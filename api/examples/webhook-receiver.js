#!/usr/bin/env node

/**
 * Sample Webhook Receiver
 *
 * This script demonstrates how to receive and validate webhooks from the PBX API.
 * It creates a simple HTTP server that listens for webhook events.
 *
 * Usage:
 *   node webhook-receiver.js [port] [secret]
 *
 * Example:
 *   node webhook-receiver.js 3001 my_webhook_secret
 */

const http = require('http');
const crypto = require('crypto');

// Configuration
const PORT = process.argv[2] || 3001;
const WEBHOOK_SECRET = process.argv[3] || 'your_webhook_secret';

// Statistics tracking
const stats = {
  totalReceived: 0,
  byEvent: {},
  lastReceived: null,
  validSignatures: 0,
  invalidSignatures: 0
};

/**
 * Verify HMAC signature from webhook
 */
function verifySignature(payload, signature, secret) {
  if (!signature) {
    console.log('⚠️  No signature provided');
    return false;
  }

  const payloadString = JSON.stringify(payload);
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error('❌ Signature verification error:', error.message);
    return false;
  }
}

/**
 * Format timestamp for display
 */
function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString();
}

/**
 * Handle incoming webhook
 */
function handleWebhook(webhook, headers) {
  const { event, data, timestamp, organization_id, attempt } = webhook;

  // Update statistics
  stats.totalReceived++;
  stats.byEvent[event] = (stats.byEvent[event] || 0) + 1;
  stats.lastReceived = new Date();

  // Verify signature
  const signature = headers['x-pbx-signature'];
  const isValid = verifySignature(webhook, signature, WEBHOOK_SECRET);

  if (isValid) {
    stats.validSignatures++;
  } else {
    stats.invalidSignatures++;
  }

  // Display webhook information
  console.log('\n' + '='.repeat(80));
  console.log(`📩 Webhook Received: ${event}`);
  console.log('='.repeat(80));
  console.log(`Timestamp:     ${formatTime(timestamp)}`);
  console.log(`Organization:  ${organization_id}`);
  console.log(`Attempt:       ${attempt}`);
  console.log(`Signature:     ${isValid ? '✅ Valid' : '❌ Invalid'}`);
  console.log('-'.repeat(80));

  // Display headers
  console.log('Headers:');
  console.log(`  X-PBX-Event:        ${headers['x-pbx-event']}`);
  console.log(`  X-PBX-Organization: ${headers['x-pbx-organization']}`);
  console.log(`  X-PBX-Timestamp:    ${headers['x-pbx-timestamp']}`);
  console.log(`  X-PBX-Attempt:      ${headers['x-pbx-attempt']}`);
  console.log('-'.repeat(80));

  // Display event-specific data
  console.log('Event Data:');
  console.log(JSON.stringify(data, null, 2));
  console.log('='.repeat(80) + '\n');

  // Handle specific event types
  handleEventType(event, data);
}

/**
 * Handle specific event types with custom logic
 */
