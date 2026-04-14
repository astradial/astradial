require('dotenv').config();
const EventEmitter = require('events');
const WebhookService = require('../webhookService');

class AsteriskManager extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.config = {
      host: process.env.AMI_HOST || 'localhost',
      port: parseInt(process.env.AMI_PORT) || 5038,
      username: process.env.AMI_USERNAME || 'pbx_ami_user',
      secret: process.env.AMI_SECRET || 'YOUR_AMI_SECRET'
    };
    this.ami = null;
    this.webhookService = new WebhookService();
    this.eventListeners = new Map(); // Track event listeners
  }

  async connect() {
    try {
      console.log(`Connecting to Asterisk AMI at ${this.config.host}:${this.config.port}...`);

      const net = require('net');

      return new Promise((resolve, reject) => {
        this.ami = new net.Socket();
        let buffer = '';
        let authenticated = false;

        const dataHandler = (data) => {
          buffer += data.toString();

          // Check for complete AMI messages (terminated by double CRLF)
          const messages = buffer.split('\r\n\r\n');
          buffer = messages.pop(); // Keep incomplete message in buffer

          for (const message of messages) {
            console.log('AMI Message:', message);

            if (!authenticated && message.includes('Response: Success') && message.includes('Authentication accepted')) {
              this.connected = true;
              authenticated = true;
              console.log('AMI Login successful');
              this.ami.removeListener('data', dataHandler);
              resolve();
            } else if (!authenticated && message.includes('Response: Error')) {
              console.error('AMI Login failed:', message);
              this.ami.removeListener('data', dataHandler);
              reject(new Error('AMI Login failed'));
            }
          }
        };

        this.ami.on('data', dataHandler);

        this.ami.connect(this.config.port, this.config.host, () => {
          console.log('Connected to Asterisk AMI');

          // Wait for greeting then send login
          setTimeout(() => {
            const loginCommand = `Action: Login\r\nUsername: ${this.config.username}\r\nSecret: ${this.config.secret}\r\n\r\n`;
            console.log('Sending login command...');
            this.ami.write(loginCommand);
          }, 100);
        });

        this.ami.on('error', (err) => {
          console.error('AMI Connection error:', err);
          reject(err);
        });

        this.ami.on('close', () => {
          console.log('AMI Connection closed');
          this.connected = false;
        });

        // Set timeout for login
        setTimeout(() => {
          if (!authenticated) {
            reject(new Error('AMI Login timeout'));
          }
        }, 10000);
      });
    } catch (error) {
      console.error('Error connecting to AMI:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.ami && this.connected) {
      try {
        // Send logoff command
        const logoffCommand = `Action: Logoff\r\n\r\n`;
        this.ami.write(logoffCommand);
        this.ami.end();
        this.connected = false;
        console.log('Disconnected from Asterisk AMI');
      } catch (error) {
        console.error('Error disconnecting from AMI:', error);
      }
    }
  }

  async sendAction(action, parameters = {}) {
    if (!this.connected || !this.ami) {
      throw new Error('Not connected to Asterisk Manager Interface');
    }

    return new Promise((resolve, reject) => {
      let command = `Action: ${action}\r\n`;

      // Add parameters
      for (const [key, value] of Object.entries(parameters)) {
        command += `${key}: ${value}\r\n`;
      }
      command += '\r\n';

      console.log('Sending AMI command:', action);

      // Listen for response
      const responseHandler = (data) => {
        const response = data.toString();
        console.log('AMI Response:', response);

        if (response.includes('Response: Success')) {
          resolve({ success: true, response });
        } else if (response.includes('Response: Error')) {
          reject(new Error(`AMI Action failed: ${response}`));
        } else {
          // Continue listening for more data
          return;
        }

        // Remove the listener after getting a complete response
        this.ami.removeListener('data', responseHandler);
      };

      this.ami.on('data', responseHandler);
      this.ami.write(command);

      // Set a timeout
      setTimeout(() => {
        this.ami.removeListener('data', responseHandler);
        resolve({ success: true, timeout: true });
      }, 5000);
    });
  }

  async reloadModule(module) {
    return this.sendAction('Reload', { Module: module });
  }

  async reloadDialplan() {
    return this.sendAction('Command', { Command: 'dialplan reload' });
  }

  async reloadQueues() {
    return this.sendAction('QueueReload');
  }

  /**
   * Restart Asterisk (WARNING: Drops all active calls)
   * Use this for global config changes that require full restart
   */
  async restartAsterisk() {
    console.log('⚠️  WARNING: Restarting Asterisk - all active calls will be dropped');
    return this.sendAction('Command', { Command: 'core restart now' });
  }

  async coreReload() {
    return this.sendAction('Command', { Command: 'core reload' });
  }

  async executeCommand(command) {
    return this.sendAction('Command', { Command: command });
  }

  async originate(options) {
    const {
      channel,
      application,
      data,
      callerid,
      timeout = 30000,
      variables = {},
      async = true
    } = options;

    const params = {
      Channel: channel,
      Timeout: timeout,
      CallerID: callerid || 'Unknown'
    };

    // Application or Extension
    if (application) {
      params.Application = application;
      params.Data = data || '';
    } else if (options.exten && options.context) {
      params.Exten = options.exten;
      params.Context = options.context;
      params.Priority = options.priority || 1;
    }

    // Channel variables
    if (variables && Object.keys(variables).length > 0) {
      const varString = Object.entries(variables)
        .map(([key, value]) => `${key}=${value}`)
        .join(',');
      params.Variable = varString;
    }

    // Async origination
    if (async) {
      params.Async = 'true';
    }

    console.log(`🤖 [AMI Originate] Channel=${params.Channel} App=${params.Application} Data=${params.Data} Async=${params.Async}`);
    return this.sendAction('Originate', params);
  }

  /**
   * Enable AMI event listening
   * This allows webhooks to be triggered from AMI events
   */
  async enableEvents() {
    if (!this.connected) {
      throw new Error('Not connected to AMI');
    }

    // Enable all events
    await this.sendAction('Events', { EventMask: 'on' });

    // Set up continuous event listener on the socket
    this.ami.on('data', (data) => {
      this.handleAMIEvent(data.toString());
    });

    console.log('✅ AMI event listening enabled');
  }

  /**
   * Parse and handle AMI events
   */
  handleAMIEvent(data) {
    // AMI can send multiple events in one data chunk — split by double CRLF
    const eventBlocks = data.split('\r\n\r\n').filter(b => b.trim());
    for (const block of eventBlocks) {
      this._processAMIEvent(block);
    }
  }

  _processAMIEvent(data) {
    try {
      const lines = data.split('\r\n');
      const event = {};

      for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length > 0) {
          event[key.trim()] = valueParts.join(':').trim();
        }
      }

      if (!event.Event) return;

      const eventType = event.Event;
      console.log(`📡 AMI Event: ${eventType}`);

      // Handle specific events and trigger webhooks
      switch (eventType) {
        case 'PeerStatus':
          this.handlePeerStatusEvent(event);
          break;
        case 'Registry':
          this.handleRegistryEvent(event);
          break;
        case 'QueueMemberStatus':
          this.handleQueueMemberEvent(event);
          break;
        case 'QueueCallerJoin':
          this.handleQueueCallerJoinEvent(event);
          break;
        case 'QueueCallerAbandon':
          this.handleQueueCallerAbandonEvent(event);
          break;
        case 'AgentConnect':
          this.handleAgentConnectEvent(event);
          break;
        case 'Cdr':
          this.handleCdrEvent(event);
          break;
        default:
          // Emit generic event for custom handling
          this.emit('amiEvent', { type: eventType, data: event });
      }

    } catch (error) {
      console.error('Error handling AMI event:', error);
    }
  }

  /**
   * Handle CDR events - save call records to database
   */
  async handleCdrEvent(event) {
    try {
      const {
        AccountCode,
        Source,
        Destination,
        DestinationContext,
        CallerID,
        Channel,
        DestinationChannel,
        Duration,
        BillableSeconds,
        Disposition,
        UniqueID,
        recordingfile
      } = event;

      // AccountCode is the org_id set in PJSIP endpoint config
      const orgId = AccountCode;
      if (!orgId || orgId.length < 10) return; // Skip if no valid org_id

      // Skip Local channel CDRs — these are queue member ring legs (duplicates)
      const ch = Channel || '';
      if (ch.startsWith('Local/')) return;

      // Map AMI disposition to our status
      const statusMap = {
        'ANSWERED': 'completed',
        'NO ANSWER': 'no_answer',
        'BUSY': 'busy',
        'FAILED': 'failed',
        'CONGESTION': 'failed'
      };

      const status = statusMap[Disposition] || 'failed';
      const duration = parseInt(BillableSeconds) || 0;
      const totalDuration = parseInt(Duration) || 0;

      // Detect direction: external caller (7+ digits from PSTN) = inbound
      let direction = 'internal';
      const src = Source || '';
      const dst = Destination || '';
      
      const ctx = DestinationContext || '';
      if (ch.includes('trunk') && src.length >= 7) {
        direction = 'inbound';
      } else if (ctx.includes('outbound') || ch.includes('outbound') || (dst.length >= 7 && src.length <= 5)) {
        direction = 'outbound';
      } else if (ch.includes('trunk')) {
        direction = 'inbound';
      }

      const recordData = {
        org_id: orgId,
        call_id: UniqueID,
        channel_id: Channel || '',
        from_number: Source || '',
        to_number: Destination || '',
        caller_id_name: CallerID || '',
        direction,
        status,
        duration,
        started_at: new Date(Date.now() - (totalDuration * 1000)),
        answered_at: duration > 0 ? new Date(Date.now() - (duration * 1000)) : null,
        ended_at: new Date()
      };

      // Store recording file if present
      if (recordingfile) {
        recordData.recording_file = recordingfile;
        recordData.recording_url = `/api/v1/calls/{id}/recording`;
      }

      const CallRecord = require('../../models').CallRecord;
      const [callRecord, created] = await CallRecord.findOrCreate({
        where: { call_id: recordData.call_id, org_id: recordData.org_id },
        defaults: recordData
      });
      if (!created) {
        await callRecord.update({
          status: recordData.status,
          duration: recordData.duration,
          ended_at: recordData.ended_at,
          recording_file: recordData.recording_file || callRecord.recording_file
        });
      }

      // Update recording_url with actual call ID
      if (recordingfile) {
        await callRecord.update({ recording_url: `/api/v1/calls/${callRecord.id}/recording` });
      }

      console.log(`📝 CDR saved: ${Source} -> ${Destination} (${Disposition}, ${duration}s, ${direction})${recordingfile ? ' [recorded]' : ''}`);

      // Emit for webhook notifications
      this.emit('callEnded', {
        orgId,
        from: Source,
        to: Destination,
        status,
        duration,
        disposition: Disposition,
        event
      });

      // Auto-ticket: POST inbound CDR to bot-bridge for ticket classification (fire-and-forget)
      if (direction === 'inbound') {
        const axios = require('axios');
        const autoTicketUrl = process.env.AUTO_TICKET_URL || 'https://events.astradial.com';
        axios.post(`${autoTicketUrl}/auto-ticket/${orgId}`, {
          call_id: UniqueID,
          from_number: Source,
          to_number: Destination,
          direction,
          disposition: Disposition,
          duration,
          total_duration: totalDuration,
          channel: Channel,
          destination_channel: DestinationChannel || '',
          destination_context: DestinationContext || '',
          recording_file: recordingfile || '',
          timestamp: new Date().toISOString(),
        }).catch(err => console.error('Auto-ticket POST failed:', err.message));
      }

    } catch (error) {
      console.error('Error handling CDR event:', error.message);
    }
  }

  /**
   * Handle PeerStatus events (user registration/unregistration)
   */
  async handlePeerStatusEvent(event) {
    const { Peer, PeerStatus, ChannelType } = event;

    if (ChannelType !== 'PJSIP') return;

    // Extract extension from peer name (e.g., "PJSIP/2001" -> "2001")
    const extension = Peer?.split('/')[1];
    if (!extension) return;

    // TODO: Look up user by extension to get org_id
    // For now, emit event that can be caught by application
    if (PeerStatus === 'Registered' || PeerStatus === 'Reachable') {
      this.emit('userRegistered', { extension, peer: Peer, event });

      // Note: Would need org_id and user data to trigger webhook
      // This would require looking up the user in the database
    } else if (PeerStatus === 'Unregistered' || PeerStatus === 'Unreachable') {
      this.emit('userUnregistered', { extension, peer: Peer, event, reason: PeerStatus });
    }
  }

  /**
   * Handle trunk registration events
   */
  async handleRegistryEvent(event) {
    const { Domain, Status, Username } = event;

    if (Status === 'Registered') {
      this.emit('trunkRegistered', { domain: Domain, username: Username, event });

      // Note: Would need to look up trunk by domain to get org_id for webhook
    } else if (Status === 'Rejected' || Status === 'Failed') {
      this.emit('trunkFailed', { domain: Domain, username: Username, reason: Status, event });
    }
  }

  /**
   * Handle queue member status events
   */
  async handleQueueMemberEvent(event) {
    const { Queue, MemberName, Status, Paused } = event;

    this.emit('queueMemberStatus', {
      queue: Queue,
      member: MemberName,
      status: Status,
      paused: Paused === '1',
      event
    });
  }

  /**
   * Handle caller joining queue
   */
  async handleQueueCallerJoinEvent(event) {
    const { Queue, Position, CallerIDNum, Count } = event;

    this.emit('queueCallerJoin', {
      queue: Queue,
      position: parseInt(Position),
      callerNumber: CallerIDNum,
      queueSize: parseInt(Count),
      event
    });

    // Note: Would need to look up queue by name to get org_id for webhook
  }

  /**
   * Handle caller abandoning queue
   */
  async handleQueueCallerAbandonEvent(event) {
    const { Queue, Position, CallerIDNum, HoldTime } = event;

    this.emit('queueCallerAbandon', {
      queue: Queue,
      position: parseInt(Position),
      callerNumber: CallerIDNum,
      holdTime: parseInt(HoldTime),
      event
    });
  }

  /**
   * Handle agent answering queue call
   */
  async handleAgentConnectEvent(event) {
    const { Queue, MemberName, CallerIDNum, HoldTime } = event;

    this.emit('agentConnect', {
      queue: Queue,
      member: MemberName,
      callerNumber: CallerIDNum,
      holdTime: parseInt(HoldTime),
      event
    });
  }
}

module.exports = AsteriskManager;