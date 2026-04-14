const EventEmitter = require('events');
const { CallRecord, Channel, Organization, User, Queue, QueueMember } = require('../../models');

class CallMonitoringService extends EventEmitter {
  constructor() {
    super();
    this.ariClient = null;
    this.activeChannels = new Map(); // channelId -> channel data
    this.activeCalls = new Map(); // callId -> call data
    this.queueStats = new Map(); // queueId -> queue statistics
    this.userStats = new Map(); // userId -> user statistics
    this.organizationStats = new Map(); // orgId -> organization statistics
    this.monitoringActive = false;
    this.statsInterval = null;
    this.updateInterval = 30000; // 30 seconds
  }

  setAriClient(ariClient) {
    this.ariClient = ariClient;
    this.setupEventListeners();
  }

  setupEventListeners() {
    if (!this.ariClient) return;

    console.log('🔍 Setting up call monitoring event listeners...');

    // Channel events
    this.ariClient.on('ChannelStateChange', (event) => {
      this.handleChannelStateChange(event);
    });

    this.ariClient.on('StasisStart', (event) => {
      this.handleStasisStart(event);
    });

    this.ariClient.on('StasisEnd', (event) => {
      this.handleStasisEnd(event);
    });

    this.ariClient.on('ChannelDestroyed', (event) => {
      this.handleChannelDestroyed(event);
    });

    this.ariClient.on('ChannelVarset', (event) => {
      this.handleChannelVarset(event);
    });

    // Bridge events for call transfers and conferences
    this.ariClient.on('BridgeCreated', (event) => {
      this.handleBridgeCreated(event);
    });

    this.ariClient.on('BridgeDestroyed', (event) => {
      this.handleBridgeDestroyed(event);
    });

    this.ariClient.on('ChannelEnteredBridge', (event) => {
      this.handleChannelEnteredBridge(event);
    });

    this.ariClient.on('ChannelLeftBridge', (event) => {
      this.handleChannelLeftBridge(event);
    });

    // Recording events
    this.ariClient.on('RecordingStarted', (event) => {
      this.handleRecordingStarted(event);
    });

    this.ariClient.on('RecordingFinished', (event) => {
      this.handleRecordingFinished(event);
    });

    // Application events
    this.ariClient.on('ApplicationReplaced', (event) => {
      console.log('📱 Application replaced:', event);
    });

    console.log('✅ Call monitoring event listeners configured');
  }

  async startMonitoring() {
    if (this.monitoringActive) {
      console.log('⚠️ Call monitoring already active');
      return;
    }

    console.log('🚀 Starting call monitoring service...');

    this.monitoringActive = true;

    // Start periodic statistics updates
    this.statsInterval = setInterval(() => {
      this.updateStatistics();
    }, this.updateInterval);

    // Load initial data
    await this.loadInitialChannels();
    await this.loadInitialCalls();

    console.log('✅ Call monitoring service started');
    this.emit('monitoring:started');
  }

  async stopMonitoring() {
    if (!this.monitoringActive) {
      console.log('⚠️ Call monitoring not active');
      return;
    }

    console.log('🛑 Stopping call monitoring service...');

    this.monitoringActive = false;

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    // Clear monitoring data
    this.activeChannels.clear();
    this.activeCalls.clear();
    this.queueStats.clear();
    this.userStats.clear();
    this.organizationStats.clear();

    console.log('✅ Call monitoring service stopped');
    this.emit('monitoring:stopped');
  }

  async loadInitialChannels() {
    try {
      if (!this.ariClient) return;

      const channels = await this.ariClient.channels.list();
      console.log(`📊 Loading ${channels.length} initial channels...`);

      for (const channel of channels) {
        await this.trackChannel(channel);
      }

    } catch (error) {
      console.error('❌ Error loading initial channels:', error);
    }
  }

