/**
 * Customer Tunnels routes — HTTP surface for managing WireGuard tunnels.
 *
 * Mounted at /api/v1/customer-tunnels (see server.js).
 * Auth: org-scoped (req.orgId from authenticateOrg middleware).
 * RBAC: admin role required for mutations (POST/PATCH/DELETE/customer-config).
 *
 * Concurrency strategy: commit DB → then call applier. If applier fails,
 * the tunnel row remains but is flagged disabled and the API returns 500
 * with diagnostic info. Operator can retry or delete via the same API.
 *
 * See: docs/features/customer-tunnels.md
 */

'use strict';

const express = require('express');
const router = express.Router();
const fs = require('node:fs/promises');
const path = require('node:path');
const { Op } = require('sequelize');

const { CustomerTunnel, TunnelMetric, sequelize } = require('../models');
const { allocateNextAvailable } = require('../services/network/subnetAllocator');
const { applyWg1Config } = require('../services/network/wireguardApplier');
const {
  renderCustomerSidePeer,
  loadServerPublicKey,
  DEFAULT_LISTEN_PORT
} = require('../services/network/wireguardGenerator');
const { getTunnelStatus } = require('../services/network/wireguardStatusService');
const { requireRole } = require('../middleware/rbac');
const {
  TUNNEL_NAME_REGEX,
  WG_KEY_REGEX,
  SUBNET_ALLOC_RETRIES,
  generatePsk,
  validateCreateInput,
  serializeTunnel,
  assertValidCustomerLanCidr,
  assertNoCustomerLanOverlap,
  normalizeCidr
} = require('./customer-tunnels-helpers');

// ─── Constants ────────────────────────────────────────────────────────────

// Cloud's public IP for the customer-config endpoint payload. MUST be set
// via env (e.g. CLOUD_PUBLIC_IP=203.0.113.1 in prod, =203.0.113.2 in
// staging). If unset we fall back to the prod IP and log a loud warning —
// this defaults to "fail noisy" rather than "silently emit wrong IP on
// staging". The customer-config endpoint will still work; configs just
// point at the wrong cloud until ops fixes the env.
const CLOUD_PUBLIC_IP = process.env.CLOUD_PUBLIC_IP || '203.0.113.1';
if (!process.env.CLOUD_PUBLIC_IP) {
  console.warn(
    '[customer-tunnels] WARNING: CLOUD_PUBLIC_IP env var is unset — defaulting to prod IP ' +
    `${CLOUD_PUBLIC_IP}. Set CLOUD_PUBLIC_IP in this VPS .env to suppress this warning.`
  );
}

// Fallback audit log file when DB INSERT fails. JSONL — one record per line
// so an operator can grep + parse. Path overridable for tests.
const AUDIT_FALLBACK_LOG = process.env.AUDIT_FALLBACK_LOG ||
  '/var/log/astrapbx-audit-fallback.log';

/**
 * Write a row to audit_log via raw SQL (matches the didPool routes pattern —
 * no AuditLog Sequelize model exists).
 *
 * On DB failure: fall back to appending the row as JSONL to a local file.
 * Loss of an audit entry on tunnel create/revoke is a real security gap
 * (these grant/revoke network access). Fallback ensures the entry is
 * preserved even if MariaDB is briefly unreachable — an operator can later
 * replay from the fallback log into audit_log.
 *
 * Audit finding P1 #4.
 */
