const fs = require('fs').promises;
const path = require('path');
const SipTrunkService = require('./sipTrunkService');
const UserProvisioningService = require('./userProvisioningService');
const QueueService = require('./queueService');
const DialplanGenerator = require('./dialplanGenerator');
const MusicOnHoldService = require('./mohService');
const { DidNumber, Organization } = require('../../models');

class ConfigDeploymentService {
  constructor() {
    this.sipTrunkService = new SipTrunkService();
    this.userProvisioningService = new UserProvisioningService();
    this.queueService = new QueueService();
    this.dialplanGenerator = new DialplanGenerator();
    this.mohService = new MusicOnHoldService();
    this.asteriskConfigPath = '/etc/asterisk';
  }

  /**
   * Deploy complete organization configuration to /etc/asterisk/
   * @param {string} orgId - Organization ID
   * @param {string} orgName - Organization name (for file naming)
   */
  async deployOrganizationConfiguration(orgId, orgName) {
    try {
      console.log(`🚀 Deploying configuration for organization: ${orgName} (${orgId})`);

      // Sanitize org name for file naming
      const sanitizedOrgName = this.sanitizeFileName(orgName);

      // Generate all configurations
      const [pjsipConfig, dialplanConfig, queueConfig] = await Promise.all([
        this.generatePJSIPConfiguration(orgId),
        this.generateDialplanConfiguration(orgId),
        this.generateQueueConfiguration(orgId)
      ]);

      // Write organization-specific configuration files
      const pjsipFilePath = path.join(this.asteriskConfigPath, `pjsip_${sanitizedOrgName}.conf`);
      const dialplanFilePath = path.join(this.asteriskConfigPath, `ext_${sanitizedOrgName}.conf`);
      const queueFilePath = path.join(this.asteriskConfigPath, `queues_${sanitizedOrgName}.conf`);

      await Promise.all([
        this.writeConfigFile(pjsipFilePath, pjsipConfig),
        this.writeConfigFile(dialplanFilePath, dialplanConfig),
        this.writeConfigFile(queueFilePath, queueConfig)
      ]);

      // Update main configuration files with includes
      await this.ensureIncludesInMainConfigs(sanitizedOrgName);

      // Deploy gateway inbound routing (Tata DID → org mapping)
      try {
        await this.deployGatewayRouting();
      } catch (gwError) {
        console.warn('⚠️  Warning: Failed to deploy gateway routing:', gwError.message);
      }

      // Deploy Music on Hold configuration (system-wide)
      let mohDeployed = false;
      try {
        await this.mohService.deploy();
        mohDeployed = true;
        console.log(`🎵 Music on Hold configuration deployed`);
      } catch (mohError) {
        console.warn(`⚠️  Warning: Failed to deploy MOH configuration:`, mohError.message);
      }

      console.log(`✅ Successfully deployed configuration for ${orgName}`);
      console.log(`📁 PJSIP Config: ${pjsipFilePath}`);
      console.log(`📁 Dialplan Config: ${dialplanFilePath}`);
      console.log(`📁 Queue Config: ${queueFilePath}`);

      return {
        success: true,
        pjsipFile: pjsipFilePath,
        dialplanFile: dialplanFilePath,
        queueFile: queueFilePath,
        mohDeployed,
        message: `Configuration deployed for organization ${orgName}`
      };

    } catch (error) {
      console.error(`❌ Error deploying configuration for ${orgName}:`, error);
      throw error;
    }
  }

  /**
   * Generate PJSIP configuration for organization (users + trunks)
   */
  async generatePJSIPConfiguration(orgId) {
    try {
      console.log(`📡 Generating PJSIP configuration for org ${orgId}...`);

      // Generate user and trunk configurations
      const [userConfig, trunkConfig] = await Promise.all([
        this.userProvisioningService.generateUserConfiguration(orgId),
        this.sipTrunkService.generateTrunkConfiguration(orgId)
      ]);

      // Combine configurations with proper headers
      let pjsipConfig = `; Auto-generated PJSIP Configuration for Organization ${orgId}\n`;
      pjsipConfig += `; Generated at: ${new Date().toISOString()}\n\n`;

      if (trunkConfig && trunkConfig.trim()) {
        pjsipConfig += `; === SIP TRUNKS ===\n`;
        pjsipConfig += trunkConfig + '\n\n';
      }

      if (userConfig && userConfig.trim()) {
        pjsipConfig += `; === USER ENDPOINTS ===\n`;
        pjsipConfig += userConfig + '\n';
      }

      return pjsipConfig;

    } catch (error) {
      console.error('Error generating PJSIP configuration:', error);
      throw error;
    }
  }

