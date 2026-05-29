const fs = require('fs').promises;
const { User, Organization } = require('../../models');

class UserProvisioningService {
  constructor() {
    this.pjsipConfigPath = process.env.ASTERISK_PJSIP_USERS_CONFIG_PATH || '/etc/asterisk/pjsip_users.conf';
    this.voicemailConfigPath = process.env.ASTERISK_VOICEMAIL_CONFIG_PATH || '/etc/asterisk/voicemail.conf';
    this.reloadCommand = process.env.ASTERISK_USERS_RELOAD_COMMAND || 'asterisk -rx "module reload res_pjsip.so"';
  }

  async generateUserConfiguration(orgId) {
    try {
      console.log(`👤 Generating user configuration for org: ${orgId}`);

      const org = await Organization.findByPk(orgId, {
        include: [{ model: User, as: 'users', where: { status: 'active' }, required: false }]
      });

      if (!org) {
        throw new Error(`Organization ${orgId} not found`);
      }

      let config = `; User/Extension configuration for ${org.name} (${org.id})\n`;
      config += `; Generated at: ${new Date().toISOString()}\n\n`;

      for (const user of org.users || []) {
        config += this.generateSingleUserConfig(user, org);
      }

      return config;

    } catch (error) {
      console.error('❌ Error generating user configuration:', error);
      throw error;
    }
  }

  generateSingleUserConfig(user, org) {
    const endpoint = user.asterisk_endpoint;
    const context = `${org.context_prefix}_internal`;

    let config = `; User: ${user.full_name || user.username} (${user.extension})\n`;

    // Endpoint configuration
    config += `[${endpoint}]\n`;
    config += `type=endpoint\n`;
    config += `context=${context}\n`;
    config += `disallow=all\n`;
    config += `allow=ulaw,alaw,g722\n`;
    config += `auth=${endpoint}_auth\n`;
    config += `aors=${endpoint}\n`;

    // Caller ID and organization mapping
    config += `callerid="${user.full_name || user.username}" <${user.extension}>\n`;
    config += `accountcode=${org.id}\n`;
    config += `set_var=__USER_ID=${user.id}\n`;
    config += `set_var=__ORG_ID=${org.id}\n`;
    config += `set_var=__EXTENSION=${user.extension}\n`;
    config += `set_var=GROUP()=${org.id}_calls\n`;

    // Call features
    config += `direct_media=no\n`;
    config += `trust_id_inbound=yes\n`;
    config += `trust_id_outbound=yes\n`;
    config += `send_rpid=yes\n`;
    config += `send_pai=yes\n`;

    // DTMF
    config += `dtmf_mode=rfc4733\n`;
    config += `rtp_symmetric=yes\n`;
    config += `force_rport=yes\n`;
    config += `rewrite_contact=yes\n`;

    // Call recording
    if (user.call_recording) {
      config += `set_var=MONITOR_EXEC_OPTIONS=m\n`;
      config += `set_var=MONITOR_OPTIONS=b\n`;
    }

    // Pickup groups for agents
    if (user.role === 'agent' || user.role === 'supervisor') {
      config += `call_group=1\n`;
      config += `pickup_group=1\n`;
    }

    // Transport
    config += `transport=transport-udp\n`;

    // Authentication order: username, auth_username, ip
    config += `identify_by=username,auth_username,ip\n`;

    config += `\n`;

    // AOR (Address of Record) configuration
    config += `[${endpoint}]\n`;
    config += `type=aor\n`;
    config += `max_contacts=3\n`;
    config += `remove_existing=yes\n`;
    config += `qualify_frequency=60\n`;
    config += `qualify_timeout=3.0\n`;

    config += `\n`;

    // Authentication configuration
    config += `[${endpoint}_auth]\n`;
    config += `type=auth\n`;
    config += `auth_type=userpass\n`;
    config += `username=${endpoint}\n`;
    config += `password=${user.sip_password}\n`;

    config += `\n`;

    return config;
  }

