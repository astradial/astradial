const fs = require('fs').promises;
const path = require('path');
const { SipTrunk, Organization } = require('../../models');

class SipTrunkService {
  constructor() {
    this.configPath = process.env.ASTERISK_PJSIP_CONFIG_PATH || '/etc/asterisk/pjsip_trunks.conf';
    this.reloadCommand = process.env.ASTERISK_RELOAD_COMMAND || 'asterisk -rx "module reload res_pjsip.so"';
  }

  async generateTrunkConfiguration(orgId) {
    try {
      console.log(`🚀 Generating SIP trunk configuration for org: ${orgId}`);

      const org = await Organization.findByPk(orgId, {
        include: [{ model: SipTrunk, as: 'trunks', where: { status: 'active' }, required: false }]
      });

      if (!org) {
        throw new Error(`Organization ${orgId} not found`);
      }

      let config = `; SIP Trunks for ${org.name} (${org.id})\n`;
      config += `; Generated at: ${new Date().toISOString()}\n\n`;

      for (const trunk of org.trunks) {
        config += this.generateSingleTrunkConfig(trunk, org);
      }

      return config;

    } catch (error) {
      console.error('❌ Error generating trunk configuration:', error);
      throw error;
    }
  }

  generateSingleTrunkConfig(trunk, org) {
    const peerName = trunk.asterisk_peer_name;
    const context = `${org.context_prefix}_incoming`;
    const trunkType = trunk.trunk_type || 'outbound';

    // For inbound trunks, use the peer name as the username for proper endpoint matching
    // This ensures multi-tenant isolation like user endpoints (e.g., org_prefix__1001)
    const authUsername = trunkType === 'inbound' ? peerName : (trunk.username || peerName);

    let config = `; Trunk: ${trunk.name}`;
    if (trunk.host) {
      config += ` - ${trunk.host}`;
    }
    config += ` (Type: ${trunkType})\n`;

    if (trunkType === 'inbound') {
      config += `; Remote provider REGISTERS TO our server (dynamic registration)\n`;
      config += `; SIP Username (for registration): ${authUsername}\n`;
      config += `; Password: ${trunk.password}\n`;
    } else if (trunkType === 'outbound') {
      config += `; We REGISTER TO remote provider\n`;
      config += `; Server: ${trunk.host}:${trunk.port}\n`;
    } else if (trunkType === 'peer2peer') {
      config += `; No registration - SIP OPTIONS keepalive only\n`;
      config += `; Peer: ${trunk.host}:${trunk.port}\n`;
    }

    // Endpoint configuration
    config += `[${peerName}]\n`;
    config += `type=endpoint\n`;
    config += `context=${context}\n`;
    config += `disallow=all\n`;
    config += `allow=ulaw,alaw,g722,g729,opus\n`;
    config += `dtmf_mode=rfc4733\n`;
    config += `media_encryption=no\n`;
    config += `force_rport=yes\n`;
    config += `rewrite_contact=yes\n`;
    config += `rtp_symmetric=yes\n`;
    config += `send_rpid=yes\n`;
    config += `trust_id_inbound=yes\n`;
    config += `trust_id_outbound=yes\n`;
    config += `set_var=GROUP()=${org.id}_calls\n`;

    // Transport
    config += `transport=transport-${trunk.transport}\n`;

    // Authentication order: username/auth_username only (no IP matching).
    // IP-based inbound matching is handled by the system-level tata_gateway
    // endpoint. Per-org trunks are for OUTBOUND dialing — they should NOT
    // create identify rules that collide with tata_gateway's IP match.
    config += `identify_by=username,auth_username\n`;

    // Allow OPTIONS without authentication (for keepalive/health checks)
    config += `allow_unauthenticated_options=yes\n`;

    // Type-specific configuration
    if (trunkType === 'inbound') {
      // Inbound - Remote provider registers TO us
      // No auth= on endpoint - they authenticate during registration, not on incoming calls
      config += `aors=${peerName}\n`;  // Use simple name for AoR registration
    } else if (trunkType === 'outbound') {
      // Outbound - We register TO the provider, we provide credentials
      if (trunk.username && trunk.password) {
        config += `outbound_auth=${peerName}_auth\n`;
      }
      config += `aors=${peerName}_aor\n`;
    } else if (trunkType === 'peer2peer') {
      // Peer2peer - No registration, SIP OPTIONS for keepalive
      config += `aors=${peerName}_aor\n`;
    }

    // Custom configuration from database
    if (trunk.configuration && typeof trunk.configuration === 'object' && Object.keys(trunk.configuration).length > 0) {
      Object.entries(trunk.configuration).forEach(([key, value]) => {
        config += `${key}=${value}\n`;
      });
    }

    config += `\n`;

    // AOR configuration
    if (trunkType === 'inbound') {
      // For inbound, use the peer name directly (not _aor suffix) so registration works
      config += `[${peerName}]\n`;
      config += `type=aor\n`;
      config += `max_contacts=1\n`;
      config += `qualify_frequency=30\n`;  // Keep NAT hole open with OPTIONS every 30 seconds
      config += `qualify_timeout=3.0\n`;
      config += `remove_existing=yes\n`;
      config += `support_path=yes\n`;  // Support Path header for proper routing
    } else {
      config += `[${peerName}_aor]\n`;
      config += `type=aor\n`;
    }

    if (trunkType === 'outbound') {
      // For outbound, registration will provide the contact
      config += `max_contacts=1\n`;
      config += `remove_existing=yes\n`;
      config += `qualify_frequency=0\n`;  // Don't qualify - we use registration
    } else if (trunkType === 'peer2peer') {
      // For peer2peer, set static contact and enable OPTIONS keepalive
      config += `contact=sip:${trunk.host}:${trunk.port}\n`;
      config += `qualify_frequency=60\n`;  // Send OPTIONS every 60 seconds
      config += `qualify_timeout=3.0\n`;
      config += `max_contacts=1\n`;
      config += `remove_existing=yes\n`;
    }

    config += `\n`;

    // Authentication configuration
    if (trunk.username && trunk.password) {
      // For inbound trunks, use the peer name as username for multi-tenant isolation
      // This matches the pattern used by user endpoints
      config += `[${peerName}_auth]\n`;
      config += `type=auth\n`;
      config += `auth_type=userpass\n`;
      config += `username=${authUsername}\n`;
      config += `password=${trunk.password}\n`;
      config += `\n`;
    }

    // Registration configuration (only for OUTBOUND type - we register to them)
    if (trunkType === 'outbound' && trunk.username && trunk.password) {
      const contactUser = trunk.contact_user || trunk.username;
      const retryInterval = trunk.retry_interval || 60;
      const expiration = trunk.expiration || 3600;

      config += `[${peerName}_reg]\n`;
      config += `type=registration\n`;
      config += `transport=transport-${trunk.transport}\n`;
      config += `outbound_auth=${peerName}_auth\n`;
      config += `server_uri=sip:${trunk.host}:${trunk.port}\n`;
      config += `client_uri=sip:${trunk.username}@${trunk.host}\n`;
      config += `contact_user=${contactUser}\n`;
      config += `retry_interval=${retryInterval}\n`;
      config += `forbidden_retry_interval=600\n`;
      config += `expiration=${expiration}\n`;
      config += `\n`;
    }

    // Identify configuration — DISABLED for per-org trunks.
    // The system-level tata_gateway endpoint handles all inbound IP
    // matching from the gateway tunnel. Per-org
    // trunks adding their own identify rules with a matching gateway IP
    // would collide and steal inbound Tata calls, routing them into
    // the wrong org context. This was a recurring prod bug.
    //
    // If a future use case needs per-org IP matching (e.g., a client
    // with their own SIP trunk on a unique IP), add it as an explicit
    // opt-in setting on the trunk, not a default for all peer2peer.

    return config;
  }

