'use strict';

// Idempotent seeder for the 5 system lead fields per org. The default
// shape matches the design's DEFAULT_LEAD_FIELDS in the handoff bundle.
// Safe to call repeatedly: existing rows are left alone, only missing
// ones are inserted.

const SYSTEM_FIELDS = [
  { id: 'name',      label: 'Name',          type: 'identifier', description: "Lead's full name",            sort_order: 0 },
  { id: 'phone',     label: 'Phone',         type: 'phone',      description: 'Primary contact number',      sort_order: 1 },
  { id: 'country',   label: 'Country',       type: 'text',       description: 'ISO country code',            sort_order: 2 },
  { id: 'business',  label: 'Business',      type: 'text',       description: 'Company / organization name', sort_order: 3 },
  { id: 'status',    label: 'Status',        type: 'select',     description: 'Stage in the outreach flow', sort_order: 4,
    options: ['Raw', 'Contacted', 'Engaged', 'Interested', 'Qualified', 'Disqualified', 'Do not contact'] },
  { id: 'lastTouch', label: 'Last activity', type: 'datetime',   description: 'Time of most recent touch',   sort_order: 5 },
];

async function seedSystemLeadFieldsForOrg(models, orgId) {
  const { CampaignLeadField } = models;
  for (const f of SYSTEM_FIELDS) {
    await CampaignLeadField.findOrCreate({
      where: { id: f.id, org_id: orgId },
      defaults: {
        id: f.id,
        org_id: orgId,
        label: f.label,
        type: f.type,
        description: f.description,
        options: f.options || null,
        required: f.id === 'name' || f.id === 'phone',
        is_system: true,
        is_deleted: false,
        sort_order: f.sort_order,
      },
    });
  }
}

async function seedSystemLeadFieldsForAllOrgs(models) {
  const orgs = await models.Organization.findAll({ attributes: ['id'] });
  for (const org of orgs) {
    await seedSystemLeadFieldsForOrg(models, org.id);
  }
  return orgs.length;
}

module.exports = {
  SYSTEM_FIELDS,
  seedSystemLeadFieldsForOrg,
  seedSystemLeadFieldsForAllOrgs,
};
