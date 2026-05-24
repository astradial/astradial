'use strict';

const pino = require('pino');

const DEBUG_ENABLED = process.env.DEBUG_CAMPAIGN_WORKERS === '1';

const pinoLogger = pino({
  level: DEBUG_ENABLED ? 'debug' : 'info',
  transport: process.env.NODE_ENV === 'production'
    ? undefined
    : {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
});

function createLogger(ctx = {}) {
  const child = pinoLogger.child(ctx);

  return {
    info(msg, extra = {}) {
      child.info(extra, msg);
    },
    warn(msg, extra = {}) {
      child.warn(extra, msg);
    },
    error(msg, extra = {}) {
      child.error(extra, msg);
    },
    debug(msg, extra = {}) {
      child.debug(extra, msg);
    },
  };
}

module.exports = { createLogger };
