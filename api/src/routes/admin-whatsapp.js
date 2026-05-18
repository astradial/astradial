/**
 * Admin WhatsApp routes — Astradial-internal MSG91 account configuration
 * and template management.
 *
 * Mounted at /api/v1/admin/whatsapp (see server.js).
 *
 * Auth: platform-admin JWT (decoded.isAdmin === true). This is intentionally
 *       NOT org-scoped — these endpoints configure the WhatsApp account WE
 *       use to send notifications TO our customer orgs, not the WhatsApp
 *       integration any individual org might have.
 *
 * Endpoints:
 *   GET    /config          — read singleton config (auth key is never returned)
 *   PATCH  /config          — update singleton (integrated_number, namespace,
 *                             selected_template_name, template_language)
 *   GET    /templates       — proxy MSG91's template list for the picker dropdown
 *   POST   /test-send       — send the configured template to a single phone
 *                             RIGHT NOW (skips the daily cron). Lets admin
 *                             verify config without waiting 24h.
 *
 * Auth-key handling: the MSG91 auth key never appears in any request or
 * response body on these routes. It lives in `MSG91_ADMIN_AUTH_KEY` env.
 * To rotate: edit /app/.env on prod + `pm2 restart astrapbx`.
 */

'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

const { AdminWhatsappConfig } = require('../models');
const msg91 = require('../services/msg91Service');

// Platform-admin gate. Accepts EITHER of:
//   1. The shared INTERNAL_API_KEY env value as a Bearer token. This is
//      the path used by the editor's server-side proxy routes — the
//      browser never sees this key, it lives in editor + astrapbx env.
//   2. A JWT (signed with JWT_SECRET) whose payload includes isAdmin=true.
//      Used by ops tooling that signs short-lived JWTs.
function requirePlatformAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Admin token required' });

  // Path 1: shared INTERNAL_API_KEY match (cheap string compare first).
  const sharedKey = process.env.INTERNAL_API_KEY;
  if (sharedKey && token === sharedKey) {
    req.adminUser = { id: null, email: 'admin@internal', via: 'internal-key' };
    return next();
  }

  // Path 2: JWT path.
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || !decoded.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.adminUser = { ...decoded, via: 'jwt' };
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid admin token' });
  }
}

// All routes here require platform admin.
router.use(requirePlatformAdmin);

// Strip server-only fields and never return the auth key in responses.
function serialiseConfig(row) {
  return {
    integrated_number: row.integrated_number,
    namespace: row.namespace,
    selected_template_name: row.selected_template_name,
    template_language: row.template_language,
    is_ready_for_send: row.isReadyForSend(),
    auth_key_present: Boolean(process.env.MSG91_ADMIN_AUTH_KEY),
    updated_by: row.updated_by,
    updated_at: row.updated_at,
  };
}

// GET /api/v1/admin/whatsapp/config
router.get('/config', async (req, res) => {
  try {
    const row = await AdminWhatsappConfig.getSingleton();
    res.json(serialiseConfig(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/v1/admin/whatsapp/config
// Body keys: integrated_number, namespace, selected_template_name, template_language
// Only the keys present in the body are updated. Pass `null` to clear a field.
router.patch('/config', async (req, res) => {
  const ALLOWED = ['integrated_number', 'namespace', 'selected_template_name', 'template_language'];
  const update = {};
  for (const k of ALLOWED) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) {
      update[k] = req.body[k] === '' ? null : req.body[k];
    }
  }
  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'no updatable fields in request body' });
  }
  update.updated_by = req.adminUser && req.adminUser.id ? req.adminUser.id : null;

  try {
    const row = await AdminWhatsappConfig.getSingleton();
    await row.update(update);
    await row.reload();
    res.json(serialiseConfig(row));
  } catch (err) {
    if (err.name === 'SequelizeValidationError') {
      return res.status(400).json({ error: err.errors.map((e) => e.message).join('; ') });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/admin/whatsapp/templates
// Proxies MSG91. We don't cache — admin clicks "refresh" infrequently and
// stale results would mask a template-approval change. If MSG91 is slow
// the admin sees that directly rather than a stale list.
router.get('/templates', async (req, res) => {
  try {
    const result = await msg91.listTemplates();
    if (!result.ok) {
      return res.status(502).json({ error: 'msg91 list-templates failed', detail: result.error });
    }
    // Slim down to the keys the UI actually uses.
    const slim = result.templates.map((t) => ({
      name: t.name || t.template_name,
      status: t.status,
      language: t.language || (t.languages && t.languages[0]),
      category: t.category,
      namespace: t.namespace,
    })).filter((t) => t.name);
    res.json({ count: slim.length, templates: slim });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/admin/whatsapp/test-send
// Body: { phone: '919812345678', sample_org_name?, sample_subscriber_name?, sample_count? }
// Sends the configured template to one number using sample variables so
// the admin can confirm template + config without waiting for 6 PM cron.
//
// Defaults are obviously-fake so a test send is always recognisable as a test
// in the recipient's WhatsApp history.
router.post('/test-send', async (req, res) => {
  const phone = String((req.body && req.body.phone) || '').trim();
  if (!/^\d{10,15}$/.test(phone)) {
    return res.status(400).json({ error: 'phone must be E.164-without-plus (10-15 digits, no leading zero)' });
  }

  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const sampleOrg = req.body && req.body.sample_org_name ? String(req.body.sample_org_name) : 'Test Org';
  const sampleName = req.body && req.body.sample_subscriber_name ? String(req.body.sample_subscriber_name) : 'Test Subscriber';
  const sampleCount = Number.isInteger(req.body && req.body.sample_count) ? req.body.sample_count : 0;

  try {
    const cfg = await AdminWhatsappConfig.getSingleton();
    if (!cfg.isReadyForSend()) {
      return res.status(400).json({
        error: 'admin WhatsApp config incomplete — set integrated_number, namespace, and selected_template_name first',
      });
    }
    const result = await msg91.sendBulkTemplate({
      integratedNumber: cfg.integrated_number,
      templateName: cfg.selected_template_name,
      namespace: cfg.namespace,
      language: cfg.template_language || 'en',
      recipients: [
        {
          to: [phone],
          components: {
            // Header {{1}} = today's date (per spec)
            header_1: { type: 'text', value: today },
            // Body {{1}} = subscriber name
            body_1: { type: 'text', value: sampleName },
            // Body {{2}} = open-ticket count
            body_2: { type: 'text', value: String(sampleCount) },
            // Button {{1}} = "View details" full URL. MSG91 validates
            // this as a URL — sending a path suffix gets rejected with
            // "Invalid URL in Button Component". For Test Send we point
            // at the editor's dashboard root since there's no real org
            // context (admin will recognise the sample data above as a
            // test send and ignore the link).
            button_1: {
              subtype: 'url',
              type: 'text',
              value: (process.env.EDITOR_BASE_URL
                || (process.env.ASTRADIAL_ENV === 'staging'
                      ? 'https://staging-editor.example.com'
                      : 'https://editor.example.com')) + '/dashboard',
            },
          },
        },
      ],
    });
    if (!result.ok) {
      return res.status(502).json({ error: 'msg91 send failed', detail: result.error, status: result.status });
    }
    res.json({ ok: true, msg91_response: result.body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
