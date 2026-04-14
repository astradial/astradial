const fs = require('fs').promises;
const { Queue, QueueMember, User, Organization } = require('../../models');

class QueueService {
  constructor() {
    this.configPath = process.env.ASTERISK_QUEUE_CONFIG_PATH || '/etc/asterisk/queues.conf';
    this.reloadCommand = process.env.ASTERISK_QUEUE_RELOAD_COMMAND || 'asterisk -rx "queue reload all"';
  }

  async generateQueueConfiguration(orgId) {
    try {
      console.log(`📞 Generating queue configuration for org: ${orgId}`);

      const org = await Organization.findByPk(orgId, {
        include: [{
          model: Queue,
          as: 'queues',
          where: { status: 'active' },
          required: false,
          include: [{
            model: QueueMember,
            as: 'members',
            include: [{ model: User, as: 'user' }]
          }]
        }]
      });

      if (!org) {
        throw new Error(`Organization ${orgId} not found`);
      }

      let config = `; Queue configuration for ${org.name} (${org.id})\n`;
      config += `; Generated at: ${new Date().toISOString()}\n\n`;

      for (const queue of org.queues || []) {
        config += this.generateSingleQueueConfig(queue, org);
      }

      return config;

    } catch (error) {
      console.error('❌ Error generating queue configuration:', error);
      throw error;
    }
  }

  generateSingleQueueConfig(queue, org) {
    let config = `; Queue: ${queue.name} (${queue.number})\n`;
    config += `[${queue.asterisk_queue_name}]\n`;

    // Basic queue settings
    config += `strategy=${queue.strategy}\n`;
    config += `timeout=${queue.timeout}\n`;
    config += `weight=${queue.weight || 0}\n`;
    config += `maxlen=${queue.max_callers || 0}\n`;

    // Retry settings
    config += `retry=${queue.retry || 5}\n`;

    // Music and announcements
    config += `musicclass=${queue.music_on_hold}\n`;
    config += `musiconhold=${queue.music_on_hold}\n`;
    if (queue.ring_sound) {
      config += `announce=${queue.ring_sound}\n`;
    }

    // Announcement frequency and settings
    if (queue.announce_frequency > 0) {
      config += `announce-frequency=${queue.announce_frequency}\n`;
    }
    config += `announce-holdtime=${queue.announce_holdtime ? 'yes' : 'no'}\n`;

    // Position announcements
    if (queue.announce_position) {
      config += `announce-position=${queue.announce_position}\n`;
      if (queue.announce_position === 'limit' && queue.announce_position_limit) {
        config += `announce-position-limit=${queue.announce_position_limit}\n`;
      }
    }

    if (queue.announce_round_seconds > 0) {
      config += `announce-round-seconds=${queue.announce_round_seconds}\n`;
    }

    // Custom announcement prompts
    if (queue.queue_youarenext) config += `queue-youarenext=${queue.queue_youarenext}\n`;
    if (queue.queue_thereare) config += `queue-thereare=${queue.queue_thereare}\n`;
    if (queue.queue_callswaiting) config += `queue-callswaiting=${queue.queue_callswaiting}\n`;
    if (queue.queue_holdtime) config += `queue-holdtime=${queue.queue_holdtime}\n`;
    if (queue.queue_minutes) config += `queue-minutes=${queue.queue_minutes}\n`;
    if (queue.queue_seconds) config += `queue-seconds=${queue.queue_seconds}\n`;
    if (queue.queue_thankyou) config += `queue-thankyou=${queue.queue_thankyou}\n`;
    if (queue.queue_reporthold) config += `queue-reporthold=${queue.queue_reporthold}\n`;

    // Periodic announcements
    if (queue.periodic_announce) {
      config += `periodic-announce=${queue.periodic_announce}\n`;
      config += `periodic-announce-frequency=${queue.periodic_announce_frequency || 60}\n`;
    }

    if (queue.min_announce_frequency > 0) {
      config += `min-announce-frequency=${queue.min_announce_frequency}\n`;
    }

    if (queue.relative_periodic_announce) {
      config += `relative-periodic-announce=yes\n`;
    }

    // Queue behavior
    config += `joinempty=${queue.join_empty ? 'yes' : 'no'}\n`;
    config += `leavewhenempty=${queue.leave_when_empty ? 'yes' : 'no'}\n`;
    config += `ringinuse=${queue.ring_inuse ? 'yes' : 'no'}\n`;
    config += `reportholdtime=${queue.reportholdtime !== false ? 'yes' : 'no'}\n`;

    // Member delay
    if (queue.memberdelay > 0) {
      config += `memberdelay=${queue.memberdelay}\n`;
    }

    // Wrap-up time
    if (queue.wrap_up_time > 0) {
      config += `wrapuptime=${queue.wrap_up_time}\n`;
    }

    // Auto-pause settings
    if (queue.autopause && queue.autopause !== 'no') {
      config += `autopause=${queue.autopause}\n`;
    }
    if (queue.autopausedelay > 0) {
      config += `autopausedelay=${queue.autopausedelay}\n`;
    }
    if (queue.autopausebusy) {
      config += `autopausebusy=yes\n`;
    }
    if (queue.autopauseunavail) {
      config += `autopauseunavail=yes\n`;
    }

    // Service level
    if (queue.service_level > 0) {
      config += `servicelevel=${queue.service_level}\n`;
    }

    // Timeout priority
    if (queue.timeoutpriority) {
      config += `timeoutpriority=${queue.timeoutpriority}\n`;
    }

    // Recording
    if (queue.recording_enabled) {
      config += `monitor-format=wav\n`;
      config += `monitor-type=MixMonitor\n`;
    }

    // Context for queue operations
    config += `context=${org.context_prefix}_queue\n`;

    // Queue members
    if (queue.members && queue.members.length > 0) {
      config += `\n; Queue Members\n`;
      queue.members.forEach(member => {
        if (member.user && member.user.status === 'active') {
          const memberString = this.generateQueueMemberString(member, org);
          config += `member => ${memberString}\n`;
        }
      });
    }

    config += `\n`;
    return config;
  }