async function tunnelAuditLog({ orgId, userId, userEmail, action, resourceId, details, req }) {
  const row = {
    org_id: orgId,
    user_id: userId || null,
    user_email: userEmail || null,
    action,
    resource: 'customer_tunnel',
    resource_id: resourceId || null,
    details: details || {},
    ip_address: req?.ip || null,
    created_at: new Date().toISOString()
  };

  try {
    await sequelize.query(
      `INSERT INTO audit_log
         (org_id, user_id, user_email, action, resource, resource_id, details, ip_address, created_at)
       VALUES (?, ?, ?, ?, 'customer_tunnel', ?, ?, ?, NOW())`,
      {
        replacements: [
          row.org_id,
          row.user_id,
          row.user_email,
          row.action,
          row.resource_id,
          JSON.stringify(row.details),
          row.ip_address
        ]
      }
    );
    return;
  } catch (err) {
    console.error(`audit_log DB insert failed for ${action}: ${err.message} — falling back to file`);
  }

  // Fallback: append JSONL to local file. Best-effort — if even this fails,
  // log to stderr and continue (we never let audit failures break the
  // operation itself).
  try {
    await fs.mkdir(path.dirname(AUDIT_FALLBACK_LOG), { recursive: true });
    await fs.appendFile(AUDIT_FALLBACK_LOG, JSON.stringify(row) + '\n', { mode: 0o600 });
    console.error(`audit_log fallback: wrote ${action} entry to ${AUDIT_FALLBACK_LOG}`);
  } catch (fallbackErr) {
    console.error(`audit_log fallback ALSO failed for ${action}: ${fallbackErr.message}`);
    console.error(`LOST AUDIT ENTRY: ${JSON.stringify(row)}`);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────

/**
 * GET /  — list tunnels for the authenticated org.
 */
router.get('/', async (req, res) => {
  try {
    if (!req.orgId) return res.status(401).json({ error: 'Unauthorized' });
    const tunnels = await CustomerTunnel.findAll({
      where: { org_id: req.orgId },
      order: [['created_at', 'DESC']]
    });
    res.json({ tunnels: tunnels.map(serializeTunnel), count: tunnels.length });
  } catch (err) {
    console.error('GET /customer-tunnels failed:', err);
    res.status(500).json({ error: 'Internal error', message: err.message });
  }
});

/**
 * GET /:id  — one tunnel detail (DB state; no live wg-show probe yet).
 */
router.get('/:id', async (req, res) => {
  try {
    if (!req.orgId) return res.status(401).json({ error: 'Unauthorized' });
    const tunnel = await CustomerTunnel.findOne({
      where: { id: req.params.id, org_id: req.orgId }
    });
    if (!tunnel) return res.status(404).json({ error: 'Tunnel not found' });
    res.json({ tunnel: serializeTunnel(tunnel) });
  } catch (err) {
    console.error('GET /customer-tunnels/:id failed:', err);
    res.status(500).json({ error: 'Internal error', message: err.message });
  }
});

/**
 * POST /  — create a new tunnel.
 *
 * Flow:
 *   1. Validate input
 *   2. Allocate next /30 subnet (retry on UNIQUE collision)
 *   3. Generate PSK
 *   4. INSERT customer_tunnels row (commits immediately)
 *   5. Call applier to update wg1.conf + reload
 *   6. If applier fails: flag tunnel disabled, return 500 with diagnostics
 *   7. If applier succeeds: audit-log, return 201
 *
 * Race condition: two concurrent POSTs may allocate the same /30; the
 * UNIQUE constraint on tunnel_subnet rejects the second INSERT. We retry
 * up to SUBNET_ALLOC_RETRIES times before failing.
 */
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    if (!req.orgId) return res.status(401).json({ error: 'Unauthorized' });

    const validation = validateCreateInput(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: 'Validation failed', errors: validation.errors });
    }

    // If customer_lan_cidr is provided, normalize to canonical
    // network-address form (e.g., "10.5.1.5/16" → "10.5.0.0/16") so
    // wg's strict AllowedIPs parser accepts it later. Then check it
    // doesn't overlap with any other customer's LAN. Static checks
    // (private range, infra non-overlap, prefix bounds) were done in
    // validateCreateInput. Cross-customer overlap needs DB context.
    let lanCidr = null;
    if (req.body.customer_lan_cidr && typeof req.body.customer_lan_cidr === 'string') {
      const trimmed = req.body.customer_lan_cidr.trim();
      if (trimmed !== '') {
        try {
          lanCidr = normalizeCidr(trimmed);
        } catch (err) {
          // validateCreateInput should have caught this earlier; this is
          // defense-in-depth for paths that bypass it.
          return res.status(400).json({
            error: 'Validation failed',
            errors: [{ field: 'customer_lan_cidr', message: err.message }]
          });
        }
      }
    }
    if (lanCidr) {
      const existing = await CustomerTunnel.findAll({
        where: {
          status: { [Op.in]: ['active', 'disabled'] },
          customer_lan_cidr: { [Op.ne]: null }
        },
        attributes: ['customer_lan_cidr']
      });
      try {
        assertNoCustomerLanOverlap(lanCidr, existing.map((t) => t.customer_lan_cidr));
      } catch (overlapErr) {
        return res.status(400).json({
          error: 'Validation failed',
          errors: [{ field: 'customer_lan_cidr', message: overlapErr.message }]
        });
      }
    }

    // Allocate subnet + insert with retry on UNIQUE collision
    let tunnel = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= SUBNET_ALLOC_RETRIES; attempt++) {
      try {
        const allocation = await allocateNextAvailable({ models: require('../models') });
        const psk = generatePsk();
        tunnel = await CustomerTunnel.create({
          org_id: req.orgId,
          name: req.body.name,
          tunnel_subnet: allocation.subnet,
          cloud_tunnel_ip: allocation.cloud_ip,
          customer_tunnel_ip: allocation.customer_ip,
          customer_lan_cidr: lanCidr,
          customer_pubkey: req.body.customer_pubkey,
          preshared_key: psk,
          notes: req.body.notes || null,
          created_by_user_id: req.userId || null
        });
        break;
      } catch (err) {
        lastErr = err;
        if (err.name === 'SequelizeUniqueConstraintError' && attempt < SUBNET_ALLOC_RETRIES) {
          // Race: another caller took our /30. Retry the allocator.
          continue;
        }
        throw err;
      }
    }
    if (!tunnel) {
      throw new Error(`Subnet allocation failed after ${SUBNET_ALLOC_RETRIES} retries: ${lastErr?.message}`);
    }

    // Apply to wg1
    let applyResult = null;
    let applyError = null;
    try {
      applyResult = await applyWg1Config({ models: require('../models') });
    } catch (err) {
      applyError = err;
      // Flag the tunnel disabled so it doesn't appear in the next apply.
      // Subnet stays reserved (cooldown) so re-allocation doesn't immediately
      // hand it out to the next caller.
      await tunnel.update({ status: 'disabled' }).catch(() => {});
    }

    // Route-sync warnings (non-fatal). If syncCustomerLanRoutes returned any
    // errors, surface them via console.error AND the audit log AND the
    // response — operator must see when route-sync silently fails (UAT review
    // of PR #148 flagged "operator sees 201 OK while SIP is still broken").
    const routeSyncWarnings = applyResult?.routeSync?.errors || [];
    if (routeSyncWarnings.length > 0) {
      console.error(
        `[customer-tunnels] route-sync warnings on tunnel ${tunnel.id} (${tunnel.name}):`,
        routeSyncWarnings
      );
    }

    await tunnelAuditLog({
      orgId: req.orgId,
      userId: req.userId,
      userEmail: req.userEmail,
      action: applyError ? 'customer_tunnel.create_apply_failed' : 'customer_tunnel.created',
      resourceId: tunnel.id,
      details: {
        name: tunnel.name,
        subnet: tunnel.tunnel_subnet,
        applied: !applyError,
        apply_error: applyError ? applyError.message : null,
        route_sync: applyResult?.routeSync || null
      },
      req
    });

    if (applyError) {
      return res.status(500).json({
        error: 'Tunnel created but apply failed',
        message: applyError.message,
        tunnel: serializeTunnel(tunnel),
        recovery: 'Tunnel row is in DB with status=disabled. Retry by PATCH-ing status=active, or DELETE to remove.'
      });
    }

    res.status(201).json({
      tunnel: serializeTunnel(tunnel),
      apply: {
        peer_count: applyResult.peerCount,
        backup_path: applyResult.backupPath,
        route_sync: applyResult.routeSync || null
      },
      // If route-sync had issues, surface them as warnings so the editor UI
      // can show them. SIP traffic from the customer LAN won't reach Asterisk
      // until the route is in place.
      warnings: routeSyncWarnings.length > 0
        ? routeSyncWarnings.map((e) => `route-sync: ${e}`)
        : undefined
    });
  } catch (err) {
    console.error('POST /customer-tunnels failed:', err);
    res.status(500).json({ error: 'Internal error', message: err.message });
  }
});

