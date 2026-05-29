'use strict';

/**
 * Streaming CSV importer for campaign leads.
 *
 *  - parses CSV from a file path (the multer-saved temp upload)
 *  - validates each row against the column_mapping the caller supplied
 *  - validates custom-field values against active campaign_lead_fields
 *  - dedupes by phone within the campaign (unique index also enforces)
 *  - bulkCreate in chunks of 500 for throughput
 *
 * Modes:
 *  - 'skip_duplicates' (default): inserts new, skips duplicates, returns counts
 *  - 'upsert': updates existing rows on duplicate phone (custom_fields merged)
 *  - 'fail_on_conflict': aborts whole import if any duplicate is seen
 */

const fs = require('fs');
const Papa = require('papaparse');

const SYSTEM_FIELDS = new Set(['name', 'phone', 'country', 'business', 'status', 'lastTouch']);

function normPhone(v) {
  if (v == null) return '';
  return String(v).replace(/[^\d+]/g, '').trim();
}

function coerceValue(rawVal, type) {
  if (rawVal == null || rawVal === '') return null;
  const v = String(rawVal).trim();
  switch (type) {
    case 'number':
    case 'currency': {
      const n = Number(v);
      if (Number.isNaN(n)) throw new Error(`expected number, got "${v}"`);
      return n;
    }
    case 'boolean':
      if (/^(true|yes|1|y)$/i.test(v)) return true;
      if (/^(false|no|0|n)$/i.test(v)) return false;
      throw new Error(`expected boolean, got "${v}"`);
    case 'date':
    case 'datetime': {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new Error(`expected date, got "${v}"`);
      return d.toISOString();
    }
    default:
      return v;
  }
}

/**
 * @param {object} args
 * @param {string} args.filePath  - path to the uploaded CSV
 * @param {string} args.orgId
 * @param {string} args.campaignId
 * @param {Record<string,string>} args.columnMapping - csv-header → lead-field-id
 * @param {Array} args.leadFields - active CampaignLeadField rows for this org
 * @param {object} args.CampaignLead - sequelize model
 * @param {'skip_duplicates'|'upsert'|'fail_on_conflict'} args.mode
 */
async function importCsv({ filePath, orgId, campaignId, columnMapping, leadFields, CampaignLead, mode = 'skip_duplicates' }) {
  // Validate column mapping references only known field ids (system or custom).
  const knownIds = new Set([...SYSTEM_FIELDS, ...leadFields.map((f) => f.id)]);
  const fieldById = Object.fromEntries(leadFields.map((f) => [f.id, f]));
  const unknown = Object.values(columnMapping).filter((id) => !knownIds.has(id));
  if (unknown.length) {
    throw Object.assign(new Error(`column_mapping references unknown field ids: ${unknown.join(', ')}`), { code: 'BAD_MAPPING', status: 400 });
  }
  const phoneSourceHeader = Object.entries(columnMapping).find(([, id]) => id === 'phone')?.[0];
  if (!phoneSourceHeader) {
    throw Object.assign(new Error('column_mapping must map at least one CSV column to "phone"'), { code: 'NO_PHONE_COLUMN', status: 400 });
  }

  const result = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const buffer = [];
  const seenPhones = new Set();

  // Pre-load existing phones in this campaign for in-process dedupe.
  // (DB-level unique index is the ultimate guard, but avoiding the
  // failed-insert round-trip is faster.)
  const existing = await CampaignLead.findAll({
    where: { org_id: orgId, campaign_id: campaignId },
    attributes: ['id', 'phone'],
  });
  const existingPhones = new Map(existing.map((r) => [r.phone, r.id]));

  // Read CSV synchronously to a string then Papa.parse. For 10k rows this
  // is fine (~5MB cap from the multer config). Streaming would be needed
  // for >100k; defer until we see real volume.
  const raw = fs.readFileSync(filePath, 'utf8');
  // Strip BOM if present — common with Excel exports.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  const parsed = Papa.parse(text, { header: true, skipEmptyLines: 'greedy' });
  if (parsed.errors && parsed.errors.length) {
    // Don't fail the whole import for soft CSV issues; surface them.
    for (const err of parsed.errors.slice(0, 5)) {
      result.errors.push({ row: err.row, message: err.message });
    }
  }

  async function flush() {
    if (!buffer.length) return;
    if (mode === 'upsert') {
      await CampaignLead.bulkCreate(buffer, {
        updateOnDuplicate: ['name', 'country', 'business', 'custom_fields', 'updated_at'],
      });
    } else {
      await CampaignLead.bulkCreate(buffer, { ignoreDuplicates: true });
    }
    buffer.length = 0;
  }

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    const rowNum = i + 2; // header is row 1
    try {
      const phone = normPhone(row[phoneSourceHeader]);
      if (!phone) {
        result.errors.push({ row: rowNum, message: 'missing phone' });
        result.skipped += 1;
        continue;
      }

      const lead = {
        org_id: orgId,
        campaign_id: campaignId,
        phone,
        status: 'raw',
        source: 'csv',
        custom_fields: {},
        custom_fields_schema_version: 1,
      };

      for (const [header, fieldId] of Object.entries(columnMapping)) {
        const rawVal = row[header];
        if (fieldId === 'phone') continue;
        if (fieldId === 'name') { lead.name = rawVal != null ? String(rawVal).trim() : null; continue; }
        if (fieldId === 'country') { lead.country = rawVal != null ? String(rawVal).trim() : null; continue; }
        if (fieldId === 'business') { lead.business = rawVal != null ? String(rawVal).trim() : null; continue; }
        if (fieldId === 'status') {
          const s = rawVal != null ? String(rawVal).trim().toLowerCase() : null;
          if (s && ['raw', 'contacted', 'engaged', 'interested', 'qualified', 'disqualified', 'dnc'].includes(s)) {
            lead.status = s;
          }
          continue;
        }
        if (fieldId === 'lastTouch') {
          const v = coerceValue(rawVal, 'datetime');
          if (v) lead.last_touch_at = v;
          continue;
        }
        // Custom field — coerce against its declared type
        const fd = fieldById[fieldId];
        if (!fd || fd.is_deleted) continue;
        const coerced = coerceValue(rawVal, fd.type);
        if (coerced !== null) lead.custom_fields[fieldId] = coerced;
      }

      // In-batch dedupe (the CSV may have duplicate phones)
      if (seenPhones.has(phone)) {
        result.skipped += 1;
        continue;
      }
      seenPhones.add(phone);

      // Existing-row handling
      const existingId = existingPhones.get(phone);
      if (existingId) {
        if (mode === 'fail_on_conflict') {
          throw Object.assign(new Error(`row ${rowNum}: phone ${phone} already exists in this campaign`), { status: 409 });
        }
        if (mode === 'upsert') {
          await CampaignLead.update(
            { name: lead.name, country: lead.country, business: lead.business, custom_fields: lead.custom_fields },
            { where: { id: existingId } },
          );
          result.updated += 1;
        } else {
          result.skipped += 1;
        }
        continue;
      }

      buffer.push(lead);
      result.inserted += 1;
      if (buffer.length >= 500) await flush();
    } catch (e) {
      if (e.status === 409) throw e; // fail_on_conflict: bubble up
      result.errors.push({ row: rowNum, message: e.message });
      result.skipped += 1;
      // do not count toward `inserted`
      if (mode === 'fail_on_conflict' && e.status >= 400) throw e;
    }
  }

  await flush();
  return result;
}

module.exports = {
  importCsv,
  SYSTEM_FIELDS,
  coerceValue,
  normPhone,
};
