const axios = require('axios');
const crypto = require('crypto');
const { Webhook } = require('../models');

class WebhookService {
  constructor() {
    this.queue = new Map(); // orgId -> Array of pending webhooks
    this.processing = new Set(); // Set of currently processing webhook IDs
    this.retryDelays = [1000, 5000, 15000, 60000, 300000]; // Progressive retry delays
  }

  async deliverWebhook(orgId, eventType, payload) {
    try {
      console.log(`📤 Delivering webhook: ${eventType} for org ${orgId}`);

      // Find all active webhooks for this organization and event
      const webhooks = await Webhook.findAll({
        where: {
          org_id: orgId,
          active: true
        }
      });

      const matchingWebhooks = webhooks.filter(webhook =>
        webhook.matchesEvent(eventType)
      );

      if (matchingWebhooks.length === 0) {
        console.log(`📭 No webhooks configured for event ${eventType} in org ${orgId}`);
        return;
      }

      // Create delivery tasks for each webhook
      const deliveryPromises = matchingWebhooks.map(webhook =>
        this.scheduleWebhookDelivery(webhook, eventType, payload)
      );

      await Promise.allSettled(deliveryPromises);

    } catch (error) {
      console.error('❌ Error in webhook delivery:', error);
    }
  }

  async scheduleWebhookDelivery(webhook, eventType, payload, attempt = 1) {
    const webhookId = `${webhook.id}_${Date.now()}_${attempt}`;

    try {
      // Check if webhook should be retried
      if (attempt > 1 && !webhook.shouldRetry()) {
        console.log(`🚫 Webhook ${webhook.id} max retries exceeded`);
        await webhook.recordFailure(null);
        return false;
      }

      // Prepare webhook payload
      const webhookPayload = {
        id: webhookId,
        event: eventType,
        timestamp: new Date().toISOString(),
        organization_id: webhook.org_id,
        data: payload,
        attempt: attempt
      };

      // Generate HMAC signature if secret is configured
      let signature = null;
      if (webhook.secret) {
        signature = this.generateSignature(webhookPayload, webhook.secret);
      }

      // Prepare headers
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'PBX-API-Webhook/1.0',
        'X-PBX-Event': eventType,
        'X-PBX-Organization': webhook.org_id,
        'X-PBX-Timestamp': webhookPayload.timestamp,
        'X-PBX-Attempt': attempt.toString(),
        ...webhook.headers
      };

      if (signature) {
        headers['X-PBX-Signature'] = signature;
      }

      console.log(`📡 Delivering webhook ${webhookId} to ${webhook.url} (attempt ${attempt})`);

      // Make the HTTP request
      const response = await axios.post(webhook.url, webhookPayload, {
        headers,
        timeout: webhook.timeout,
        validateStatus: (status) => status < 400 // Accept 2xx and 3xx as success
      });

      console.log(`✅ Webhook ${webhookId} delivered successfully (${response.status})`);

      // Record success
      await webhook.recordSuccess();
      return true;

    } catch (error) {
      console.error(`❌ Webhook ${webhookId} failed:`, error.message);

      const statusCode = error.response?.status || null;
      await webhook.recordFailure(statusCode);

      // Schedule retry if appropriate
      if (webhook.shouldRetry() && attempt <= webhook.retry_count) {
        const delay = this.retryDelays[Math.min(attempt - 1, this.retryDelays.length - 1)];
        console.log(`⏰ Scheduling retry ${attempt + 1} for webhook ${webhook.id} in ${delay}ms`);

        setTimeout(() => {
          this.scheduleWebhookDelivery(webhook, eventType, payload, attempt + 1);
        }, delay);
      } else {
        console.log(`🚫 Webhook ${webhook.id} failed permanently after ${attempt} attempts`);
      }

      return false;
    }
  }

  generateSignature(payload, secret) {
    const payloadString = JSON.stringify(payload);
    return 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(payloadString)
      .digest('hex');
  }

  verifySignature(payload, signature, secret) {
    const expectedSignature = this.generateSignature(payload, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  // Event-specific webhook methods
  async onCallInitiated(callData) {
    const payload = {
      call_id: callData.callRecord.call_id,
      channel_id: callData.channel.id,
      channel_name: callData.channel.name,
      from_number: callData.callRecord.from_number,
      to_number: callData.callRecord.to_number,
      caller_id_name: callData.callRecord.caller_id_name,
      direction: callData.callRecord.direction,
      started_at: callData.callRecord.started_at
    };

    await this.deliverWebhook(callData.orgId, 'call.initiated', payload);
  }

  async onCallRinging(callData) {
    const payload = {
      call_id: callData.callRecord.call_id,
      channel_id: callData.channel.id,
      status: 'ringing',
      from_number: callData.callRecord.from_number,
      to_number: callData.callRecord.to_number
    };

    await this.deliverWebhook(callData.orgId, 'call.ringing', payload);
  }

  async onCallAnswered(callData) {
    const payload = {
      call_id: callData.callRecord.call_id,
      channel_id: callData.channel.id,
      status: 'answered',
      from_number: callData.callRecord.from_number,
      to_number: callData.callRecord.to_number,
      answered_at: callData.callRecord.answered_at
    };

    await this.deliverWebhook(callData.orgId, 'call.answered', payload);
  }

  async onCallEnded(callData) {
    const payload = {
      call_id: callData.callRecord.call_id,
      channel_id: callData.channel.id,
      status: callData.callRecord.status,
      from_number: callData.callRecord.from_number,
      to_number: callData.callRecord.to_number,
      started_at: callData.callRecord.started_at,
      answered_at: callData.callRecord.answered_at,
      ended_at: callData.callRecord.ended_at,
      duration: callData.callRecord.duration,
      talk_time: callData.callRecord.talk_time,
      hangup_cause: callData.callRecord.hangup_cause
    };

    await this.deliverWebhook(callData.orgId, 'call.ended', payload);
  }

  async onCallFailed(callData) {
    const payload = {
      call_id: callData.callRecord.call_id,
      channel_id: callData.channel.id,
      status: 'failed',
      from_number: callData.callRecord.from_number,
      to_number: callData.callRecord.to_number,
      failure_reason: callData.reason || 'Unknown',
      hangup_cause: callData.callRecord.hangup_cause
    };

    await this.deliverWebhook(callData.orgId, 'call.failed', payload);
  }

  async onQueueEntered(queueData) {
    const payload = {
      call_id: queueData.callRecord.call_id,
      queue_id: queueData.queue.id,
      queue_name: queueData.queue.name,
      queue_number: queueData.queue.number,
      position: queueData.position || 1,
      wait_time: queueData.waitTime || 0,
      from_number: queueData.callRecord.from_number
    };

    await this.deliverWebhook(queueData.orgId, 'queue.entered', payload);
  }

  async onQueueAbandoned(queueData) {
    const payload = {
      call_id: queueData.callRecord.call_id,
      queue_id: queueData.queue.id,
      queue_name: queueData.queue.name,
      queue_number: queueData.queue.number,
      wait_time: queueData.waitTime,
      position: queueData.position,
      from_number: queueData.callRecord.from_number,
      reason: 'abandoned'
    };

    await this.deliverWebhook(queueData.orgId, 'queue.abandoned', payload);
  }

  async onQueueAnswered(queueData) {
    const payload = {
      call_id: queueData.callRecord.call_id,
      queue_id: queueData.queue.id,
      queue_name: queueData.queue.name,
      agent_id: queueData.agent?.id,
      agent_extension: queueData.agent?.extension,
      agent_name: queueData.agent?.full_name,
      wait_time: queueData.waitTime,
      from_number: queueData.callRecord.from_number
    };

    await this.deliverWebhook(queueData.orgId, 'queue.answered', payload);
  }

  async onUserRegistered(userData) {
    const payload = {
      user_id: userData.user.id,
      extension: userData.user.extension,
      username: userData.user.username,
      endpoint: userData.user.asterisk_endpoint,
      status: 'registered',
      registered_at: new Date().toISOString()
    };

    await this.deliverWebhook(userData.orgId, 'user.registered', payload);
  }

  async onUserUnregistered(userData) {
    const payload = {
      user_id: userData.user.id,
      extension: userData.user.extension,
      username: userData.user.username,
      endpoint: userData.user.asterisk_endpoint,
      status: 'unregistered',
      unregistered_at: new Date().toISOString(),
      reason: userData.reason || 'Unknown'
    };

    await this.deliverWebhook(userData.orgId, 'user.unregistered', payload);
  }

  async onTrunkRegistered(trunkData) {
    const payload = {
      trunk_id: trunkData.trunk.id,
      trunk_name: trunkData.trunk.name,
      host: trunkData.trunk.host,
      status: 'registered',
      registered_at: new Date().toISOString()
    };

    await this.deliverWebhook(trunkData.orgId, 'trunk.registered', payload);
  }

  async onTrunkFailed(trunkData) {
    const payload = {
      trunk_id: trunkData.trunk.id,
      trunk_name: trunkData.trunk.name,
      host: trunkData.trunk.host,
      status: 'failed',
      failed_at: new Date().toISOString(),
      reason: trunkData.reason || 'Registration failed'
    };

    await this.deliverWebhook(trunkData.orgId, 'trunk.failed', payload);
  }

  // Utility methods
  async getWebhookStats(orgId) {
    const webhooks = await Webhook.findAll({
      where: { org_id: orgId }
    });

    return webhooks.map(webhook => ({
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      active: webhook.active,
      last_delivery: webhook.last_delivery,
      last_status: webhook.last_status,
      failure_count: webhook.failure_count,
      success_rate: this.calculateSuccessRate(webhook)
    }));
  }

  calculateSuccessRate(webhook) {
    // This would be enhanced with proper delivery tracking
    // For now, return a simple calculation
    if (!webhook.last_delivery) return 0;

    const totalAttempts = webhook.failure_count + 1; // Assuming at least one attempt
    const successfulAttempts = webhook.last_status === 200 ? 1 : 0;

    return Math.round((successfulAttempts / totalAttempts) * 100);
  }

  async testWebhook(webhookId) {
    try {
      const webhook = await Webhook.findByPk(webhookId);
      if (!webhook) {
        throw new Error('Webhook not found');
      }

      const testPayload = {
        event: 'test',
        timestamp: new Date().toISOString(),
        organization_id: webhook.org_id,
        data: {
          message: 'This is a test webhook delivery',
          webhook_id: webhook.id
        }
      };

      return await this.scheduleWebhookDelivery(webhook, 'test', testPayload.data);

    } catch (error) {
      console.error('❌ Error testing webhook:', error);
      throw error;
    }
  }

  // Bulk webhook operations
  async pauseWebhooksForOrg(orgId) {
    await Webhook.update(
      { active: false },
      { where: { org_id: orgId, active: true } }
    );
    console.log(`⏸️ Paused all webhooks for organization ${orgId}`);
  }

  async resumeWebhooksForOrg(orgId) {
    await Webhook.update(
      { active: true },
      { where: { org_id: orgId, active: false } }
    );
    console.log(`▶️ Resumed all webhooks for organization ${orgId}`);
  }

  async getDeliveryHistory(webhookId, limit = 100) {
    // This would require a separate delivery log table in a real implementation
    // For now, return basic info from the webhook record
    const webhook = await Webhook.findByPk(webhookId);
    if (!webhook) return null;

    return {
      webhook_id: webhook.id,
      url: webhook.url,
      last_delivery: webhook.last_delivery,
      last_status: webhook.last_status,
      failure_count: webhook.failure_count,
      total_deliveries: 'N/A' // Would need delivery log table
    };
  }
}

module.exports = WebhookService;