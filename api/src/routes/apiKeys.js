const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { OrgApiKey } = require('../models');
const { requireRole } = require('../middleware/rbac');

const AVAILABLE_PERMISSIONS = [
  'calls.read',
  'calls.write',
  'calls.click_to_call',
  'calls.originate_ai',
  'calls.recording',
  'calls.live',
  'calls.transfer',
  'calls.hangup',
  'calls.hold',
];

// List API keys for the org
router.get('/', async (req, res) => {
  try {
    const keys = await OrgApiKey.findAll({
      where: { org_id: req.orgId },
      attributes: ['id', 'name', 'api_key', 'permissions', 'status', 'last_used_at', 'created_by', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });
    res.json({ keys, available_permissions: AVAILABLE_PERMISSIONS });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create API key
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name, permissions } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    // Generate key and secret
    const apiKey = `ak_${crypto.randomBytes(16).toString('hex')}`;
    const apiSecret = `as_${crypto.randomBytes(24).toString('hex')}`;
    const secretHash = await bcrypt.hash(apiSecret, 10);

    const key = await OrgApiKey.create({
      org_id: req.orgId,
      name,
      api_key: apiKey,
      api_secret_hash: secretHash,
      permissions: permissions || AVAILABLE_PERMISSIONS,
      created_by: req.userEmail || null,
    });

    // Return secret only once — it can't be retrieved later
    res.status(201).json({
      id: key.id,
      name: key.name,
      api_key: apiKey,
      api_secret: apiSecret, // shown ONCE
      permissions: key.permissions,
      message: 'Save the API secret now — it cannot be retrieved later.',
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Update API key (name, permissions)
router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const key = await OrgApiKey.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!key) return res.status(404).json({ error: 'API key not found' });

    const { name, permissions } = req.body;
    if (name) key.name = name;
    if (permissions) key.permissions = permissions;
    await key.save();

    res.json(key);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Revoke API key
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const key = await OrgApiKey.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!key) return res.status(404).json({ error: 'API key not found' });

    await key.update({ status: 'revoked' });
    res.json({ message: 'API key revoked' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