  async loadInitialCalls() {
    try {
      // Load active calls from database
      const activeCalls = await CallRecord.findAll({
        where: {
          status: ['initiated', 'ringing', 'answered', 'bridged']
        },
        include: [
          { model: Channel, as: 'channels' }
        ]
      });

      console.log(`📊 Loading ${activeCalls.length} active calls...`);

      for (const call of activeCalls) {
        this.activeCalls.set(call.call_id, {
          callRecord: call,
          channels: call.channels || [],
          startTime: new Date(call.started_at),
          status: call.status,
          bridge: null
        });
      }

    } catch (error) {
      console.error('❌ Error loading initial calls:', error);
    }
  }

  // Event handlers
  async handleChannelStateChange(event) {
    const channel = event.channel;
    console.log(`📞 Channel state change: ${channel.name} -> ${channel.state}`);

    await this.trackChannel(channel);

    // Emit real-time event
    this.emit('channel:stateChange', {
      channelId: channel.id,
      channelName: channel.name,
      state: channel.state,
      caller: channel.caller,
      connected: channel.connected,
      timestamp: new Date()
    });

    // Update call status based on channel state
    if (channel.state === 'Up') {
      await this.handleCallAnswered(channel);
    } else if (channel.state === 'Down') {
      await this.handleCallEnded(channel);
    }
  }

  async handleStasisStart(event) {
    const channel = event.channel;
    console.log(`🎯 Stasis start: ${channel.name}`);

    await this.trackChannel(channel);

    this.emit('channel:stasisStart', {
      channelId: channel.id,
      channelName: channel.name,
      application: event.application,
      args: event.args,
      timestamp: new Date()
    });
  }

  async handleStasisEnd(event) {
    const channel = event.channel;
    console.log(`🔚 Stasis end: ${channel.name}`);

    this.emit('channel:stasisEnd', {
      channelId: channel.id,
      channelName: channel.name,
      timestamp: new Date()
    });

    // Clean up channel tracking
    this.activeChannels.delete(channel.id);
  }

  async handleChannelDestroyed(event) {
    const channel = event.channel;
    console.log(`💀 Channel destroyed: ${channel.name}`);

    this.emit('channel:destroyed', {
      channelId: channel.id,
      channelName: channel.name,
      cause: event.cause,
      timestamp: new Date()
    });

    // Clean up tracking
    this.activeChannels.delete(channel.id);
    await this.handleCallEnded(channel);
  }

  async handleChannelVarset(event) {
    const channel = event.channel;
    const variable = event.variable;

    // Track important channel variables
    if (['CALLERID(name)', 'CALLERID(num)', 'UNIQUEID', 'LINKEDID'].includes(variable)) {
      console.log(`📝 Channel variable set: ${channel.name} -> ${variable} = ${event.value}`);

      this.emit('channel:variableSet', {
        channelId: channel.id,
        channelName: channel.name,
        variable: variable,
        value: event.value,
        timestamp: new Date()
      });
    }
  }

  async handleBridgeCreated(event) {
    const bridge = event.bridge;
    console.log(`🌉 Bridge created: ${bridge.id} (${bridge.bridge_type})`);

    this.emit('bridge:created', {
      bridgeId: bridge.id,
      bridgeType: bridge.bridge_type,
      technology: bridge.technology,
      timestamp: new Date()
    });
  }

  async handleBridgeDestroyed(event) {
    const bridge = event.bridge;
    console.log(`💥 Bridge destroyed: ${bridge.id}`);

    this.emit('bridge:destroyed', {
      bridgeId: bridge.id,
      timestamp: new Date()
    });
  }

  async handleChannelEnteredBridge(event) {
    const channel = event.channel;
    const bridge = event.bridge;

    console.log(`🚪 Channel entered bridge: ${channel.name} -> ${bridge.id}`);

    // Update channel tracking
    if (this.activeChannels.has(channel.id)) {
      const channelData = this.activeChannels.get(channel.id);
      channelData.bridge = bridge.id;
      this.activeChannels.set(channel.id, channelData);
    }

    this.emit('bridge:channelEntered', {
      channelId: channel.id,
      channelName: channel.name,
      bridgeId: bridge.id,
      timestamp: new Date()
    });

    // Check if this creates a connected call
    await this.checkForConnectedCall(bridge.id);
  }

