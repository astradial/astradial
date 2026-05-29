/**
 * MSG91 WhatsApp client (admin account).
 *
 * Used by:
 *   • the daily 18:00 IST scheduler to send personalised missed-call
 *     summaries to subscribers across customer orgs;
 *   • the admin UI's "Test Send" button to verify config without waiting
 *     for the cron tick;
 *   • the admin UI's template picker (proxies MSG91's template list).
 *
 * Auth key intentionally read from env on EVERY call rather than cached
 * at module-load time so a rotation (`pm2 restart astrapbx` after an .env
 * edit) takes effect without a code change.
 *
 * Errors policy: return `{ ok: false, error, status }` instead of throwing.
 * The scheduler iterates over hundreds of orgs/subscribers; one MSG91
 * failure (network blip, bad phone, template not approved) shouldn't kill
 * the rest of the run. Callers can decide retry semantics.
 */

'use strict';

const MSG91_BASE = 'https://api.msg91.com/api/v5';

function authKey() {
  const k = process.env.MSG91_ADMIN_AUTH_KEY;
  if (!k) throw new Error('MSG91_ADMIN_AUTH_KEY is not set in environment');
  return k;
}

/**
 * GET /api/v5/whatsapp/templates — list templates approved on the admin
 * MSG91 account. Used by the admin UI to populate the template-selector
 * dropdown.
 *
 * MSG91 response shape (simplified):
 *   { hasError: false, data: [ { name, status, language, ... }, ... ] }
 *
 * We filter to APPROVED templates only — sending against a draft/rejected
 * template gives a confusing 400 at send time, easier to never offer it.
 */
async function listTemplates() {
  try {
    const intNum = process.env.MSG91_INTEGRATED_NUMBER || 15558897024;
    const res = await fetch(`https://control.msg91.com/api/v5/whatsapp/get-template-client/${intNum}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        authkey: authKey(),
      },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || (body && body.hasError)) {
      return {
        ok: false,
        status: res.status,
        error: (body && (body.message || JSON.stringify(body))) || `HTTP ${res.status}`,
      };
    }
    const all = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    const approved = all.filter((t) => !t.status || String(t.status).toLowerCase() === 'approved');
    return { ok: true, templates: approved, raw: body };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * POST /api/v5/whatsapp/whatsapp-outbound-message/bulk/ — send one
 * template message personalised per recipient.
 *
 * `recipients` is an array of `{ to: [phone], components }` per the MSG91
 * shape — letting each recipient receive a different set of variable
 * values in a single API call (e.g., "Hello Ramesh" / "Hello Priya" in
 * one batch instead of N HTTP calls).
 *
 * Variable shape from caller:
 *   recipients = [
 *     { to: ['919812345678'], components: {
 *         header_1: { type: 'text', value: '13 May 2026' },
 *         body_1:   { type: 'text', value: 'Ramesh' },
 *         body_2:   { type: 'text', value: '7'         },
 *       } },
 *     ...
 *   ]
 *
 * Failure of individual phones inside a batch is reported by MSG91 in
 * `body.message[*].requestId` / `body.message[*].code` — the caller is
 * responsible for inspecting that and logging per-recipient outcomes.
 */
async function sendBulkTemplate({
  integratedNumber,
  templateName,
  namespace,
  language = 'en',
  recipients,
}) {
  if (!integratedNumber || !templateName || !namespace) {
    return { ok: false, error: 'missing required field (integratedNumber/templateName/namespace)' };
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return { ok: false, error: 'recipients must be a non-empty array' };
  }

  const payload = {
    integrated_number: integratedNumber,
    content_type: 'template',
    payload: {
      messaging_product: 'whatsapp',
      type: 'template',
      template: {
        name: templateName,
        language: { code: language, policy: 'deterministic' },
        namespace,
        to_and_components: recipients.map((r) => ({
          to: r.to,
          components: r.components,
        })),
      },
    },
  };

  try {
    const res = await fetch(`${MSG91_BASE}/whatsapp/whatsapp-outbound-message/bulk/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authkey: authKey(),
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: (body && (body.message || body.error || JSON.stringify(body))) || `HTTP ${res.status}`,
        body,
      };
    }
    return { ok: true, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  listTemplates,
  sendBulkTemplate,
};
