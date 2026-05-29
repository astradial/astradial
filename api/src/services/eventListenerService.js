const AsteriskManager = require('./asterisk/asteriskManager');
const AsteriskARIClient = require('./asterisk/ariClient');
const WebhookService = require('./webhookService');
const { User, SipTrunk: SIPTrunk, Queue } = require('../models');

/**
 * Event Listener Service
 *
 * This service runs continuously in the background, listening to AMI and ARI events
 * from Asterisk and triggering webhooks for configured organizations.
 */
class EventListenerService {
  constructor() {
    this.amiManager = null;
    this.ariClient = null;
    this.webhookService = new WebhookService();
    this.isRunning = false;
    this.reconnectInterval = 5000;
  }

  /**
   * Start the event listener service
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️  Event listener service already running');
      return;
    }

    console.log('\n' + '━'.repeat(80));
    console.log('🎧 Starting Event Listener Service');
    console.log('━'.repeat(80));

    try {
      // Initialize and start ARI client (non-blocking)
      this.startARIClient().catch(error => {
        console.warn('⚠️  ARI client failed to start:', error.message);
      });

      // Initialize and start AMI manager with event listening (non-blocking)
      this.startAMIManager().catch(error => {
        console.warn('⚠️  AMI manager failed to start:', error.message);
      });

      this.isRunning = true;
      console.log('✅ Event Listener Service started (ARI/AMI connections may be pending)');
      console.log('━'.repeat(80) + '\n');

    } catch (error) {
      console.error('❌ Failed to start Event Listener Service:', error);
      this.scheduleRestart();
    }
  }

  /**
   * Start ARI client for call events
   */
  async startARIClient() {
    try {
      console.log('🔌 Connecting to Asterisk ARI...');

      this.ariClient = new AsteriskARIClient();

      // Set up event handlers for ARI events
      this.setupARIEventHandlers();

      // Connect to ARI
      await this.ariClient.connect();

      console.log('✅ ARI client connected and listening for call events');

    } catch (error) {
      console.error('❌ Failed to start ARI client:', error);
      throw error;
    }
  }

  /**
   * Start AMI manager for registration and queue events
   */
  async startAMIManager() {
    try {
      console.log('🔌 Connecting to Asterisk AMI...');

      this.amiManager = new AsteriskManager();

      // Set up event handlers for AMI events
      this.setupAMIEventHandlers();

      // Connect to AMI
      await this.amiManager.connect();

      // Enable event listening
      await this.amiManager.enableEvents();

      console.log('✅ AMI manager connected and listening for system events');

    } catch (error) {
      console.error('❌ Failed to start AMI manager:', error);
      throw error;
    }
  }

  /**
   * Set up ARI event handlers
   */
  setupARIEventHandlers() {
    // Call initiated
    this.ariClient.on('callInitiated', async (callData) => {
      try {
        await this.webhookService.onCallInitiated(callData);
      } catch (error) {
        console.error('Error handling callInitiated webhook:', error);
      }
    });

    // Call answered
    this.ariClient.on('callAnswered', async (callData) => {
      try {
        await this.webhookService.onCallAnswered(callData);
      } catch (error) {
        console.error('Error handling callAnswered webhook:', error);
      }
    });

    // Call ended
    this.ariClient.on('callEnded', async (callData) => {
      try {
        await this.webhookService.onCallEnded(callData);
      } catch (error) {
        console.error('Error handling callEnded webhook:', error);
      }
    });

    console.log('✅ ARI event handlers configured');
  }

