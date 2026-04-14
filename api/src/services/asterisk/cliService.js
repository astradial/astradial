const { exec } = require('child_process');
const { promisify } = require('util');

class AsteriskCLIService {
  constructor() {
    this.execAsync = promisify(exec);
  }

  /**
   * Execute an Asterisk CLI command
   * @param {string} command - The CLI command to execute
   * @param {object} options - Command options
   */
  async executeCommand(command, options = {}) {
    try {
      const timeout = options.timeout || 10000; // 10 seconds default
      const fullCommand = `asterisk -rx "${command}"`;

      console.log(`🔧 Executing Asterisk CLI: ${command}`);

      const { stdout, stderr } = await this.execAsync(fullCommand, { timeout });

      return {
        success: true,
        command: command,
        output: stdout.trim(),
        error: stderr.trim() || null,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`❌ Asterisk CLI command failed: ${command}`, error);
      return {
        success: false,
        command: command,
        output: null,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get Asterisk version information
   */
  async getVersion() {
    return await this.executeCommand('core show version');
  }

  /**
   * Get Asterisk uptime
   */
  async getUptime() {
    return await this.executeCommand('core show uptime');
  }

  /**
   * Show all PJSIP endpoints
   */
  async showPJSIPEndpoints() {
    return await this.executeCommand('pjsip show endpoints');
  }

  /**
   * Show specific PJSIP endpoint
   * @param {string} endpoint - Endpoint name
   */
  async showPJSIPEndpoint(endpoint) {
    return await this.executeCommand(`pjsip show endpoint ${endpoint}`);
  }

  /**
   * Show PJSIP registrations
   */
  async showPJSIPRegistrations() {
    return await this.executeCommand('pjsip show registrations');
  }

  /**
   * Show all queues
   */
  async showQueues() {
    return await this.executeCommand('queue show');
  }

  /**
   * Show specific queue
   * @param {string} queueName - Queue name
   */
  async showQueue(queueName) {
    return await this.executeCommand(`queue show ${queueName}`);
  }

  /**
   * Show active calls
   */
  async showCalls() {
    return await this.executeCommand('core show calls');
  }

  /**
   * Show channels
   */
  async showChannels() {
    return await this.executeCommand('core show channels');
  }

  /**
   * Show dialplan for context
   * @param {string} context - Dialplan context
   */
  async showDialplan(context = null) {
    if (context) {
      return await this.executeCommand(`dialplan show ${context}`);
    }
    return await this.executeCommand('dialplan show');
  }

  /**
   * Show loaded modules
   */
  async showModules() {
    return await this.executeCommand('module show');
  }

  /**
   * Show specific module
   * @param {string} module - Module name
   */
  async showModule(module) {
    return await this.executeCommand(`module show like ${module}`);
  }

  /**
   * Reload configuration
   */
  async reloadConfig() {
    return await this.executeCommand('core reload');
  }

  /**
   * Reload PJSIP configuration
   */
  async reloadPJSIP() {
    return await this.executeCommand('module reload res_pjsip.so');
  }

  /**
   * Reload dialplan
   */
  async reloadDialplan() {
    return await this.executeCommand('dialplan reload');
  }

  /**
   * Reload queues
   */
  async reloadQueues() {
    return await this.executeCommand('module reload app_queue.so');
  }

  /**
   * Originate a call
   * @param {string} channel - Channel to call
   * @param {string} context - Dialplan context
   * @param {string} extension - Extension to call
   * @param {number} priority - Priority (default: 1)
   */
  async originateCall(channel, context, extension, priority = 1) {
    const command = `channel originate ${channel} extension ${extension}@${context}:${priority}`;
    return await this.executeCommand(command);
  }

  /**
   * Hangup a channel
   * @param {string} channel - Channel to hangup
   */
  async hangupChannel(channel) {
    return await this.executeCommand(`channel request hangup ${channel}`);
  }

  /**
   * Add member to queue
   * @param {string} queueName - Queue name
   * @param {string} member - Member to add (e.g., PJSIP/1001)
   */
  async addQueueMember(queueName, member) {
    return await this.executeCommand(`queue add member ${member} to ${queueName}`);
  }

  /**
   * Remove member from queue
   * @param {string} queueName - Queue name
   * @param {string} member - Member to remove
   */
  async removeQueueMember(queueName, member) {
    return await this.executeCommand(`queue remove member ${member} from ${queueName}`);
  }

  /**
   * Pause queue member
   * @param {string} queueName - Queue name
   * @param {string} member - Member to pause
   * @param {string} reason - Reason for pause (optional)
   */
  async pauseQueueMember(queueName, member, reason = null) {
    let command = `queue pause member ${member} queue ${queueName}`;
    if (reason) {
      command += ` reason ${reason}`;
    }
    return await this.executeCommand(command);
  }

  /**
   * Unpause queue member
   * @param {string} queueName - Queue name
   * @param {string} member - Member to unpause
   */
  async unpauseQueueMember(queueName, member) {
    return await this.executeCommand(`queue unpause member ${member} queue ${queueName}`);
  }

  /**
   * Show voicemail users
   */
  async showVoicemailUsers() {
    return await this.executeCommand('voicemail show users');
  }

  /**
   * Check dialplan extension
   * @param {string} extension - Extension to check
   * @param {string} context - Context to check in
   */
  async checkDialplanExtension(extension, context) {
    return await this.executeCommand(`dialplan show ${extension}@${context}`);
  }

  /**
   * Show system information
   */
  async showSystemInfo() {
    const commands = [
      'core show version',
      'core show uptime',
      'core show calls',
      'core show channels',
      'module show like res_pjsip',
      'pjsip show endpoints',
      'queue show'
    ];

    const results = {};
    for (const command of commands) {
      try {
        const result = await this.executeCommand(command);
        const key = command.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        results[key] = result;
      } catch (error) {
        console.error(`Failed to execute ${command}:`, error);
      }
    }

    return {
      success: true,
      timestamp: new Date().toISOString(),
      system_info: results
    };
  }

  /**
   * Test connectivity to Asterisk
   */
  async testConnection() {
    try {
      const result = await this.executeCommand('core ping', { timeout: 5000 });
      return {
        success: result.success,
        connected: result.success && result.output.includes('Pong'),
        timestamp: new Date().toISOString(),
        details: result
      };
    } catch (error) {
      return {
        success: false,
        connected: false,
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }

  /**
   * Execute custom command with validation
   * @param {string} command - Command to execute
   * @param {object} options - Options
   */
  async executeCustomCommand(command, options = {}) {
    // Validate command for security
    if (!this.isCommandSafe(command)) {
      return {
        success: false,
        error: 'Command contains potentially dangerous characters',
        timestamp: new Date().toISOString()
      };
    }

    return await this.executeCommand(command, options);
  }

  /**
   * Check if command is safe to execute
   * @param {string} command - Command to validate
   */
  isCommandSafe(command) {
    // Block potentially dangerous characters and commands
    const dangerousPatterns = [
      /[;&|`$()]/,  // Shell metacharacters
      /\.\./,       // Directory traversal
      /rm\s/,       // rm command
      /del\s/,      // del command
      /format/,     // format command
      /shutdown/,   // shutdown
      /reboot/,     // reboot
      /halt/,       // halt
      /passwd/,     // passwd
      /su\s/,       // su command
      /sudo\s/      // sudo command
    ];

    return !dangerousPatterns.some(pattern => pattern.test(command.toLowerCase()));
  }

  /**
   * Get organization-specific information
   * @param {string} orgPrefix - Organization prefix (e.g., 'testorg')
   */
  async getOrganizationInfo(orgPrefix) {
    try {
      const [endpoints, queues, dialplans] = await Promise.all([
        this.executeCommand(`pjsip show endpoints like ${orgPrefix}`),
        this.executeCommand(`queue show like ${orgPrefix}`),
        this.executeCommand(`dialplan show ${orgPrefix}_internal`)
      ]);

      return {
        success: true,
        organization: orgPrefix,
        timestamp: new Date().toISOString(),
        endpoints: endpoints,
        queues: queues,
        dialplans: dialplans
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Monitor real-time events (simplified version)
   */
  async getRealtimeStatus() {
    try {
      const [calls, channels, endpoints] = await Promise.all([
        this.executeCommand('core show calls'),
        this.executeCommand('core show channels concise'),
        this.executeCommand('pjsip show endpoints')
      ]);

      // Parse the outputs to extract useful information
      const callCount = this.parseCallCount(calls.output);
      const channelInfo = this.parseChannelInfo(channels.output);
      const endpointStatus = this.parseEndpointStatus(endpoints.output);

      return {
        success: true,
        timestamp: new Date().toISOString(),
        realtime_status: {
          active_calls: callCount,
          channels: channelInfo,
          endpoints: endpointStatus
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Parse call count from output
   */
  parseCallCount(output) {
    const match = output.match(/(\d+)\s+active\s+call/i);
    return match ? parseInt(match[1]) : 0;
  }

  /**
   * Parse channel information
   */
  parseChannelInfo(output) {
    const lines = output.split('\n').filter(line => line.trim());
    return {
      total_channels: lines.length,
      channel_types: this.extractChannelTypes(lines)
    };
  }

  /**
   * Parse endpoint status
   */
  parseEndpointStatus(output) {
    const lines = output.split('\n').filter(line => line.includes('Endpoint:'));
    const online = lines.filter(line => line.includes('Online')).length;
    const offline = lines.filter(line => line.includes('Offline')).length;

    return {
      total_endpoints: lines.length,
      online: online,
      offline: offline
    };
  }

  /**
   * Extract channel types from channel list
   */
  extractChannelTypes(lines) {
    const types = {};
    lines.forEach(line => {
      const parts = line.split('!');
      if (parts.length > 0) {
        const channel = parts[0];
        const type = channel.split('/')[0] || 'Unknown';
        types[type] = (types[type] || 0) + 1;
      }
    });
    return types;
  }
}

module.exports = AsteriskCLIService;