  /**
   * Generate dialplan configuration for organization
   */
  async generateDialplanConfiguration(orgId) {
    try {
      console.log(`📞 Generating dialplan configuration for org ${orgId}...`);

      const dialplans = await this.dialplanGenerator.generateDialplansForOrganization(orgId);

      let dialplanConfig = `; Auto-generated Dialplan Configuration for Organization ${orgId}\n`;
      dialplanConfig += `; Generated at: ${new Date().toISOString()}\n\n`;

      // Add all organization contexts
      Object.entries(dialplans.contexts).forEach(([contextName, contextContent]) => {
        dialplanConfig += contextContent + '\n';
      });

      return dialplanConfig;

    } catch (error) {
      console.error('Error generating dialplan configuration:', error);
      throw error;
    }
  }

  /**
   * Generate queue configuration for organization
   */
  async generateQueueConfiguration(orgId) {
    try {
      console.log(`📋 Generating queue configuration for org ${orgId}...`);

      const queueConfig = await this.queueService.generateQueueConfiguration(orgId);

      let fullConfig = `; Auto-generated Queue Configuration for Organization ${orgId}\n`;
      fullConfig += `; Generated at: ${new Date().toISOString()}\n\n`;

      if (queueConfig && queueConfig.trim()) {
        fullConfig += queueConfig;
      } else {
        fullConfig += `; No queues configured for this organization\n`;
      }

      return fullConfig;

    } catch (error) {
      console.error('Error generating queue configuration:', error);
      throw error;
    }
  }

  /**
   * Write configuration file — local or remote via SSH
   */
  async writeConfigFile(filePath, content) {
    const sshHost = process.env.ASTERISK_SSH_HOST;
    const sshUser = process.env.ASTERISK_SSH_USER || 'root';
    const sshKey = process.env.ASTERISK_SSH_KEY || '';

    // Remote deployment via SSH
    if (sshHost) {
      try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        // Write to local temp, then SCP to remote
        const tempPath = `/tmp/${path.basename(filePath)}`;
        await fs.writeFile(tempPath, content);

        const sshOpts = sshKey ? `-i ${sshKey}` : '';
        const scpCmd = `scp -o StrictHostKeyChecking=no ${sshOpts} "${tempPath}" ${sshUser}@${sshHost}:${filePath}`;
        await execAsync(scpCmd);

        console.log(`✅ Written config file (SSH → ${sshHost}): ${filePath}`);
        return;
      } catch (error) {
        console.error(`❌ SSH write failed for ${filePath}:`, error.message);
        throw error;
      }
    }

    // Local deployment
    try {
      await fs.writeFile(filePath, content, { mode: 0o644 });
      console.log(`✅ Written config file: ${filePath}`);
    } catch (error) {
      if (error.code === 'EACCES') {
        console.warn(`⚠️ Permission denied writing to ${filePath}. Trying with sudo...`);
        const tempPath = `/tmp/${path.basename(filePath)}`;
        await fs.writeFile(tempPath, content);

        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        await execAsync(`sudo mv "${tempPath}" "${filePath}"`);
        await execAsync(`sudo chown asterisk:asterisk "${filePath}"`);
        await execAsync(`sudo chmod 644 "${filePath}"`);

        console.log(`✅ Written config file with sudo: ${filePath}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Ensure include statements exist in main configuration files
   */
  async ensureIncludesInMainConfigs(orgName) {
    try {
      console.log(`🔗 Ensuring includes for ${orgName}...`);

      const pjsipMainPath = path.join(this.asteriskConfigPath, 'pjsip.conf');
      const extensionsMainPath = path.join(this.asteriskConfigPath, 'extensions.conf');
      const queuesMainPath = path.join(this.asteriskConfigPath, 'queues.conf');

      // Check and add PJSIP include (use absolute path)
      await this.ensureIncludeInFile(
        pjsipMainPath,
        `#include ${this.asteriskConfigPath}/pjsip_${orgName}.conf`,
        'Organization-specific PJSIP configurations'
      );

      // Check and add extensions include (use absolute path)
      await this.ensureIncludeInFile(
        extensionsMainPath,
        `#include "${this.asteriskConfigPath}/ext_${orgName}.conf"`,
        'Organization-specific dialplan configurations'
      );

      // Also ensure DIDs configuration file exists
      await this.ensureDidsConfigExists();

      // Check and add queues include (use absolute path)
      await this.ensureIncludeInFile(
        queuesMainPath,
        `#include "${this.asteriskConfigPath}/queues_${orgName}.conf"`,
        'Organization-specific queue configurations'
      );

      console.log(`✅ Includes updated for ${orgName}`);

    } catch (error) {
      console.error('Error updating main config includes:', error);
      throw error;
    }
  }

