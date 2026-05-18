'use strict';

/**
 * Test setup: stub `../../models` so units that require it at the
 * module top (queueService, dialplanGenerator) can load without
 * spinning up a real sequelize connection.
 *
 * Tests that need real models must use a fixture DB harness instead
 * (not provided here — these are pure unit tests against pure functions).
 *
 * Usage: require this file FIRST in any test file that imports modules
 * with a top-level `require('../../models')`.
 */

const path = require('path');
const Module = require('module');

const STUB = {
  Queue: { findAll: async () => [], findOne: async () => null },
  QueueMember: { findAll: async () => [], findOne: async () => null, create: async () => ({}) },
  User: { findAll: async () => [], findOne: async () => null },
  Organization: { findAll: async () => [], findOne: async () => null },
  Ticket: {
    normalisePhone: (raw) => {
      const d = String(raw || '').replace(/\D/g, '');
      if (d.length >= 10) return d.slice(-10);
      return d || null;
    },
    findOne: async () => null,
    create: async (x) => x,
    upsertFromCdr: async () => ({ ticket: { id: 'stub-ticket' }, created: true }),
  },
  TicketCallEvent: {
    recordSafe: async (attrs) => ({ event: { id: 'stub-event', ...attrs }, created: true }),
    findAll: async () => [],
    findOne: async () => null,
  },
  CallRecord: { findOne: async () => null },
  DidNumber: { findAll: async () => [] },
  sequelize: {
    query: async () => [[], { affectedRows: 0 }],
    transaction: async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' }, transaction: null }),
    QueryTypes: { SELECT: 'SELECT' },
  },
};

// Patch the modules cache so any future `require('../../models')` returns STUB.
const modelsPath = path.resolve(__dirname, '../../src/models/index.js');
require.cache[modelsPath] = {
  id: modelsPath,
  filename: modelsPath,
  loaded: true,
  exports: STUB,
};

module.exports = STUB;