  generateQueueMemberString(member, org) {
    const user = member.user;
    const endpoint = user.asterisk_endpoint;
    const penalty = member.penalty || 0;
    const memberName = user.full_name || user.username;
    const paused = member.paused ? '1' : '0';
    const ringTarget = user.ring_target || 'ext';

    if (ringTarget === 'phone' && user.phone_number) {
      // Route through extension dialplan so ring_target=phone logic is applied
      // No PJSIP state_interface — SIP endpoint won't be registered for phone users
      const internalContext = `${org.context_prefix}_internal`;
      return `Local/${user.extension}@${internalContext}/n,${penalty},"${memberName}"`;
    }

    if (user.routing_type === 'ai_agent') {
      // AI agent routes through extension dialplan to reach Stasis app
      const internalContext = `${org.context_prefix}_internal`;
      return `Local/${user.extension}@${internalContext}/n,${penalty},"${memberName}"`;
    }

    // Default: ring SIP endpoint directly
    return `PJSIP/${endpoint},${penalty},"${memberName}",PJSIP/${endpoint}`;
  }

  async generateCompleteConfiguration() {
    try {
      console.log('🔧 Generating complete queue configuration...');

      let completeConfig = `; Complete Asterisk Queue Configuration\n`;
      completeConfig += `; Auto-generated by PBX API\n`;
      completeConfig += `; Generated at: ${new Date().toISOString()}\n\n`;

      // Global queue settings
      completeConfig += `[general]\n`;
      completeConfig += `persistentmembers=yes\n`;
      completeConfig += `autofill=yes\n`;
      completeConfig += `monitor-type=MixMonitor\n`;
      completeConfig += `shared_lastcall=yes\n`;
      completeConfig += `log=yes\n`;
      completeConfig += `\n`;

      // Add queue configurations for all active organizations
      const organizations = await Organization.findAll({
        where: { status: 'active' },
        include: [{
          model: Queue,
          as: 'queues',
          where: { status: 'active' },
          required: false,
          include: [{
            model: QueueMember,
            as: 'members',
            include: [{ model: User, as: 'user' }]
          }]
        }]
      });

      for (const org of organizations) {
        if (org.queues && org.queues.length > 0) {
          completeConfig += `; ===== Organization: ${org.name} =====\n`;

          for (const queue of org.queues) {
            completeConfig += this.generateSingleQueueConfig(queue, org);
          }

          completeConfig += '\n';
        }
      }

      console.log('✅ Complete queue configuration generated');
      return completeConfig;

    } catch (error) {
      console.error('❌ Error generating complete queue configuration:', error);
      throw error;
    }
  }

  async writeConfigurationFile(filePath = null) {
    try {
      const targetPath = filePath || this.configPath;
      const config = await this.generateCompleteConfiguration();

      // Create backup of existing file
      try {
        await this.createBackup(targetPath);
      } catch (backupError) {
        console.warn('⚠️ Could not create backup:', backupError.message);
      }

      // Write new configuration
      await fs.writeFile(targetPath, config, 'utf8');
      console.log(`✅ Queue configuration written to: ${targetPath}`);

      return targetPath;

    } catch (error) {
      console.error('❌ Error writing queue configuration file:', error);
      throw error;
    }
  }