/**
 * PATCH /:id  — update status (active/disabled), notes, or customer_lan_cidr.
 *
 * Status transitions trigger a re-apply (so disabling immediately removes
 * the peer from wg1; re-enabling immediately adds it back).
 * customer_lan_cidr changes also trigger a re-apply so the new LAN is
 * reflected in the peer's AllowedIPs.
 */
router.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    if (!req.orgId) return res.status(401).json({ error: 'Unauthorized' });

    // Guard against missing body or wrong Content-Type — would otherwise
    // throw when accessing `req.body.status`, surfacing as a 500 instead
    // of a clean 400.
    const body = (req.body && typeof req.body === 'object') ? req.body : null;
    if (!body) {
      return res.status(400).json({
        error: 'Request body required',
        hint: 'Send a JSON body with at least one of: status, notes. Ensure Content-Type: application/json.'
      });
    }

    const tunnel = await CustomerTunnel.findOne({
      where: { id: req.params.id, org_id: req.orgId }
    });
    if (!tunnel) return res.status(404).json({ error: 'Tunnel not found' });
    if (tunnel.status === 'revoked') {
      return res.status(400).json({ error: 'Cannot modify a revoked tunnel; create a new one instead' });
    }

    const updates = {};
    if (body.status !== undefined) {
      if (!['active', 'disabled'].includes(body.status)) {
        return res.status(400).json({ error: 'status must be "active" or "disabled" (use DELETE to revoke)' });
      }
      updates.status = body.status;
    }
    if (body.notes !== undefined) {
      if (typeof body.notes !== 'string' || body.notes.length > 4000) {
        return res.status(400).json({ error: 'notes must be string ≤4000 chars' });
      }
      updates.notes = body.notes;
    }
    if (body.customer_lan_cidr !== undefined) {
      // null / '' / falsy means "clear the LAN" — accept that.
      if (body.customer_lan_cidr === null || body.customer_lan_cidr === '') {
        updates.customer_lan_cidr = null;
      } else if (typeof body.customer_lan_cidr !== 'string') {
        return res.status(400).json({ error: 'customer_lan_cidr must be a string or null' });
      } else {
        const lanRaw = body.customer_lan_cidr.trim();
        if (lanRaw === '') {
          updates.customer_lan_cidr = null;
        } else {
          try {
            assertValidCustomerLanCidr(lanRaw);
          } catch (err) {
            return res.status(400).json({
              error: 'Validation failed',
              errors: [{ field: 'customer_lan_cidr', message: err.message }]
            });
          }
          // Normalize to network-address form before storing — see comment
          // in the POST handler.
          const lan = normalizeCidr(lanRaw);
          // Cross-customer overlap check — exclude this tunnel itself.
          const existing = await CustomerTunnel.findAll({
            where: {
              id: { [Op.ne]: tunnel.id },
              status: { [Op.in]: ['active', 'disabled'] },
              customer_lan_cidr: { [Op.ne]: null }
            },
            attributes: ['customer_lan_cidr']
          });
          try {
            assertNoCustomerLanOverlap(lan, existing.map((t) => t.customer_lan_cidr));
          } catch (overlapErr) {
            return res.status(400).json({
              error: 'Validation failed',
              errors: [{ field: 'customer_lan_cidr', message: overlapErr.message }]
            });
          }
          updates.customer_lan_cidr = lan;
        }
      }
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields in request body' });
    }

    const prevStatus = tunnel.status;
    const prevLanCidr = tunnel.customer_lan_cidr;
    await tunnel.update(updates);

    // Re-apply when anything that affects wg1.conf changes (status or LAN).
    let applyResult = null;
    let applyError = null;
    const lanCidrChanged = updates.customer_lan_cidr !== undefined &&
                           updates.customer_lan_cidr !== prevLanCidr;
    const statusChanged = updates.status && updates.status !== prevStatus;
    if (statusChanged || lanCidrChanged) {
      try {
        applyResult = await applyWg1Config({ models: require('../models') });
      } catch (err) {
        applyError = err;
      }
    }

    // Route-sync warnings (non-fatal). Same pattern as POST — operator must
    // see when route-sync silently fails so the UI can warn instead of
    // showing green while SIP is broken.
    const routeSyncWarnings = applyResult?.routeSync?.errors || [];
    if (routeSyncWarnings.length > 0) {
      console.error(
        `[customer-tunnels] route-sync warnings on tunnel ${tunnel.id} (${tunnel.name}) update:`,
        routeSyncWarnings
      );
    }

    await tunnelAuditLog({
      orgId: req.orgId,
      userId: req.userId,
      userEmail: req.userEmail,
      action: 'customer_tunnel.updated',
      resourceId: tunnel.id,
      details: {
        updates,
        prev_status: prevStatus,
        applied: applyResult ? true : false,
        apply_error: applyError?.message || null,
        route_sync: applyResult?.routeSync || null
      },
      req
    });

    if (applyError) {
      return res.status(500).json({
        error: 'Tunnel updated but re-apply failed',
        message: applyError.message,
        tunnel: serializeTunnel(tunnel)
      });
    }

    res.json({
      tunnel: serializeTunnel(tunnel),
      apply: applyResult
        ? {
            peer_count: applyResult.peerCount,
            route_sync: applyResult.routeSync || null
          }
        : null,
      warnings: routeSyncWarnings.length > 0
        ? routeSyncWarnings.map((e) => `route-sync: ${e}`)
        : undefined
    });
  } catch (err) {
    console.error('PATCH /customer-tunnels/:id failed:', err);
    res.status(500).json({ error: 'Internal error', message: err.message });
  }
});

