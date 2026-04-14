# Webhook Testing Guide

This guide explains how to test the webhook system where the PBX API sends events to your webhook receiver.

## Setup

### 1. Start the Webhook Receiver

```bash
cd /home/syed/PBX-API-Development/examples
node webhook-receiver.js 3001 my_webhook_secret
```

**Parameters:**
- Port: `3001` (or any available port)
- Secret: `my_webhook_secret` (must match the secret when creating the webhook)

The receiver will display:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎣 Webhook Receiver Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Port:           3001
Webhook URL:    http://localhost:3001/
Stats URL:      http://localhost:3001/stats
Health URL:     http://localhost:3001/health
Secret:         ***ret
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Waiting for webhooks...
```

### 2. Configure Webhook in PBX API

Create a webhook configuration that points to your receiver:

```bash
# Get your organization token first
TOKEN="your_org_token_here"

# Create webhook
curl -X POST http://localhost:3000/api/v1/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:3001/",
    "events": [
      "call.initiated",
      "call.answered",
      "call.ended",
      "queue.entered",
      "queue.abandoned",
      "queue.answered",
      "user.registered",
      "user.unregistered"
    ],
    "secret": "my_webhook_secret",
    "active": true,
    "retry_count": 3,
    "timeout": 5000
  }'
```

**Response:**
```json
{
  "id": "webhook-uuid-here",
  "org_id": "your-org-id",
  "url": "http://localhost:3001/",
  "events": ["call.initiated", "call.answered", "call.ended", ...],
  "active": true,
  "secret": "my_webhook_secret",
  "retry_count": 3,
  "timeout": 5000,
  "created_at": "2025-10-09T16:00:00.000Z"
}
```

### 3. Start the PBX API Server

Make sure the PBX API server is running with ARI/AMI enabled:

```bash
cd /home/syed/PBX-API-Development
npm start
```

## Testing Webhook Events

### Option A: Test Webhook Endpoint

Test that the webhook is configured correctly:

```bash
curl -X POST http://localhost:3000/api/v1/webhooks/{WEBHOOK_ID}/test \
  -H "Authorization: Bearer $TOKEN"
```

You should see in the webhook receiver:
```
================================================================================
📩 Webhook Received: test
================================================================================
Timestamp:     10/9/2025, 4:00:00 PM
Organization:  your-org-id
Attempt:       1
Signature:     ✅ Valid
--------------------------------------------------------------------------------
Event Data:
{
  "message": "This is a test webhook delivery",
  "webhook_id": "webhook-uuid-here"
}
================================================================================

🧪 Test webhook received
   Message: This is a test webhook delivery
```

### Option B: Trigger Real Call Events

#### 1. Make a Call (Click-to-Call)

```bash
curl -X POST http://localhost:3000/api/v1/calls/click-to-call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "2001",
    "to": "2002",
    "to_type": "extension"
  }'
```

**Expected Webhooks:**
1. **call.initiated** - When call starts
2. **call.answered** - When extension 2002 answers
3. **call.ended** - When call completes

#### 2. Transfer a Call

```bash
curl -X POST http://localhost:3000/api/v1/calls/{CHANNEL_ID}/transfer \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "2003",
    "type": "blind"
  }'
```

#### 3. Hangup a Call

```bash
curl -X POST http://localhost:3000/api/v1/calls/{CHANNEL_ID}/hangup \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "normal"
  }'
```

**Expected Webhook:**
- **call.ended** with hangup details

### Option C: Queue Events

#### 1. Add Member to Queue

```bash
curl -X POST http://localhost:3000/api/v1/queues/{QUEUE_ID}/members \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user-uuid",
    "penalty": 0
  }'