function handleEventType(event, data) {
  switch (event) {
    case 'call.initiated':
      console.log(`📞 New call from ${data.from_number} to ${data.to_number}`);
      console.log(`   Direction: ${data.direction}, Channel: ${data.channel_id}`);
      break;

    case 'call.answered':
      console.log(`✅ Call answered: ${data.call_id}`);
      console.log(`   From: ${data.from_number} → To: ${data.to_number}`);
      break;

    case 'call.ended':
      console.log(`📴 Call ended: ${data.call_id}`);
      console.log(`   Duration: ${data.duration}s, Status: ${data.status}`);
      if (data.hangup_cause) {
        console.log(`   Hangup cause: ${data.hangup_cause}`);
      }
      break;

    case 'queue.entered':
      console.log(`🎫 Caller joined queue: ${data.queue_name} (${data.queue_number})`);
      console.log(`   Position: ${data.position}, Wait time: ${data.wait_time}s`);
      break;

    case 'queue.abandoned':
      console.log(`🚪 Caller abandoned queue: ${data.queue_name}`);
      console.log(`   Wait time: ${data.wait_time}s, Position was: ${data.position}`);
      break;

    case 'queue.answered':
      console.log(`👤 Agent answered queue call: ${data.queue_name}`);
      console.log(`   Agent: ${data.agent_name} (${data.agent_extension})`);
      console.log(`   Wait time: ${data.wait_time}s`);
      break;

    case 'user.registered':
      console.log(`🟢 User registered: ${data.username} (${data.extension})`);
      console.log(`   Endpoint: ${data.endpoint}`);
      break;

    case 'user.unregistered':
      console.log(`🔴 User unregistered: ${data.username} (${data.extension})`);
      console.log(`   Reason: ${data.reason}`);
      break;

    case 'trunk.registered':
      console.log(`🔗 Trunk registered: ${data.trunk_name}`);
      console.log(`   Host: ${data.host}`);
      break;

    case 'trunk.failed':
      console.log(`⚠️  Trunk failed: ${data.trunk_name}`);
      console.log(`   Reason: ${data.reason}`);
      break;

    case 'test':
      console.log(`🧪 Test webhook received`);
      console.log(`   Message: ${data.message}`);
      break;

    default:
      console.log(`ℹ️  Unknown event type: ${event}`);
  }
  console.log('');
}

/**
 * Display statistics
 */
function displayStats() {
  console.log('\n' + '━'.repeat(80));
  console.log('📊 Webhook Statistics');
  console.log('━'.repeat(80));
  console.log(`Total webhooks received: ${stats.totalReceived}`);
  console.log(`Valid signatures:        ${stats.validSignatures}`);
  console.log(`Invalid signatures:      ${stats.invalidSignatures}`);
  console.log(`Last received:           ${stats.lastReceived ? formatTime(stats.lastReceived) : 'Never'}`);
  console.log('-'.repeat(80));
  console.log('Events by type:');

  if (Object.keys(stats.byEvent).length === 0) {
    console.log('  (none)');
  } else {
    for (const [event, count] of Object.entries(stats.byEvent)) {
      console.log(`  ${event.padEnd(25)} ${count}`);
    }
  }
  console.log('━'.repeat(80) + '\n');
}

/**
 * Create HTTP server to receive webhooks
 */
const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const webhook = JSON.parse(body);

        // Handle the webhook
        handleWebhook(webhook, req.headers);

        // Send success response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Webhook received successfully',
          event: webhook.event,
          timestamp: new Date().toISOString()
        }));

      } catch (error) {
        console.error('❌ Error processing webhook:', error.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'Invalid webhook payload',
          message: error.message
        }));
      }
    });

  } else if (req.method === 'GET' && req.url === '/stats') {
    // Stats endpoint
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats, null, 2));

  } else if (req.method === 'GET' && req.url === '/health') {
    // Health check endpoint
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      uptime: process.uptime(),
      totalReceived: stats.totalReceived
    }));

  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not found',
      endpoints: {
        'POST /': 'Receive webhooks',
        'GET /stats': 'View statistics',
        'GET /health': 'Health check'
      }
    }));
  }
});

// Start server
server.listen(PORT, () => {
  console.log('\n' + '━'.repeat(80));
  console.log('🎣 Webhook Receiver Started');
  console.log('━'.repeat(80));
  console.log(`Port:           ${PORT}`);
  console.log(`Webhook URL:    http://localhost:${PORT}/`);
  console.log(`Stats URL:      http://localhost:${PORT}/stats`);
  console.log(`Health URL:     http://localhost:${PORT}/health`);
  console.log(`Secret:         ${WEBHOOK_SECRET ? '***' + WEBHOOK_SECRET.slice(-4) : '(none)'}`);
  console.log('━'.repeat(80));
  console.log('\nWaiting for webhooks...\n');
  console.log('Press Ctrl+C to stop\n');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...\n');
  displayStats();
  server.close(() => {
    console.log('✅ Server closed\n');
    process.exit(0);
  });
});

// Display stats periodically (every 5 minutes)
setInterval(() => {
  if (stats.totalReceived > 0) {
    displayStats();
  }
}, 300000);