/**
 * DELETE /:id  — revoke a tunnel (soft delete; subnet stays reserved 30d).
 */
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    if (!req.orgId) return res.status(401).json({ error: 'Unauthorized' });

    const tunnel = await CustomerTunnel.findOne({
      where: { id: req.params.id, org_id: req.orgId }
    });
    if (!tunnel) return res.status(404).json({ error: 'Tunnel not found' });
    if (tunnel.status === 'revoked') {
      return res.json({ tunnel: serializeTunnel(tunnel), message: 'Already revoked' });
    }

    await tunnel.update({ status: 'revoked' });

    // Re-apply to remove the peer from wg1
    let applyResult = null;
    let applyError = null;
    try {
      applyResult = await applyWg1Config({ models: require('../models') });
    } catch (err) {
      applyError = err;
    }

    // Route-sync surfacing (same pattern as POST/PATCH). On revoke, the
    // expected behaviour is that the customer's LAN route is REMOVED from
    // the kernel (since the tunnel is no longer active). If that fails,
    // operator needs to see the warning — a stale route could route
    // traffic into a dead tunnel.
    const routeSyncWarnings = applyResult?.routeSync?.errors || [];
    if (routeSyncWarnings.length > 0) {
      console.error(
        `[customer-tunnels] route-sync warnings on tunnel ${tunnel.id} (${tunnel.name}) revoke:`,
        routeSyncWarnings
      );
    }

    await tunnelAuditLog({
      orgId: req.orgId,
      userId: req.userId,
      userEmail: req.userEmail,
      action: 'customer_tunnel.revoked',
      resourceId: tunnel.id,
      details: {
        name: tunnel.name,
        subnet: tunnel.tunnel_subnet,
        applied: !applyError,
        apply_error: applyError?.message || null,
        route_sync: applyResult?.routeSync || null
      },
      req
    });

    if (applyError) {
      return res.status(500).json({
        error: 'Tunnel revoked in DB but apply failed',
        message: applyError.message,
        tunnel: serializeTunnel(tunnel)
      });
    }

    res.json({
      tunnel: serializeTunnel(tunnel),
      message: 'Revoked',
      apply: applyResult
        ? {
            peer_count: applyResult.peerCount,
            route_sync: applyResult.routeSync || null
          }
        : null,
      warnings: routeSyncWarnings.length > 0
        ? routeSyncWarnings.map((e) => `route-sync: ${e}`)
        : undefined
    });
  } catch (err) {
    console.error('DELETE /customer-tunnels/:id failed:', err);
    res.status(500).json({ error: 'Internal error', message: err.message });
  }
});