  async handleChannelLeftBridge(event) {
    const channel = event.channel;
    const bridge = event.bridge;

    console.log(`🚪 Channel left bridge: ${channel.name} <- ${bridge.id}`);

    // Update channel tracking
    if (this.activeChannels.has(channel.id)) {
      const channelData = this.activeChannels.get(channel.id);
      channelData.bridge = null;
      this.activeChannels.set(channel.id, channelData);
    }

    this.emit('bridge:channelLeft', {
      channelId: channel.id,
      channelName: channel.name,
      bridgeId: bridge.id,
      timestamp: new Date()
    });
  }

  async handleRecordingStarted(event) {
    const recording = event.recording;
    console.log(`🎙️ Recording started: ${recording.name}`);

    this.emit('recording:started', {
      recordingName: recording.name,
      format: recording.format,
      state: recording.state,
      timestamp: new Date()
    });
  }

  async handleRecordingFinished(event) {
    const recording = event.recording;
    console.log(`🛑 Recording finished: ${recording.name}`);

    this.emit('recording:finished', {
      recordingName: recording.name,
      format: recording.format,
      state: recording.state,
      timestamp: new Date()
    });
  }

  // Call status tracking
  async handleCallAnswered(channel) {
    try {
      // Find call record associated with this channel
      const callRecord = await this.findCallByChannel(channel);
      if (!callRecord) return;

      if (callRecord.status !== 'answered') {
        await callRecord.update({
          status: 'answered',
          answered_at: new Date()
        });

        console.log(`✅ Call answered: ${callRecord.call_id}`);

        this.emit('call:answered', {
          callId: callRecord.call_id,
          channelId: channel.id,
          timestamp: new Date()
        });
      }

    } catch (error) {
      console.error('❌ Error handling call answered:', error);
    }
  }

  async handleCallEnded(channel) {
    try {
      const callRecord = await this.findCallByChannel(channel);
      if (!callRecord) return;

      if (!['ended', 'failed'].includes(callRecord.status)) {
        const endedAt = new Date();
        const duration = callRecord.answered_at ?
          Math.floor((endedAt - new Date(callRecord.answered_at)) / 1000) : 0;

        await callRecord.update({
          status: 'ended',
          ended_at: endedAt,
          duration: duration
        });

        console.log(`🔚 Call ended: ${callRecord.call_id} (${duration}s)`);

        this.emit('call:ended', {
          callId: callRecord.call_id,
          channelId: channel.id,
          duration: duration,
          timestamp: endedAt
        });

        // Clean up call tracking
        this.activeCalls.delete(callRecord.call_id);
      }

    } catch (error) {
      console.error('❌ Error handling call ended:', error);
    }
  }

  async checkForConnectedCall(bridgeId) {
    try {
      if (!this.ariClient) return;

      const bridge = await this.ariClient.bridges.get({ bridgeId });
      if (bridge.channels && bridge.channels.length >= 2) {
        // This is a connected call
        for (const channelId of bridge.channels) {
          const callRecord = await this.findCallByChannelId(channelId);
          if (callRecord && callRecord.status !== 'bridged') {
            await callRecord.update({ status: 'bridged' });

            this.emit('call:bridged', {
              callId: callRecord.call_id,
              bridgeId: bridgeId,
              channelCount: bridge.channels.length,
              timestamp: new Date()
            });
          }
        }
      }

    } catch (error) {
      console.error('❌ Error checking connected call:', error);
    }
  }

  // Channel tracking
  async trackChannel(channel) {
    const channelData = {
      id: channel.id,
      name: channel.name,
      state: channel.state,
      caller: channel.caller,
      connected: channel.connected,
      accountcode: channel.accountcode,
      dialplan: channel.dialplan,
      creationtime: channel.creationtime,
      language: channel.language,
      bridge: null,
      lastUpdate: new Date()
    };

    this.activeChannels.set(channel.id, channelData);

    // Try to associate with call record
    try {
      const callRecord = await this.findCallByChannel(channel);
      if (callRecord) {
        channelData.callId = callRecord.call_id;
        channelData.orgId = callRecord.org_id;
      }
    } catch (error) {
      console.warn('⚠️ Could not associate channel with call:', error.message);
    }
  }

