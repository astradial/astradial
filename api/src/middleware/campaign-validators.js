'use strict';

// Validators for campaign endpoints. Plain-function style (matching the
// rest of api/src/routes/*) — no express-validator pipeline since the
// workflow JSON has a custom shape that's clearer as a recursive walk.

const ACTION_TYPES = new Set(['whatsapp', 'call']);
const TEMPLATE_STATUSES = new Set(['draft', 'published', 'archived']);

function bad(res, msg, details) {
  return res.status(400).json({ error: 'ValidationError', message: msg, ...(details && { details }) });
}

function isString(v, max) {
  return typeof v === 'string' && v.length > 0 && (!max || v.length <= max);
}

function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// Validate the Studio workflow JSON shape:
//   { meta?: object, days: [ { id, gap>=0, actions: [ { id, type ∈ {whatsapp,call}, ... } ] } ] }
function validateWorkflow(workflow) {
  const errs = [];
  if (!workflow || typeof workflow !== 'object') {
    return ['workflow must be an object'];
  }
  if (!Array.isArray(workflow.days)) {
    return ['workflow.days must be an array'];
  }
  const dayIds = new Set();
  workflow.days.forEach((day, i) => {
    const p = `days[${i}]`;
    if (!day || typeof day !== 'object') { errs.push(`${p} must be an object`); return; }
    if (!isString(day.id, 64)) errs.push(`${p}.id must be a non-empty string ≤64 chars`);
    if (dayIds.has(day.id)) errs.push(`${p}.id is duplicated`);
    dayIds.add(day.id);
    if (typeof day.gap !== 'number' || day.gap < 0 || !Number.isInteger(day.gap)) {
      errs.push(`${p}.gap must be a non-negative integer`);
    }
    if (!Array.isArray(day.actions)) { errs.push(`${p}.actions must be an array`); return; }
    const actionIds = new Set();
    day.actions.forEach((a, j) => {
      const ap = `${p}.actions[${j}]`;
      if (!a || typeof a !== 'object') { errs.push(`${ap} must be an object`); return; }
      if (!isString(a.id, 64)) errs.push(`${ap}.id must be a non-empty string ≤64 chars`);
      if (actionIds.has(a.id)) errs.push(`${ap}.id is duplicated`);
      actionIds.add(a.id);
      if (!ACTION_TYPES.has(a.type)) errs.push(`${ap}.type must be one of: ${[...ACTION_TYPES].join(', ')}`);
      if (a.type === 'whatsapp' && a.template != null && !isString(a.template, 200)) {
        errs.push(`${ap}.template must be a string ≤200 chars`);
      }
      if (a.type === 'whatsapp' && a.interest_keywords != null) {
        if (!Array.isArray(a.interest_keywords)) {
          errs.push(`${ap}.interest_keywords must be an array`);
        } else if (a.interest_keywords.length > 20) {
          errs.push(`${ap}.interest_keywords must have ≤20 entries`);
        } else {
          a.interest_keywords.forEach((kw, ki) => {
            if (typeof kw !== 'string' || kw.trim().length === 0 || kw.length > 50) {
              errs.push(`${ap}.interest_keywords[${ki}] must be a non-empty string ≤50 chars`);
            }
          });
        }
      }
      if (a.type === 'call' && a.interest_keywords != null) {
        if (!Array.isArray(a.interest_keywords)) {
          errs.push(`${ap}.interest_keywords must be an array`);
        } else if (a.interest_keywords.length > 20) {
          errs.push(`${ap}.interest_keywords must have ≤20 entries`);
        } else {
          a.interest_keywords.forEach((kw, ki) => {
            if (typeof kw !== 'string' || kw.trim().length === 0 || kw.length > 50) {
              errs.push(`${ap}.interest_keywords[${ki}] must be a non-empty string ≤50 chars`);
            }
          });
        }
      }
      if (a.type === 'call' && a.script != null && !isString(a.script, 200)) {
        errs.push(`${ap}.script must be a string ≤200 chars`);
      }
      // callerId is freeform but bounded — anything more nuanced (E.164,
      // org-owns-this-DID) belongs in PR 5 alongside the scheduler.
      if (a.callerId != null && !isString(a.callerId, 64)) {
        errs.push(`${ap}.callerId must be a string ≤64 chars`);
      }
      // options is a render-only bag; reject scalars/arrays so the
      // shape stays predictable, but don't validate keys.
      if (a.options != null && (typeof a.options !== 'object' || Array.isArray(a.options))) {
        errs.push(`${ap}.options must be an object`);
      }
    });
  });
  return errs;
}

function templateCreate(req, res, next) {
  const { name, description } = req.body || {};
  if (!isString(name, 200)) return bad(res, 'name is required (1-200 chars)');
  if (description != null && (typeof description !== 'string' || description.length > 4000)) {
    return bad(res, 'description must be ≤4000 chars');
  }
  next();
}

function templateUpdate(req, res, next) {
  const { name, description, workflow, status } = req.body || {};
  if (name != null && !isString(name, 200)) return bad(res, 'name must be 1-200 chars');
  if (description != null && (typeof description !== 'string' || description.length > 4000)) {
    return bad(res, 'description must be ≤4000 chars');
  }
  if (status != null && !TEMPLATE_STATUSES.has(status)) {
    return bad(res, `status must be one of: ${[...TEMPLATE_STATUSES].join(', ')}`);
  }
  if (workflow != null) {
    const errs = validateWorkflow(workflow);
    if (errs.length) return bad(res, 'workflow is invalid', errs);
  }
  next();
}

function throughputUpdate(req, res, next) {
  const { avg_call_seconds } = req.body || {};
  // max_concurrent_calls / max_sends_per_minute removed in Phase D — now org-level.
  if (avg_call_seconds !== undefined) {
    if (!Number.isInteger(avg_call_seconds) || avg_call_seconds < 10 || avg_call_seconds > 7200) {
      return bad(res, 'avg_call_seconds must be an integer between 10 and 7200');
    }
  }
  next();
}

module.exports = {
  validateWorkflow,
  templateCreate,
  templateUpdate,
  throughputUpdate,
  isUuid,
  isString,
  bad,
  ACTION_TYPES,
  TEMPLATE_STATUSES,
};
