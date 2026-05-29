/**
 * Ticket Alerts routes — org-scoped management of the daily missed-call
 * WhatsApp alert.
 *
 * Mounted at /api/v1/orgs/:orgId/ticket-alerts (see server.js).
 * Auth: org-scoped (req.orgId from authenticateOrg middleware).
 * RBAC: owner/admin role required for mutations. Read is open to any
 *       authenticated org member so the UI can hide the section for
 *       non-managers without 401-ing them.
 *
 * Path-scoping: the :orgId in the URL is asserted to match the JWT-derived
 * req.orgId. This prevents a member of org A from poking at org B's
 * subscribers by changing the URL.
 */

'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

const { Organization, TicketAlertSubscriber } = require('../models');
const { requireRole } = require('../middleware/rbac');

// Indian mobile validator. Leading digit 6-9 per TRAI numbering plan.
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

// Reject names that look like a copy-pasted formula injection or are
// silently unhelpful. The full input goes into a WhatsApp template
// variable; sanitising here is one fewer trap downstream.
const NAME_REGEX = /^[\p{L}\p{N} ._'-]{1,120}$/u;

function assertSameOrg(req, res) {
  if (req.params.orgId !== req.orgId) {
    res.status(403).json({ error: 'orgId in URL does not match authenticated org' });
    return false;
  }
  return true;
}

function serialiseSubscriber(s) {
  return {
    id: s.id,
    org_id: s.org_id,
    country_code: s.country_code,
    phone: s.phone,
    name: s.name,
    full_number: `${s.country_code}${s.phone}`,
    created_by: s.created_by,
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}

// GET /api/v1/orgs/:orgId/ticket-alerts
// Returns the toggle state + full subscriber list. Single round-trip
// keeps the UI render fast.
router.get('/', async (req, res) => {
  if (!assertSameOrg(req, res)) return;
  try {
    const org = await Organization.findByPk(req.orgId, {
      attributes: ['id', 'name', 'ticket_alerts_enabled'],
    });
    if (!org) return res.status(404).json({ error: 'organization not found' });
    const subscribers = await TicketAlertSubscriber.findAll({
      where: { org_id: req.orgId },
      order: [['created_at', 'ASC']],
    });
    res.json({
      enabled: org.ticket_alerts_enabled,
      subscribers: subscribers.map(serialiseSubscriber),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/v1/orgs/:orgId/ticket-alerts
// Body: { enabled: boolean }
router.patch('/', requireRole('admin'), async (req, res) => {
  if (!assertSameOrg(req, res)) return;
  const enabled = req.body && req.body.enabled;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'body.enabled must be boolean' });
  }
  try {
    const org = await Organization.findByPk(req.orgId);
    if (!org) return res.status(404).json({ error: 'organization not found' });
    await org.update({ ticket_alerts_enabled: enabled });
    res.json({ enabled: org.ticket_alerts_enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/orgs/:orgId/ticket-alerts/subscribers
// Body: { phone: '9812345678', name: 'Ramesh', country_code?: '91' }
// country_code defaults to '91' to match v1 UI which keeps the prefix
// non-editable; accepting it on the body anyway so future country
// expansion doesn't need a wire-format break.
router.post('/subscribers', requireRole('admin'), async (req, res) => {
  if (!assertSameOrg(req, res)) return;
  const { phone, name, country_code = '91' } = req.body || {};

  if (!phone || !INDIAN_MOBILE_REGEX.test(String(phone))) {
    return res.status(400).json({
      error: 'phone must be a 10-digit Indian mobile starting with 6-9 (no country code, no leading zero)',
    });
  }
  if (!name || !NAME_REGEX.test(String(name).trim())) {
    return res.status(400).json({ error: 'name is required and must be 1-120 valid chars' });
  }
  if (country_code !== '91') {
    return res.status(400).json({ error: 'only country_code "91" is supported in this release' });
  }

  try {
    const subscriber = await TicketAlertSubscriber.create({
      org_id: req.orgId,
      country_code,
      phone: String(phone),
      name: String(name).trim(),
      created_by: (req.user && req.user.id) || null,
    });
    res.status(201).json(serialiseSubscriber(subscriber));
  } catch (err) {
    // Composite unique constraint → 409, not 500.
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'this phone number is already subscribed for this org' });
    }
    if (err.name === 'SequelizeValidationError') {
      return res.status(400).json({ error: err.errors.map((e) => e.message).join('; ') });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/v1/orgs/:orgId/ticket-alerts/subscribers/:subscriberId
router.delete('/subscribers/:subscriberId', requireRole('admin'), async (req, res) => {
  if (!assertSameOrg(req, res)) return;
  try {
    const subscriber = await TicketAlertSubscriber.findOne({
      where: { id: req.params.subscriberId, org_id: req.orgId },
    });
    if (!subscriber) return res.status(404).json({ error: 'subscriber not found' });
    await subscriber.destroy();
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
