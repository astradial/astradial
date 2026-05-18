/**
 * SSE broadcast registry — shared between the HTTP route that
 * accepts client connections and the classifier that produces
 * ticket changes. Living in its own module keeps server.js and
 * ticketClassifier.js from forming a circular require.
 *
 * v1 protocol is intentionally minimal:
 *   - Server emits a `refresh` event (with optional org_id + ticket_id)
 *   - Client refetches the list when it receives one
 *
 * Per-row deltas can be layered on later without breaking clients;
 * they would just keep refetching on `refresh` until they opt into
 * row-level events.
 */
'use strict';

const clients = new Map();  // orgId → Set<res>

function register(orgId, res) {
  if (!clients.has(orgId)) clients.set(orgId, new Set());
  clients.get(orgId).add(res);
}

function unregister(orgId, res) {
  const set = clients.get(orgId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(orgId);
}

function broadcast(orgId, event) {
  const set = clients.get(orgId);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify(event);
  const type = (event && event.type) || 'refresh';
  for (const res of set) {
    try {
      res.write(`event: ${type}\n`);
      res.write(`data: ${payload}\n\n`);
    } catch (e) { /* writer half-closed — the 'close' handler will clean up */ }
  }
}

module.exports = { register, unregister, broadcast };