  async generateTransportConfiguration() {
    let config = `; Transport configurations\n`;
    config += `; Generated at: ${new Date().toISOString()}\n\n`;

    // UDP Transport
    config += `[transport-udp]\n`;
    config += `type=transport\n`;
    config += `protocol=udp\n`;
    config += `bind=0.0.0.0:5060\n`;
    config += `external_media_address=${process.env.ASTERISK_EXTERNAL_IP || '127.0.0.1'}\n`;
    config += `external_signaling_address=${process.env.ASTERISK_EXTERNAL_IP || '127.0.0.1'}\n`;
    config += `local_net=${process.env.ASTERISK_LOCAL_NET || '192.168.0.0/16'}\n`;
    config += `local_net=10.0.0.0/8\n`;
    config += `local_net=172.16.0.0/12\n`;
    config += `\n`;

    // TCP Transport
    config += `[transport-tcp]\n`;
    config += `type=transport\n`;
    config += `protocol=tcp\n`;
    config += `bind=0.0.0.0:5060\n`;
    config += `external_media_address=${process.env.ASTERISK_EXTERNAL_IP || '127.0.0.1'}\n`;
    config += `external_signaling_address=${process.env.ASTERISK_EXTERNAL_IP || '127.0.0.1'}\n`;
    config += `local_net=${process.env.ASTERISK_LOCAL_NET || '192.168.0.0/16'}\n`;
    config += `local_net=10.0.0.0/8\n`;
    config += `local_net=172.16.0.0/12\n`;
    config += `\n`;

    // TLS Transport
    config += `[transport-tls]\n`;
    config += `type=transport\n`;
    config += `protocol=tls\n`;
    config += `bind=0.0.0.0:5061\n`;
    config += `cert_file=/etc/asterisk/keys/asterisk.crt\n`;
    config += `priv_key_file=/etc/asterisk/keys/asterisk.key\n`;
    config += `ca_list_file=/etc/asterisk/keys/ca.crt\n`;
    config += `external_media_address=${process.env.ASTERISK_EXTERNAL_IP || '127.0.0.1'}\n`;
    config += `external_signaling_address=${process.env.ASTERISK_EXTERNAL_IP || '127.0.0.1'}\n`;
    config += `local_net=${process.env.ASTERISK_LOCAL_NET || '192.168.0.0/16'}\n`;
    config += `local_net=10.0.0.0/8\n`;
    config += `local_net=172.16.0.0/12\n`;
    config += `\n`;

    return config;
  }