  /**
   * Ensure include statement exists in configuration file
   */
  async ensureIncludeInFile(filePath, includeStatement, comment) {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const sshHost = process.env.ASTERISK_SSH_HOST;
      const sshUser = process.env.ASTERISK_SSH_USER || 'root';
      const sshKey = process.env.ASTERISK_SSH_KEY || '';

      let content;
      if (sshHost) {
        // Read remote file via SSH
        const sshOpts = sshKey ? `-i ${sshKey}` : '';
        try {
          const { stdout } = await execAsync(`ssh -o StrictHostKeyChecking=no ${sshOpts} ${sshUser}@${sshHost} "cat ${filePath}"`);
          content = stdout;
        } catch { content = ''; }
      } else {
        try {
          content = await fs.readFile(filePath, 'utf8');
        } catch (error) {
          if (error.code === 'EACCES') {
            const { stdout } = await execAsync(`sudo cat "${filePath}"`);
            content = stdout;
          } else {
            throw error;
          }
        }
      }

      // Check if include already exists
      if (content.includes(includeStatement)) {
        console.log(`ℹ️ Include already exists in ${filePath}: ${includeStatement}`);
        return;
      }

      // Add include at the end of the file
      const newContent = content + `\n; ${comment}\n${includeStatement}\n`;

      // Write updated content
      await this.writeConfigFile(filePath, newContent);
      console.log(`✅ Added include to ${filePath}: ${includeStatement}`);

    } catch (error) {
      console.error(`Error updating ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Remove organization configuration files and includes
   */
  async removeOrganizationConfiguration(orgName) {
    try {
      console.log(`🗑️ Removing configuration for organization: ${orgName}`);

      const sanitizedOrgName = this.sanitizeFileName(orgName);
      const pjsipFilePath = path.join(this.asteriskConfigPath, `pjsip_${sanitizedOrgName}.conf`);
      const dialplanFilePath = path.join(this.asteriskConfigPath, `ext_${sanitizedOrgName}.conf`);

      // Remove configuration files
      await Promise.all([
        this.removeFileIfExists(pjsipFilePath),
        this.removeFileIfExists(dialplanFilePath)
      ]);

      // Remove includes from main configuration files
      await this.removeIncludesFromMainConfigs(sanitizedOrgName);

      console.log(`✅ Successfully removed configuration for ${orgName}`);

      return {
        success: true,
        message: `Configuration removed for organization ${orgName}`
      };

    } catch (error) {
      console.error(`❌ Error removing configuration for ${orgName}:`, error);
      throw error;
    }
  }

  /**
   * Remove include statements from main configuration files
   */
  async removeIncludesFromMainConfigs(orgName) {
    try {
      const pjsipMainPath = path.join(this.asteriskConfigPath, 'pjsip.conf');
      const extensionsMainPath = path.join(this.asteriskConfigPath, 'extensions.conf');

      await Promise.all([
        this.removeIncludeFromFile(pjsipMainPath, `pjsip_${orgName}.conf`),
        this.removeIncludeFromFile(extensionsMainPath, `ext_${orgName}.conf`)
      ]);

      console.log(`✅ Includes removed for ${orgName}`);

    } catch (error) {
      console.error('Error removing includes from main configs:', error);
      throw error;
    }
  }

  /**
   * Remove include statement from configuration file
   */
  async removeIncludeFromFile(filePath, includeFileName) {
    try {
      let content;
      try {
        content = await fs.readFile(filePath, 'utf8');
      } catch (error) {
        if (error.code === 'EACCES') {
          const { exec } = require('child_process');
          const { promisify } = require('util');
          const execAsync = promisify(exec);
          const { stdout } = await execAsync(`sudo cat "${filePath}"`);
          content = stdout;
        } else {
          throw error;
        }
      }

      // Remove include lines
      const lines = content.split('\n');
      const filteredLines = lines.filter(line =>
        !line.includes(`#include "${includeFileName}"`) &&
        !line.includes(`#include "/${includeFileName}"`)
      );

      if (filteredLines.length !== lines.length) {
        const newContent = filteredLines.join('\n');
        await this.writeConfigFile(filePath, newContent);
        console.log(`✅ Removed include from ${filePath}: ${includeFileName}`);
      }

    } catch (error) {
      console.error(`Error removing include from ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Remove file if it exists
   */
  async removeFileIfExists(filePath) {
    try {
      await fs.unlink(filePath);
      console.log(`✅ Removed file: ${filePath}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`ℹ️ File does not exist: ${filePath}`);
      } else if (error.code === 'EACCES') {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        await execAsync(`sudo rm -f "${filePath}"`);
        console.log(`✅ Removed file with sudo: ${filePath}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Sanitize organization name for file naming
   */
  sanitizeFileName(orgName) {
    return orgName
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')  // Allow underscores in original name
      .replace(/_+/g, '_')          // Collapse multiple underscores
      .replace(/^_/, '');           // Only remove leading underscores
  }

  /**
   * Ensure DIDs configuration file exists
   */
  async ensureDidsConfigExists() {
    try {
      const didsConfigPath = path.join(this.asteriskConfigPath, 'extensions_dids.conf');

      try {
        await fs.access(didsConfigPath);
        console.log(`ℹ️ DIDs config file already exists: ${didsConfigPath}`);
        return;
      } catch (error) {
        // File doesn't exist, create it
        console.log(`📝 Creating missing DIDs config file: ${didsConfigPath}`);

        const didsConfig = `; Auto-generated DIDs Configuration
; Generated at: ${new Date().toISOString()}
;
; This file contains DID routing configurations for PipeCat Bridge
; DIDs are routed to the appropriate contexts and applications

; =============================================================================
; PIPECAT BRIDGE DIDs
; =============================================================================

; DID routing for PipeCat Bridge - Extension 2001
[from-did-2001]
exten => 2001,1,NoOp(DID 2001 - PipeCat Bridge)
 same => n,Set(__DID_NUMBER=2001)
 same => n,Set(__CALL_TYPE=pipecat_bridge)
 same => n,Answer()
 same => n,Stasis(pipecat_bridge)
 same => n,Hangup()

; =============================================================================
; VOICE GATEWAY DIDs
; =============================================================================

; DID 1000111 - Voice Gateway
[from-did-1000111]
exten => 1000111,1,NoOp(DID 1000111 - Voice Gateway)
 same => n,Set(__DID_NUMBER=1000111)
 same => n,Set(__TENANT_ID=tenant-demo-1)
 same => n,Answer()
 same => n,Stasis(voice-gateway,1000111)
 same => n,Hangup()

; DID 1000222 - Test Tenant
[from-did-1000222]
exten => 1000222,1,NoOp(DID 1000222 - Test Tenant)
 same => n,Set(__DID_NUMBER=1000222)
 same => n,Set(__TENANT_ID=test-tenant)
 same => n,Answer()
 same => n,Stasis(voice-gateway,test-tenant)
 same => n,Hangup()

; DID 1000333 - Sales Demo
[from-did-1000333]
exten => 1000333,1,NoOp(DID 1000333 - Sales Demo)
 same => n,Set(__DID_NUMBER=1000333)
 same => n,Set(__TENANT_ID=tenant-sales-1)
 same => n,Answer()
 same => n,Stasis(voice-gateway,1000333)
 same => n,Hangup()

; =============================================================================
; CATCH-ALL DID HANDLER
; =============================================================================

; Fallback for unrouted DIDs
[from-did-fallback]
exten => _X.,1,NoOp(Unrouted DID: \${EXTEN})
 same => n,Set(__DID_NUMBER=\${EXTEN})
 same => n,Answer()
 same => n,Playbook(number-not-in-service)
 same => n,Hangup()
`;

        await this.writeConfigFile(didsConfigPath, didsConfig);
        console.log(`✅ Created DIDs config file: ${didsConfigPath}`);
      }
    } catch (error) {
      console.error('Error ensuring DIDs config exists:', error);
      throw error;
    }
  }

  /**
   * List all organization configuration files
   */
  async listOrganizationConfigurations() {
    try {
      const files = await fs.readdir(this.asteriskConfigPath);

      const orgConfigs = files.filter(file =>
        file.startsWith('pjsip_') || file.startsWith('ext_')
      );

      const grouped = {};
      orgConfigs.forEach(file => {
        const [type, orgName] = file.replace('.conf', '').split('_', 2);
        if (!grouped[orgName]) {
          grouped[orgName] = {};
        }
        grouped[orgName][type] = file;
      });

      return grouped;

    } catch (error) {
      console.error('Error listing organization configurations:', error);
      throw error;
    }
  }

  /**
   * Generate and deploy the Tata gateway inbound routing from the database.
   * Replaces the static ext_tata_gateway.conf with DID→org routing derived
   * from all assigned DIDs in the did_numbers table.
   */
  async deployGatewayRouting() {
    try {
      console.log('🌐 Generating gateway inbound routing from database...');

      const assignedDids = await DidNumber.findAll({
        where: { pool_status: 'assigned', status: 'active' },
        include: [{ model: Organization, as: 'organization', attributes: ['id', 'name', 'context_prefix'] }],
        order: [['number', 'ASC']],
      });

      const orgDids = {};
      for (const did of assignedDids) {
        if (!did.organization) continue;
        const orgId = did.organization.id;
        if (!orgDids[orgId]) orgDids[orgId] = { org: did.organization, dids: [] };
        orgDids[orgId].dids.push(did);
      }

      let config = '';
      config += '; Auto-generated Tata Gateway Inbound Routing\n';
      config += `; Generated at: ${new Date().toISOString()}\n`;
      config += '; DO NOT EDIT — regenerated on every config deploy\n\n';

      config += '[tata-inbound]\n';
      config += 'exten => _+9180659780XX,1,NoOp(Tata Inbound: ${EXTEN} from ${CALLERID(all)})\n';
      config += 'same => n,Set(DID_CLEAN=${EXTEN:1})\n';
      config += 'same => n,Goto(tata-did-route,${DID_CLEAN},1)\n\n';
      config += 'exten => _9180659780XX,1,NoOp(Tata Inbound (no plus): ${EXTEN})\n';
      config += 'same => n,Set(DID_CLEAN=${EXTEN})\n';
      config += 'same => n,Goto(tata-did-route,${DID_CLEAN},1)\n\n';
      config += 'exten => _X.,1,NoOp(Tata Inbound - Unmatched: ${EXTEN})\n';
      config += 'same => n,Playback(number-not-in-service)\n';
      config += 'same => n,Hangup()\n\n';

      config += '[tata-did-route]\n';
      config += '; DID-to-Organization routing (auto-generated from DB)\n';

      for (const [, { org, dids }] of Object.entries(orgDids)) {
        config += `\n; === ${org.name} (${org.context_prefix}_) ===\n`;
        for (const did of dids) {
          const cleanNum = did.number.replace(/[^0-9]/g, '');
          config += `exten => ${cleanNum},1,Goto(${org.context_prefix}_incoming,${cleanNum},1)\n`;
        }
      }

      config += '\n; Catch-all for unassigned DIDs\n';
      config += 'exten => _X.,1,NoOp(Unassigned DID: ${EXTEN})\n';
      config += 'same => n,Answer()\n';
      config += 'same => n,Playback(number-not-in-service)\n';
      config += 'same => n,Hangup()\n';

      const gatewayFilePath = path.join(this.asteriskConfigPath, 'ext_tata_gateway.conf');
      await this.writeConfigFile(gatewayFilePath, config);

      const didCount = assignedDids.length;
      const orgCount = Object.keys(orgDids).length;
      console.log(`✅ Gateway routing deployed: ${didCount} DIDs across ${orgCount} orgs`);
      return { success: true, didCount, orgCount };
    } catch (error) {
      console.error('❌ Error deploying gateway routing:', error);
      throw error;
    }
  }

  /**
   * Reload Asterisk configuration.
   * Note: `core reload` does NOT reliably re-read static members from queues.conf,
   * so we explicitly reload app_queue afterwards. Verified 2026-04-10: without the
   * explicit app_queue reload, queue members updated via the API don't reach the
   * live queue and incoming calls fail to ring agents.
   */
  async reloadAsteriskConfiguration() {
    try {
      console.log('🔄 Reloading Asterisk configuration...');

      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const sshHost = process.env.ASTERISK_SSH_HOST;
      const sshUser = process.env.ASTERISK_SSH_USER || 'root';
      const sshKey = process.env.ASTERISK_SSH_KEY || '';

      if (sshHost) {
        // Remote reload via SSH
        const sshOpts = sshKey ? `-i ${sshKey}` : '';
        await execAsync(`ssh -o StrictHostKeyChecking=no ${sshOpts} ${sshUser}@${sshHost} 'asterisk -rx "core reload" && asterisk -rx "module reload app_queue.so"'`);
      } else {
        // Local reload
        await execAsync('asterisk -rx "core reload"');
        await execAsync('asterisk -rx "module reload app_queue.so"');
      }

      console.log('✅ Asterisk configuration reloaded (core + app_queue)');

      return { success: true, message: 'Asterisk configuration reloaded' };

    } catch (error) {
      console.error('Error reloading Asterisk configuration:', error);
      throw error;
    }
  }
}

module.exports = ConfigDeploymentService;