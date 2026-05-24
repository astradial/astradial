'use strict';

/**
 * /api/v1/campaigns — top-level router for the Campaigns feature.
 *
 * This file holds the sub-routers for each resource. PR 2 ships only
 * the `templates/*` endpoints (Studio); later PRs append campaigns,
 * leads, approvals, lead-fields, and SSE.
 */

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { Op } = require('sequelize');
const {
  CampaignTemplate,
  Campaign,
  CampaignLead,
  CampaignLeadField,
  CampaignEvent,
  CampaignApproval,
  CampaignImportJob,
  sequelize,
} = require('../models');
const { requirePermission } = require('../middleware/rbac');
const {
  templateCreate,
  templateUpdate,
  throughputUpdate,
} = require('../middleware/campaign-validators');
const { importCsv } = require('../services/campaign-csv-importer');
const { getQueue, IMPORT_QUEUE } = require('../jobs/campaignQueues');

// Separate multer for the async path — 250 MB cap to handle 5-lakh-row
// uploads. Sync importer keeps its 5 MB cap below; the dialog routes
// large uploads here instead of through the synchronous endpoint.
const csvUploadLarge = multer({
  dest: '/tmp/',
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okMime = file.mimetype === 'text/csv'
      || file.mimetype === 'application/vnd.ms-excel'
      || file.mimetype === 'application/octet-stream';
    const okExt = /\.csv$/i.test(file.originalname || '');
    if (!okMime && !okExt) return cb(new Error('Only CSV files are allowed'), false);
    cb(null, true);
  },
});

const router = express.Router();

// Scoped multer for CSV uploads — 5 MB cap + MIME filter. Avoids the
// global 50 MB multer used elsewhere; an unconfigured cap was a
// plan-review blocker (B11).
const csvUpload = multer({
  dest: '/tmp/',
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okMime = file.mimetype === 'text/csv'
      || file.mimetype === 'application/vnd.ms-excel'
      || file.mimetype === 'application/octet-stream';
    const okExt = /\.csv$/i.test(file.originalname || '');
    if (!okMime && !okExt) return cb(new Error('Only CSV files are allowed'), false);
    cb(null, true);
  },
});

function cleanupTmp(file) {
  if (file && file.path) {
    fs.unlink(file.path, () => { /* best-effort */ });
  }
}

function paginate(q) {
  const page = Math.max(1, parseInt(q.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(q.limit) || 25));
  return { limit, offset: (page - 1) * limit, page };
}

// ── Templates ────────────────────────────────────────────────────────