/**
 * GET /:id/customer-config  — render the [Peer] block for the customer
 * to paste into their router (e.g., GDMS WireGuard config).
 */
router.get('/:id/customer-config', requireRole('admin'), async (req, res) => {
  try {
    if (!req.orgId) return res.status(401).json({ error: 'Unauthorized' });

    // Need PSK → use withSecrets scope
    const tunnel = await CustomerTunnel.scope('withSecrets').findOne({
      where: { id: req.params.id, org_id: req.orgId }
    });
    if (!tunnel) return res.status(404).json({ error: 'Tunnel not found' });

    let cloudPubKey;
    try {
      cloudPubKey = await loadServerPublicKey();
    } catch (err) {
      return res.status(503).json({
        error: 'Server WireGuard public key unavailable',
        message: err.message,
        hint: 'Has wg1 been bootstrapped on this VPS? See customer-tunnels.md bootstrap procedure.'
      });
    }

    // Canonicalize cloud_tunnel_ip to 10.20.0.1 — the only address actually
    // bound to wg1 (see DEFAULT_INTERFACE_ADDRESS in wireguardGenerator.js).
    // Each customer's /30 allocation produces a per-customer cloud_tunnel_ip
    // (.1, .5, .9, etc.) in the DB row, but only the first customer's .1
    // happens to match the interface. Every other customer would otherwise
    // dial an IP that isn't bound to anything.
    const CANONICAL_CLOUD_TUNNEL_IP = '10.20.0.1';
    const renderTunnel = Object.assign({}, tunnel.toJSON ? tunnel.toJSON() : tunnel, {
      cloud_tunnel_ip: CANONICAL_CLOUD_TUNNEL_IP
    });

    // cloud_routed_ips is intentionally EMPTY. Including the cloud's public
    // IP (e.g., 203.0.113.1/32) would create a routing loop: the customer
    // router would try to send packets to 203.0.113.1 *through* the tunnel,
    // but the tunnel's Endpoint IS 203.0.113.1 → routers like GWN7002
    // detect this and refuse to save the peer config. renderCustomerSidePeer
    // automatically adds the cloud_tunnel_ip (10.20.0.1) — that's all the
    // customer needs to reach Asterisk through the tunnel.
    const config = renderCustomerSidePeer({
      tunnel: renderTunnel,
      cloud_public_key: cloudPubKey,
      cloud_endpoint: `${CLOUD_PUBLIC_IP}:${DEFAULT_LISTEN_PORT}`,
      cloud_routed_ips: []
    });

    await tunnelAuditLog({
      orgId: req.orgId,
      userId: req.userId,
      userEmail: req.userEmail,
      action: 'customer_tunnel.customer_config_viewed',
      resourceId: tunnel.id,
      details: { name: tunnel.name },
      req
    });

    res.json({
      tunnel_id: tunnel.id,
      customer_peer_config: config,
      cloud_public_key: cloudPubKey,
      cloud_endpoint: `${CLOUD_PUBLIC_IP}:${DEFAULT_LISTEN_PORT}`,
      cloud_tunnel_ip: CANONICAL_CLOUD_TUNNEL_IP,
      customer_tunnel_ip: tunnel.customer_tunnel_ip
    });
  } catch (err) {
    console.error('GET /customer-tunnels/:id/customer-config failed:', err);
    res.status(500).json({ error: 'Internal error', message: err.message });
  }
});

