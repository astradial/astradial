const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const {
  CrmCompany, CrmContact, CrmDeal, CrmActivity,
  CrmCustomField, CrmCustomFieldValue, CrmPipelineStage,
} = require('../models');
const { requirePermission } = require('../middleware/rbac');

// ── helpers ──────────────────────────────────────────────────────────
function paginate(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 25));
  return { limit, offset: (page - 1) * limit, page };
}

function searchWhere(query, fields) {
  if (!query.search) return {};
  const term = `%${query.search}%`;
  return { [Op.or]: fields.map(f => ({ [f]: { [Op.like]: term } })) };
}

async function attachCustomValues(orgId, entityType, rows) {
  const ids = rows.map(r => r.id);
  if (!ids.length) return rows;
  const fields = await CrmCustomField.findAll({ where: { org_id: orgId, entity_type: entityType } });
  if (!fields.length) return rows;
  const values = await CrmCustomFieldValue.findAll({
    where: { field_id: fields.map(f => f.id), entity_id: ids },
  });
  const valMap = {};
  values.forEach(v => {
    if (!valMap[v.entity_id]) valMap[v.entity_id] = {};
    const fd = fields.find(f => f.id === v.field_id);
    if (fd) valMap[v.entity_id][fd.field_name] = v.value;
  });
  return rows.map(r => {
    const plain = r.toJSON ? r.toJSON() : r;
    plain.custom_fields = valMap[plain.id] || {};
    return plain;
  });
}

async function saveCustomValues(fieldDefs, entityId, customFields) {
  if (!customFields || typeof customFields !== 'object') return;
  for (const [name, value] of Object.entries(customFields)) {
    const fd = fieldDefs.find(f => f.field_name === name);
    if (!fd) continue;
    await CrmCustomFieldValue.upsert({
      field_id: fd.id,
      entity_id: entityId,
      value: value == null ? null : String(value),
    });
  }
}

