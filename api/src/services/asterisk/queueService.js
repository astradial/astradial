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

    // Basic queue settings.
    // `timeout` here is the **round** budget — the total time Asterisk's
    // queue will spend trying members in one round before declaring the
    // round NO_ANSWER and waiting `retry` seconds to start the next
    // round. It is NOT a per-member cap, despite the wording in some
    // docs and despite a previous incorrect comment in this file.
    // Reproduced 2026-05-15 on Thangavelu Hospital queue 5002: with
    // timeout=60 and Landline's per-member ring=60s, the round budget
    // was fully consumed by Landline alone — Raman (penalty 1) was
    // never tried within any round, calls dropped without reaching the
    // second agent. Setting the round budget to SUM of member ring
    // times + 10s buffer guarantees every active member gets a turn.
    // Each member's actual ring duration is still controlled by their
    // own `Dial(..., ring_timeout_seconds, ...)` inside the qm helper
    // context, so this just removes the round-level guillotine.
    config += `strategy=${queue.strategy}\n`;
    const memberRingTimes = (queue.members || [])
      .filter(m => m.user && m.user.status === 'active')
      .map(m => m.ring_timeout_seconds || 20);
    const sumRingTimes = memberRingTimes.reduce((a, b) => a + b, 0);
    const effectiveTimeout = Math.max(
      Number(queue.timeout) || 20,
      sumRingTimes > 0 ? sumRingTimes + 10 : 0
    );
    config += `timeout=${effectiveTimeout}\n`;
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
    // `ringinuse=no` skips members whose device state is anything other
    // than NOT_INUSE — including UNKNOWN. Members whose dial path is a
    // non-PJSIP target (phone via trunk, ai_agent Stasis, or any user
    // missing asterisk_endpoint) get a `Custom:qm<id>` state_interface
    // that nothing ever publishes, so their devstate sits at UNKNOWN
    // forever and `ringinuse=no` causes app_queue to silently never
    // dial them. (Reproduced 2026-05-15: Thangavelu Hospital queue 5002
    // and AstraPrivate queue 5001 both had members stuck unrungable.)
    // For queues that contain any such member we force `ringinuse=yes`;
    // the per-member Dial() in the qmem helper context handles trunk-
    // busy properly anyway.
    //
    // CRITICAL: this condition must mirror `generateQueueMemberString`'s
    // Custom: emission rule exactly — any user that gets Custom: must
    // force ringinuse=yes for the queue. If you change one, change both.
    const hasCustomStateMember = (queue.members || []).some(m => {
      if (!m.user || m.user.status !== 'active') return false;
      const u = m.user;
      return u.ring_target === 'phone' || u.routing_type === 'ai_agent' || !u.asterisk_endpoint;
    });
    const ringInUse = hasCustomStateMember ? true : !!queue.ring_inuse;
    config += `ringinuse=${ringInUse ? 'yes' : 'no'}\n`;
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

    // Queue members. Write members in penalty-ascending order: for
    // `linear` strategy Asterisk rings members in queues.conf order, so
    // lower penalty = earlier in file = rings first. For other
    // strategies Asterisk uses penalty as a stairstep tier (members
    // with penalty 0 are tried before penalty 1, etc.), so the order
    // here is cosmetic but consistent with the UI's "P0 ranks first"
    // priority display.
    if (queue.members && queue.members.length > 0) {
      const orderedMembers = [...queue.members].sort((a, b) =>
        (a.penalty || 0) - (b.penalty || 0)
      );
      config += `\n; Queue Members\n`;
      orderedMembers.forEach(member => {
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
    // Every queue member routes through its per-queue helper context
    // (generated by dialplanGenerator.generateQueueMemberContext). That
    // context's `qm<member_id>` extension does the actual Dial with the
    // member's per-member `ring_timeout_seconds`. Routing every member
    // through a Local channel makes the per-member-timeout uniform: a
    // softphone member's ring time is honored the same way as a
    // ring_target='phone' member's, with the same control point in the
    // dialplan.
    //
    // state_interface (4th arg of the queues.conf `member =>` line)
    // tells Asterisk which device to monitor for "in-use" / busy state
    // so `ringinuse=no` can skip busy members. Three cases:
    //
    //   - softphone target: use `PJSIP/<endpoint>` so the queue tracks
    //     the device's registration/busy state correctly.
    //   - ring_target='phone' (external dial via trunk): there's no
    //     registered endpoint to monitor. Omitting state_interface
    //     defaults the member to "Invalid" device state and Asterisk
    //     REFUSES to ring Invalid members — calls would silently skip
    //     past phone-target members. Use a Custom: devstate keyed on
    //     the member id; Asterisk treats unset Custom devstates as
    //     NOT_INUSE, so the queue happily rings them.
    //   - AI-agent (Stasis handoff): same problem as phone — no
    //     registered endpoint. Use Custom: devstate same as phone.
    const user = member.user;
    const penalty = member.penalty || 0;
    const memberName = (user.full_name || user.username || 'Unknown').replace(/[",]/g, ' ');
    const memberContext = `${org.context_prefix}_qmem`;
    const memberExten = `qm${member.id.replace(/-/g, '')}`;
    let stateInterface;
    if (user.ring_target !== 'phone' && user.routing_type !== 'ai_agent' && user.asterisk_endpoint) {
      stateInterface = `,PJSIP/${user.asterisk_endpoint}`;
    } else {
      // Custom:qm<id> defaults to NOT_INUSE → queue treats the member
      // as ringable. The member id is unique-per-row so concurrent
      // members never share state.
      stateInterface = `,Custom:${memberExten}`;
    }
    return `Local/${memberExten}@${memberContext}/n,${penalty},"${memberName}"${stateInterface}`;
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

      // Create queue member. `ring_timeout_seconds` lets the caller
      // request a per-member ring duration when the member is added;
      // the model defaults this to 20s when omitted.
      const member = await QueueMember.create({
        queue_id: queueId,
        user_id: userId,
        penalty: options.penalty || 0,
        paused: options.paused || false,
        paused_reason: options.paused_reason || null,
        ring_inuse: options.ring_inuse || false,
        ring_timeout_seconds: Number.isInteger(options.ring_timeout_seconds)
          ? options.ring_timeout_seconds
          : undefined
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

  // Build the Asterisk member-interface string that matches the
  // queues.conf `member =>` line. Single per-org helper context
  // `<context_prefix>_qmem` with `qm<memberIdNoHyphens>` extension.
  // Kept short enough to fit within Asterisk's 80-char
  // AST_CHANNEL_NAME limit (was previously broken by truncation).
  // context_prefix is derived from the queue's asterisk_queue_name
  // formatted as `<context_prefix>_<number>`.
  _memberInterfaceFor(queue, member) {
    const aqn = String(queue.asterisk_queue_name || '');
    const suffix = `_${queue.number}`;
    const contextPrefix = aqn.endsWith(suffix) ? aqn.slice(0, -suffix.length) : aqn;
    const ctx = `${contextPrefix}_qmem`;
    const exten = `qm${member.id.replace(/-/g, '')}`;
    return `Local/${exten}@${ctx}/n`;
  }

  async removeMemberFromAsteriskQueue(queue, user, member) {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      // `member` may be undefined on legacy callers — in that case the
      // full `queue reload all` triggered by deployQueueConfiguration
      // still removes the member when queues.conf is regenerated, so
      // skipping the AMI remove is safe.
      if (!member) {
        console.log(`🗑️ Skipping AMI remove for ${user?.username || '?'} — relying on queue reload`);
        return;
      }
      const memberInterface = this._memberInterfaceFor(queue, member);
      const command = `asterisk -rx "queue remove member ${memberInterface} from ${queue.asterisk_queue_name}"`;
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

      const memberInterface = this._memberInterfaceFor(queue, member);
      const command = `asterisk -rx "queue add member ${memberInterface} to ${queue.asterisk_queue_name} penalty ${member.penalty || 0}"`;
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

      // Remove from Asterisk queue. Passing `member` so the helper can
      // build the new Local-channel interface that matches what
      // queueService.generateQueueMemberString writes to queues.conf.
      await this.removeMemberFromAsteriskQueue(member.queue, member.user, member);

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

      // Queue members are joined as Local/qm<id>@<ctx>/n via the helper
      // context — NOT as PJSIP/<endpoint>. Asterisk's `queue pause member`
      // matches by exact interface string, so passing the PJSIP endpoint
      // silently no-ops (the queue keeps ringing the agent even though
      // the editor shows "paused"). Use the same _memberInterfaceFor()
      // resolver the AMI add/remove paths use to keep both surfaces in
      // lock-step.
      const memberInterface = this._memberInterfaceFor(member.queue, member);
      const command = `asterisk -rx "queue pause member ${memberInterface} queue ${member.queue.asterisk_queue_name} reason ${reason}"`;
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

      // See pauseQueueMember above — must use Local/qm interface, not PJSIP.
      const memberInterface = this._memberInterfaceFor(member.queue, member);
      const command = `asterisk -rx "queue unpause member ${memberInterface} queue ${member.queue.asterisk_queue_name}"`;
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