  async generateCompleteConfiguration() {
    try {
      console.log('🔧 Generating complete SIP trunk configuration...');

      let completeConfig = `; Complete PJSIP Trunk Configuration\n`;
      completeConfig += `; Auto-generated by PBX API\n`;
      completeConfig += `; Generated at: ${new Date().toISOString()}\n\n`;

      // Add transport configuration
      completeConfig += await this.generateTransportConfiguration();

      // Add trunk configurations for all active organizations
      const organizations = await Organization.findAll({
        where: { status: 'active' },
        include: [{
          model: SipTrunk,
          as: 'trunks',
          where: { status: 'active' },
          required: false
        }]
      });

      for (const org of organizations) {
        if (org.trunks && org.trunks.length > 0) {
          completeConfig += `; ===== Organization: ${org.name} =====\n`;

          for (const trunk of org.trunks) {
            completeConfig += this.generateSingleTrunkConfig(trunk, org);
          }

          completeConfig += '\n';
        }
      }

      console.log('✅ Complete SIP trunk configuration generated');
      return completeConfig;

    } catch (error) {
      console.error('❌ Error generating complete configuration:', error);
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
      console.log(`✅ SIP trunk configuration written to: ${targetPath}`);

      return targetPath;

    } catch (error) {
      console.error('❌ Error writing configuration file:', error);
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
      // File doesn't exist, no backup needed
    }
  }

  async reloadAsteriskConfiguration() {
    try {
      console.log('🔄 Reloading Asterisk PJSIP configuration...');

      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const { stdout, stderr } = await execAsync(this.reloadCommand);

      if (stderr) {
        console.warn('⚠️ Reload warnings:', stderr);
      }

      console.log('✅ Asterisk configuration reloaded successfully');
      return { success: true, output: stdout };

    } catch (error) {
      console.error('❌ Error reloading Asterisk configuration:', error);
      return { success: false, error: error.message };
    }
  }

  async deployTrunkConfiguration(orgId = null) {
    try {
      console.log(`🚀 Deploying SIP trunk configuration${orgId ? ` for org ${orgId}` : ' for all organizations'}...`);

      // Generate and write configuration
      await this.writeConfigurationFile();

      // Reload Asterisk
      const reloadResult = await this.reloadAsteriskConfiguration();

      if (!reloadResult.success) {
        throw new Error(`Failed to reload Asterisk: ${reloadResult.error}`);
      }

      console.log('✅ SIP trunk configuration deployed successfully');
      return { success: true, message: 'Configuration deployed and Asterisk reloaded' };

    } catch (error) {
      console.error('❌ Error deploying trunk configuration:', error);
      throw error;
    }
  }

  async addTrunk(trunkData) {
    try {
      console.log(`➕ Adding new SIP trunk: ${trunkData.name}`);

      // Create trunk in database
      const trunk = await SipTrunk.create(trunkData);

      // Regenerate and deploy configuration
      await this.deployTrunkConfiguration(trunkData.org_id);

      console.log(`✅ SIP trunk ${trunk.name} added and deployed`);
      return trunk;

    } catch (error) {
      console.error('❌ Error adding SIP trunk:', error);
      throw error;
    }
  }