  // Statistics updates
  async updateStatistics() {
    if (!this.monitoringActive) return;

    try {
      console.log('📊 Updating call statistics...');

      await this.updateOrganizationStats();
      await this.updateUserStats();
      await this.updateQueueStats();

      this.emit('stats:updated', {
        timestamp: new Date(),
        organizations: this.organizationStats.size,
        users: this.userStats.size,
        queues: this.queueStats.size,
        activeChannels: this.activeChannels.size,
        activeCalls: this.activeCalls.size
      });

    } catch (error) {
      console.error('❌ Error updating statistics:', error);
    }
  }

  async updateOrganizationStats() {
    try {
      const organizations = await Organization.findAll({ where: { status: 'active' } });

      for (const org of organizations) {
        const stats = {
          orgId: org.id,
          orgName: org.name,
          activeChannels: 0,
          activeCalls: 0,
          totalCalls: 0,
          inboundCalls: 0,
          outboundCalls: 0,
          averageCallDuration: 0,
          lastUpdate: new Date()
        };

        // Count active channels for this org
        for (const [channelId, channelData] of this.activeChannels) {
          if (channelData.orgId === org.id) {
            stats.activeChannels++;
          }
        }

        // Count active calls for this org
        for (const [callId, callData] of this.activeCalls) {
          if (callData.callRecord.org_id === org.id) {
            stats.activeCalls++;
          }
        }

        // Get today's call statistics
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todaysCalls = await CallRecord.count({
          where: {
            org_id: org.id,
            started_at: { [Op.gte]: today }
          }
        });

        const inboundCalls = await CallRecord.count({
          where: {
            org_id: org.id,
            direction: 'inbound',
            started_at: { [Op.gte]: today }
          }
        });

        const outboundCalls = await CallRecord.count({
          where: {
            org_id: org.id,
            direction: 'outbound',
            started_at: { [Op.gte]: today }
          }
        });

        // Calculate average call duration
        const avgDuration = await CallRecord.findOne({
          where: {
            org_id: org.id,
            started_at: { [Op.gte]: today },
            duration: { [Op.gt]: 0 }
          },
          attributes: [[sequelize.fn('AVG', sequelize.col('duration')), 'avgDuration']]
        });

        stats.totalCalls = todaysCalls;
        stats.inboundCalls = inboundCalls;
        stats.outboundCalls = outboundCalls;
        stats.averageCallDuration = avgDuration?.dataValues?.avgDuration || 0;

        this.organizationStats.set(org.id, stats);
      }

    } catch (error) {
      console.error('❌ Error updating organization stats:', error);
    }
  }

  async updateUserStats() {
    try {
      // Implementation for user statistics
      // Track calls per user, average talk time, etc.
      const activeUsers = await User.findAll({
        where: { status: 'active' },
        include: [{ model: Organization, as: 'organization' }]
      });

      for (const user of activeUsers) {
        const stats = {
          userId: user.id,
          extension: user.extension,
          orgId: user.org_id,
          isRegistered: false,
          activeChannels: 0,
          activeCalls: 0,
          callsToday: 0,
          talkTimeToday: 0,
          lastUpdate: new Date()
        };

        // Check registration status via ARI
        if (this.ariClient) {
          try {
            const endpoints = await this.ariClient.endpoints.list();
            const userEndpoint = endpoints.find(ep =>
              ep.resource === user.asterisk_endpoint
            );
            stats.isRegistered = userEndpoint?.state === 'online';
          } catch (error) {
            // Endpoint not found or error
          }
        }

        // Count active channels/calls for this user
        for (const [channelId, channelData] of this.activeChannels) {
          if (channelData.caller?.number === user.extension ||
              channelData.connected?.number === user.extension) {
            stats.activeChannels++;
          }
        }

        this.userStats.set(user.id, stats);
      }

    } catch (error) {
      console.error('❌ Error updating user stats:', error);
    }
  }

