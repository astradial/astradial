'use strict';

const KEY_PREFIX = 'astradial:campaigns:concurrency';
const SLOT_TTL_SECONDS = 1800;

let _client = null;

function getClient() {
  if (_client) return _client;

  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[campaign-concurrency] REDIS_URL not set — concurrency tracking disabled (permissive mode)');
    return null;
  }

  const Redis = require('ioredis');
  _client = new Redis(url, {
    // Don't crash the API if Redis is temporarily unreachable — the
    // scheduler falls back to the DB-level locked_at/locked_by mechanism.
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  _client.on('error', (err) => {
    console.error('[campaign-concurrency] Redis error:', err.message);
  });

  return _client;
}

function campaignKey(orgId, campaignId) {
  return `${KEY_PREFIX}:${orgId}:${campaignId}:calls`;
}

function orgKey(orgId) {
  return `${KEY_PREFIX}:${orgId}:total_calls`;
}

// Atomically increment the live-call counter for a campaign.
// Returns true if slot acquired (count after increment <= maxConcurrent).
// The TTL guards against orphaned keys when a webhook never fires.
async function tryAcquireCallSlot(orgId, campaignId, maxConcurrent) {
  const client = getClient();
  if (!client) return true;

  try {
    const ck = campaignKey(orgId, campaignId);

    // INCR + EXPIRE, then check cap. If exceeded, DECR to roll back
    // and return false — no call slot is granted.
    const newCount = await client.incr(ck);
    await client.expire(ck, SLOT_TTL_SECONDS);

    if (newCount > maxConcurrent) {
      await client.decr(ck);
      return false;
    }

    // Mirror into the org-total key so getOrgLiveCount() is O(1).
    await client.incr(orgKey(orgId));
    await client.expire(orgKey(orgId), SLOT_TTL_SECONDS);
    return true;
  } catch (e) {
    console.error('[campaign-concurrency] tryAcquireCallSlot error:', e.message);
    // Fail open — a Redis blip should not block all outbound calls.
    return true;
  }
}

// Decrement live-call counter. Never goes below 0.
async function releaseCallSlot(orgId, campaignId) {
  const client = getClient();
  if (!client) return;

  try {
    const ck = campaignKey(orgId, campaignId);
    const ok = orgKey(orgId);

    // Only decrement if the counter is currently > 0. A Lua script
    // makes the check-then-decrement atomic so a double-release can't
    // push the counter negative.
    const lua = `
      local v = redis.call('GET', KEYS[1])
      if v and tonumber(v) > 0 then
        redis.call('DECR', KEYS[1])
      end
    `;
    await client.eval(lua, 1, ck);

    const luaOrg = `
      local v = redis.call('GET', KEYS[1])
      if v and tonumber(v) > 0 then
        redis.call('DECR', KEYS[1])
      end
    `;
    await client.eval(luaOrg, 1, ok);
  } catch (e) {
    console.error('[campaign-concurrency] releaseCallSlot error:', e.message);
  }
}

// Current live count for one campaign.
async function getLiveCount(orgId, campaignId) {
  const client = getClient();
  if (!client) return 0;

  try {
    const val = await client.get(campaignKey(orgId, campaignId));
    return Math.max(0, parseInt(val, 10) || 0);
  } catch (e) {
    console.error('[campaign-concurrency] getLiveCount error:', e.message);
    return 0;
  }
}

// Sum of live counts across all campaigns for an org.
// Used to enforce org-level cap from org_settings.
async function getOrgLiveCount(orgId) {
  const client = getClient();
  if (!client) return 0;

  try {
    const val = await client.get(orgKey(orgId));
    return Math.max(0, parseInt(val, 10) || 0);
  } catch (e) {
    console.error('[campaign-concurrency] getOrgLiveCount error:', e.message);
    return 0;
  }
}

module.exports = {
  tryAcquireCallSlot,
  releaseCallSlot,
  getLiveCount,
  getOrgLiveCount,
};