  async updateTrunk(trunkId, updateData) {
    try {
      console.log(`✏️ Updating SIP trunk: ${trunkId}`);

      const trunk = await SipTrunk.findByPk(trunkId);
      if (!trunk) {
        throw new Error('Trunk not found');
      }

      const oldPeerName = trunk.asterisk_peer_name;
      await trunk.update(updateData);

      // If peer name changed, we need to clean up old configuration
      if (updateData.asterisk_peer_name && updateData.asterisk_peer_name !== oldPeerName) {
        console.log(`🔄 Peer name changed from ${oldPeerName} to ${updateData.asterisk_peer_name}`);
      }

      // Regenerate and deploy configuration
      await this.deployTrunkConfiguration(trunk.org_id);

      console.log(`✅ SIP trunk ${trunk.name} updated and deployed`);
      return trunk;

    } catch (error) {
      console.error('❌ Error updating SIP trunk:', error);
      throw error;
    }
  }

  async removeTrunk(trunkId) {
    try {
      console.log(`🗑️ Removing SIP trunk: ${trunkId}`);

      const trunk = await SipTrunk.findByPk(trunkId);
      if (!trunk) {
        throw new Error('Trunk not found');
      }

      const orgId = trunk.org_id;
      const trunkName = trunk.name;

      // Delete from database
      await trunk.destroy();

      // Regenerate and deploy configuration (this will exclude the deleted trunk)
      await this.deployTrunkConfiguration(orgId);

      console.log(`✅ SIP trunk ${trunkName} removed and configuration deployed`);
      return { success: true, message: `Trunk ${trunkName} removed successfully` };

    } catch (error) {
      console.error('❌ Error removing SIP trunk:', error);
      throw error;
    }
  }

  async testTrunkConnectivity(trunkId) {
    try {
      console.log(`🔍 Testing connectivity for trunk: ${trunkId}`);

      const trunk = await SipTrunk.findByPk(trunkId);
      if (!trunk) {
        throw new Error('Trunk not found');
      }

      // Use Asterisk CLI to check registration status
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const command = `asterisk -rx "pjsip show registrations like ${trunk.asterisk_peer_name}"`;
      const { stdout } = await execAsync(command);

      // Parse registration status
      const isRegistered = stdout.includes('Registered') || stdout.includes('Auth Sent');

      // Update trunk status
      await trunk.update({
        registration_status: isRegistered ? 'registered' : 'failed',
        last_registration: isRegistered ? new Date() : trunk.last_registration
      });

      console.log(`📊 Trunk ${trunk.name} status: ${isRegistered ? 'registered' : 'failed'}`);

      return {
        trunk_id: trunk.id,
        trunk_name: trunk.name,
        host: trunk.host,
        status: isRegistered ? 'registered' : 'failed',
        last_check: new Date().toISOString(),
        details: stdout
      };

    } catch (error) {
      console.error('❌ Error testing trunk connectivity:', error);
      throw error;
    }
  }

  async getTrunkStatus(orgId) {
    try {
      const trunks = await SipTrunk.findAll({
        where: { org_id: orgId },
        attributes: ['id', 'name', 'host', 'status', 'registration_status', 'last_registration', 'asterisk_peer_name']
      });

      const status = await Promise.all(
        trunks.map(async (trunk) => {
          try {
            const testResult = await this.testTrunkConnectivity(trunk.id);
            return {
              ...trunk.toJSON(),
              connectivity_status: testResult.status,
              last_connectivity_check: testResult.last_check
            };
          } catch (error) {
            return {
              ...trunk.toJSON(),
              connectivity_status: 'error',
              connectivity_error: error.message
            };
          }
        })
      );

      return status;

    } catch (error) {
      console.error('❌ Error getting trunk status:', error);
      throw error;
    }
  }

  async generateTrunkReport(orgId) {
    try {
      const org = await Organization.findByPk(orgId, {
        include: [{ model: SipTrunk, as: 'trunks' }]
      });

      if (!org) {
        throw new Error('Organization not found');
      }

      const trunkStatus = await this.getTrunkStatus(orgId);

      const report = {
        organization: {
          id: org.id,
          name: org.name,
          context_prefix: org.context_prefix
        },
        summary: {
          total_trunks: org.trunks.length,
          active_trunks: org.trunks.filter(t => t.status === 'active').length,
          registered_trunks: trunkStatus.filter(t => t.connectivity_status === 'registered').length,
          failed_trunks: trunkStatus.filter(t => t.connectivity_status === 'failed').length
        },
        trunks: trunkStatus,
        generated_at: new Date().toISOString()
      };

      return report;

    } catch (error) {
      console.error('❌ Error generating trunk report:', error);
      throw error;
    }
  }
}

module.exports = SipTrunkService;