```

#### 2. Call a Queue

When someone calls a queue number, you'll receive:
- **queue.entered** - Caller joins queue
- **queue.answered** - Agent answers
- **queue.abandoned** - If caller hangs up before answer

## Webhook Event Examples

### call.initiated
```json
{
  "id": "webhook_123_1696867200000_1",
  "event": "call.initiated",
  "timestamp": "2025-10-09T16:00:00.000Z",
  "organization_id": "org-uuid",
  "data": {
    "call_id": "PJSIP/2001-00000001",
    "channel_id": "PJSIP/2001-00000001",
    "channel_name": "PJSIP/2001-00000001",
    "from_number": "+15551234567",
    "to_number": "2001",
    "caller_id_name": "John Doe",
    "direction": "inbound",
    "started_at": "2025-10-09T16:00:00.000Z"
  },
  "attempt": 1
}
```

### call.answered
```json
{
  "id": "webhook_123_1696867205000_1",
  "event": "call.answered",
  "timestamp": "2025-10-09T16:00:05.000Z",
  "organization_id": "org-uuid",
  "data": {
    "call_id": "PJSIP/2001-00000001",
    "channel_id": "PJSIP/2001-00000001",
    "status": "answered",
    "from_number": "+15551234567",
    "to_number": "2001",
    "answered_at": "2025-10-09T16:00:05.000Z"
  },
  "attempt": 1
}
```

### call.ended
```json
{
  "id": "webhook_123_1696867245000_1",
  "event": "call.ended",
  "timestamp": "2025-10-09T16:00:45.000Z",
  "organization_id": "org-uuid",
  "data": {
    "call_id": "PJSIP/2001-00000001",
    "channel_id": "PJSIP/2001-00000001",
    "status": "completed",
    "from_number": "+15551234567",
    "to_number": "2001",
    "started_at": "2025-10-09T16:00:00.000Z",
    "answered_at": "2025-10-09T16:00:05.000Z",
    "ended_at": "2025-10-09T16:00:45.000Z",
    "duration": 45,
    "talk_time": 40,
    "hangup_cause": "16"
  },
  "attempt": 1
}
```

### queue.entered
```json
{
  "id": "webhook_123_1696867200000_1",
  "event": "queue.entered",
  "timestamp": "2025-10-09T16:00:00.000Z",
  "organization_id": "org-uuid",
  "data": {
    "call_id": "call-uuid",
    "queue_id": "queue-uuid",
    "queue_name": "Support Queue",
    "queue_number": "5000",
    "position": 1,
    "wait_time": 0,
    "from_number": "+15551234567"
  },
  "attempt": 1
}
```

## Verifying Webhook Signatures

The webhook receiver automatically verifies HMAC signatures. Here's how it works:

1. **PBX API** generates signature:
   ```javascript
   const signature = 'sha256=' + crypto
     .createHmac('sha256', webhook.secret)
     .update(JSON.stringify(payload))
     .digest('hex');
   ```

2. **Receiver** verifies signature using the same secret
3. If signatures match: ✅ Valid
4. If signatures don't match: ❌ Invalid

**Important:** The secret must match between webhook configuration and receiver!

## Monitoring Webhooks

### View Statistics

```bash
curl http://localhost:3001/stats
```

**Response:**
```json
{
  "totalReceived": 15,
  "byEvent": {
    "call.initiated": 5,
    "call.answered": 4,
    "call.ended": 5,
    "test": 1
  },
  "lastReceived": "2025-10-09T16:30:00.000Z",
  "validSignatures": 14,
  "invalidSignatures": 1
}
```

### Health Check

```bash
curl http://localhost:3001/health
```

### View PBX API Webhook Status

```bash
curl -X GET http://localhost:3000/api/v1/webhooks \
  -H "Authorization: Bearer $TOKEN"
```

## Troubleshooting

### Webhook Not Receiving Events

1. **Check webhook is active:**
   ```bash
   curl http://localhost:3000/api/v1/webhooks/{WEBHOOK_ID} \
     -H "Authorization: Bearer $TOKEN"
   ```
   Ensure `"active": true`

2. **Check events are configured:**
   Ensure the `events` array includes the event type you're testing

3. **Check URL is accessible:**
   ```bash
   curl -X POST http://localhost:3001/ \
     -H "Content-Type: application/json" \
     -d '{"test": "data"}'
   ```

4. **Check PBX API logs:**
   Look for webhook delivery messages in the API server console

### Invalid Signatures

If you see `❌ Invalid` signatures:
- Ensure the secret matches between webhook config and receiver
- Check that the receiver is using the correct secret parameter

### Webhook Delivery Failures

Check webhook failure count:
```bash
curl http://localhost:3000/api/v1/webhooks/{WEBHOOK_ID} \
  -H "Authorization: Bearer $TOKEN" | jq '.failure_count'
```

If `failure_count` is high:
- Webhook may have been auto-disabled
- Check receiver is running and accessible
- Review receiver logs for errors

## Advanced: Using ngrok for External Testing

If you want to test with a public URL:

```bash
# Install ngrok
npm install -g ngrok

# Start ngrok tunnel
ngrok http 3001

# Use the ngrok URL in webhook config
curl -X POST http://localhost:3000/api/v1/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-ngrok-url.ngrok.io/",
    "events": ["call.initiated", "call.answered", "call.ended"],
    "secret": "my_webhook_secret",
    "active": true
  }'
```

Now you can receive webhooks from anywhere!