  async generateVoicemailConfiguration(orgId) {
    try {
      console.log(`📧 Generating voicemail configuration for org: ${orgId}`);

      const org = await Organization.findByPk(orgId, {
        include: [{
          model: User,
          as: 'users',
          where: {
            status: 'active',
            voicemail_enabled: true
          },
          required: false
        }]
      });

      if (!org) {
        throw new Error(`Organization ${orgId} not found`);
      }

      let config = `; Voicemail configuration for ${org.name}\n`;
      config += `[${org.context_prefix}vm]\n`;

      for (const user of org.users || []) {
        if (user.voicemail_enabled) {
          config += this.generateVoicemailEntry(user);
        }
      }

      config += `\n`;
      return config;

    } catch (error) {
      console.error('❌ Error generating voicemail configuration:', error);
      throw error;
    }
  }

  generateVoicemailEntry(user) {
    const name = user.full_name || user.username;
    const email = user.email || '';

    // Format: extension => password,name,email,pager_email,options
    return `${user.extension} => ${user.sip_password},"${name}",${email},,delete=yes|saycid=yes|envelope=yes|attach=yes\n`;
  }

  async generateCompleteUserConfiguration() {
    try {
      console.log('🔧 Generating complete user configuration...');

      let completeConfig = `; Complete PJSIP User Configuration\n`;
      completeConfig += `; Auto-generated by PBX API\n`;
      completeConfig += `; Generated at: ${new Date().toISOString()}\n\n`;

      // Add global settings
      completeConfig += this.generateGlobalSettings();

      // Add user configurations for all active organizations
      const organizations = await Organization.findAll({
        where: { status: 'active' },
        include: [{
          model: User,
          as: 'users',
          where: { status: 'active' },
          required: false
        }]
      });

      for (const org of organizations) {
        if (org.users && org.users.length > 0) {
          completeConfig += `; ===== Organization: ${org.name} =====\n`;

          for (const user of org.users) {
            completeConfig += this.generateSingleUserConfig(user, org);
          }

          completeConfig += '\n';
        }
      }

      console.log('✅ Complete user configuration generated');
      return completeConfig;

    } catch (error) {
      console.error('❌ Error generating complete user configuration:', error);
      throw error;
    }
  }

  generateGlobalSettings() {
    let config = `; Global PJSIP settings for users\n`;
    config += `[global]\n`;
    config += `type=global\n`;
    config += `default_outbound_endpoint=anonymous\n`;
    config += `debug=no\n`;
    config += `keep_alive_interval=90\n`;
    config += `contact_expiration_check_interval=30\n`;
    config += `disable_multi_domain=yes\n`;
    config += `\n`;

    // ACL for internal users
    config += `[default_acl]\n`;
    config += `type=acl\n`;
    config += `permit=192.168.0.0/16\n`;
    config += `permit=10.0.0.0/8\n`;
    config += `permit=172.16.0.0/12\n`;
    config += `permit=127.0.0.1/32\n`;
    config += `deny=0.0.0.0/0\n`;
    config += `\n`;

    return config;
  }

