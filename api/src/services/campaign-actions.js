'use strict';

const msg91Service = require('./msg91Service');

const INTERNAL_SECRET = process.env.INTERNAL_CALL_SECRET || 'internal';
const PORT = process.env.PORT || 3000;

// Validate a template_snapshot before launch.
// Returns { valid: boolean, errors: string[] }
function validateSnapshot(snapshot) {
  const errors = [];

  if (!snapshot || typeof snapshot !== 'object') {
    return { valid: false, errors: ['template_snapshot must be an object'] };
  }

  if (!Array.isArray(snapshot.days) || snapshot.days.length === 0) {
    return { valid: false, errors: ['template_snapshot.days must be a non-empty array'] };
  }

  snapshot.days.forEach((day, i) => {
    const p = `days[${i}]`;
    if (!Array.isArray(day.actions) || day.actions.length === 0) {
      errors.push(`${p} must have at least one action`);
      return;
    }
    day.actions.forEach((action, j) => {
      const ap = `${p}.actions[${j}]`;
      if (action.type === 'whatsapp') {
        if (!action.template || typeof action.template !== 'string') {
          errors.push(`${ap}: whatsapp action requires a template name`);
        }
        const ns = action.namespace || action.options?.namespace;
        if (!ns || typeof ns !== 'string') {
          errors.push(`${ap}: whatsapp action requires a namespace`);
        }
      } else if (action.type === 'call') {
        if (!action.script || typeof action.script !== 'string') {
          errors.push(`${ap}: call action requires a script (pipecat bot id)`);
        }
        if (action.callerId != null) {
          if (typeof action.callerId !== 'string' || action.callerId.length > 64) {
            errors.push(`${ap}: callerId must be a string ≤64 chars`);
          }
        }
      }
    });
  });

  return { valid: errors.length === 0, errors };
}

// Send a WhatsApp template message to one lead.
// Returns { ok: boolean, transient?: boolean, requestId?: string, error?: string }
async function runWhatsApp({ orgId, campaignId, lead, run, action, campaignRow }) {
  try {
    const integratedNumber = campaignRow.options?.msg91_integrated_number
      || process.env.MSG91_INTEGRATED_NUMBER;

    if (!integratedNumber) {
      return { ok: false, transient: false, error: 'No MSG91 integrated number configured' };
    }

    const namespace = action.namespace || action.options?.namespace;
    if (!namespace) {
      return { ok: false, transient: false, error: 'No namespace configured for whatsapp action' };
    }

    const result = await msg91Service.sendBulkTemplate({
      integratedNumber,
      templateName: action.template,
      namespace,
      language: action.language || action.options?.language || 'en',
      recipients: [
        {
          to: [lead.phone],
          components: action.variables || action.options?.components || {},
        },
      ],
    });

    if (!result.ok) {
      // MSG91 4xx with bad template or bad number = permanent failure
      const status = result.status;
      if (status && status >= 400 && status < 500) {
        return { ok: false, transient: false, error: result.error };
      }
      // Network / 5xx = transient
      return { ok: false, transient: true, error: result.error };
    }

    // MSG91 can return ok=true at HTTP level but report hasError in body
    const body = result.body || {};
    if (body.hasError) {
      const code = body.code || body.errorCode;
      // Template-rejected or invalid-number error codes are permanent
      const permanentCodes = ['TEMPLATE_REJECTED', 'INVALID_NUMBER', 'OPT_OUT'];
      const isPermanent = permanentCodes.some(
        (c) => String(code || '').toUpperCase().includes(c)
      );
      return { ok: false, transient: !isPermanent, error: body.message || String(code) };
    }

    const msgs = Array.isArray(body.message) ? body.message : [];
    const requestId = msgs[0]?.requestId || body.requestId || null;
    return { ok: true, requestId: requestId || undefined };
  } catch (e) {
    // Unhandled (network, JSON parse, etc.) = transient
    return { ok: false, transient: true, error: e.message };
  }
}

// Originate a voice call via AstraPBX originate-to-ai endpoint.
// Returns { ok, transient?, callId?, error? }
async function runCall({ orgId, campaignId, lead, run, action, campaignRow }) {
  try {
    const url = `http://localhost:${PORT}/api/v1/calls/originate-to-ai`;

    // Pass campaign context as Asterisk channel variables so the pipecat bot
    // can POST the call transcript back to /webhooks/call-result when done.
    const resultWebhookUrl = `${process.env.API_BASE_URL || `http://localhost:${PORT}`}/api/v1/webhooks/call-result`;
    const body = {
      to: lead.phone,
      bot_id: action.script,
      org_id: orgId,
      variables: {
        CAMPAIGN_LEAD_ID: lead.id,
        CAMPAIGN_ID: campaignId,
        ORG_ID: orgId,
        RESULT_WEBHOOK_URL: resultWebhookUrl,
        // JSON-encoded so pipecat can match keywords client-side as well.
        INTEREST_KEYWORDS: JSON.stringify(action.interest_keywords || []),
      },
    };
    if (action.callerId) body.caller_id = action.callerId;
    const wsBaseUrl = process.env.CAMPAIGN_BOT_WS_BASE_URL || `ws://localhost:${process.env.BOT_WS_PORT || 8765}/bot`;
    body.wss_url = `${wsBaseUrl}/${action.script}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': process.env.INTERNAL_API_KEY || 'internal-dev-key',
      },
      body: JSON.stringify(body),
    });

    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      // Body may be empty on some error responses
    }

    if (!res.ok) {
      // 4xx (bad number, bot not found, etc.) = permanent
      if (res.status >= 400 && res.status < 500) {
        return {
          ok: false,
          transient: false,
          error: data?.error || data?.message || `HTTP ${res.status}`,
        };
      }
      // 5xx = transient
      return {
        ok: false,
        transient: true,
        error: data?.error || data?.message || `HTTP ${res.status}`,
      };
    }

    return {
      ok: true,
      callId: data?.call_id || data?.callId || data?.id || undefined,
    };
  } catch (e) {
    // Network error, timeout = transient
    return { ok: false, transient: true, error: e.message };
  }
}

module.exports = {
  validateSnapshot,
  runWhatsApp,
  runCall,
};
