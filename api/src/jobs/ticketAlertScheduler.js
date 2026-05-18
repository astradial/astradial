/**
 * Daily open-ticket WhatsApp alert scheduler.
 *
 * Cron: 0 18 * * *  with timezone Asia/Kolkata
 *
 * For every org with `ticket_alerts_enabled = true`:
 *   1. Count the org's currently-open support tickets from Firestore at
 *      `{TICKETS_ROOT}/{orgId}/tickets` where status='open' and not archived.
 *      Tickets accumulate across days until an operator closes them, so a
 *      customer with 8 unaddressed missed-call tickets from last week and
 *      0 new calls today still gets a reminder.
 *   2. If count = 0, SKIP this org (don't spam zero-count alerts).
 *   3. For each subscriber phone, build per-recipient template components
 *      and send via MSG91 `sendBulkTemplate` in a single batched API call.
 *
 * Template variables:
 *   header_1 = today's date (e.g. "14 May 2026")    ← {{1}} in header
 *   body_1   = subscriber's name                     ← {{1}} in body
 *   body_2   = open-ticket count                     ← {{2}} in body
 *
 * One MSG91 call per org (not per subscriber) since `to_and_components`
 * supports per-recipient personalisation in a single bulk request. If an
 * individual phone fails, MSG91 reports it in the per-recipient response;
 * we audit-log every send + every skip with reason so "why didn't I get
 * an alert?" is debuggable post-hoc.
 *
 * Refusal cases (the scheduler emits an audit-log entry and bails out
 * cleanly without throwing):
 *   • Admin WhatsApp config not ready (any of integrated_number,
 *     namespace, or selected_template_name unset)
 *   • MSG91_ADMIN_AUTH_KEY missing from env
 *   • Zero subscribers for an org with the toggle on (operator probably
 *     enabled+forgot to add anyone)
 *
 * `runOnce()` is exported so a developer can invoke it from a node REPL
 * for debugging without waiting for 18:00 IST. The cron also calls it.
 */

'use strict';

const cron = require('node-cron');
const { QueryTypes } = require('sequelize');

const {
  sequelize,
  Organization,
  TicketAlertSubscriber,
  AdminWhatsappConfig,
} = require('../models');
const msg91 = require('../services/msg91Service');

// Tickets live in Firestore (collection `astrapbx/{orgId}/tickets`, or
// `astrapbx_stage` on staging). Lazy-loaded so a Firestore connectivity
// issue doesn't kill the whole astrapbx boot — the scheduler aborts
// gracefully on the first failed query instead.
//
// OSS-native deployments run with USE_FIREBASE=false and shouldn't touch
// Firestore at all. firestore() throws a clear error in that mode; the
// scheduler's callers wrap accesses in try/catch and audit-log the skip.
let _fsAdmin = null;
function firestore() {
  if (process.env.USE_FIREBASE !== 'true') {
    throw new Error('Firestore disabled (USE_FIREBASE!=true); skipping firestore-backed path');
  }
  if (_fsAdmin) return _fsAdmin;
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    const cred = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!cred) throw new Error('GOOGLE_APPLICATION_CREDENTIALS not set');
    admin.initializeApp({ credential: admin.credential.cert(require(cred)) });
  }
  _fsAdmin = admin.firestore();
  return _fsAdmin;
}

const TICKETS_ROOT = process.env.ASTRADIAL_ENV === 'staging' ? 'astrapbx_stage' : 'astrapbx';

// Editor host used in the WhatsApp "View details" button URL. The MSG91
// template's button is approved with a `{{1}}` URL variable and the
// validator on MSG91's side requires the substituted value to BE a
// valid URL — sending just the path suffix gets rejected as
// "Invalid URL in Button Component". So we send the full URL.
const EDITOR_BASE_URL = process.env.EDITOR_BASE_URL
  || (process.env.ASTRADIAL_ENV === 'staging'
        ? 'https://staging-editor.example.com'
        : 'https://editor.example.com');

const CRON_SPEC = '0 18 * * *';
const TIMEZONE = 'Asia/Kolkata';

// "13 May 2026" — matches the template's header {{1}} expectation.
function formatIstDate(d = new Date()) {
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: TIMEZONE,
  });
}

