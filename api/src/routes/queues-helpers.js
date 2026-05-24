'use strict';

/**
 * Validation helpers for queue routes.
 *
 * Extracted from `queues.js` so the validation logic can be unit-tested
 * without spinning up the Express stack — see
 * `api/tests/queue-validation.test.js`.
 */

/**
 * Validate a queue's timeout destination against the org's actual config.
 * Returns `null` on success, or an error message string on failure.
 *
 * Resolution rules per type (must match `dialplanGenerator.js`
 * post-Queue() routing — see queue-architecture.md §"Post-Queue() routing"):
 *
 *   - `queue`     — destination must match an existing queue.number in this org.
 *                   Dialplan emits Goto(org_<ctx>_queue, dest, 1).
 *   - `extension` — destination must match either a user.extension OR an
 *                   ivr.extension in this org. Dialplan emits
 *                   Goto(org_<ctx>_internal, dest, 1) — both Users and IVRs
 *                   live in that context.
 *   - `phone`     — destination must look like a phone number (7-15 digits
 *                   after stripping non-digit characters). Dialplan emits
 *                   Dial(PJSIP/<digits>@<trunk>, ...) so we cannot accept
 *                   short codes here (would dial e.g. "5004" out through
 *                   the carrier — the May 20 bug we're fixing).
 *
 * Returning `null` when destination is falsy is intentional: an empty
 * destination is the valid "no timeout routing — play 'all agents busy'
 * then hang up" configuration (dialplanGenerator.js ~line 1216).
 *
 * @param {object} models - Sequelize models — `{ Queue, User, Ivr }`.
 *   Injected (not required from inside) so tests can pass mocks.
 * @param {string} orgId
 * @param {string|null|undefined} destination
 * @param {string|null|undefined} type
 * @returns {Promise<string|null>}
 */
async function validateTimeoutDestination(models, orgId, destination, type) {
  if (!destination) return null;
  if (!['queue', 'extension', 'phone'].includes(type)) {
    return `Unknown timeout destination type: ${type}`;
  }
  const dest = String(destination);
  if (type === 'queue') {
    const q = await models.Queue.findOne({ where: { org_id: orgId, number: dest } });
    if (!q) return `No queue with extension ${dest} in this organization`;
    return null;
  }
  if (type === 'extension') {
    const u = await models.User.findOne({ where: { org_id: orgId, extension: dest } });
    if (u) return null;
    const iv = await models.Ivr.findOne({ where: { org_id: orgId, extension: dest } });
    if (iv) return null;
    return `No user or IVR with extension ${dest} in this organization`;
  }
  // type === 'phone'
  const digits = dest.replace(/[^0-9]/g, '');
  if (digits.length < 7 || digits.length > 15) {
    return `Phone number ${dest} does not look like a valid number (need 7-15 digits)`;
  }
  return null;
}

module.exports = {
  validateTimeoutDestination,
};