  async updateQueueStats() {
    try {
      const queues = await Queue.findAll({
        where: { active: true },
        include: [{ model: QueueMember, as: 'members' }]
      });

      for (const queue of queues) {
        const stats = {
          queueId: queue.id,
          queueNumber: queue.number,
          queueName: queue.name,
          strategy: queue.strategy,
          waitingCallers: 0,
          availableAgents: 0,
          busyAgents: 0,
          longestWait: 0,
          callsToday: 0,
          averageWaitTime: 0,
          abandonedCalls: 0,
          lastUpdate: new Date()
        };

        // Get real-time queue stats via ARI/AMI
        if (this.ariClient) {
          try {
            // This would require AMI connection for queue stats
            // For now, we'll use basic tracking
          } catch (error) {
            console.warn(`⚠️ Could not get queue stats for ${queue.number}`);
          }
        }

        this.queueStats.set(queue.id, stats);
      }

    } catch (error) {
      console.error('❌ Error updating queue stats:', error);
    }
  }

  // Utility methods
  async findCallByChannel(channel) {
    try {
      // Try to find by channel name or caller ID
      const channelRecord = await Channel.findOne({
        where: { asterisk_channel_id: channel.id },
        include: [{ model: CallRecord, as: 'callRecord' }]
      });

      if (channelRecord?.callRecord) {
        return channelRecord.callRecord;
      }

      // Fallback: try to match by caller ID and time
      const callerNum = channel.caller?.number;
      if (callerNum) {
        return await CallRecord.findOne({
          where: {
            [Op.or]: [
              { from_number: callerNum },
              { to_number: callerNum }
            ],
            status: { [Op.notIn]: ['ended', 'failed'] }
          },
          order: [['started_at', 'DESC']]
        });
      }

      return null;

    } catch (error) {
      console.error('❌ Error finding call by channel:', error);
      return null;
    }
  }

  async findCallByChannelId(channelId) {
    const channelData = this.activeChannels.get(channelId);
    if (channelData?.callId) {
      return this.activeCalls.get(channelData.callId)?.callRecord;
    }
    return null;
  }

  // Public API methods
  getActiveChannels() {
    return Array.from(this.activeChannels.values());
  }

  getActiveCalls() {
    return Array.from(this.activeCalls.values());
  }

  getOrganizationStats(orgId) {
    return this.organizationStats.get(orgId);
  }

  getUserStats(userId) {
    return this.userStats.get(userId);
  }

  getQueueStats(queueId) {
    return this.queueStats.get(queueId);
  }

  getAllStats() {
    return {
      organizations: Array.from(this.organizationStats.values()),
      users: Array.from(this.userStats.values()),
      queues: Array.from(this.queueStats.values()),
      activeChannels: this.getActiveChannels(),
      activeCalls: this.getActiveCalls(),
      lastUpdate: new Date()
    };
  }

  getMonitoringStatus() {
    return {
      active: this.monitoringActive,
      startTime: this.startTime,
      activeChannels: this.activeChannels.size,
      activeCalls: this.activeCalls.size,
      updateInterval: this.updateInterval
    };
  }

  // Real-time events for WebSocket clients
  subscribeToEvents(eventTypes = []) {
    const subscriber = new EventEmitter();

    const eventHandler = (eventType) => (data) => {
      if (eventTypes.length === 0 || eventTypes.includes(eventType)) {
        subscriber.emit('monitoring:event', { type: eventType, data });
      }
    };

    // Subscribe to all monitoring events
    const events = [
      'channel:stateChange', 'channel:stasisStart', 'channel:stasisEnd',
      'channel:destroyed', 'channel:variableSet', 'bridge:created',
      'bridge:destroyed', 'bridge:channelEntered', 'bridge:channelLeft',
      'recording:started', 'recording:finished', 'call:answered',
      'call:ended', 'call:bridged', 'stats:updated'
    ];

    events.forEach(eventType => {
      this.on(eventType, eventHandler(eventType));
    });

    return subscriber;
  }
}

module.exports = CallMonitoringService;