'use strict';

/**
 * BullMQ worker that consumes the `campaign-import` queue.
 *
 * Each job represents one async CSV import for one campaign. The worker
 * stream-parses the CSV (papaparse node-stream), inserts CampaignLead rows
 * in 1000-row batches, and for every freshly-inserted lead creates a
 * matching CampaignLeadRun so the scheduler can pick it up immediately.
 *
 * Designed for 500k-row uploads (~50-100 MB) — the file is never loaded
 * fully into memory; backpressure is applied via parser.pause/resume.
 *
 * Progress is persisted to the CampaignImportJob row every ~5 batches
 * (~5000 rows) to minimise DB writes while keeping the UI responsive.
 */

const fs = require('fs');
const Papa = require('papaparse');

const { createWorker, IMPORT_QUEUE } = require('./campaignQueues');
const {
  CampaignImportJob,
  CampaignLead,
  CampaignLeadRun,
  CampaignLeadField,
  Campaign,
  sequelize,
} = require('../models');
const { normPhone, coerceValue, SYSTEM_FIELDS } = require('../services/campaign-csv-importer');

const BATCH_SIZE = 1000;
const PROGRESS_EVERY_N_BATCHES = 5;
const MAX_ERRORS_RETAINED = 100;
// Skip the existing-phones pre-load above this campaign size — at >1M leads
// the Map would dominate worker memory; rely on the DB unique index instead.
const PRELOAD_DEDUPE_THRESHOLD = 1_000_000;
const VALID_LEAD_STATUSES = ['raw', 'contacted', 'engaged', 'interested', 'qualified', 'disqualified', 'dnc'];

function safeUnlink(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.warn(`[campaignImportWorker] failed to remove tmp file ${filePath}: ${err.message}`);
    }
  });
}

function buildLeadFromRow({ row, columnMapping, phoneSourceHeader, fieldById, orgId, campaignId }) {
  const phone = normPhone(row[phoneSourceHeader]);
  if (!phone) return { phone: null, lead: null };

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
      if (s && VALID_LEAD_STATUSES.includes(s)) lead.status = s;
      continue;
    }
    if (fieldId === 'lastTouch') {
      const v = coerceValue(rawVal, 'datetime');
      if (v) lead.last_touch_at = v;
      continue;
    }
    const fd = fieldById[fieldId];
    if (!fd || fd.is_deleted) continue;
    const coerced = coerceValue(rawVal, fd.type);
    if (coerced !== null) lead.custom_fields[fieldId] = coerced;
  }

  return { phone, lead };
}