  async createBackup(filePath) {
    try {
      const stats = await fs.stat(filePath);
      if (stats.isFile()) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${filePath}.backup.${timestamp}`;
        await fs.copyFile(filePath, backupPath);
        console.log(`📋 Created backup: ${backupPath}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async reloadAsteriskQueues() {
    try {
      console.log('🔄 Reloading Asterisk queue configuration...');

      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const { stdout, stderr } = await execAsync(this.reloadCommand);

      if (stderr) {
        console.warn('⚠️ Reload warnings:', stderr);
      }

      console.log('✅ Asterisk queue configuration reloaded successfully');
      return { success: true, output: stdout };

    } catch (error) {
      console.error('❌ Error reloading Asterisk queue configuration:', error);
      return { success: false, error: error.message };
    }
  }

  async deployQueueConfiguration(orgId = null) {
    try {
      console.log(`🚀 Deploying queue configuration${orgId ? ` for org ${orgId}` : ' for all organizations'}...`);

      // Generate and write configuration
      await this.writeConfigurationFile();

      // Reload Asterisk queues
      const reloadResult = await this.reloadAsteriskQueues();

      if (!reloadResult.success) {
        throw new Error(`Failed to reload Asterisk queues: ${reloadResult.error}`);
      }

      console.log('✅ Queue configuration deployed successfully');
      return { success: true, message: 'Queue configuration deployed and Asterisk reloaded' };

    } catch (error) {
      console.error('❌ Error deploying queue configuration:', error);
      throw error;
    }
  }

  async addQueueMember(queueId, userId, options = {}) {
    try {
      console.log(`➕ Adding member ${userId} to queue ${queueId}`);

      // Check if member already exists
      const existingMember = await QueueMember.findOne({
        where: { queue_id: queueId, user_id: userId }
      });

      if (existingMember) {
        throw new Error('User is already a member of this queue');
      }

      // Create queue member
      const member = await QueueMember.create({
        queue_id: queueId,
        user_id: userId,
        penalty: options.penalty || 0,
        paused: options.paused || false,
        paused_reason: options.paused_reason || null,
        ring_inuse: options.ring_inuse || false
      });

      // Get queue and user info
      const queue = await Queue.findByPk(queueId);
      const user = await User.findByPk(userId);

      // Add member to Asterisk queue via CLI
      await this.addMemberToAsteriskQueue(queue, user, member);

      // Redeploy configuration to make it persistent
      await this.deployQueueConfiguration(queue.org_id);

      console.log(`✅ Member ${user.username} added to queue ${queue.name}`);
      return member;

    } catch (error) {
      console.error('❌ Error adding queue member:', error);
      throw error;
    }
  }

  async removeMemberFromAsteriskQueue(queue, user) {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const command = `asterisk -rx "queue remove member PJSIP/${user.asterisk_endpoint} from ${queue.asterisk_queue_name}"`;
      await execAsync(command);

      console.log(`🗑️ Removed ${user.username} from Asterisk queue ${queue.name}`);

    } catch (error) {
      console.error('❌ Error removing member from Asterisk queue:', error);
    }
  }

  async addMemberToAsteriskQueue(queue, user, member) {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const command = `asterisk -rx "queue add member PJSIP/${user.asterisk_endpoint} to ${queue.asterisk_queue_name} penalty ${member.penalty}"`;
      await execAsync(command);

      console.log(`➕ Added ${user.username} to Asterisk queue ${queue.name}`);

    } catch (error) {
      console.error('❌ Error adding member to Asterisk queue:', error);
    }
  }

  async removeQueueMember(queueId, userId) {
    try {
      console.log(`🗑️ Removing member ${userId} from queue ${queueId}`);

      const member = await QueueMember.findOne({
        where: { queue_id: queueId, user_id: userId },
        include: [
          { model: Queue, as: 'queue' },
          { model: User, as: 'user' }
        ]
      });

      if (!member) {
        throw new Error('Queue member not found');
      }

      // Remove from Asterisk queue
      await this.removeMemberFromAsteriskQueue(member.queue, member.user);

      // Remove from database
      await member.destroy();

      // Redeploy configuration
      await this.deployQueueConfiguration(member.queue.org_id);

      console.log(`✅ Member ${member.user.username} removed from queue ${member.queue.name}`);
      return { success: true, message: 'Member removed successfully' };

    } catch (error) {
      console.error('❌ Error removing queue member:', error);
      throw error;
    }
  }

  async pauseQueueMember(queueId, userId, reason = 'Manual pause') {
    try {
      console.log(`⏸️ Pausing member ${userId} in queue ${queueId}`);

      const member = await QueueMember.findOne({
        where: { queue_id: queueId, user_id: userId },
        include: [
          { model: Queue, as: 'queue' },
          { model: User, as: 'user' }
        ]
      });

      if (!member) {
        throw new Error('Queue member not found');
      }

      // Update database
      await member.update({
        paused: true,
        paused_reason: reason
      });

      // Pause in Asterisk
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const command = `asterisk -rx "queue pause member PJSIP/${member.user.asterisk_endpoint} queue ${member.queue.asterisk_queue_name} reason ${reason}"`;
      await execAsync(command);

      console.log(`⏸️ Member ${member.user.username} paused in queue ${member.queue.name}`);
      return member;

    } catch (error) {
      console.error('❌ Error pausing queue member:', error);
      throw error;
    }
  }