/**
 * GET /:id/status  — live status of one tunnel from `wg show wg1 dump`.
 *
 * Read-only; no RBAC restriction beyond org auth (operators viewing their
 * own tunnel state). Single shell exec per request — cheap.
 */
router.get('/:id/status', async (req, res) => {
  try {
    if (!req.orgId) return res.status(401).json({ error: 'Unauthorized' });

    const tunnel = await CustomerTunnel.findOne({
      where: { id: req.params.id, org_id: req.orgId }
    });
    if (!tunnel) return res.status(404).json({ error: 'Tunnel not found' });

    let status;
    try {
      status = await getTunnelStatus({ tunnel });
    } catch (err) {
      // wg interface might not be bootstrapped; surface that distinctly
      return res.status(503).json({
        error: 'WireGuard status unavailable',
        message: err.message,
        hint: 'wg1 may not be running on this VPS yet.'
      });
    }
    res.json({ tunnel_id: tunnel.id, status });
  } catch (err) {
    console.error('GET /customer-tunnels/:id/status failed:', err);
    res.status(500).json({ error: 'Internal error', message: err.message });
  }
});

/**
 * GET /:id/metrics?from=<ISO>&to=<ISO>  — historical snapshots.
 *
 * Returns tunnel_metrics rows for the given tunnel within the time range.
 * Defaults: last 24h. Max range: 30 days (caps DB scan).
 */
