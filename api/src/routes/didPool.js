const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { DidNumber, Organization, SipTrunk, sequelize } = require('../models');
const { requirePermission, requireRole } = require('../middleware/rbac');
const ConfigDeploymentService = require('../services/asterisk/configDeploymentService');

const configService = new ConfigDeploymentService();

// Valid state transitions — prevents invalid pool_status changes
const VALID_TRANSITIONS = {
  available: ['pending', 'assigned', 'reserved'],
  pending: ['available', 'assigned'],     // reject → available, approve → assigned
  assigned: ['available'],                 // release → available
  reserved: ['available', 'assigned'],     // unreserve or assign
};

function canTransition(from, to) {
  return VALID_TRANSITIONS[from]?.includes(to) || false;
}

// Audit log for DID state changes
async function didAuditLog(did, action, details, req) {
  try {
    await sequelize.query(
      `INSERT INTO audit_log (id, org_id, action, resource, resource_id, details, ip_address, created_at)
       VALUES (UUID(), ?, ?, 'did', ?, ?, ?, NOW())`,
      { replacements: [
        did.org_id || details.org_id || null,
        action,
        did.id,
        JSON.stringify({ number: did.number, ...details }),
        req?.ip || null,
      ]}
    );
  } catch (e) { console.warn('DID audit log failed:', e.message); }
}

// Auto-deploy: regenerate gateway routing + org config + reload Asterisk
// If the org has exactly one assigned+active DID and none is marked default,
// mark it as default. Called after approve/assign so new orgs never end up
// without an org default.
async function autoSetDefaultIfFirst(orgId) {
  if (!orgId) return;
  try {
    const dids = await DidNumber.findAll({ where: { org_id: orgId, pool_status: 'assigned', status: 'active' } });
    if (dids.length === 0) return;
    const hasDefault = dids.some(d => d.is_default);
    if (hasDefault) return;
    await dids[0].update({ is_default: true });
    console.log(`✅ Auto-set ${dids[0].number} as default DID for org ${orgId}`);
  } catch (e) { console.error('autoSetDefaultIfFirst failed:', e.message); }
}

async function autoDeploy(orgId) {
  try {
    if (orgId) {
      const org = await Organization.findByPk(orgId);
      if (org) await configService.deployOrganizationConfiguration(orgId, org.name);
    }
    // Gateway routing is deployed inside deployOrganizationConfiguration,
    // but also deploy standalone in case orgId is null
    await configService.deployGatewayRouting();
    await configService.reloadAsteriskConfiguration();
    console.log('✅ Auto-deploy completed after DID change');
  } catch (e) {
    console.error('⚠️ Auto-deploy failed:', e.message);
  }
}

// ══════════════════════════════════════════════════════════════════════
// ORG-FACING ENDPOINTS (authenticated org user)
// ══════════════════════════════════════════════════════════════════════