// Today's IST window as UTC Date objects, suitable for Sequelize Op.gte/lt.
// Computed by asking the system for today's IST date string, then re-
// interpreting that as UTC offset by India's +05:30. Avoids any
// dependency on the host process's TZ.
function todayIstWindow(now = new Date()) {
  const ymd = now.toLocaleDateString('en-CA', { timeZone: TIMEZONE }); // 'YYYY-MM-DD'
  const startUtc = new Date(`${ymd}T00:00:00+05:30`);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc, endUtc, ymd };
}

async function audit(orgId, action, details) {
  try {
    await sequelize.query(
      `INSERT INTO audit_log (org_id, user_email, action, resource, resource_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      { replacements: [orgId || null, 'scheduler', action, 'ticket_alert', null, JSON.stringify(details || {})] }
    );
  } catch (e) {
    // Never let an audit-log failure abort the run. Log to stderr and continue.
    console.error('[ticketAlertScheduler] audit_log write failed:', e.message);
  }
}

/**
 * Count this org's currently-open tickets.
 *
 * The daily WhatsApp's template variable `body_2` is the count of
 * support tickets that still need action. This is NOT today's missed-
 * call CDR count — tickets accumulate across days until an operator
 * closes them. A customer with 8 unaddressed missed-call tickets from
 * last week and 0 new calls today still gets an alert reminding them
 * those 8 are still open.
 *
 * Counts tickets in Firestore at:
 *   {TICKETS_ROOT}/{orgId}/tickets where status = 'open' AND archived != true
 *
 * We filter `archived != true` via JS post-filter to avoid a composite
 * index requirement (Firestore doesn't allow != / != combinations on
 * different fields without a tailored composite index). At per-org
 * scale (tens to hundreds of tickets per org max) this is trivial.
 */
/**
 * Count this org's currently-open tickets.
 *
 * MariaDB-backed since Phase B of the tickets migration. Previously
 * read from Firestore `{TICKETS_ROOT}/{orgId}/tickets` with a
 * post-filter on `archived !== true`. Now a single SELECT against
 * the `tickets` table — same semantic (status='open' includes
 * `in_progress`? no — only literal 'open' matches the old behavior
 * and the daily-report's intent: "what's waiting for action").
 *
 * The Firestore code path is kept for `firestore()` because the
 * boot-time lazy init might still be useful for other features.
 * Once the rest of the migration is complete it can be removed.
 */
async function countOpenTicketsForOrg(orgId) {
  // QueryTypes.SELECT returns a flat array of row objects (no
  // metadata tuple). Destructure the first row directly.
  const rows = await sequelize.query(
    "SELECT COUNT(*) AS n FROM tickets WHERE org_id = ? AND status = 'open'",
    { replacements: [orgId], type: QueryTypes.SELECT }
  );
  return Number((rows && rows[0] && rows[0].n) || 0);
}

/**
 * Run the daily sweep once. Idempotent — calling it twice the same day
 * sends the alert twice. Callers requiring once-per-day semantics should
 * gate on their own flag; cron's single tick is the natural gate.
 *
 * Returns a summary object so the cron handler can log a single line
 * with counts of orgs-considered, sent, skipped, failed.
 */
async function runOnce({ now = new Date() } = {}) {
  const { startUtc, endUtc, ymd } = todayIstWindow(now);
  const dateLabel = formatIstDate(now);

  const summary = { date: ymd, orgs_considered: 0, sent: 0, skipped_zero: 0, skipped_no_subs: 0, skipped_no_config: 0, failed: 0 };

  if (!process.env.MSG91_ADMIN_AUTH_KEY) {
    summary.skipped_no_config = -1;
    await audit(null, 'ticket_alert.run.abort', { reason: 'MSG91_ADMIN_AUTH_KEY not set', summary });
    console.warn('[ticketAlertScheduler] aborting — MSG91_ADMIN_AUTH_KEY not in env');
    return summary;
  }

  const cfg = await AdminWhatsappConfig.getSingleton();
  if (!cfg.isReadyForSend()) {
    summary.skipped_no_config = -1;
    await audit(null, 'ticket_alert.run.abort', {
      reason: 'admin_whatsapp_config incomplete',
      missing: {
        integrated_number: !cfg.integrated_number,
        namespace: !cfg.namespace,
        selected_template_name: !cfg.selected_template_name,
      },
      summary,
    });
    console.warn('[ticketAlertScheduler] aborting — admin_whatsapp_config incomplete');
    return summary;
  }

  const orgs = await Organization.findAll({
    where: { ticket_alerts_enabled: true },
    attributes: ['id', 'name'],
  });
  summary.orgs_considered = orgs.length;

  for (const org of orgs) {
    try {
      const openTicketCount = await countOpenTicketsForOrg(org.id);
      if (openTicketCount === 0) {
        summary.skipped_zero++;
        await audit(org.id, 'ticket_alert.skip', { reason: 'zero_open_tickets', date: ymd });
        continue;
      }

      const subs = await TicketAlertSubscriber.findAll({
        where: { org_id: org.id },
        attributes: ['id', 'country_code', 'phone', 'name'],
      });
      if (subs.length === 0) {
        summary.skipped_no_subs++;
        await audit(org.id, 'ticket_alert.skip', {
          reason: 'no_subscribers',
          open_ticket_count: openTicketCount,
          hint: 'alerts toggle is ON but the subscriber list is empty',
          date: ymd,
        });
        continue;
      }

      // Build per-recipient components. Header is the same for everyone
      // in this batch (today's date); body_1 changes per subscriber name;
      // body_2 is the same org-wide open-ticket count.
      //
      // button_1 = "View details" button URL. The MSG91 template has a
      // URL button with a `{{1}}` variable, and MSG91 validates the
      // substituted value as a URL — sending only the path suffix gets
      // rejected with "Invalid URL in Button Component". So we send the
      // full URL to the org's tickets page in the editor.
      const ticketsUrl = `${EDITOR_BASE_URL}/dashboard/${org.id}/tickets`;
      const recipients = subs.map((s) => ({
        to: [s.fullNumber()],
        components: {
          header_1: { type: 'text', value: dateLabel },
          body_1: { type: 'text', value: s.name },
          body_2: { type: 'text', value: String(openTicketCount) },
          button_1: { subtype: 'url', type: 'text', value: ticketsUrl },
        },
      }));

      const result = await msg91.sendBulkTemplate({
        integratedNumber: cfg.integrated_number,
        templateName: cfg.selected_template_name,
        namespace: cfg.namespace,
        language: cfg.template_language || 'en',
        recipients,
      });

      if (!result.ok) {
        summary.failed++;
        await audit(org.id, 'ticket_alert.send.fail', {
          reason: 'msg91_error',
          status: result.status,
          error: result.error,
          open_ticket_count: openTicketCount,
          recipient_count: recipients.length,
          date: ymd,
        });
        console.error(`[ticketAlertScheduler] org=${org.id} send failed:`, result.error);
        continue;
      }

      summary.sent++;
      await audit(org.id, 'ticket_alert.send.ok', {
        open_ticket_count: openTicketCount,
        recipient_count: recipients.length,
        template: cfg.selected_template_name,
        date: ymd,
      });
    } catch (e) {
      summary.failed++;
      console.error(`[ticketAlertScheduler] org=${org.id} unexpected error:`, e.message);
      await audit(org.id, 'ticket_alert.send.fail', { reason: 'unexpected', error: e.message, date: ymd });
    }
  }

  console.log(`[ticketAlertScheduler] run complete: ${JSON.stringify(summary)}`);
  return summary;
}

let task = null;

function start() {
  if (task) {
    console.warn('[ticketAlertScheduler] already started — start() is a no-op');
    return task;
  }
  task = cron.schedule(
    CRON_SPEC,
    () => {
      runOnce({ now: new Date() }).catch((e) => {
        console.error('[ticketAlertScheduler] runOnce threw:', e);
      });
    },
    { timezone: TIMEZONE }
  );
  console.log(`✓ Ticket-alert scheduler armed (${CRON_SPEC} ${TIMEZONE})`);
  return task;
}

function stop() {
  if (!task) return;
  task.stop();
  task = null;
  console.log('✓ Ticket-alert scheduler stopped');
}

module.exports = { start, stop, runOnce, todayIstWindow, formatIstDate, CRON_SPEC, TIMEZONE };