  async generateCompleteVoicemailConfiguration() {
    try {
      console.log('📧 Generating complete voicemail configuration...');

      let completeConfig = `; Complete Voicemail Configuration\n`;
      completeConfig += `; Auto-generated by PBX API\n`;
      completeConfig += `; Generated at: ${new Date().toISOString()}\n\n`;

      // Global voicemail settings
      completeConfig += `[general]\n`;
      completeConfig += `format=wav\n`;
      completeConfig += `attach=yes\n`;
      completeConfig += `attachfmt=wav\n`;
      completeConfig += `serveremail=noreply@pbx.local\n`;
      completeConfig += `sendvoicemail=yes\n`;
      completeConfig += `delete=yes\n`;
      completeConfig += `maxmsg=100\n`;
      completeConfig += `maxsecs=300\n`;
      completeConfig += `minsecs=2\n`;
      completeConfig += `maxgreet=60\n`;
      completeConfig += `skipms=3000\n`;
      completeConfig += `maxsilence=10\n`;
      completeConfig += `silencethreshold=128\n`;
      completeConfig += `maxlogins=3\n`;
      completeConfig += `emaildateformat=%A, %B %d, %Y at %r\n`;
      completeConfig += `emailsubject=[PBX] New voicemail ${user.extension}\n`;
      completeConfig += `emailbody=Dear ${user.full_name},\\n\\nYou have received a new voicemail in mailbox ${user.extension}.\\n\\nDuration: \${VM_DUR}\\nCaller ID: \${VM_CALLERID}\\nDate: \${VM_DATE}\\n\\nThe voicemail is attached to this email.\\n\\nThank you!\n`;
      completeConfig += `\n`;

      // Add voicemail contexts for each organization
      const organizations = await Organization.findAll({
        where: { status: 'active' },
        include: [{
          model: User,
          as: 'users',
          where: {
            status: 'active',
            voicemail_enabled: true
          },
          required: false
        }]
      });

      for (const org of organizations) {
        if (org.users && org.users.length > 0) {
          completeConfig += `; Organization: ${org.name}\n`;
          completeConfig += `[${org.context_prefix}vm]\n`;

          for (const user of org.users) {
            completeConfig += this.generateVoicemailEntry(user);
          }

          completeConfig += '\n';
        }
      }

      console.log('✅ Complete voicemail configuration generated');
      return completeConfig;

    } catch (error) {
      console.error('❌ Error generating complete voicemail configuration:', error);
      throw error;
    }
  }

  async writeConfigurationFiles() {
    try {
      console.log('📝 Writing user configuration files...');

      // Generate and write PJSIP user configuration
      const pjsipConfig = await this.generateCompleteUserConfiguration();
      await this.createBackup(this.pjsipConfigPath);
      await fs.writeFile(this.pjsipConfigPath, pjsipConfig, 'utf8');
      console.log(`✅ PJSIP user configuration written to: ${this.pjsipConfigPath}`);

      // Generate and write voicemail configuration
      const voicemailConfig = await this.generateCompleteVoicemailConfiguration();
      await this.createBackup(this.voicemailConfigPath);
      await fs.writeFile(this.voicemailConfigPath, voicemailConfig, 'utf8');
      console.log(`✅ Voicemail configuration written to: ${this.voicemailConfigPath}`);

      return {
        pjsip_config: this.pjsipConfigPath,
        voicemail_config: this.voicemailConfigPath
      };

    } catch (error) {
      console.error('❌ Error writing configuration files:', error);
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

  async reloadAsteriskConfiguration() {
    try {
      console.log('🔄 Reloading Asterisk user configuration...');

      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      // Reload PJSIP
      const pjsipReload = await execAsync('asterisk -rx "module reload res_pjsip.so"');

      // Reload voicemail
      const voicemailReload = await execAsync('asterisk -rx "module reload app_voicemail.so"');

      console.log('✅ Asterisk user configuration reloaded successfully');
      return {
        success: true,
        pjsip_output: pjsipReload.stdout,
        voicemail_output: voicemailReload.stdout
      };

    } catch (error) {
      console.error('❌ Error reloading Asterisk user configuration:', error);
      return { success: false, error: error.message };
    }
  }

  async deployUserConfiguration(orgId = null) {
    try {
      console.log(`🚀 Deploying user configuration${orgId ? ` for org ${orgId}` : ' for all organizations'}...`);

      // Generate and write configurations
      await this.writeConfigurationFiles();

      // Reload Asterisk
      const reloadResult = await this.reloadAsteriskConfiguration();

      if (!reloadResult.success) {
        throw new Error(`Failed to reload Asterisk: ${reloadResult.error}`);
      }

      console.log('✅ User configuration deployed successfully');
      return { success: true, message: 'User configuration deployed and Asterisk reloaded' };

    } catch (error) {
      console.error('❌ Error deploying user configuration:', error);
      throw error;
    }
  }

  async provisionUser(userData) {
    try {
      console.log(`➕ Provisioning new user: ${userData.username}`);

      // Create user in database
      const user = await User.create(userData);

      // Redeploy configuration
      await this.deployUserConfiguration(userData.org_id);

      console.log(`✅ User ${user.username} provisioned successfully`);
      return user;

    } catch (error) {
      console.error('❌ Error provisioning user:', error);
      throw error;
    }
  }

  async updateUser(userId, updateData) {
    try {
      console.log(`✏️ Updating user: ${userId}`);

      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      await user.update(updateData);

      // Redeploy configuration
      await this.deployUserConfiguration(user.org_id);

      console.log(`✅ User ${user.username} updated successfully`);
      return user;

    } catch (error) {
      console.error('❌ Error updating user:', error);
      throw error;
    }
  }

  async deprovisionUser(userId) {
    try {
      console.log(`🗑️ Deprovisioning user: ${userId}`);

      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const orgId = user.org_id;
      const username = user.username;

      // Delete from database
      await user.destroy();

      // Redeploy configuration
      await this.deployUserConfiguration(orgId);

      console.log(`✅ User ${username} deprovisioned successfully`);
      return { success: true, message: `User ${username} deprovisioned successfully` };

    } catch (error) {
      console.error('❌ Error deprovisioning user:', error);
      throw error;
    }
  }

  async getUserRegistrationStatus(userId) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check registration status via Asterisk CLI
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const command = `asterisk -rx "pjsip show endpoint ${user.asterisk_endpoint}"`;
      const { stdout } = await execAsync(command);

      // Parse registration status
      const isRegistered = stdout.includes('Contacts:') && !stdout.includes('Not in use');
      const statusMatch = stdout.match(/DeviceState\s*:\s*(\w+)/);
      const deviceState = statusMatch ? statusMatch[1] : 'UNKNOWN';

      // Update user status
      const registrationStatus = isRegistered ? 'registered' : 'unregistered';
      await user.update({ sip_registration_status: registrationStatus });

      return {
        user_id: user.id,
        username: user.username,
        extension: user.extension,
        endpoint: user.asterisk_endpoint,
        registration_status: registrationStatus,
        device_state: deviceState,
        last_check: new Date().toISOString(),
        asterisk_output: stdout
      };

    } catch (error) {
      console.error('❌ Error checking user registration:', error);
      throw error;
    }
  }

