/**
 * Step executors — each action type has a handler that runs the actual work.
 * All executors receive { config, triggerData, stepResults } and return { success, data, error }.
 */

require('dotenv').config();

const ASTRAPBX_URL = process.env.ASTRAPBX_URL || 'http://localhost:8000';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

/**
 * Resolve template variables in a string: {trigger.phone}, {step.1.data.ticket_id}
 */
function resolveTemplates(template, context) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{([^}]+)\}/g, (match, path) => {
    const parts = path.split('.');
    let value = context;
    for (const part of parts) {
      if (value == null) return match;
      value = value[part];
    }
    return value != null ? String(value) : match;
  });
}

function resolveObject(obj, context) {
  if (typeof obj === 'string') return resolveTemplates(obj, context);
  if (Array.isArray(obj)) return obj.map((item) => resolveObject(item, context));
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveObject(value, context);
    }
    return result;
  }
  return obj;
}

// ─── Executors ───

const executors = {
  /**
   * HTTP Request — send POST/GET/PUT/DELETE to any URL
   */
  async http_request({ config, context }) {
    const url = resolveTemplates(config.url, context);
    const method = (config.method || 'POST').toUpperCase();
    const headers = resolveObject(config.headers || { 'Content-Type': 'application/json' }, context);
    const body = config.body ? JSON.stringify(resolveObject(config.body, context)) : undefined;

    const resp = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(30000) });
    const responseText = await resp.text();
    let responseData;
    try { responseData = JSON.parse(responseText); } catch { responseData = responseText; }

    if (!resp.ok) {
      return { success: false, error: `HTTP ${resp.status}: ${responseText.slice(0, 200)}`, data: responseData };
    }
    return { success: true, data: responseData };
  },

  /**
   * Send WhatsApp — via MSG91 or configured provider
   */
  async send_whatsapp({ config, context, orgId }) {
    let phone = resolveTemplates(config.phone, context).replace(/\D/g, '');
    phone = '91' + phone.slice(-10); // Always India, last 10 digits

    const templateName = resolveTemplates(config.template_name || '', context);
    console.log(`[WhatsApp] phone=${phone} template=${templateName} orgId=${orgId} sender=${config.sender_number}`);

    if (templateName && orgId) {
      // Template mode — direct MSG91 API
      try {
        // Get MSG91 authkey from org settings
        const keyResp = await fetch(`${ASTRAPBX_URL}/api/v1/settings/msg91/key`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Key': INTERNAL_API_KEY },
          body: JSON.stringify({ org_id: orgId }),
        });
        const { authkey } = await keyResp.json();
        if (!authkey) return { success: false, error: 'MSG91 not configured for this org' };

        // Build template components from variable mappings
        // MSG91 uses flat format: { header_1: { type, value }, body_1: { type, value } }
        // For header variables: auto-detect image URLs, otherwise text
        const components = {};
        try {
          const varMappings = JSON.parse(config.template_variables || '[]');
          for (const v of varMappings) {
            if (v.key) {
              const resolved = resolveTemplates(v.value, context);
              // Header with URL = image type
              const isHeader = v.key.startsWith('header_');
              const isUrl = /^https?:\/\/.+/i.test(resolved);
              components[v.key] = { type: isHeader && isUrl ? 'image' : 'text', value: resolved };
            }
          }
        } catch {}
        console.log(`[WhatsApp] components:`, JSON.stringify(components));

        // Get sender number — from config or fetch from MSG91
        let senderNumber = config.sender_number || '';
        if (!senderNumber) {
          try {
            const numResp = await fetch('https://control.msg91.com/api/v5/whatsapp/whatsapp-activation/', {
              headers: { authkey, accept: 'application/json', 'content-type': 'application/json' },
            });
            const numData = await numResp.json();
            senderNumber = numData?.data?.[0]?.integrated_number || '';
          } catch {}
        }

        const resp = await fetch('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
          method: 'POST',
          headers: { authkey, 'Content-Type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            integrated_number: senderNumber,
            content_type: 'template',
            payload: {
              type: 'template',
              template: {
                name: templateName,
                language: { code: config.template_language || 'en', policy: 'deterministic' },
                to_and_components: [{ to: [phone], components }],
              },
              messaging_product: 'whatsapp',
            },
          }),
        });
        const data = await resp.json().catch(() => ({}));
        return { success: resp.ok, data, error: resp.ok ? null : `MSG91: ${resp.status}` };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    // Free text mode — fallback to bot-bridge
    const message = resolveTemplates(config.message || '', context);
    const resp = await fetch('https://events.astradial.com/bot-bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send_whatsapp', phone, message, template_id: config.template_id || '' }),
    });
    const data = await resp.json().catch(() => ({}));
    return { success: resp.ok, data, error: resp.ok ? null : `WhatsApp failed: ${resp.status}` };
  },

  /**
   * Place AI Phone Call — via AstraPBX originate-to-ai
   */
  async place_call({ config, context, orgId }) {
    const destination = resolveTemplates(config.destination, context);
    const botId = resolveTemplates(config.bot_id || '', context);
    const message = resolveTemplates(config.message || '', context);

    // Use originate-to-ai if bot/wss_url provided, otherwise click-to-call
    const wssUrl = resolveTemplates(config.wss_url || '', context);
    const callerId = resolveTemplates(config.caller_id || '', context);
    // Parse custom variables from config
    let customVars = {};
    try {
      const varList = JSON.parse(config.variables || '[]');
      for (const v of varList) {
        if (v.key) customVars[v.key] = resolveTemplates(v.value, context);
      }
    } catch {}

    const endpoint = (botId || wssUrl) ? '/api/v1/calls/originate-to-ai' : '/api/v1/calls/click-to-call';
    const body = (botId || wssUrl) ? {
      org_id: orgId,
      to: destination,
      wss_url: wssUrl || undefined,
      caller_id: callerId || undefined,
      variables: {
        WORKFLOW_BOT_ID: botId,
        ...customVars,
        // Base64-encoded custom vars for pipecat bot (avoids AMI comma delimiter issues)
        CUSTOM_VARS_B64: Buffer.from(JSON.stringify(customVars)).toString('base64'),
      },
    } : {
      org_id: orgId,
      from: callerId || destination,
      to: destination,
      to_type: 'external',
    };

    try {
      const resp = await fetch(`${ASTRAPBX_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': INTERNAL_API_KEY,
        },
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        return { success: false, error: `Call failed: ${resp.status}`, data };
      }

      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Create Ticket — via LogsUpdate /bot-bridge
   */
  async create_ticket({ config, context, orgId }) {
    const body = resolveObject({
      action: 'create_ticket',
      org_id: orgId,
      caller_number: config.caller_number || '{trigger.phone}',
      channel_id: config.channel_id || 'workflow',
      category: config.category || 'general',
      summary: config.summary || '{trigger.summary}',
      details: config.details || '',
      guest_name: config.guest_name || '{trigger.guest_name}',
      room_number: config.room_number || '{trigger.room_number}',
      priority: config.priority || 'normal',
    }, context);

    const resp = await fetch('https://events.astradial.com/bot-bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    return { success: resp.ok, data, error: resp.ok ? null : `Ticket failed: ${resp.status}` };
  },

  /**
   * Condition — evaluate expression and return branch
   */
  async condition({ config, context }) {
    const field = resolveTemplates(config.field, context);
    const operator = config.operator || '==';
    const value = resolveTemplates(config.value, context);

    let result = false;
    switch (operator) {
      case '==': result = field == value; break;
      case '!=': result = field != value; break;
      case '>': result = Number(field) > Number(value); break;
      case '<': result = Number(field) < Number(value); break;
      case 'contains': result = String(field).includes(String(value)); break;
      case 'exists': result = field != null && field !== ''; break;
      default: result = false;
    }
    return { success: true, data: { result, branch: result ? 'true' : 'false' } };
  },

  /**
   * Delay — wait for specified duration (handled by Bull Queue delay, not inline)
   */
  async delay({ config }) {
    // This is a no-op — delays are handled by re-queuing with delay in the runner
    return { success: true, data: { delayed: true, duration: config.duration } };
  },

  /**
   * Log — just log the data (for debugging)
   */
  async log({ config, context }) {
    const message = resolveTemplates(config.message || 'Workflow log', context);
    console.log(`[WORKFLOW LOG] ${message}`);
    return { success: true, data: { message } };
  },
};

module.exports = { executors, resolveTemplates, resolveObject };
