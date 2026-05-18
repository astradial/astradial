'use strict';

/**
 * Effective-disposition override for inbound CDR rows.
 *
 * Asterisk records `disposition=ANSWERED` for any call where `Answer()`
 * ran — including IVR greeting playback or queue music-on-hold with no
 * member ever bridging. The downstream auto-ticket pipeline (and our
 * local classifier) skips ANSWERED rows, so without this override those
 * "answered for greeting only" calls would never produce missed-call
 * tickets and the customer's miss disappears.
 *
 * This module decides whether to flip ANSWERED → NO ANSWER for the
 * classifier. The shape is intentionally parallel to the realPjsipBridge
 * / realQueueBridge predicates in `ticketClassifier.js` so the two
 * stages agree on what "a real member bridged" means. A divergence
 * between them is exactly what caused the 2026-05-16 V7 (org 00000001)
 * incident where 7+ false `queue_timeout` tickets fired in a morning on
 * calls that had been answered for 1-3 minutes each.
 *
 * Returns the effective disposition string to pass to the classifier.
 * Pure function — no I/O, safe to import anywhere.
 */
function effectiveDisposition(r) {
  const raw = String(r && r.disposition || '');
  if (raw !== 'ANSWERED') return raw;
  const dch = String(r.dstchannel || '').trim();
  const lastapp = String(r.lastapp || '').toLowerCase();
  const billsec = Number(r.billsec || 0);
  // Two valid bridge shapes — mirrors the classifier's realPjsipBridge /
  // realQueueBridge regexes (api/src/services/ticketClassifier.js:113-114).
  // Keep these in lockstep with the classifier; the override must not
  // pre-flip a row the classifier would have recognised as bridged.
  const realPjsipBridge = /^PJSIP\/[a-zA-Z0-9_-]+-/.test(dch) && billsec > 0;
  const realQueueBridge = /^Local\/qm[a-f0-9]{32}@/.test(dch) && billsec > 0;
  const bridged = realPjsipBridge || realQueueBridge;
  const stillInGreeting = ['waitexten', 'background', 'playback', 'queue'].includes(lastapp);
  // Only flip when BOTH conditions hold: no real bridge AND the channel
  // was still in IVR/queue-music when it ended. A bridged call (either
  // direct PJSIP or qm-helper with billsec>0) is a real conversation
  // and must stay ANSWERED so the classifier's auto-close fires.
  if (!bridged && stillInGreeting) return 'NO ANSWER';
  return raw;
}

module.exports = { effectiveDisposition };
