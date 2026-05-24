'use strict';

const IORedis = require('ioredis');

let _redis = null;

function getRedis() {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('[campaign-rate-limiter] REDIS_URL is not set');
  _redis = new IORedis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
  return _redis;
}

// Returns true if the send is allowed (token consumed), false if rate limited.
// Key: `astradial:campaigns:rate:{orgId}:{channel}`
// Window: 60s, sliding counter via INCR + EXPIRE.
// If maxPerMinute is null/undefined/0, allow unconditionally.
async function tryConsume(orgId, channel, maxPerMinute) {
  if (!maxPerMinute) return true;

  const key = `astradial:campaigns:rate:${orgId}:${channel}`;
  const redis = getRedis();

  // SET NX with expiry — creates the key the first time with TTL 60s.
  // Then INCR atomically. If the returned value exceeds the limit the
  // counter is already incremented; we don't decrement because the 60s
  // window will expire it naturally and an under-count is safe.
  const multi = redis.multi();
  multi.set(key, 0, 'EX', 60, 'NX');
  multi.incr(key);
  const results = await multi.exec();

  // results[1][1] is the value returned by INCR
  const count = results && results[1] && results[1][1];
  return Number(count) <= maxPerMinute;
}

module.exports = { tryConsume };