  /**
   * Set up AMI event handlers
   */
  setupAMIEventHandlers() {
    // User registration events
    this.amiManager.on('userRegistered', async (data) => {
      try {
        const user = await this.getUserByExtension(data.extension);
        if (user) {
          await this.webhookService.onUserRegistered({
            user,
            orgId: user.org_id
          });
        }
      } catch (error) {
        console.error('Error handling userRegistered webhook:', error);
      }
    });

    this.amiManager.on('userUnregistered', async (data) => {
      try {
        const user = await this.getUserByExtension(data.extension);
        if (user) {
          await this.webhookService.onUserUnregistered({
            user,
            orgId: user.org_id,
            reason: data.reason
          });
        }
      } catch (error) {
        console.error('Error handling userUnregistered webhook:', error);
      }
    });

    // Trunk registration events
    this.amiManager.on('trunkRegistered', async (data) => {
      try {
        const trunk = await this.getTrunkByDomain(data.domain);
        if (trunk) {
          await this.webhookService.onTrunkRegistered({
            trunk,
            orgId: trunk.org_id
          });
        }
      } catch (error) {
        console.error('Error handling trunkRegistered webhook:', error);
      }
    });

    this.amiManager.on('trunkFailed', async (data) => {
      try {
        const trunk = await this.getTrunkByDomain(data.domain);
        if (trunk) {
          await this.webhookService.onTrunkFailed({
            trunk,
            orgId: trunk.org_id,
            reason: data.reason
          });
        }
      } catch (error) {
        console.error('Error handling trunkFailed webhook:', error);
      }
    });

    // Queue events
    this.amiManager.on('queueCallerJoin', async (data) => {
      try {
        const queue = await this.getQueueByName(data.queue);
        if (queue) {
          await this.webhookService.onQueueEntered({
            queue,
            orgId: queue.org_id,
            position: data.position,
            waitTime: 0,
            callRecord: { from_number: data.callerNumber }
          });
        }
      } catch (error) {
        console.error('Error handling queueCallerJoin webhook:', error);
      }
    });

    this.amiManager.on('queueCallerAbandon', async (data) => {
      try {
        const queue = await this.getQueueByName(data.queue);
        if (queue) {
          await this.webhookService.onQueueAbandoned({
            queue,
            orgId: queue.org_id,
            position: data.position,
            waitTime: data.holdTime,
            callRecord: { from_number: data.callerNumber }
          });
        }
      } catch (error) {
        console.error('Error handling queueCallerAbandon webhook:', error);
      }
    });

    this.amiManager.on('agentConnect', async (data) => {
      try {
        const queue = await this.getQueueByName(data.queue);
        if (queue) {
          // Parse member name to get extension
          const extension = data.member.split('/').pop();
          const agent = await this.getUserByExtension(extension);

          await this.webhookService.onQueueAnswered({
            queue,
            orgId: queue.org_id,
            agent,
            waitTime: data.holdTime,
            callRecord: { from_number: data.callerNumber }
          });
        }
      } catch (error) {
        console.error('Error handling agentConnect webhook:', error);
      }
    });

    console.log('✅ AMI event handlers configured');
  }

  /**
   * Helper: Get user by extension
   */
  async getUserByExtension(extension) {
    try {
      return await User.findOne({
        where: { extension }
      });
    } catch (error) {
      console.error('Error looking up user by extension:', error);
      return null;
    }
  }

  /**
   * Helper: Get trunk by domain
   */
  async getTrunkByDomain(domain) {
    try {
      return await SIPTrunk.findOne({
        where: { host: domain }
      });
    } catch (error) {
      console.error('Error looking up trunk by domain:', error);
      return null;
    }
  }

  /**
   * Helper: Get queue by Asterisk name
   */
  async getQueueByName(asteriskQueueName) {
    try {
      return await Queue.findOne({
        where: { asterisk_queue_name: asteriskQueueName }
      });
    } catch (error) {
      console.error('Error looking up queue by name:', error);
      return null;
    }
  }

  /**
   * Stop the event listener service
   */
  async stop() {
    if (!this.isRunning) {
      console.log('⚠️  Event listener service not running');
      return;
    }

    console.log('\n🛑 Stopping Event Listener Service...');

    try {
      // Disconnect ARI client
      if (this.ariClient) {
        this.ariClient.disconnect();
        console.log('✅ ARI client disconnected');
      }

      // Disconnect AMI manager
      if (this.amiManager) {
        await this.amiManager.disconnect();
        console.log('✅ AMI manager disconnected');
      }

      this.isRunning = false;
      console.log('✅ Event Listener Service stopped\n');

    } catch (error) {
      console.error('❌ Error stopping Event Listener Service:', error);
    }
  }

  /**
   * Restart the service
   */
  async restart() {
    console.log('\n🔄 Restarting Event Listener Service...');
    await this.stop();
    await this.start();
  }

  /**
   * Schedule automatic restart on failure
   */
  scheduleRestart() {
    console.log(`⏰ Scheduling restart in ${this.reconnectInterval}ms...`);

    setTimeout(() => {
      console.log('🔄 Attempting to restart Event Listener Service...');
      this.start();
    }, this.reconnectInterval);
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      ari: {
        connected: this.ariClient?.isConnected || false,
        activeCalls: this.ariClient?.getActiveCallsCount() || 0
      },
      ami: {
        connected: this.amiManager?.connected || false
      }
    };
  }
}

// Export singleton instance
module.exports = new EventListenerService();