// ── COMPANIES ────────────────────────────────────────────────────────
router.get('/companies', requirePermission('crm.read'), async (req, res) => {
  try {
    const { limit, offset, page } = paginate(req.query);
    const where = { org_id: req.orgId, ...searchWhere(req.query, ['name', 'email', 'phone', 'industry']) };
    if (req.query.assigned_to) where.assigned_to = req.query.assigned_to;
    const { count, rows } = await CrmCompany.findAndCountAll({
      where, limit, offset, order: [['created_at', 'DESC']],
      include: [{ model: CrmContact, as: 'contacts', attributes: ['id'] }],
    });
    const enriched = await attachCustomValues(req.orgId, 'company', rows);
    res.json({ data: enriched, total: count, page, pages: Math.ceil(count / limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/companies/:id', requirePermission('crm.read'), async (req, res) => {
  try {
    const row = await CrmCompany.findOne({
      where: { id: req.params.id, org_id: req.orgId },
      include: [
        { model: CrmContact, as: 'contacts' },
        { model: CrmDeal, as: 'deals' },
        { model: CrmActivity, as: 'activities', order: [['created_at', 'DESC']], limit: 20 },
      ],
    });
    if (!row) return res.status(404).json({ error: 'Company not found' });
    const [enriched] = await attachCustomValues(req.orgId, 'company', [row]);
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/companies', requirePermission('crm.write'), async (req, res) => {
  try {
    const { custom_fields, ...data } = req.body;
    data.org_id = req.orgId;
    data.created_by = req.userId || null;
    const row = await CrmCompany.create(data);
    if (custom_fields) {
      const defs = await CrmCustomField.findAll({ where: { org_id: req.orgId, entity_type: 'company' } });
      await saveCustomValues(defs, row.id, custom_fields);
    }
    res.status(201).json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/companies/:id', requirePermission('crm.write'), async (req, res) => {
  try {
    const row = await CrmCompany.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!row) return res.status(404).json({ error: 'Company not found' });
    const { custom_fields, ...data } = req.body;
    await row.update(data);
    if (custom_fields) {
      const defs = await CrmCustomField.findAll({ where: { org_id: req.orgId, entity_type: 'company' } });
      await saveCustomValues(defs, row.id, custom_fields);
    }
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/companies/:id', requirePermission('crm.delete'), async (req, res) => {
  try {
    const deleted = await CrmCompany.destroy({ where: { id: req.params.id, org_id: req.orgId } });
    if (!deleted) return res.status(404).json({ error: 'Company not found' });
    res.json({ message: 'Company deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CONTACTS ─────────────────────────────────────────────────────────
router.get('/contacts', requirePermission('crm.read'), async (req, res) => {
  try {
    const { limit, offset, page } = paginate(req.query);
    const where = { org_id: req.orgId, ...searchWhere(req.query, ['first_name', 'last_name', 'email', 'phone']) };
    if (req.query.lead_status) where.lead_status = req.query.lead_status;
    if (req.query.company_id) where.company_id = req.query.company_id;
    if (req.query.assigned_to) where.assigned_to = req.query.assigned_to;
    const { count, rows } = await CrmContact.findAndCountAll({
      where, limit, offset, order: [['created_at', 'DESC']],
      include: [{ model: CrmCompany, as: 'company', attributes: ['id', 'name'] }],
    });
    const enriched = await attachCustomValues(req.orgId, 'contact', rows);
    res.json({ data: enriched, total: count, page, pages: Math.ceil(count / limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/contacts/:id', requirePermission('crm.read'), async (req, res) => {
  try {
    const row = await CrmContact.findOne({
      where: { id: req.params.id, org_id: req.orgId },
      include: [
        { model: CrmCompany, as: 'company' },
        { model: CrmDeal, as: 'deals' },
        { model: CrmActivity, as: 'activities', order: [['created_at', 'DESC']], limit: 20 },
      ],
    });
    if (!row) return res.status(404).json({ error: 'Contact not found' });
    const [enriched] = await attachCustomValues(req.orgId, 'contact', [row]);
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/contacts', requirePermission('crm.write'), async (req, res) => {
  try {
    const { custom_fields, ...data } = req.body;
    data.org_id = req.orgId;
    data.created_by = req.userId || null;
    const row = await CrmContact.create(data);
    if (custom_fields) {
      const defs = await CrmCustomField.findAll({ where: { org_id: req.orgId, entity_type: 'contact' } });
      await saveCustomValues(defs, row.id, custom_fields);
    }
    res.status(201).json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/contacts/:id', requirePermission('crm.write'), async (req, res) => {
  try {
    const row = await CrmContact.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!row) return res.status(404).json({ error: 'Contact not found' });
    const { custom_fields, ...data } = req.body;
    await row.update(data);
    if (custom_fields) {
      const defs = await CrmCustomField.findAll({ where: { org_id: req.orgId, entity_type: 'contact' } });
      await saveCustomValues(defs, row.id, custom_fields);
    }
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/contacts/:id/status', requirePermission('crm.write'), async (req, res) => {
  try {
    const row = await CrmContact.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!row) return res.status(404).json({ error: 'Contact not found' });
    await row.update({ lead_status: req.body.lead_status });
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/contacts/:id/assign', requirePermission('crm.assign'), async (req, res) => {
  try {
    const row = await CrmContact.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!row) return res.status(404).json({ error: 'Contact not found' });
    await row.update({ assigned_to: req.body.assigned_to });
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/contacts/:id', requirePermission('crm.delete'), async (req, res) => {
  try {
    const deleted = await CrmContact.destroy({ where: { id: req.params.id, org_id: req.orgId } });
    if (!deleted) return res.status(404).json({ error: 'Contact not found' });
    res.json({ message: 'Contact deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DEALS ────────────────────────────────────────────────────────────
router.get('/deals', requirePermission('crm.read'), async (req, res) => {
  try {
    const { limit, offset, page } = paginate(req.query);
    const where = { org_id: req.orgId, ...searchWhere(req.query, ['title']) };
    if (req.query.stage) where.stage = req.query.stage;
    if (req.query.company_id) where.company_id = req.query.company_id;
    if (req.query.contact_id) where.contact_id = req.query.contact_id;
    if (req.query.assigned_to) where.assigned_to = req.query.assigned_to;
    const { count, rows } = await CrmDeal.findAndCountAll({
      where, limit, offset, order: [['created_at', 'DESC']],
      include: [
        { model: CrmCompany, as: 'company', attributes: ['id', 'name'] },
        { model: CrmContact, as: 'contact', attributes: ['id', 'first_name', 'last_name'] },
      ],
    });
    const enriched = await attachCustomValues(req.orgId, 'deal', rows);
    res.json({ data: enriched, total: count, page, pages: Math.ceil(count / limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/deals/:id', requirePermission('crm.read'), async (req, res) => {
  try {
    const row = await CrmDeal.findOne({
      where: { id: req.params.id, org_id: req.orgId },
      include: [
        { model: CrmCompany, as: 'company' },
        { model: CrmContact, as: 'contact' },
        { model: CrmActivity, as: 'activities', order: [['created_at', 'DESC']], limit: 20 },
      ],
    });
    if (!row) return res.status(404).json({ error: 'Deal not found' });
    const [enriched] = await attachCustomValues(req.orgId, 'deal', [row]);
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/deals', requirePermission('crm.write'), async (req, res) => {
  try {
    const { custom_fields, ...data } = req.body;
    data.org_id = req.orgId;
    data.created_by = req.userId || null;
    const row = await CrmDeal.create(data);
    if (custom_fields) {
      const defs = await CrmCustomField.findAll({ where: { org_id: req.orgId, entity_type: 'deal' } });
      await saveCustomValues(defs, row.id, custom_fields);
    }
    res.status(201).json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/deals/:id', requirePermission('crm.write'), async (req, res) => {
  try {
    const row = await CrmDeal.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!row) return res.status(404).json({ error: 'Deal not found' });
    const { custom_fields, ...data } = req.body;
    await row.update(data);
    if (custom_fields) {
      const defs = await CrmCustomField.findAll({ where: { org_id: req.orgId, entity_type: 'deal' } });
      await saveCustomValues(defs, row.id, custom_fields);
    }
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/deals/:id/stage', requirePermission('crm.write'), async (req, res) => {
  try {
    const row = await CrmDeal.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!row) return res.status(404).json({ error: 'Deal not found' });
    await row.update({ stage: req.body.stage });
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/deals/:id/assign', requirePermission('crm.assign'), async (req, res) => {
  try {
    const row = await CrmDeal.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!row) return res.status(404).json({ error: 'Deal not found' });
    await row.update({ assigned_to: req.body.assigned_to });
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/deals/:id', requirePermission('crm.delete'), async (req, res) => {
  try {
    const deleted = await CrmDeal.destroy({ where: { id: req.params.id, org_id: req.orgId } });
    if (!deleted) return res.status(404).json({ error: 'Deal not found' });
    res.json({ message: 'Deal deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ACTIVITIES ───────────────────────────────────────────────────────
router.get('/activities', requirePermission('crm.read'), async (req, res) => {
  try {
    const { limit, offset, page } = paginate(req.query);
    const where = { org_id: req.orgId };
    if (req.query.contact_id) where.contact_id = req.query.contact_id;
    if (req.query.company_id) where.company_id = req.query.company_id;
    if (req.query.deal_id) where.deal_id = req.query.deal_id;
    if (req.query.type) where.type = req.query.type;
    const { count, rows } = await CrmActivity.findAndCountAll({
      where, limit, offset, order: [['created_at', 'DESC']],
      include: [
        { model: CrmContact, as: 'contact', attributes: ['id', 'first_name', 'last_name'] },
        { model: CrmCompany, as: 'company', attributes: ['id', 'name'] },
        { model: CrmDeal, as: 'deal', attributes: ['id', 'title'] },
      ],
    });
    res.json({ data: rows, total: count, page, pages: Math.ceil(count / limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/activities', requirePermission('crm.write'), async (req, res) => {
  try {
    const data = { ...req.body, org_id: req.orgId, created_by: req.userId || null };
    const row = await CrmActivity.create(data);
    res.status(201).json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/activities/:id', requirePermission('crm.write'), async (req, res) => {
  try {
    const row = await CrmActivity.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!row) return res.status(404).json({ error: 'Activity not found' });
    await row.update(req.body);
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/activities/:id', requirePermission('crm.delete'), async (req, res) => {
  try {
    const deleted = await CrmActivity.destroy({ where: { id: req.params.id, org_id: req.orgId } });
    if (!deleted) return res.status(404).json({ error: 'Activity not found' });
    res.json({ message: 'Activity deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CUSTOM FIELDS ────────────────────────────────────────────────────
router.get('/custom-fields', requirePermission('crm.read'), async (req, res) => {
  try {
    const where = { org_id: req.orgId };
    if (req.query.entity_type) where.entity_type = req.query.entity_type;
    const rows = await CrmCustomField.findAll({ where, order: [['entity_type', 'ASC'], ['sort_order', 'ASC']] });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/custom-fields', requirePermission('crm.customize'), async (req, res) => {
  try {
    const data = { ...req.body, org_id: req.orgId };
    // auto-generate field_name from label if not provided
    if (!data.field_name && data.field_label) {
      data.field_name = data.field_label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    }
    const row = await CrmCustomField.create(data);
    res.status(201).json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/custom-fields/:id', requirePermission('crm.customize'), async (req, res) => {
  try {
    const row = await CrmCustomField.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!row) return res.status(404).json({ error: 'Custom field not found' });
    await row.update(req.body);
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/custom-fields/:id', requirePermission('crm.customize'), async (req, res) => {
  try {
    const deleted = await CrmCustomField.destroy({ where: { id: req.params.id, org_id: req.orgId } });
    if (!deleted) return res.status(404).json({ error: 'Custom field not found' });
    res.json({ message: 'Custom field deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PIPELINES ────────────────────────────────────────────────────────

const DEFAULT_LEAD_STAGES = [
  { stage_key: 'new', stage_label: 'New', sort_order: 0 },
  { stage_key: 'contacted', stage_label: 'Contacted', sort_order: 1 },
  { stage_key: 'qualified', stage_label: 'Qualified', sort_order: 2 },
  { stage_key: 'converted', stage_label: 'Converted', sort_order: 3 },
  { stage_key: 'lost', stage_label: 'Lost', sort_order: 4 },
];

const DEFAULT_DEAL_STAGES = [
  { stage_key: 'lead', stage_label: 'Lead', sort_order: 0 },
  { stage_key: 'qualified', stage_label: 'Qualified', sort_order: 1 },
  { stage_key: 'proposal', stage_label: 'Proposal', sort_order: 2 },
  { stage_key: 'negotiation', stage_label: 'Negotiation', sort_order: 3 },
  { stage_key: 'won', stage_label: 'Won', sort_order: 4 },
  { stage_key: 'lost', stage_label: 'Lost', sort_order: 5 },
];

router.get('/pipelines/:pipeline', requirePermission('crm.read'), async (req, res) => {
  try {
    const { pipeline } = req.params;
    if (!['lead', 'deal'].includes(pipeline)) return res.status(400).json({ error: 'Pipeline must be lead or deal' });
    const rows = await CrmPipelineStage.findAll({
      where: { org_id: req.orgId, pipeline },
      order: [['sort_order', 'ASC']],
    });
    if (rows.length === 0) {
      // Return defaults when org hasn't customized
      return res.json(pipeline === 'lead' ? DEFAULT_LEAD_STAGES : DEFAULT_DEAL_STAGES);
    }
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk save — replaces all stages for a pipeline
router.put('/pipelines/:pipeline', requirePermission('crm.customize'), async (req, res) => {
  try {
    const { pipeline } = req.params;
    if (!['lead', 'deal'].includes(pipeline)) return res.status(400).json({ error: 'Pipeline must be lead or deal' });
    const { stages } = req.body;
    if (!Array.isArray(stages) || stages.length === 0) return res.status(400).json({ error: 'stages array required' });

    // Delete existing stages for this org+pipeline
    await CrmPipelineStage.destroy({ where: { org_id: req.orgId, pipeline } });

    // Create new stages
    const rows = await CrmPipelineStage.bulkCreate(
      stages.map((s, i) => ({
        org_id: req.orgId,
        pipeline,
        stage_key: s.stage_key || s.stage_label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
        stage_label: s.stage_label,
        sort_order: s.sort_order != null ? s.sort_order : i,
      }))
    );
    res.json(rows);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── STATS ────────────────────────────────────────────────────────────
router.get('/stats', requirePermission('crm.read'), async (req, res) => {
  try {
    const orgId = req.orgId;
    const [companies, contacts, deals, openDeals] = await Promise.all([
      CrmCompany.count({ where: { org_id: orgId } }),
      CrmContact.count({ where: { org_id: orgId } }),
      CrmDeal.count({ where: { org_id: orgId } }),
      CrmDeal.count({ where: { org_id: orgId, stage: { [Op.notIn]: ['won', 'lost'] } } }),
    ]);
    // pipeline value
    const pipeline = await CrmDeal.sum('amount', {
      where: { org_id: orgId, stage: { [Op.notIn]: ['won', 'lost'] } },
    });
    const wonValue = await CrmDeal.sum('amount', {
      where: { org_id: orgId, stage: 'won' },
    });
    res.json({
      companies, contacts, deals, open_deals: openDeals,
      pipeline_value: pipeline || 0,
      won_value: wonValue || 0,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