  async unpauseQueueMember(queueId, userId) {
    try {
      console.log(`▶️ Unpausing member ${userId} in queue ${queueId}`);

      const member = await QueueMember.findOne({
        where: { queue_id: queueId, user_id: userId },
        include: [
          { model: Queue, as: 'queue' },
          { model: User, as: 'user' }
        ]
      });

      if (!member) {
        throw new Error('Queue member not found');
      }

      // Update database
      await member.update({
        paused: false,
        paused_reason: null
      });

      // Unpause in Asterisk
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const command = `asterisk -rx "queue unpause member PJSIP/${member.user.asterisk_endpoint} queue ${member.queue.asterisk_queue_name}"`;
      await execAsync(command);

      console.log(`▶️ Member ${member.user.username} unpaused in queue ${member.queue.name}`);
      return member;

    } catch (error) {
      console.error('❌ Error unpausing queue member:', error);
      throw error;
    }
  }

  async getQueueStatus(queueId) {
    try {
      const queue = await Queue.findByPk(queueId, {
        include: [{
          model: QueueMember,
          as: 'members',
          include: [{ model: User, as: 'user' }]
        }]
      });

      if (!queue) {
        throw new Error('Queue not found');
      }

      // Get real-time queue status from Asterisk
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const command = `asterisk -rx "queue show ${queue.asterisk_queue_name}"`;
      const { stdout } = await execAsync(command);

      // Parse queue statistics
      const stats = this.parseQueueStats(stdout);

      return {
        queue: {
          id: queue.id,
          name: queue.name,
          number: queue.number,
          strategy: queue.strategy,
          status: queue.status
        },
        members: queue.members.map(member => ({
          id: member.id,
          user: {
            id: member.user.id,
            username: member.user.username,
            full_name: member.user.full_name,
            extension: member.user.extension
          },
          penalty: member.penalty,
          paused: member.paused,
          paused_reason: member.paused_reason
        })),
        statistics: stats,
        asterisk_output: stdout
      };

    } catch (error) {
      console.error('❌ Error getting queue status:', error);
      throw error;
    }
  }

  parseQueueStats(output) {
    const stats = {
      calls_completed: 0,
      calls_abandoned: 0,
      calls_in_queue: 0,
      average_hold_time: 0,
      service_level: 0,
      members_available: 0,
      members_busy: 0,
      members_unavailable: 0
    };

    // Basic parsing - could be enhanced with regex patterns
    const lines = output.split('\n');

    lines.forEach(line => {
      if (line.includes('Completed:')) {
        const match = line.match(/Completed:\s*(\d+)/);
        if (match) stats.calls_completed = parseInt(match[1]);
      }
      if (line.includes('Abandoned:')) {
        const match = line.match(/Abandoned:\s*(\d+)/);
        if (match) stats.calls_abandoned = parseInt(match[1]);
      }
      if (line.includes('Calls:')) {
        const match = line.match(/Calls:\s*(\d+)/);
        if (match) stats.calls_in_queue = parseInt(match[1]);
      }
      if (line.includes('Holdtime:')) {
        const match = line.match(/Holdtime:\s*(\d+)/);
        if (match) stats.average_hold_time = parseInt(match[1]);
      }
    });

    return stats;
  }

  async getOrganizationQueueSummary(orgId) {
    try {
      const queues = await Queue.findAll({
        where: { org_id: orgId },
        include: [{
          model: QueueMember,
          as: 'members',
          include: [{ model: User, as: 'user' }]
        }]
      });

      const summary = {
        organization_id: orgId,
        total_queues: queues.length,
        active_queues: queues.filter(q => q.status === 'active').length,
        total_members: queues.reduce((acc, q) => acc + q.members.length, 0),
        active_members: queues.reduce((acc, q) =>
          acc + q.members.filter(m => !m.paused && m.user.status === 'active').length, 0
        ),
        queues: queues.map(queue => ({
          id: queue.id,
          name: queue.name,
          number: queue.number,
          strategy: queue.strategy,
          status: queue.status,
          member_count: queue.members.length,
          active_members: queue.members.filter(m => !m.paused && m.user.status === 'active').length
        }))
      };

      return summary;

    } catch (error) {
      console.error('❌ Error getting organization queue summary:', error);
      throw error;
    }
  }
}

module.exports = QueueService;