// Browse available DIDs in the pool — filtered to this environment so
// orgs on prod only see DIDs earmarked for prod (and likewise on staging).
// Admin endpoint /admin/all stays unfiltered for cross-env management.
router.get('/available', async (req, res) => {
  try {
    const env = process.env.ASTRADIAL_ENV === 'staging' ? 'staging' : 'prod';
    const dids = await DidNumber.findAll({
      where: { pool_status: 'available', status: 'active', routing_environment: env },
      attributes: ['id', 'number', 'description', 'region', 'provider', 'monthly_price'],
      order: [['monthly_price', 'ASC'], ['number', 'ASC']],
    });
    res.json(dids);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Request (buy) a DID — goes to pending (with row lock to prevent race conditions)
router.post('/:id/request', async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // Lock the row — prevents two orgs requesting the same DID simultaneously
    const did = await DidNumber.findByPk(req.params.id, { lock: t.LOCK.UPDATE, transaction: t });
    if (!did) { await t.rollback(); return res.status(404).json({ error: 'DID not found' }); }
    if (!canTransition(did.pool_status, 'pending')) {
      await t.rollback();
      return res.status(409).json({ error: `This number is ${did.pool_status} and cannot be requested.` });
    }

    await did.update({
      pool_status: 'pending',
      requested_by_org: req.orgId,
      requested_at: new Date(),
    }, { transaction: t });

    await t.commit();
    didAuditLog(did, 'did.requested', { org_id: req.orgId }, req);
    res.json({ message: 'Number requested, awaiting admin approval', did });
  } catch (e) { await t.rollback(); res.status(500).json({ error: e.message }); }
});

// Cancel own pending request
router.post('/:id/cancel-request', async (req, res) => {
  try {
    const did = await DidNumber.findByPk(req.params.id);
    if (!did) return res.status(404).json({ error: 'DID not found' });
    if (did.pool_status !== 'pending' || did.requested_by_org !== req.orgId) {
      return res.status(403).json({ error: 'Cannot cancel this request' });
    }

    await did.update({
      pool_status: 'available',
      requested_by_org: null,
      requested_at: null,
    });

    res.json({ message: 'Request cancelled' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// My org's DIDs (assigned + pending)
router.get('/my', async (req, res) => {
  try {
    const assigned = await DidNumber.findAll({
      where: { org_id: req.orgId, pool_status: 'assigned' },
      include: [{ model: SipTrunk, as: 'trunk', attributes: ['id', 'name'] }],
      order: [['number', 'ASC']],
    });
    const pending = await DidNumber.findAll({
      where: { requested_by_org: req.orgId, pool_status: 'pending' },
      attributes: ['id', 'number', 'description', 'region', 'provider', 'monthly_price', 'requested_at'],
      order: [['requested_at', 'DESC']],
    });
    res.json({ assigned, pending });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Set this DID as the org's default outbound caller ID.
// Must be owned by the user's org and assigned. Clears is_default on all
// other DIDs of the same org first. Requires owner or admin role.
router.post('/:id/set-default', requireRole('admin'), async (req, res) => {
  try {
    const did = await DidNumber.findByPk(req.params.id);
    if (!did || did.org_id !== req.orgId) return res.status(404).json({ error: 'DID not found' });
    if (did.pool_status !== 'assigned' || did.status !== 'active') {
      return res.status(400).json({ error: 'DID must be assigned + active' });
    }
    await sequelize.transaction(async (t) => {
      await DidNumber.update({ is_default: false }, { where: { org_id: req.orgId }, transaction: t });
      await did.update({ is_default: true }, { transaction: t });
    });
    autoDeploy(req.orgId);
    res.json({ message: `${did.number} set as default outbound caller ID`, did });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS (admin auth required)
// ══════════════════════════════════════════════════════════════════════

// List ALL DIDs with org info (admin dashboard)
router.get('/admin/all', async (req, res) => {
  try {
    const { status, pool_status: ps, org_id } = req.query;
    const where = {};
    if (status) where.status = status;
    if (ps) where.pool_status = ps;
    if (org_id) where.org_id = org_id;

    const dids = await DidNumber.findAll({
      where,
      include: [
        { model: Organization, as: 'organization', attributes: ['id', 'name'] },
        { model: SipTrunk, as: 'trunk', attributes: ['id', 'name'] },
      ],
      order: [['number', 'ASC']],
    });

    // Also count by status
    const counts = {
      available: await DidNumber.count({ where: { pool_status: 'available' } }),
      pending: await DidNumber.count({ where: { pool_status: 'pending' } }),
      assigned: await DidNumber.count({ where: { pool_status: 'assigned' } }),
      reserved: await DidNumber.count({ where: { pool_status: 'reserved' } }),
      total: await DidNumber.count(),
    };

    res.json({ dids, counts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk add DIDs to pool
router.post('/admin/bulk', async (req, res) => {
  try {
    const { numbers, provider, region, monthly_price, trunk_id } = req.body;
    if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
      return res.status(400).json({ error: 'numbers array required' });
    }

    const created = [];
    const skipped = [];

    for (const num of numbers) {
      const number = String(num).replace(/[^0-9+]/g, '');
      const existing = await DidNumber.findOne({ where: { number } });
      if (existing) { skipped.push(number); continue; }

      const did = await DidNumber.create({
        number,
        pool_status: 'available',
        status: 'active',
        provider: provider || null,
        region: region || null,
        monthly_price: monthly_price || null,
        trunk_id: trunk_id || null,
        org_id: null,
        routing_type: null,
        routing_destination: null,
      });
      created.push(did);
    }

    res.status(201).json({ created: created.length, skipped: skipped.length, skipped_numbers: skipped });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Approve pending request
router.post('/admin/:id/approve', async (req, res) => {
  try {
    const did = await DidNumber.findByPk(req.params.id);
    if (!did) return res.status(404).json({ error: 'DID not found' });
    if (did.pool_status !== 'pending') return res.status(409).json({ error: `DID is ${did.pool_status}, not pending` });
    if (!did.requested_by_org) return res.status(400).json({ error: 'No requesting org' });

    await did.update({
      pool_status: 'assigned',
      org_id: did.requested_by_org,
      requested_by_org: null,
      requested_at: null,
    });

    // Auto-set as default if this is the org's only assigned DID
    await autoSetDefaultIfFirst(did.org_id);

    autoDeploy(did.org_id);
    didAuditLog(did, 'did.approved', { org_id: did.org_id }, req);

    res.json({ message: `DID ${did.number} assigned`, did });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reject pending request
router.post('/admin/:id/reject', async (req, res) => {
  try {
    const did = await DidNumber.findByPk(req.params.id);
    if (!did) return res.status(404).json({ error: 'DID not found' });
    if (did.pool_status !== 'pending') return res.status(409).json({ error: `DID is ${did.pool_status}, not pending` });

    await did.update({
      pool_status: 'available',
      requested_by_org: null,
      requested_at: null,
    });

    res.json({ message: 'Request rejected, DID returned to pool' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin manually assign DID to org
router.post('/admin/:id/assign', async (req, res) => {
  try {
    const { org_id } = req.body;
    if (!org_id) return res.status(400).json({ error: 'org_id required' });

    const did = await DidNumber.findByPk(req.params.id);
    if (!did) return res.status(404).json({ error: 'DID not found' });
    if (did.pool_status === 'assigned' && did.org_id) {
      return res.status(409).json({ error: `DID already assigned to org ${did.org_id}` });
    }

    const org = await Organization.findByPk(org_id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    await did.update({
      pool_status: 'assigned',
      org_id,
      requested_by_org: null,
      requested_at: null,
    });

    await autoSetDefaultIfFirst(org_id);

    autoDeploy(org_id);

    res.json({ message: `DID ${did.number} assigned to ${org.name}`, did });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Release DID back to pool
router.post('/admin/:id/release', async (req, res) => {
  try {
    const did = await DidNumber.findByPk(req.params.id);
    if (!did) return res.status(404).json({ error: 'DID not found' });

    await did.update({
      pool_status: 'available',
      org_id: null,
      routing_type: null,
      routing_destination: null,
      recording_enabled: false,
      requested_by_org: null,
      requested_at: null,
    });

    autoDeploy(null); // no org — just regenerate gateway routing

    res.json({ message: `DID ${did.number} released to pool` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin update DID details (price, region, description, etc.)
router.put('/admin/:id', async (req, res) => {
  try {
    const did = await DidNumber.findByPk(req.params.id);
    if (!did) return res.status(404).json({ error: 'DID not found' });

    const allowed = ['description', 'region', 'provider', 'monthly_price', 'status', 'trunk_id', 'routing_environment'];
    const data = {};
    for (const k of allowed) { if (req.body[k] !== undefined) data[k] = req.body[k]; }

    await did.update(data);
    res.json(did);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
