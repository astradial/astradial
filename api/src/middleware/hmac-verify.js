'use strict';

const crypto = require('crypto');

function makeHmacVerify(secretEnvVar) {
  return (req, res, next) => {
    const secret = process.env[secretEnvVar];

    if (!secret) {
      console.warn(`[hmac-verify] ${secretEnvVar} is not set — skipping signature check (dev mode)`);
      return next();
    }

    const header = req.headers['x-webhook-signature'];
    if (!header) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const sig = header.startsWith('sha256=') ? header.slice(7) : header;

    const rawBody = req.rawBody
      ? req.rawBody
      : Buffer.from(JSON.stringify(req.body));

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    let sigBuf, expectedBuf;
    try {
      sigBuf = Buffer.from(sig, 'hex');
      expectedBuf = Buffer.from(expected, 'hex');
    } catch (_) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    next();
  };
}

module.exports = { makeHmacVerify };