async function processImportJob(job) {
  const { importJobId, orgId, campaignId, filePath, columnMapping, mode = 'skip_duplicates' } = job.data || {};

  const importRow = await CampaignImportJob.findByPk(importJobId);
  if (!importRow) {
    console.warn(`[campaignImportWorker] importJob ${importJobId} not found (deleted while queued) — exiting`);
    safeUnlink(filePath);
    return { skipped: true, reason: 'import_job_missing' };
  }

  await importRow.update({ status: 'running', started_at: new Date() });
  console.log(`[campaignImportWorker] start import=${importJobId} campaign=${campaignId} mode=${mode} file=${filePath}`);

  const campaign = await Campaign.findOne({ where: { id: campaignId, org_id: orgId } });
  if (!campaign) {
    await importRow.update({
      status: 'failed',
      last_error: 'Campaign deleted',
      finished_at: new Date(),
    });
    safeUnlink(filePath);
    return { failed: true, reason: 'campaign_missing' };
  }

  const leadFields = await CampaignLeadField.findAll({
    where: { org_id: orgId, is_deleted: false },
  });
  const fieldById = Object.fromEntries(leadFields.map((f) => [f.id, f]));

  // Validate column mapping the same way the sync importer does.
  const knownIds = new Set([...SYSTEM_FIELDS, ...leadFields.map((f) => f.id)]);
  const unknown = Object.values(columnMapping || {}).filter((id) => !knownIds.has(id));
  if (unknown.length) {
    const msg = `column_mapping references unknown field ids: ${unknown.join(', ')}`;
    await importRow.update({ status: 'failed', last_error: msg, finished_at: new Date() });
    safeUnlink(filePath);
    const err = new Error(msg);
    err.code = 'BAD_MAPPING';
    throw err;
  }
  const phoneSourceHeader = Object.entries(columnMapping || {}).find(([, id]) => id === 'phone')?.[0];
  if (!phoneSourceHeader) {
    const msg = 'column_mapping must map at least one CSV column to "phone"';
    await importRow.update({ status: 'failed', last_error: msg, finished_at: new Date() });
    safeUnlink(filePath);
    const err = new Error(msg);
    err.code = 'NO_PHONE_COLUMN';
    throw err;
  }

  // Pre-load existing phones unless the campaign is already too large.
  let existingPhones = new Map();
  const existingCount = await CampaignLead.count({ where: { org_id: orgId, campaign_id: campaignId } });
  if (existingCount <= PRELOAD_DEDUPE_THRESHOLD) {
    const existing = await CampaignLead.findAll({
      where: { org_id: orgId, campaign_id: campaignId },
      attributes: ['id', 'phone'],
      raw: true,
    });
    existingPhones = new Map(existing.map((r) => [r.phone, r.id]));
    console.log(`[campaignImportWorker] preloaded ${existingPhones.size} existing phones for in-process dedupe`);
  } else {
    console.log(`[campaignImportWorker] campaign has ${existingCount} leads — skipping preload, using DB unique index`);
  }

  const seenPhones = new Set();
  let buffer = [];
  const counters = { processed: 0, inserted: 0, updated: 0, skipped: 0, error_count: 0 };
  const persisted = { processed: 0, inserted: 0, updated: 0, skipped: 0, error_count: 0 };
  const errors = [];
  let batchesSinceFlush = 0;
  let totalInsertedThisRun = 0;
  let fatalError = null;
  let cancelled = false;

  // Default next_run_at for new runs — fall back to NOW when start_at unset.
  const defaultNextRunAt = campaign.start_at ? new Date(campaign.start_at) : new Date();

  async function persistProgress(extra = {}) {
    const delta = {
      processed: counters.processed,
      inserted: counters.inserted,
      updated: counters.updated,
      skipped: counters.skipped,
      error_count: counters.error_count,
      errors: errors.length ? errors.slice(0, MAX_ERRORS_RETAINED) : null,
      ...extra,
    };
    try {
      await importRow.update(delta);
      persisted.processed = counters.processed;
      persisted.inserted = counters.inserted;
      persisted.updated = counters.updated;
      persisted.skipped = counters.skipped;
      persisted.error_count = counters.error_count;
      const pct = importRow.total_rows
        ? ` (${Math.min(100, Math.floor((counters.processed / importRow.total_rows) * 100))}%)`
        : '';
      console.log(`[campaignImportWorker] progress import=${importJobId} processed=${counters.processed}${pct} inserted=${counters.inserted} updated=${counters.updated} skipped=${counters.skipped} errors=${counters.error_count}`);
    } catch (e) {
      console.warn(`[campaignImportWorker] progress persist failed: ${e.message}`);
    }
  }

  async function checkCancelled() {
    // Re-read the row's status only on batch boundaries (~every 1000 rows)
    // so cancel latency is bounded to one batch worth of work without
    // adding a DB hit per row. 5000-row latency (the progress-persist
    // cadence) would be too slow when the worker is grinding.
    try {
      const fresh = await CampaignImportJob.findOne({
        where: { id: importJobId },
        attributes: ['status'],
      });
      return !!(fresh && fresh.status === 'cancelled');
    } catch (_) {
      return false;
    }
  }

  async function flushBatch() {
    if (cancelled) return;
    if (await checkCancelled()) {
      // Drop any pending rows on the floor — the user asked to stop, so
      // committing a partial-but-larger batch on the way out would surprise
      // them. The DB row already has status='cancelled', last_error set.
      cancelled = true;
      buffer = [];
      return;
    }
    if (!buffer.length) return;
    const batch = buffer;
    buffer = [];

    // Phones to-be-inserted in this batch (anything not already mapped to an existing id).
    const insertablePhones = new Set(batch.map((b) => b.phone));

    const tx = await sequelize.transaction();
    try {
      if (mode === 'upsert') {
        await CampaignLead.bulkCreate(batch, {
          updateOnDuplicate: ['name', 'country', 'business', 'custom_fields', 'updated_at'],
          transaction: tx,
        });
      } else {
        // 'skip_duplicates' and 'fail_on_conflict' both lean on ignoreDuplicates here;
        // fail_on_conflict surfaces conflicts at the row-scan stage instead (see below).
        await CampaignLead.bulkCreate(batch, {
          ignoreDuplicates: true,
          transaction: tx,
        });
      }

      // MariaDB lacks RETURNING on bulk inserts — fetch IDs back by phone so
      // we can create CampaignLeadRun rows for the freshly-inserted leads only.
      const freshRows = await CampaignLead.findAll({
        where: {
          org_id: orgId,
          campaign_id: campaignId,
          phone: Array.from(insertablePhones),
        },
        attributes: ['id', 'phone'],
        raw: true,
        transaction: tx,
      });

      const runRows = [];
      for (const r of freshRows) {
        if (existingPhones.has(r.phone)) continue; // was already present before this run
        runRows.push({
          org_id: orgId,
          campaign_id: campaignId,
          campaign_lead_id: r.id,
          current_day_index: 0,
          current_action_index: 0,
          next_run_at: defaultNextRunAt,
          status: 'pending',
        });
        // Remember it so subsequent batches in this same import don't re-create runs.
        existingPhones.set(r.phone, r.id);
      }

      if (runRows.length) {
        await CampaignLeadRun.bulkCreate(runRows, { transaction: tx });
      }

      await tx.commit();
      totalInsertedThisRun += runRows.length;
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* ignore */ }
      throw e;
    }

    batchesSinceFlush += 1;
    if (batchesSinceFlush >= PROGRESS_EVERY_N_BATCHES) {
      batchesSinceFlush = 0;
      await persistProgress();
    }
  }

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    let bomStripped = false;
    let rowIndex = 1; // header is row 1; data rows start at 2

    stream.once('error', (e) => reject(e));

    Papa.parse(stream, {
      header: true,
      skipEmptyLines: 'greedy',
      // papaparse handles the stream end-to-end; we only need to convert
      // the first chunk's leading BOM (Excel CSV exports).
      beforeFirstChunk(chunk) {
        if (!bomStripped && chunk && chunk.charCodeAt(0) === 0xfeff) {
          bomStripped = true;
          return chunk.slice(1);
        }
        return chunk;
      },
      step: (results, parser) => {
        if (fatalError) {
          parser.abort();
          return;
        }
        if (cancelled) {
          parser.abort();
          return;
        }
        rowIndex += 1;
        const rowNum = rowIndex;
        counters.processed += 1;

        const row = results.data;
        try {
          const { phone, lead } = buildLeadFromRow({
            row, columnMapping, phoneSourceHeader, fieldById, orgId, campaignId,
          });

          if (!phone) {
            counters.skipped += 1;
            if (errors.length < MAX_ERRORS_RETAINED) errors.push({ row: rowNum, message: 'missing phone' });
            counters.error_count += 1;
            return;
          }

          if (seenPhones.has(phone)) {
            counters.skipped += 1;
            return;
          }
          seenPhones.add(phone);

          const existingId = existingPhones.get(phone);
          if (existingId) {
            if (mode === 'fail_on_conflict') {
              fatalError = new Error(`row ${rowNum}: phone ${phone} already exists in this campaign`);
              fatalError.code = 'DUPLICATE_PHONE';
              parser.abort();
              return;
            }
            if (mode === 'upsert') {
              // Queue an upsert via the same buffer; bulkCreate with
              // updateOnDuplicate will handle it server-side.
              buffer.push(lead);
              counters.updated += 1;
            } else {
              counters.skipped += 1;
            }
            return;
          }

          buffer.push(lead);
          counters.inserted += 1;
        } catch (e) {
          counters.error_count += 1;
          counters.skipped += 1;
          if (errors.length < MAX_ERRORS_RETAINED) errors.push({ row: rowNum, message: e.message });
        }

        if (buffer.length >= BATCH_SIZE) {
          parser.pause();
          flushBatch()
            .then(() => {
              if (cancelled) {
                console.log(`[campaign-import] ${importJobId} cancellation detected at row ${counters.processed} — stopping`);
                parser.abort();
                return;
              }
              parser.resume();
            })
            .catch((err) => {
              fatalError = err;
              parser.abort();
            });
        }
      },
      complete: async () => {
        try {
          if (fatalError) {
            // fail_on_conflict or batch insert error already captured; don't flush more.
            return reject(fatalError);
          }
          if (cancelled) {
            // Skip the final flush — buffer was dropped on cancel detection.
            // Persist counters one last time so the UI sees the partial count
            // where we stopped; the DB row already carries status='cancelled'.
            await persistProgress();
            return resolve();
          }
          await flushBatch();
          // flushBatch may have flipped `cancelled` if the user cancelled
          // between the last batch and the parser's complete event.
          await persistProgress();
          resolve();
        } catch (e) {
          reject(e);
        }
      },
      error: (err) => reject(err),
    });
  }).then(async () => {
    if (cancelled) {
      // Cancellation is a normal terminal state, not a failure — the cancel
      // route already stamped status='cancelled' and last_error. Leave the
      // row alone, skip the stats bump, drop the tmp file, return cleanly
      // so BullMQ marks the job completed-with-no-error (no retries).
      safeUnlink(filePath);
      console.log(`[campaign-import] ${importJobId} cancelled — worker exited cleanly at row ${counters.processed}`);
      return { cancelled: true, ...counters };
    }
    // Update Campaign.stats.total in its own transaction so a stats-write
    // failure doesn't roll back any successfully-inserted leads.
    if (totalInsertedThisRun > 0) {
      const tx = await sequelize.transaction();
      try {
        const fresh = await Campaign.findByPk(campaignId, { transaction: tx, lock: tx.LOCK.UPDATE });
        if (fresh) {
          const stats = fresh.stats && typeof fresh.stats === 'object' ? { ...fresh.stats } : {};
          stats.total = (Number(stats.total) || 0) + totalInsertedThisRun;
          await fresh.update({ stats }, { transaction: tx });
        }
        await tx.commit();
      } catch (e) {
        try { await tx.rollback(); } catch (_) { /* ignore */ }
        console.warn(`[campaignImportWorker] failed to update Campaign.stats.total: ${e.message}`);
      }
    }

    await importRow.update({
      status: 'completed',
      finished_at: new Date(),
      processed: counters.processed,
      inserted: counters.inserted,
      updated: counters.updated,
      skipped: counters.skipped,
      error_count: counters.error_count,
      errors: errors.length ? errors.slice(0, MAX_ERRORS_RETAINED) : null,
    });
    console.log(`[campaignImportWorker] completed import=${importJobId} processed=${counters.processed} inserted=${counters.inserted} updated=${counters.updated} skipped=${counters.skipped} errors=${counters.error_count}`);
    safeUnlink(filePath);
    return { ok: true, ...counters };
  }).catch(async (err) => {
    // Note any partial commit in last_error so the operator knows leads may
    // already have been inserted from earlier batches.
    const partialNote = counters.inserted > 0
      ? ` (partial: ${counters.inserted} leads already inserted from earlier batches)`
      : '';
    const message = `${err.message || String(err)}${partialNote}`;
    try {
      await importRow.update({
        status: 'failed',
        last_error: message,
        finished_at: new Date(),
        processed: counters.processed,
        inserted: counters.inserted,
        updated: counters.updated,
        skipped: counters.skipped,
        error_count: counters.error_count,
        errors: errors.length ? errors.slice(0, MAX_ERRORS_RETAINED) : null,
      });
    } catch (e) {
      console.warn(`[campaignImportWorker] failed to record failure: ${e.message}`);
    }
    console.error(`[campaignImportWorker] FAILED import=${importJobId} attempt=${job.attemptsMade + 1}: ${message}`);
    safeUnlink(filePath);
    // Re-throw so BullMQ retries (3 attempts w/ exponential backoff per queue defaults).
    throw err;
  });
}

/**
 * Start the import worker. Returns the Worker instance, or the no-op stub
 * when CAMPAIGN_WORKERS_ENABLED=0 (handled inside createWorker).
 */
function startImportWorker() {
  return createWorker(IMPORT_QUEUE, processImportJob, { concurrency: 2 });
}

module.exports = { startImportWorker };
