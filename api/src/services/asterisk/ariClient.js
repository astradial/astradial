const ari = require('ari-client');
const EventEmitter = require('events');
const dgram = require('dgram');
const WebSocket = require('ws');
const { CallRecord } = require('../../models');
const WebhookService = require('../webhookService');

class AsteriskARIClient extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.isConnected = false;
    this.reconnectInterval = 5000;
    this.applicationName = process.env.ASTERISK_ARI_APP || 'pbx_api';
    this.activeCalls = new Map(); // channelId -> call data
    this.webhookService = new WebhookService();
  }

  async connect() {
    try {
      console.log('🔌 Connecting to Asterisk ARI...');

      this.client = await ari.connect(
        `http://${process.env.ASTERISK_HOST}:${process.env.ASTERISK_PORT}`,
        process.env.ASTERISK_ARI_USERNAME || 'pbx_api',
        process.env.ASTERISK_ARI_PASSWORD || 'pbx_secret'
      );

      console.log('✅ Connected to Asterisk ARI');
      this.isConnected = true;

      // Start the stasis application
      this.client.start(this.applicationName);

      // Set up event listeners
      this.setupEventListeners();

      this.emit('connected');

    } catch (error) {
      console.error('❌ Failed to connect to Asterisk ARI:', error.message || error);
      this.isConnected = false;
      this.scheduleReconnect();
      throw error; // Re-throw so caller can handle
    }
  }

  setupEventListeners() {
    // Application events
    this.client.on('StasisStart', this.handleStasisStart.bind(this));
    this.client.on('StasisEnd', this.handleStasisEnd.bind(this));

    // Channel events
    this.client.on('ChannelStateChange', this.handleChannelStateChange.bind(this));
    this.client.on('ChannelHangupRequest', this.handleChannelHangup.bind(this));
    this.client.on('ChannelDestroyed', this.handleChannelDestroyed.bind(this));

    // Bridge events
    this.client.on('BridgeCreated', this.handleBridgeCreated.bind(this));
    this.client.on('BridgeDestroyed', this.handleBridgeDestroyed.bind(this));
    this.client.on('ChannelEnteredBridge', this.handleChannelEnteredBridge.bind(this));
    this.client.on('ChannelLeftBridge', this.handleChannelLeftBridge.bind(this));

    // Connection events
    this.client.on('error', (error) => {
      console.error('ARI Client error:', error);
      this.isConnected = false;
      this.scheduleReconnect();
    });

    this.client.on('close', () => {
      console.log('ARI connection closed');
      this.isConnected = false;
      this.scheduleReconnect();
    });
  }

  async handleStasisStart(event, channel) {
    console.log(`📞 Stasis Start: ${channel.name} (${channel.id})`);
    console.log(`📞 Stasis Args: ${JSON.stringify(event.args)}`);

    try {
      // Extract organization context from channel variables
      const channelVars = await this.getChannelVariables(channel.id);
      // ORG_ID may be set as dialplan var or via accountcode on the PJSIP endpoint
      const orgId = channelVars.ORG_ID || channel.accountcode || null;
      const didNumber = channelVars.DID_NUMBER || channel.dialplan?.exten;
      console.log(`📞 Channel vars: ORG_ID=${channelVars.ORG_ID}, accountcode=${channel.accountcode}, caller=${channel.caller?.number}`);

      // Create call record (skip if no orgId to avoid validation error)
      let callRecord = null;
      if (orgId) {
        const [record, created] = await CallRecord.findOrCreate({
          where: { call_id: channel.id, org_id: orgId },
          defaults: {
            org_id: orgId,
            call_id: channel.id,
            channel_id: channel.name,
            from_number: channel.caller?.number || 'Unknown',
            to_number: didNumber || channel.dialplan?.exten || 'Unknown',
            caller_id_name: channel.caller?.name || '',
            direction: this.determineCallDirection(channel),
            status: 'ringing',
            started_at: new Date()
          }
        });
        callRecord = record;
      } else {
        console.warn(`⚠️ No org_id for channel ${channel.id}, skipping call record`);
      }

      // Store call data
      this.activeCalls.set(channel.id, {
        callRecord,
        channel,
        orgId,
        startTime: Date.now()
      });

      this.emit('callInitiated', {
        callRecord,
        channel,
        orgId
      });

      // Trigger webhook for call.initiated event
      if (callRecord) {
        await this.webhookService.onCallInitiated({
          callRecord,
          channel,
          orgId
        });
      }

      // Check if this is an AI agent call from Stasis args
      // Dialplan sends: Stasis(pbx_api,ai_agent,<wss_url>)
      const stasisArgs = event.args || [];
      if (stasisArgs[0] === 'ai_agent' && stasisArgs[1]) {
        await this.handleAiAgentCall(channel, stasisArgs[1], orgId, callRecord);
      } else {
        // Default: answer the channel
        await this.answerChannel(channel.id);
      }

    } catch (error) {
      console.error('Error handling StasisStart:', error);
    }
  }

  /**
   * Handle an AI agent call by:
   * 1. Creating a UDP socket (local relay)
   * 2. Creating an externalMedia channel pointing to that UDP socket
   * 3. Opening a WebSocket to the pipecat server
   * 4. Relaying audio: Asterisk <-> UDP <-> Node.js <-> WSS <-> Pipecat
   */
  async handleAiAgentCall(channel, wssUrl, orgId, callRecord) {
    try {
      console.log(`🤖 AI Agent call: connecting ${channel.id} to pipecat via AudioSocket`);

      // Read custom variables set by workflow executor (outbound calls)
      let customVars = {};
      try {
        const resp = await this.client.channels.getChannelVar({ channelId: channel.id, variable: 'CUSTOM_VARS_B64' });
        if (resp?.value) {
          customVars = JSON.parse(Buffer.from(resp.value, 'base64').toString('utf-8'));
          console.log(`🤖 Custom variables for bot:`, customVars);
        }
      } catch {
        // No custom vars — not a workflow call or no vars set
      }

      // Answer the incoming channel
      await this.answerChannel(channel.id);
      console.log(`🤖 Channel answered, setting up AudioSocket relay`);

      // Create a mixing bridge
      const bridgeId = `ai_bridge_${channel.id}`;
      const bridge = await this.createBridge(bridgeId, 'mixing');
      if (!bridge) {
        console.error('❌ Failed to create bridge for AI agent call');
        await this.hangupChannel(channel.id, 'normal');
        return;
      }

      // Add the caller channel to the bridge
      await this.addChannelToBridge(bridge.id, channel.id);

      // Start recording on the bridge
      const recordingName = `${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}-${channel.caller?.number || 'unknown'}-ai-bot`;
      try {
        await this.client.bridges.record({
          bridgeId: bridge.id,
          name: recordingName,
          format: 'wav',
          maxDurationSeconds: 600,
          ifExists: 'overwrite',
        });
        console.log(`🎙️ Recording started: ${recordingName}`);
      } catch (recErr) {
        console.error(`🎙️ Recording failed: ${recErr.message}`);
      }

      // Create a local UDP socket to relay audio
      const udpRelay = dgram.createSocket('udp4');
      let asteriskPort = null;
      let asteriskHost = null;

      await new Promise((resolve, reject) => {
        udpRelay.bind(0, '127.0.0.1', (err) => {
          if (err) return reject(err);
          const addr = udpRelay.address();
          console.log(`🤖 UDP relay listening on ${addr.address}:${addr.port}`);
          resolve();
        });
      });

      const relayAddr = udpRelay.address();

      // Create externalMedia channel with UDP transport
      const externalChannel = await this.client.channels.externalMedia({
        app: this.applicationName,
        external_host: `${relayAddr.address}:${relayAddr.port}`,
        format: 'ulaw',
        encapsulation: 'rtp',
        transport: 'udp'
      });

      const extChannelId = externalChannel.channel?.id || externalChannel.id;
      console.log(`🤖 External media channel created: ${extChannelId}`);

      // Add external media channel to the bridge
      await this.addChannelToBridge(bridge.id, extChannelId);

      // Open WebSocket to pipecat
      const ws = new WebSocket(wssUrl);
      const streamSid = `asterisk_${channel.id}`;
      const callSid = channel.id;
      let mediaChunk = 0;

      ws.on('open', () => {
        console.log(`🤖 WebSocket connected to pipecat: ${wssUrl}`);

        // Send "connected" event first (pipecat bots expect this before "start")
        ws.send(JSON.stringify({
          event: 'connected',
          protocol: 'Call',
          version: '1.0.0'
        }));

        // Send Twilio-style "start" event that pipecat expects
        const startMessage = JSON.stringify({
          event: 'start',
          start: {
            streamSid: streamSid,
            callSid: callSid,
            accountSid: orgId || 'astrapbx',
            from: channel.caller?.number || 'Unknown',
            to: channel.dialplan?.exten || 'Unknown',
            direction: 'inbound',
            mediaFormat: {
              encoding: 'audio/x-mulaw',
              sampleRate: 8000,
              channels: 1
            },
            customParameters: {
              provider: 'astrapbx',
              org_id: orgId || '',
              channel_id: channel.id,
              endpoint: channel.name || '',
              ...customVars
            }
          }
        });
        ws.send(startMessage);
        console.log(`🤖 Sent start event with streamSid: ${streamSid}`);
      });

      ws.on('error', (err) => {
        console.error(`🤖 WebSocket error: ${err.message}`);
      });

      ws.on('close', () => {
        console.log(`🤖 WebSocket closed for channel ${channel.id}`);
      });

      // Convert 8-bit µ-law to 16-bit signed linear PCM
      const ULAW_DECODE = new Int16Array(256);
      (() => {
        for (let i = 0; i < 256; i++) {
          let u = ~i & 0xFF;
          let sign = u & 0x80;
          let exponent = (u >> 4) & 0x07;
          let mantissa = u & 0x0F;
          let sample = ((mantissa << 3) + 0x84) << exponent;
          sample -= 0x84;
          ULAW_DECODE[i] = sign ? -sample : sample;
        }
      })();

      function ulawToPcm16(ulawBuffer) {
        const pcmBuffer = Buffer.alloc(ulawBuffer.length * 2);
        for (let i = 0; i < ulawBuffer.length; i++) {
          pcmBuffer.writeInt16LE(ULAW_DECODE[ulawBuffer[i]], i * 2);
        }
        return pcmBuffer;
      }

      // Relay: Asterisk UDP (RTP) -> pipecat WSS (binary PCM for AstraPBXSerializer)
      udpRelay.on('message', (msg, rinfo) => {
        // Remember Asterisk's address for sending back
        if (!asteriskPort) {
          asteriskPort = rinfo.port;
          asteriskHost = rinfo.address;
        }

        // Strip RTP header (first 12 bytes) to get raw µ-law audio
        if (msg.length > 12) {
          const ulawPayload = msg.slice(12);
          if (ws.readyState === WebSocket.OPEN) {
            // Convert µ-law to 16-bit linear PCM and send as binary
            const pcmData = ulawToPcm16(ulawPayload);
            ws.send(pcmData);
          }
        }
      });

      // Relay: pipecat WSS -> Asterisk UDP (RTP)
      // Buffer audio and send in paced 160-byte (20ms) RTP packets
      let rtpSeq = 0;
      let rtpTimestamp = 0;
      const rtpSSRC = Math.floor(Math.random() * 0xFFFFFFFF);
      const RTP_PACKET_SIZE = 160; // 20ms of ulaw at 8kHz
      const RTP_INTERVAL = 20; // 20ms between packets
      let audioBuffer = Buffer.alloc(0);
      let rtpTimer = null;

      // Paced sender with drift correction
      let rtpStartTime = 0;
      let packetsSent = 0;

      const startRtpSender = () => {
        if (rtpTimer) return;
        rtpStartTime = Date.now();
        packetsSent = 0;

        const sendPacket = () => {
          if (!asteriskPort || !asteriskHost) {
            rtpTimer = setTimeout(sendPacket, RTP_INTERVAL);
            return;
          }

          // Send all packets that should have been sent by now
          const elapsed = Date.now() - rtpStartTime;
          const expectedPackets = Math.floor(elapsed / RTP_INTERVAL);

          while (packetsSent < expectedPackets && audioBuffer.length >= RTP_PACKET_SIZE) {
            const chunk = audioBuffer.subarray(0, RTP_PACKET_SIZE);
            audioBuffer = audioBuffer.subarray(RTP_PACKET_SIZE);

            const rtpHeader = Buffer.alloc(12);
            rtpHeader[0] = 0x80; // V=2
            rtpHeader[1] = 0x00; // PT=0 (PCMU/ulaw)
            rtpHeader.writeUInt16BE(rtpSeq & 0xFFFF, 2);
            rtpHeader.writeUInt32BE(rtpTimestamp & 0xFFFFFFFF, 4);
            rtpHeader.writeUInt32BE(rtpSSRC, 8);

            udpRelay.send(Buffer.concat([rtpHeader, chunk]), asteriskPort, asteriskHost);
            rtpSeq++;
            rtpTimestamp += RTP_PACKET_SIZE;
            packetsSent++;
          }

          // Schedule next check — adjust for drift
          const nextPacketTime = rtpStartTime + (packetsSent + 1) * RTP_INTERVAL;
          const delay = Math.max(1, nextPacketTime - Date.now());
          rtpTimer = setTimeout(sendPacket, delay);
        };

        rtpTimer = setTimeout(sendPacket, RTP_INTERVAL);
      };

      // Convert 16-bit signed linear PCM to 8-bit µ-law
      function linearToUlaw(sample) {
        const BIAS = 0x84;
        const MAX = 32635;
        let sign = (sample >> 8) & 0x80;
        if (sign) sample = -sample;
        if (sample > MAX) sample = MAX;
        sample += BIAS;
        let exponent = 7;
        for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {}
        let mantissa = (sample >> (exponent + 3)) & 0x0F;
        let ulawByte = ~(sign | (exponent << 4) | mantissa) & 0xFF;
        return ulawByte;
      }

      function pcm16ToUlaw(pcmBuffer) {
        const numSamples = pcmBuffer.length / 2;
        const ulawBuffer = Buffer.alloc(numSamples);
        for (let i = 0; i < numSamples; i++) {
          const sample = pcmBuffer.readInt16LE(i * 2);
          ulawBuffer[i] = linearToUlaw(sample);
        }
        return ulawBuffer;
      }

      ws.on('message', (data) => {
        if (Buffer.isBuffer(data) || (data instanceof ArrayBuffer)) {
          // Binary audio from AstraPBXSerializer (16-bit signed linear PCM at 8kHz)
          // Convert to µ-law for RTP
          const pcmData = Buffer.isBuffer(data) ? data : Buffer.from(data);
          if (pcmData.length > 0) {
            const ulawData = pcm16ToUlaw(pcmData);
            audioBuffer = Buffer.concat([audioBuffer, ulawData]);
            startRtpSender();
          }
          return;
        }

        try {
          const msg = JSON.parse(data.toString());

          if (msg.event === 'media' && msg.media?.payload) {
            // Decode base64 audio from Twilio-style pipecat and add to buffer
            const audioData = Buffer.from(msg.media.payload, 'base64');
            audioBuffer = Buffer.concat([audioBuffer, audioData]);
            startRtpSender();
          } else if (msg.event === 'stop') {
            console.log(`🤖 Pipecat sent stop event for ${channel.id}`);
            this.hangupChannel(channel.id, 'normal').catch(() => {});
          }
        } catch (e) {
          // Unknown format
        }
      });

      // Store everything for cleanup
      const callData = this.activeCalls.get(channel.id);
      if (callData) {
        callData.isAiAgent = true;
        callData.wsRelay = ws;
        callData.udpRelay = udpRelay;
        callData.extChannelId = extChannelId;
        callData.bridgeId = bridge.id;
        // rtpTimer is set later when audio starts - store getter via closure
        callData.getRtpTimer = () => rtpTimer;
      }

      console.log(`🤖 AI Agent call bridged successfully: ${channel.id} <-> UDP:${relayAddr.port} <-> WSS:${wssUrl}`);

    } catch (error) {
      console.error(`❌ Error handling AI agent call:`, error);
      try { await this.hangupChannel(channel.id, 'normal'); } catch {}
    }
  }

  async handleStasisEnd(event, channel) {
    console.log(`📞 Stasis End: ${channel.name} (${channel.id})`);

    const callData = this.activeCalls.get(channel.id);
    if (callData) {
      try {
        // Update call record
        if (callData.callRecord) {
          await callData.callRecord.update({
            status: 'completed',
            ended_at: new Date(),
            duration: Math.floor((Date.now() - callData.startTime) / 1000)
          });
        }

        this.emit('callEnded', {
          callRecord: callData.callRecord,
          channel,
          orgId: callData.orgId
        });

        // Trigger webhook for call.ended event
        if (callData.callRecord) {
          await this.webhookService.onCallEnded({
            callRecord: callData.callRecord,
            channel,
            orgId: callData.orgId
          });
        }

        // Clean up AI agent bridge, external channel, UDP relay, WebSocket, and timer
        if (callData.isAiAgent) {
          if (callData.getRtpTimer) {
            const timer = callData.getRtpTimer();
            if (timer) clearTimeout(timer);
          }
          if (callData.wsRelay) {
            try { callData.wsRelay.close(); } catch (e) { /* ignore */ }
          }
          if (callData.udpRelay) {
            try { callData.udpRelay.close(); } catch (e) { /* ignore */ }
          }
          if (callData.extChannelId) {
            try { await this.hangupChannel(callData.extChannelId, 'normal'); } catch (e) { /* ignore */ }
          }
          if (callData.bridgeId) {
            try {
              await this.client.bridges.destroy({ bridgeId: callData.bridgeId });
              console.log(`🌉 Destroyed AI agent bridge: ${callData.bridgeId}`);
            } catch (e) { /* ignore */ }
          }
        }

      } catch (error) {
        console.error('Error updating call record:', error);
      }

      this.activeCalls.delete(channel.id);
    }
  }

  async handleChannelStateChange(event, channel) {
    console.log(`📞 Channel State: ${channel.name} -> ${channel.state}`);

    const callData = this.activeCalls.get(channel.id);
    if (!callData) return;

    try {
      let updateData = {};

      switch (channel.state) {
        case 'Up':
          updateData = {
            status: 'answered',
            answered_at: new Date()
          };
          this.emit('callAnswered', {
            callRecord: callData.callRecord,
            channel,
            orgId: callData.orgId
          });

          // Trigger webhook for call.answered event
          await this.webhookService.onCallAnswered({
            callRecord: callData.callRecord,
            channel,
            orgId: callData.orgId
          });
          break;

        case 'Ringing':
          updateData = { status: 'ringing' };
          break;

        case 'Busy':
          updateData = { status: 'busy' };
          break;
      }

      if (Object.keys(updateData).length > 0) {
        await callData.callRecord.update(updateData);
      }

    } catch (error) {
      console.error('Error handling channel state change:', error);
    }
  }

  async handleChannelHangup(event, channel) {
    console.log(`📞 Channel Hangup: ${channel.name} - Cause: ${event.cause}`);

    const callData = this.activeCalls.get(channel.id);
    if (callData) {
      try {
        await callData.callRecord.update({
          hangup_cause: event.cause.toString(),
          ended_at: new Date()
        });
      } catch (error) {
        console.error('Error updating hangup cause:', error);
      }
    }
  }

  async handleChannelDestroyed(event, channel) {
    console.log(`📞 Channel Destroyed: ${channel.name}`);
    this.activeCalls.delete(channel.id);
  }

  async handleBridgeCreated(event, bridge) {
    console.log(`🌉 Bridge Created: ${bridge.id}`);
  }

  async handleBridgeDestroyed(event, bridge) {
    console.log(`🌉 Bridge Destroyed: ${bridge.id}`);
  }

  async handleChannelEnteredBridge(event, bridge, channel) {
    if (channel) console.log(`🌉 Channel ${channel.name} entered bridge ${bridge.id}`);
  }

  async handleChannelLeftBridge(event, bridge, channel) {
    if (channel) console.log(`🌉 Channel ${channel.name} left bridge ${bridge.id}`);
  }

  // Call control methods
  async answerChannel(channelId) {
    try {
      await this.client.channels.answer({ channelId });
      console.log(`✅ Answered channel: ${channelId}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to answer channel ${channelId}:`, error);
      return false;
    }
  }

  async hangupChannel(channelId, reason = 'normal') {
    try {
      await this.client.channels.hangup({ channelId, reason });
      console.log(`✅ Hung up channel: ${channelId}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to hangup channel ${channelId}:`, error);
      return false;
    }
  }

  async holdChannel(channelId) {
    try {
      await this.client.channels.hold({ channelId });
      console.log(`⏸️ Put channel on hold: ${channelId}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to hold channel ${channelId}:`, error);
      return false;
    }
  }

  async unholdChannel(channelId) {
    try {
      await this.client.channels.unhold({ channelId });
      console.log(`▶️ Removed channel from hold: ${channelId}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to unhold channel ${channelId}:`, error);
      return false;
    }
  }

  async muteChannel(channelId, direction = 'both') {
    try {
      await this.client.channels.mute({ channelId, direction });
      console.log(`🔇 Muted channel: ${channelId} (${direction})`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to mute channel ${channelId}:`, error);
      return false;
    }
  }

  async unmuteChannel(channelId, direction = 'both') {
    try {
      await this.client.channels.unmute({ channelId, direction });
      console.log(`🔊 Unmuted channel: ${channelId} (${direction})`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to unmute channel ${channelId}:`, error);
      return false;
    }
  }

  async transferChannel(channelId, extension, context = 'default') {
    try {
      await this.client.channels.redirect({
        channelId,
        endpoint: `Local/${extension}@${context}`
      });
      console.log(`↗️ Transferred channel ${channelId} to ${extension}@${context}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to transfer channel ${channelId}:`, error);
      return false;
    }
  }

  async createBridge(bridgeId, type = 'mixing') {
    try {
      const bridge = await this.client.bridges.create({
        type,
        bridgeId,
        name: `Bridge_${bridgeId}`
      });
      console.log(`🌉 Created bridge: ${bridge.id}`);
      return bridge;
    } catch (error) {
      console.error(`❌ Failed to create bridge:`, error);
      return null;
    }
  }

  async addChannelToBridge(bridgeId, channelId) {
    try {
      await this.client.bridges.addChannel({
        bridgeId,
        channel: channelId
      });
      console.log(`🌉 Added channel ${channelId} to bridge ${bridgeId}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to add channel to bridge:`, error);
      return false;
    }
  }

  /**
   * Move a channel into a Stasis application
   * This is useful for taking control of channels created outside Stasis
   */
  async moveChannelToStasis(channelId, stasisApp = 'ai_agent', args = []) {
    try {
      await this.client.channels.continueInDialplan({
        channelId,
        context: 'stasis-bridge',
        extension: stasisApp,
        priority: 1
      });
      console.log(`🤖 Moved channel ${channelId} to Stasis app: ${stasisApp}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to move channel to Stasis:`, error);
      return false;
    }
  }

  /**
   * Start external media on a channel (for AI/WebRTC integration)
   */
  async startExternalMedia(channelId, options = {}) {
    try {
      const {
        app = 'ai_agent',
        external_host = '127.0.0.1:8000',
        format = 'ulaw',
        direction = 'both'
      } = options;

      await this.client.channels.externalMedia({
        channelId,
        app,
        external_host,
        format,
        direction
      });
      console.log(`🎤 Started external media on channel ${channelId}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to start external media:`, error);
      return false;
    }
  }

  async removeChannelFromBridge(bridgeId, channelId) {
    try {
      await this.client.bridges.removeChannel({
        bridgeId,
        channel: channelId
      });
      console.log(`🌉 Removed channel ${channelId} from bridge ${bridgeId}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to remove channel from bridge:`, error);
      return false;
    }
  }

  // Utility methods
  async getChannelVariables(channelId, variables = ['ORG_ID', 'DID_NUMBER', 'ROUTING_TYPE', 'WSS_URL', 'AI_AGENT_APP']) {
    const result = {};

    for (const variable of variables) {
      try {
        const response = await this.client.channels.getChannelVar({
          channelId,
          variable
        });
        result[variable] = response.value;
      } catch (error) {
        result[variable] = null;
      }
    }

    return result;
  }

  determineCallDirection(channel) {
    const name = channel.name || '';
    const callerNum = channel.caller?.number || '';
    // Trunk channels: if caller is external number (7+ digits), it's inbound from PSTN
    if (name.includes('trunk')) {
      if (callerNum.length >= 7) return 'inbound';
      return 'outbound';
    }
    // Local channels routed through outbound context
    if (name.includes('Local/') && name.includes('outbound')) {
      return 'outbound';
    }
    // Extension-to-extension
    return 'internal';
  }

  getActiveCallsCount() {
    return this.activeCalls.size;
  }

  getActiveCallsForOrg(orgId) {
    return Array.from(this.activeCalls.values())
      .filter(call => call.orgId === orgId)
      .map(call => ({
        channelId: call.channel.id,
        channelName: call.channel.name,
        state: call.channel.state,
        callRecord: call.callRecord,
        duration: Math.floor((Date.now() - call.startTime) / 1000)
      }));
  }

  scheduleReconnect() {
    if (this.reconnectTimeout) return;

    console.log(`⏰ Scheduling ARI reconnect in ${this.reconnectInterval}ms`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, this.reconnectInterval);
  }

  disconnect() {
    this.isConnected = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.client) {
      this.client.stop();
      this.client = null;
    }

    console.log('🔌 Disconnected from Asterisk ARI');
  }
}

module.exports = AsteriskARIClient;