router.get('/:id/metrics', async (req, res) => {
  try {
    if (!req.orgId) return res.status(401).json({ error: 'Unauthorized' });

    const tunnel = await CustomerTunnel.findOne({
      where: { id: req.params.id, org_id: req.orgId },
      attributes: ['id']
    });
    if (!tunnel) return res.status(404).json({ error: 'Tunnel not found' });

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    let from = req.query.from ? new Date(req.query.from) : defaultFrom;
    let to = req.query.to ? new Date(req.query.to) : now;

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return res.status(400).json({ error: 'from/to must be ISO 8601 timestamps' });
    }
    if (to < from) {
      return res.status(400).json({ error: 'to must be >= from' });
    }

    // Range cap: 3 days max. At 60s polling that's 4,320 rows — fits under
    // the 5,000-row safety cap with headroom. Audit finding P0 #2 lowered
    // this from 30d after we noticed 30d × 1440/day = 43,200 rows would
    // silently truncate at the 5k limit. For longer historical analysis,
    // query tunnel_metrics directly via SQL.
    const maxRangeMs = 3 * 24 * 60 * 60 * 1000;
    if (to - from > maxRangeMs) {
      return res.status(400).json({ error: 'Range too large (max 3 days)' });
    }

    const ROW_LIMIT = 5000;
    const metrics = await TunnelMetric.findAll({
      where: {
        tunnel_id: tunnel.id,
        snapshot_at: { [Op.gte]: from, [Op.lte]: to }
      },
      order: [['snapshot_at', 'ASC']],
      limit: ROW_LIMIT
    });

    // Signal partial results if we hit the row cap — UI / callers can
    // detect and either narrow the range or warn the user.
    const truncated = metrics.length >= ROW_LIMIT;

    res.json({
      tunnel_id: tunnel.id,
      from: from.toISOString(),
      to: to.toISOString(),
      count: metrics.length,
      truncated,
      ...(truncated ? { truncation_note: `Returned the most recent ${ROW_LIMIT} rows of a larger range. Narrow 'from'/'to' for complete data.` } : {}),
      metrics: metrics.map((m) => ({
        snapshot_at: m.snapshot_at?.toISOString?.() || m.snapshot_at,
        latest_handshake_at: m.latest_handshake_at?.toISOString?.() || m.latest_handshake_at,
        endpoint_ip: m.endpoint_ip,
        endpoint_port: m.endpoint_port,
        bytes_received: Number(m.bytes_received),  // BIGINT → Number for JSON
        bytes_sent: Number(m.bytes_sent),
        peer_count_total: m.peer_count_total
      }))
    });
  } catch (err) {
    console.error('GET /customer-tunnels/:id/metrics failed:', err);
    res.status(500).json({ error: 'Internal error', message: err.message });
  }
});

module.exports = router;
