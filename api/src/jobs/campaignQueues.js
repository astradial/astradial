/**
 * Centralized BullMQ Queue + Worker factory for the Campaigns feature.
 *
 * All campaign-related job code (CSV import worker, dispatch worker, etc.)
 * must go through this module so connection options and key-prefix
 * configuration live in exactly one place.
 *
 * Key-prefix isolation:
 *   The workflow-engine service uses the legacy `bull@4` package against
 *   the SAME Redis instance. To avoid colliding with its keys we namespace
 *   every campaign queue under `astradial:campaigns`.
 *
 * Disabling workers:
 *   Set `CAMPAIGN_WORKERS_ENABLED=0` in the process env to suppress all
 *   worker consumption. Queues remain functional (the API process still
 *   needs to enqueue), but `createWorker` returns an inert stub so the
 *   process won't pull jobs off Redis.
 */

'use strict';

const IORedis = require('ioredis');
const { Queue, Worker } = require('bullmq');

const QUEUE_PREFIX = 'astradial:campaigns';

const IMPORT_QUEUE = 'campaign-import';
const DISPATCH_QUEUE = 'campaign-dispatch'; // Phase B — kept for backward compat; superseded by Phase D channel queues
const SCHEDULER_QUEUE = 'campaign-scheduler';
const CALLS_QUEUE = 'campaign-calls';       // Phase D: one shared queue for all call actions
const WHATSAPP_QUEUE = 'campaign-whatsapp'; // Phase D: one shared queue for all WhatsApp actions

const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: { age: 7 * 86400 },
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
};

let _connection = null;
const _queues = new Map();
const _workers = new Set();

/**
 * Returns a memoized ioredis connection suitable for BullMQ.
 *
 * BullMQ's blocking commands (BRPOPLPUSH etc.) require
 * `maxRetriesPerRequest: null`; ioredis otherwise aborts the blocked
 * command after the default retry budget and BullMQ throws.
 */
function getConnection() {
  if (_connection) return _connection;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('[campaignQueues] REDIS_URL is not set — cannot initialize BullMQ connection');
  }
  _connection = new IORedis(url, { maxRetriesPerRequest: null });
  return _connection;
}

/**
 * Memoized BullMQ Queue factory. Calling `getQueue('campaign-import')`
 * twice returns the same Queue instance.
 */
function getQueue(name) {
  if (_queues.has(name)) return _queues.get(name);
  const queue = new Queue(name, {
    connection: getConnection(),
    prefix: QUEUE_PREFIX,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  queue.on('error', (err) => {
    console.error(`[campaignQueues] queue=${name} error:`, err.message);
  });
  _queues.set(name, queue);
  return queue;
}

/**
 * Register a Worker for orderly shutdown. Exported so external callers
 * can hand off a Worker they constructed manually; `createWorker` calls
 * this automatically.
 */
function registerWorker(worker) {
  if (!worker) return worker;
  _workers.add(worker);
  return worker;
}

/**
 * Worker stub returned when `CAMPAIGN_WORKERS_ENABLED=0`. Implements the
 * subset of the BullMQ Worker surface callers reasonably expect so
 * `shutdownAll` and basic event wiring don't blow up.
 */
function makeNoopWorker(name) {
  return {
    name,
    isStub: true,
    on() { return this; },
    off() { return this; },
    async close() { /* no-op */ },
    async waitUntilReady() { /* no-op */ },
  };
}

/**
 * Construct a BullMQ Worker bound to our connection + prefix, with
 * sensible default event handlers. Returns a no-op stub when workers
 * are disabled so callers don't need to branch on the env var.
 */
function createWorker(name, processor, opts = {}) {
  if (process.env.CAMPAIGN_WORKERS_ENABLED === '0') {
    console.log(`[campaignQueues] workers disabled (CAMPAIGN_WORKERS_ENABLED=0) — skipping worker for "${name}"`);
    const stub = makeNoopWorker(name);
    return stub;
  }

  const worker = new Worker(name, processor, {
    connection: getConnection(),
    prefix: QUEUE_PREFIX,
    concurrency: 1,
    ...opts,
  });

  worker.on('failed', (job, err) => {
    const jobId = job && job.id ? job.id : '<unknown>';
    console.error(`[campaignQueues] worker=${name} job=${jobId} failed:`, err && err.message);
  });

  worker.on('error', (err) => {
    console.error(`[campaignQueues] worker=${name} error:`, err && err.message);
  });

  worker.on('completed', (job) => {
    if (process.env.DEBUG_CAMPAIGN_WORKERS === '1') {
      const jobId = job && job.id ? job.id : '<unknown>';
      const ms = job && job.processedOn && job.finishedOn
        ? (job.finishedOn - job.processedOn)
        : null;
      console.log(`[campaignQueues] worker=${name} job=${jobId} completed${ms != null ? ` in ${ms}ms` : ''}`);
    }
  });

  registerWorker(worker);
  console.log(`✓ Campaign worker started: ${name}`);
  return worker;
}

/**
 * Close every memoized Queue and every registered Worker, then drop the
 * shared ioredis connection. Safe to call multiple times. Intended to
 * be wired into the server's SIGTERM/SIGINT handlers.
 */
async function shutdownAll() {
  const errors = [];

  for (const worker of _workers) {
    try {
      if (worker && typeof worker.close === 'function') {
        await worker.close();
      }
    } catch (e) {
      errors.push(`worker ${worker && worker.name}: ${e.message}`);
    }
  }
  _workers.clear();

  for (const [name, queue] of _queues.entries()) {
    try {
      await queue.close();
    } catch (e) {
      errors.push(`queue ${name}: ${e.message}`);
    }
  }
  _queues.clear();

  if (_connection) {
    try {
      _connection.disconnect();
    } catch (e) {
      errors.push(`connection: ${e.message}`);
    }
    _connection = null;
  }

  if (errors.length) {
    console.warn('[campaignQueues] shutdownAll completed with errors:', errors.join('; '));
  } else {
    console.log('✓ Campaign queues shut down cleanly');
  }
}

module.exports = {
  IMPORT_QUEUE,
  DISPATCH_QUEUE,
  SCHEDULER_QUEUE,
  CALLS_QUEUE,
  WHATSAPP_QUEUE,
  QUEUE_PREFIX,
  getConnection,
  getQueue,
  createWorker,
  registerWorker,
  shutdownAll,
};