router.get('/templates', requirePermission('campaigns.read'), async (req, res) => {
  try {
    const { limit, offset, page } = paginate(req.query);
    const where = { org_id: req.orgId };
    if (req.query.status) where.status = req.query.status;
    if (req.query.q) where.name = { [Op.like]: `%${req.query.q}%` };
    const { count, rows } = await CampaignTemplate.findAndCountAll({
      where, limit, offset, order: [['updated_at', 'DESC']],
    });
    res.json({ data: rows, total: count, page, pages: Math.ceil(count / limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/templates', requirePermission('campaigns.write'), templateCreate, async (req, res) => {
  try {
    const { name, description } = req.body;
    const row = await CampaignTemplate.create({
      org_id: req.orgId,
      name,
      description: description || null,
      created_by: req.userId || null,
      status: 'draft',
      workflow: { meta: { name }, days: [] },
    });
    res.status(201).json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/templates/:id', requirePermission('campaigns.read'), async (req, res) => {
  try {
    const row = await CampaignTemplate.findOne({
      where: { id: req.params.id, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Template not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/templates/:id', requirePermission('campaigns.write'), templateUpdate, async (req, res) => {
  try {
    const row = await CampaignTemplate.findOne({
      where: { id: req.params.id, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Template not found' });
    const updates = {};
    if (req.body.name != null) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.workflow != null) updates.workflow = req.body.workflow;
    await row.update(updates);
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/templates/:id/publish', requirePermission('campaigns.write'), async (req, res) => {
  try {
    const row = await CampaignTemplate.findOne({
      where: { id: req.params.id, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Template not found' });
    if (!row.workflow || !Array.isArray(row.workflow.days) || row.workflow.days.length === 0) {
      return res.status(422).json({ error: 'Cannot publish empty template — add at least one day with one action.' });
    }
    await row.update({ status: 'published', version: row.version + 1 });
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/templates/:id/archive', requirePermission('campaigns.write'), async (req, res) => {
  try {
    const row = await CampaignTemplate.findOne({
      where: { id: req.params.id, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Template not found' });
    await row.update({ status: 'archived' });
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/templates/:id', requirePermission('campaigns.delete'), async (req, res) => {
  try {
    const row = await CampaignTemplate.findOne({
      where: { id: req.params.id, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Template not found' });

    // Block deletion if any campaign still references this template.
    // Running campaigns hold a `template_snapshot`, so the deletion is
    // safe for them — but draft campaigns that point at this template
    // would be left orphaned. Refuse and ask the user to detach first.
    const ref = await Campaign.count({
      where: {
        org_id: req.orgId,
        template_id: row.id,
        status: { [Op.in]: ['draft', 'scheduled'] },
      },
    });
    if (ref > 0) {
      return res.status(409).json({
        error: 'TemplateInUse',
        message: `${ref} draft/scheduled campaign(s) still reference this template. Archive instead, or detach those campaigns first.`,
      });
    }
    await row.destroy();
    res.status(204).end();
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Campaigns ────────────────────────────────────────────────────────

router.get('/', requirePermission('campaigns.read'), async (req, res) => {
  try {
    const { limit, offset, page } = paginate(req.query);
    const where = { org_id: req.orgId };
    if (req.query.status) where.status = req.query.status;
    if (req.query.q) where.name = { [Op.like]: `%${req.query.q}%` };
    const { count, rows } = await Campaign.findAndCountAll({
      where, limit, offset, order: [['created_at', 'DESC']],
    });
    res.json({ data: rows, total: count, page, pages: Math.ceil(count / limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', requirePermission('campaigns.write'), csvUpload.single('leads_csv'), async (req, res) => {
  let tx = null;
  try {
    const { name, description, template_id, owner_user_id, start_at } = req.body;
    let columnMapping = {};
    if (req.body.column_mapping) {
      try {
        columnMapping = typeof req.body.column_mapping === 'string'
          ? JSON.parse(req.body.column_mapping)
          : req.body.column_mapping;
      } catch {
        cleanupTmp(req.file);
        return res.status(400).json({ error: 'column_mapping must be valid JSON' });
      }
    }

    if (!name || typeof name !== 'string' || name.length < 1 || name.length > 200) {
      cleanupTmp(req.file);
      return res.status(400).json({ error: 'name is required (1-200 chars)' });
    }

    // If a template_id is supplied, snapshot its workflow now. The
    // snapshot is what the scheduler will run; subsequent edits to the
    // template do NOT affect this campaign (plan-review blocker B-design).
    let templateSnapshot = null;
    if (template_id) {
      const tpl = await CampaignTemplate.findOne({
        where: { id: template_id, org_id: req.orgId },
      });
      if (!tpl) {
        cleanupTmp(req.file);
        return res.status(404).json({ error: 'Template not found' });
      }
      if (tpl.status !== 'published') {
        cleanupTmp(req.file);
        return res.status(422).json({ error: 'Template must be published before launching a campaign from it.' });
      }
      templateSnapshot = tpl.workflow;
    }

    tx = await sequelize.transaction();

    const campaign = await Campaign.create({
      org_id: req.orgId,
      name,
      description: description || null,
      template_id: template_id || null,
      template_snapshot: templateSnapshot,
      owner_user_id: owner_user_id || req.userId || null,
      status: 'draft',
      start_at: start_at || null,
      stats: { contacted: 0, engaged: 0, interested: 0, qualified: 0, total: 0 },
    }, { transaction: tx });

    let importResult = null;
    if (req.file && Object.keys(columnMapping).length > 0) {
      const leadFields = await CampaignLeadField.findAll({
        where: { org_id: req.orgId, is_deleted: false },
        transaction: tx,
      });
      importResult = await importCsv({
        filePath: req.file.path,
        orgId: req.orgId,
        campaignId: campaign.id,
        columnMapping,
        leadFields,
        CampaignLead,
        mode: req.query.mode || 'skip_duplicates',
      });
      // Stamp the imported-leads count onto stats so the dashboard shows
      // a non-zero total even before any sends fire.
      await campaign.update({ stats: { ...campaign.stats, total: importResult.inserted } }, { transaction: tx });
    }

    await tx.commit();
    cleanupTmp(req.file);

    res.status(201).json({ campaign, import: importResult });
  } catch (e) {
    if (tx) try { await tx.rollback(); } catch { /* ignore */ }
    cleanupTmp(req.file);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// ── Approvals queue (defined BEFORE /:id so the literal path wins) ──

router.get('/approvals', requirePermission('campaigns.read'), async (req, res) => {
  try {
    const { limit, offset, page } = paginate(req.query);
    const where = { org_id: req.orgId };
    if (req.query.status) where.status = req.query.status;
    if (req.query.campaign_id) where.campaign_id = req.query.campaign_id;
    const { count, rows } = await CampaignApproval.findAndCountAll({
      where, limit, offset, order: [['sla_at', 'ASC'], ['created_at', 'ASC']],
    });
    res.json({ data: rows, total: count, page, pages: Math.ceil(count / limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// SSE stream — poll-driven pending-approvals count for sidebar badge.
// Declared BEFORE /approvals/:approvalId so the literal path wins.
router.get('/approvals/stream', requirePermission('campaigns.read'), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendCount = async () => {
    try {
      const count = await CampaignApproval.count({
        where: { org_id: req.orgId, status: 'pending' },
      });
      res.write(`data: ${JSON.stringify({ count })}\n\n`);
    } catch (_) { /* keep stream alive even on transient DB errors */ }
  };

  // Initial push so the badge updates immediately on subscribe.
  await sendCount();

  // Poll cadence is cheap (one COUNT per org per 10s) and far simpler than
  // wiring Redis pub/sub for what is, ultimately, a badge.
  const tick = setInterval(sendCount, 10_000);
  // Comment-line heartbeat keeps proxies (nginx, Caddy) from killing idle conns.
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(tick);
    clearInterval(ping);
  });
});

// Lightweight count for the sidebar badge (no SSE, just a number).
// Declared BEFORE /approvals/:approvalId so :approvalId doesn't swallow "count".
router.get('/approvals/count', requirePermission('campaigns.read'), async (req, res) => {
  try {
    const count = await CampaignApproval.count({
      where: { org_id: req.orgId, status: 'pending' },
    });
    res.json({ count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/approvals/:approvalId', requirePermission('campaigns.read'), async (req, res) => {
  try {
    const row = await CampaignApproval.findOne({
      where: { id: req.params.approvalId, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Approval not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/approvals/:approvalId/decide', requirePermission('campaigns.approve'), async (req, res) => {
  try {
    const { decision, edited_draft } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be "approved" or "rejected"' });
    }
    const row = await CampaignApproval.findOne({
      where: { id: req.params.approvalId, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Approval not found' });
    if (row.status !== 'pending') {
      return res.status(409).json({ error: `Approval already ${row.status}` });
    }
    const patch = { status: decision, decided_by: req.userId || null, decided_at: new Date() };
    if (decision === 'approved' && typeof edited_draft === 'string') {
      patch.draft = edited_draft;
    }
    await row.update(patch);
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Lead-field config (org-wide CRUD, BEFORE /:id) ──────────────────

const LEAD_FIELD_TYPES = new Set([
  'text', 'number', 'select', 'multi', 'date', 'datetime',
  'phone', 'email', 'url', 'boolean', 'currency', 'identifier',
]);

router.get('/lead-fields', requirePermission('campaigns.read'), async (req, res) => {
  try {
    const where = { org_id: req.orgId };
    if (req.query.include_deleted !== '1') where.is_deleted = false;
    const rows = await CampaignLeadField.findAll({
      where, order: [['sort_order', 'ASC'], ['created_at', 'ASC']],
    });
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/lead-fields', requirePermission('campaigns.write'), async (req, res) => {
  try {
    const { id, label, type, description, options, required, sort_order } = req.body || {};
    if (!id || typeof id !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/i.test(id)) {
      return res.status(400).json({ error: 'id must be a slug (letters/digits/underscore, ≤64 chars, leading letter)' });
    }
    if (!label || typeof label !== 'string' || label.length > 120) {
      return res.status(400).json({ error: 'label is required (≤120 chars)' });
    }
    if (!LEAD_FIELD_TYPES.has(type)) {
      return res.status(400).json({ error: `type must be one of: ${[...LEAD_FIELD_TYPES].join(', ')}` });
    }
    if ((type === 'select' || type === 'multi') && !Array.isArray(options)) {
      return res.status(400).json({ error: 'select/multi fields require options[]' });
    }
    const existing = await CampaignLeadField.findOne({ where: { id, org_id: req.orgId } });
    if (existing) return res.status(409).json({ error: 'A field with that id already exists' });
    const row = await CampaignLeadField.create({
      id,
      org_id: req.orgId,
      label,
      type,
      description: description || null,
      options: options || null,
      required: !!required,
      is_system: false,
      is_deleted: false,
      sort_order: Number.isInteger(sort_order) ? sort_order : 100,
    });
    res.status(201).json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Reorder lead-field rows by array position. Declared BEFORE
// /lead-fields/:fieldId so :fieldId doesn't swallow "reorder".
router.put('/lead-fields/reorder', requirePermission('campaigns.write'), async (req, res) => {
  let tx = null;
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200
        || !ids.every((x) => typeof x === 'string')) {
      return res.status(400).json({ error: 'ids must be a non-empty string[] (max 200)' });
    }
    // Validate every id belongs to this org in one query — prevents a
    // partial reorder that would leave the page inconsistent.
    const found = await CampaignLeadField.findAll({
      where: { id: { [Op.in]: ids }, org_id: req.orgId, is_deleted: false },
      attributes: ['id'],
    });
    if (found.length !== ids.length) {
      return res.status(400).json({ error: 'One or more ids are invalid or not in this org' });
    }

    // Gaps of 10 leave room for manual single-row inserts without a re-renumber.
    tx = await sequelize.transaction();
    for (let i = 0; i < ids.length; i++) {
      await CampaignLeadField.update(
        { sort_order: (i + 1) * 10 },
        { where: { id: ids[i], org_id: req.orgId }, transaction: tx },
      );
    }
    await tx.commit();
    res.json({ ok: true, count: ids.length });
  } catch (e) {
    if (tx) try { await tx.rollback(); } catch { /* ignore */ }
    res.status(400).json({ error: e.message });
  }
});

router.patch('/lead-fields/:fieldId', requirePermission('campaigns.write'), async (req, res) => {
  try {
    const row = await CampaignLeadField.findOne({
      where: { id: req.params.fieldId, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Field not found' });
    const updates = {};
    for (const k of ['label', 'description', 'options', 'required', 'sort_order']) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (req.body.type != null && req.body.type !== row.type) {
      return res.status(422).json({ error: 'type cannot be changed after creation' });
    }
    await row.update(updates);
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/lead-fields/:fieldId', requirePermission('campaigns.write'), async (req, res) => {
  try {
    const row = await CampaignLeadField.findOne({
      where: { id: req.params.fieldId, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Field not found' });
    if (row.is_system) {
      return res.status(409).json({ error: 'System fields cannot be deleted' });
    }
    await row.update({ is_deleted: true });
    res.status(204).end();
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Campaign by id ──────────────────────────────────────────────────

router.get('/:id', requirePermission('campaigns.read'), async (req, res) => {
  try {
    const row = await Campaign.findOne({
      where: { id: req.params.id, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Campaign not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', requirePermission('campaigns.write'), throughputUpdate, async (req, res) => {
  try {
    const row = await Campaign.findOne({
      where: { id: req.params.id, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Campaign not found' });

    if (req.body.max_concurrent_calls !== undefined) {
      const { getLiveCount } = require('../services/campaign-concurrency');
      const live = await getLiveCount(req.orgId, row.id);
      if (live > req.body.max_concurrent_calls) {
        return res.status(409).json({
          error: `Cannot set cap to ${req.body.max_concurrent_calls} — ${live} calls are live right now`,
        });
      }
    }

    const updates = {};
    for (const key of ['name', 'description', 'owner_user_id', 'start_at', 'max_concurrent_calls', 'max_sends_per_minute', 'avg_call_seconds']) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    await row.update(updates);
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/:id/launch', requirePermission('campaigns.write'), async (req, res) => {
  try {
    const row = await Campaign.findOne({
      where: { id: req.params.id, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Campaign not found' });
    if (!['draft', 'scheduled'].includes(row.status)) {
      return res.status(409).json({ error: `Cannot launch a campaign in status "${row.status}"` });
    }
    if (!row.template_snapshot || !Array.isArray(row.template_snapshot.days) || row.template_snapshot.days.length === 0) {
      return res.status(422).json({ error: 'Campaign has no workflow snapshot. Attach a published template first.' });
    }
    const { validateSnapshot } = require('../services/campaign-actions');
    const vr = validateSnapshot(row.template_snapshot);
    if (!vr.valid) {
      return res.status(422).json({ error: 'Workflow snapshot has errors', errors: vr.errors });
    }
    const leadCount = await CampaignLead.count({
      where: { org_id: req.orgId, campaign_id: row.id },
    });
    if (leadCount === 0) {
      return res.status(422).json({ error: 'Campaign has no leads. Import a CSV before launching.' });
    }

    await row.update({ status: 'running', started_at: new Date() });
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/:id/pause', requirePermission('campaigns.write'), async (req, res) => {
  try {
    const row = await Campaign.findOne({
      where: { id: req.params.id, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Campaign not found' });
    if (row.status !== 'running') {
      return res.status(409).json({ error: `Cannot pause a campaign in status "${row.status}"` });
    }
    await row.update({ status: 'paused', paused_at: new Date() });
    // Scheduler-side row state transitions (campaign_lead_runs.status
    // pending → waiting) happen in PR 5 once the scheduler exists.
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/:id/resume', requirePermission('campaigns.write'), async (req, res) => {
  try {
    const row = await Campaign.findOne({
      where: { id: req.params.id, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Campaign not found' });
    if (row.status !== 'paused') {
      return res.status(409).json({ error: `Cannot resume a campaign in status "${row.status}"` });
    }
    await row.update({ status: 'running', paused_at: null });
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id', requirePermission('campaigns.delete'), async (req, res) => {
  try {
    const row = await Campaign.findOne({
      where: { id: req.params.id, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Campaign not found' });
    if (row.status === 'running') {
      return res.status(409).json({ error: 'Pause the campaign before deleting it.' });
    }
    await row.destroy();
    res.status(204).end();
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── CSV import (re-import into an existing campaign) ────────────────

router.post('/:id/leads/import', requirePermission('campaigns.write'), csvUpload.single('leads_csv'), async (req, res) => {
  try {
    const row = await Campaign.findOne({
      where: { id: req.params.id, org_id: req.orgId },
    });
    if (!row) { cleanupTmp(req.file); return res.status(404).json({ error: 'Campaign not found' }); }
    if (!req.file) { return res.status(400).json({ error: 'leads_csv file is required' }); }

    let columnMapping = {};
    try {
      columnMapping = req.body.column_mapping
        ? (typeof req.body.column_mapping === 'string'
            ? JSON.parse(req.body.column_mapping)
            : req.body.column_mapping)
        : {};
    } catch {
      cleanupTmp(req.file);
      return res.status(400).json({ error: 'column_mapping must be valid JSON' });
    }
    if (!Object.keys(columnMapping).length) {
      cleanupTmp(req.file);
      return res.status(400).json({ error: 'column_mapping is required' });
    }

    const leadFields = await CampaignLeadField.findAll({
      where: { org_id: req.orgId, is_deleted: false },
    });
    const result = await importCsv({
      filePath: req.file.path,
      orgId: req.orgId,
      campaignId: row.id,
      columnMapping,
      leadFields,
      CampaignLead,
      mode: req.query.mode || 'skip_duplicates',
    });
    cleanupTmp(req.file);
    res.json(result);
  } catch (e) {
    cleanupTmp(req.file);
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

// ── Leads (list/get/patch/delete on a campaign) ─────────────────────

// Whitelist of sortable columns. Anything else falls back to default
// `created_at DESC`. Prevents arbitrary column injection via ?sort=.
const LEAD_SORT_COLUMNS = new Set([
  'name', 'phone', 'country', 'status', 'last_touch_at', 'created_at',
]);

function parseSort(q, defaultOrder = [['created_at', 'DESC']]) {
  if (!q.sort) return defaultOrder;
  const [colRaw, dirRaw] = String(q.sort).split(':');
  // Accept camelCase from clients — map `lastTouch` → `last_touch_at`.
  const col = colRaw === 'lastTouch' ? 'last_touch_at' : colRaw;
  if (!LEAD_SORT_COLUMNS.has(col)) return defaultOrder;
  const dir = String(dirRaw || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return [[col, dir]];
}

router.get('/:id/leads', requirePermission('campaigns.read'), async (req, res) => {
  try {
    const camp = await Campaign.findOne({ where: { id: req.params.id, org_id: req.orgId }, attributes: ['id'] });
    if (!camp) return res.status(404).json({ error: 'Campaign not found' });
    const { limit, offset, page } = paginate(req.query);
    const where = { org_id: req.orgId, campaign_id: camp.id };
    if (req.query.status && req.query.status !== 'all') where.status = req.query.status;
    if (req.query.q) where[Op.or] = [
      { name: { [Op.like]: `%${req.query.q}%` } },
      { phone: { [Op.like]: `%${req.query.q}%` } },
      { business: { [Op.like]: `%${req.query.q}%` } },
    ];
    // `total` here = unfiltered campaign size; `filtered` = match after where.
    // Cheap because of (org_id, campaign_id, …) indexes.
    const [total, { count: filtered, rows }] = await Promise.all([
      CampaignLead.count({ where: { org_id: req.orgId, campaign_id: camp.id } }),
      CampaignLead.findAndCountAll({
        where, limit, offset, order: parseSort(req.query),
      }),
    ]);
    res.json({
      data: rows,
      total,
      filtered,
      page,
      pageSize: limit,
      pages: Math.ceil(filtered / limit),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/leads/:leadId', requirePermission('campaigns.read'), async (req, res) => {
  try {
    const row = await CampaignLead.findOne({
      where: { id: req.params.leadId, campaign_id: req.params.id, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Lead not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/leads/:leadId', requirePermission('campaigns.write'), async (req, res) => {
  try {
    const row = await CampaignLead.findOne({
      where: { id: req.params.leadId, campaign_id: req.params.id, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Lead not found' });
    const updates = {};
    // Whitelist — `phone` is intentionally NOT editable here because the
    // (org_id, campaign_id, phone) unique index makes a swap a deduplication
    // problem; do it via /import upsert if you need to change phone.
    for (const k of ['name', 'country', 'business', 'status', 'intent_score', 'custom_fields']) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    await row.update(updates);
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id/leads/:leadId', requirePermission('campaigns.write'), async (req, res) => {
  try {
    const row = await CampaignLead.findOne({
      where: { id: req.params.leadId, campaign_id: req.params.id, org_id: req.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Lead not found' });
    await row.destroy();
    res.status(204).end();
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Events (read-only timeline) ─────────────────────────────────────

router.get('/:id/events', requirePermission('campaigns.read'), async (req, res) => {
  try {
    const camp = await Campaign.findOne({ where: { id: req.params.id, org_id: req.orgId }, attributes: ['id'] });
    if (!camp) return res.status(404).json({ error: 'Campaign not found' });
    const { limit, offset, page } = paginate(req.query);
    const where = { org_id: req.orgId, campaign_id: camp.id };
    if (req.query.campaign_lead_id) where.campaign_lead_id = req.query.campaign_lead_id;
    if (req.query.kind) where.kind = req.query.kind;
    const { count, rows } = await CampaignEvent.findAndCountAll({
      where, limit, offset, order: [['created_at', 'DESC']],
    });
    res.json({ data: rows, total: count, page, pages: Math.ceil(count / limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Per-campaign dashboard summary ──────────────────────────────────
// One call that powers the page shell: campaign row + funnel +
// per-status counts (drives kanban + filter dropdown) + recent events.
router.get('/:id/dashboard', requirePermission('campaigns.read'), async (req, res) => {
  try {
    const camp = await Campaign.findOne({
      where: { id: req.params.id, org_id: req.orgId },
    });
    if (!camp) return res.status(404).json({ error: 'Campaign not found' });

    const baseWhere = { org_id: req.orgId, campaign_id: camp.id };

    const [statusGroups, totalLeads, recentEvents] = await Promise.all([
      CampaignLead.findAll({
        where: baseWhere,
        attributes: ['status', [sequelize.fn('COUNT', '*'), 'n']],
        group: ['status'],
        raw: true,
      }),
      CampaignLead.count({ where: baseWhere }),
      CampaignEvent.findAll({
        where: baseWhere,
        order: [['created_at', 'DESC']],
        limit: 20,
      }),
    ]);

    const leadCounts = {
      raw: 0, contacted: 0, engaged: 0, interested: 0,
      qualified: 0, disqualified: 0, dnc: 0,
    };
    for (const g of statusGroups) {
      if (g.status in leadCounts) leadCounts[g.status] = Number(g.n) || 0;
    }
    const funnel = {
      contacted: leadCounts.contacted + leadCounts.engaged + leadCounts.interested + leadCounts.qualified,
      engaged: leadCounts.engaged + leadCounts.interested + leadCounts.qualified,
      interested: leadCounts.interested + leadCounts.qualified,
      qualified: leadCounts.qualified,
    };

    res.json({
      campaign: camp,
      funnel,
      stats: camp.stats || funnel,
      leadCounts,
      totalLeads,
      recentEvents,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Lead drawer: per-lead event timeline ────────────────────────────
router.get('/:id/leads/:leadId/timeline', requirePermission('campaigns.read'), async (req, res) => {
  try {
    const lead = await CampaignLead.findOne({
      where: { id: req.params.leadId, campaign_id: req.params.id, org_id: req.orgId },
      attributes: ['id'],
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const rows = await CampaignEvent.findAll({
      where: { org_id: req.orgId, campaign_id: req.params.id, campaign_lead_id: lead.id },
      order: [['created_at', 'DESC']],
      limit,
    });
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Transcript view from a call_completed event payload ─────────────
router.get('/:id/leads/:leadId/transcript/:eventId', requirePermission('campaigns.read'), async (req, res) => {
  try {
    const event = await CampaignEvent.findOne({
      where: {
        id: req.params.eventId,
        org_id: req.orgId,
        campaign_id: req.params.id,
        campaign_lead_id: req.params.leadId,
      },
    });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const payload = event.payload || {};
    // Backend may store transcript directly OR under .transcript — accept both.
    const transcript = payload.transcript || payload;
    if (!Array.isArray(transcript.messages)) {
      return res.status(202).json({
        ready: false,
        message: 'Transcript not ready yet',
      });
    }
    res.json({
      ready: true,
      eventId: event.id,
      kind: event.kind,
      createdAt: event.created_at,
      ...transcript,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Async CSV import (5-lakh scale path) ────────────────────────────
// Returns 202 immediately with a jobId; the worker (BullMQ, see
// jobs/campaignImportWorker.js) streams the CSV and updates the
// campaign_import_jobs row. Editor polls GET /imports/:jobId.

router.post(
  '/:id/leads/import-async',
  requirePermission('campaigns.write'),
  csvUploadLarge.single('leads_csv'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'leads_csv file is required' });
      }

      const camp = await Campaign.findOne({
        where: { id: req.params.id, org_id: req.orgId },
        attributes: ['id', 'org_id'],
      });
      if (!camp) {
        cleanupTmp(req.file);
        return res.status(404).json({ error: 'Campaign not found' });
      }

      let columnMapping = {};
      try {
        columnMapping = req.body.column_mapping
          ? (typeof req.body.column_mapping === 'string'
              ? JSON.parse(req.body.column_mapping)
              : req.body.column_mapping)
          : {};
      } catch {
        cleanupTmp(req.file);
        return res.status(400).json({ error: 'column_mapping must be valid JSON' });
      }
      if (!Object.keys(columnMapping).length) {
        cleanupTmp(req.file);
        return res.status(400).json({ error: 'column_mapping is required' });
      }

      const mode = ['skip_duplicates', 'upsert', 'fail_on_conflict'].includes(req.query.mode)
        ? req.query.mode
        : 'skip_duplicates';

      // Create the tracking row first so the worker has a target even
      // if BullMQ.add() fails between here and the enqueue call.
      const importJob = await CampaignImportJob.create({
        org_id: req.orgId,
        campaign_id: camp.id,
        status: 'queued',
        mode,
        file_path: req.file.path,
        original_filename: req.file.originalname,
        file_size_bytes: req.file.size,
        column_mapping: columnMapping,
        created_by: req.userId || null,
      });

      try {
        const queue = getQueue(IMPORT_QUEUE);
        const job = await queue.add('import-leads', {
          importJobId: importJob.id,
          orgId: req.orgId,
          campaignId: camp.id,
          filePath: req.file.path,
          columnMapping,
          mode,
        }, {
          jobId: importJob.id, // deduplicates accidental double-clicks
        });
        await importJob.update({ queue_job_id: String(job.id) });
      } catch (qErr) {
        // Mark the job failed so the user sees a clear error instead
        // of a row stuck in 'queued' forever. File stays on disk for
        // debugging; the import-jobs sweep (Phase B) cleans it.
        await importJob.update({
          status: 'failed',
          last_error: `Enqueue failed: ${qErr.message}`,
          finished_at: new Date(),
        });
        return res.status(503).json({
          error: 'ImportQueueUnavailable',
          message: qErr.message,
          jobId: importJob.id,
        });
      }

      res.status(202).json({
        jobId: importJob.id,
        status: importJob.status,
        message: 'Import queued. Poll GET /campaigns/:id/imports/:jobId for progress.',
      });
    } catch (e) {
      cleanupTmp(req.file);
      res.status(500).json({ error: e.message });
    }
  }
);

router.get('/:id/imports', requirePermission('campaigns.read'), async (req, res) => {
  try {
    const camp = await Campaign.findOne({
      where: { id: req.params.id, org_id: req.orgId },
      attributes: ['id'],
    });
    if (!camp) return res.status(404).json({ error: 'Campaign not found' });
    const { limit, offset, page } = paginate(req.query);
    const { count, rows } = await CampaignImportJob.findAndCountAll({
      where: { org_id: req.orgId, campaign_id: camp.id },
      limit,
      offset,
      order: [['created_at', 'DESC']],
      // file_path can be long and isn't useful to the UI; trim the payload.
      attributes: { exclude: ['file_path'] },
    });
    res.json({ data: rows, total: count, page, pages: Math.ceil(count / limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/imports/:jobId', requirePermission('campaigns.read'), async (req, res) => {
  try {
    const row = await CampaignImportJob.findOne({
      where: {
        id: req.params.jobId,
        campaign_id: req.params.id,
        org_id: req.orgId,
      },
      attributes: { exclude: ['file_path'] },
    });
    if (!row) return res.status(404).json({ error: 'Import job not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/imports/:jobId', requirePermission('campaigns.write'), async (req, res) => {
  try {
    // Only `{ status: 'cancelled' }` is a valid payload — keep the surface
    // tiny so future status transitions don't sneak in via this endpoint.
    if (!req.body || req.body.status !== 'cancelled' || Object.keys(req.body).length !== 1) {
      return res.status(400).json({ error: 'Only { status: "cancelled" } is accepted' });
    }
    const row = await CampaignImportJob.findOne({
      where: {
        id: req.params.jobId,
        campaign_id: req.params.id,
        org_id: req.orgId,
      },
      attributes: { exclude: ['file_path'] },
    });
    if (!row) return res.status(404).json({ error: 'Import job not found' });
    if (['completed', 'failed', 'cancelled'].includes(row.status)) {
      return res.status(409).json({ error: `Cannot cancel a ${row.status} import` });
    }
    await row.update({
      status: 'cancelled',
      finished_at: new Date(),
      last_error: 'Cancelled by user',
    });
    // Best-effort BullMQ removal — if the worker is mid-batch, .remove() is a
    // no-op and the worker bails on its next DB status re-read instead.
    if (row.queue_job_id) {
      try {
        const queue = getQueue(IMPORT_QUEUE);
        await queue.remove(row.queue_job_id);
      } catch (_) { /* best-effort */ }
    }
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