  async getOrganizationUserStatus(orgId) {
    try {
      const users = await User.findAll({
        where: { org_id: orgId },
        attributes: ['id', 'username', 'extension', 'full_name', 'status', 'sip_registration_status', 'asterisk_endpoint']
      });

      const status = await Promise.all(
        users.map(async (user) => {
          try {
            const registrationStatus = await this.getUserRegistrationStatus(user.id);
            return {
              ...user.toJSON(),
              current_registration: registrationStatus.registration_status,
              device_state: registrationStatus.device_state,
              last_registration_check: registrationStatus.last_check
            };
          } catch (error) {
            return {
              ...user.toJSON(),
              current_registration: 'error',
              registration_error: error.message
            };
          }
        })
      );

      return status;

    } catch (error) {
      console.error('❌ Error getting organization user status:', error);
      throw error;
    }
  }

  async generateUserReport(orgId) {
    try {
      const org = await Organization.findByPk(orgId, {
        include: [{ model: User, as: 'users' }]
      });

      if (!org) {
        throw new Error('Organization not found');
      }

      const userStatus = await this.getOrganizationUserStatus(orgId);

      const report = {
        organization: {
          id: org.id,
          name: org.name,
          context_prefix: org.context_prefix
        },
        summary: {
          total_users: org.users.length,
          active_users: org.users.filter(u => u.status === 'active').length,
          registered_users: userStatus.filter(u => u.current_registration === 'registered').length,
          voicemail_enabled: org.users.filter(u => u.voicemail_enabled).length,
          recording_enabled: org.users.filter(u => u.call_recording).length
        },
        users: userStatus,
        generated_at: new Date().toISOString()
      };

      return report;

    } catch (error) {
      console.error('❌ Error generating user report:', error);
      throw error;
    }
  }
}

module.exports = UserProvisioningService;