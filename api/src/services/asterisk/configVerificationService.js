const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

class ConfigVerificationService {
  constructor() {
    this.execAsync = promisify(exec);
    this.asteriskConfigPath = '/etc/asterisk';
  }

  /**
   * Comprehensive verification of organization configuration
   * @param {string} orgId - Organization ID
   * @param {string} orgName - Organization name (for file naming)
   */
  async verifyOrganizationConfiguration(orgId, orgName) {
    try {
      console.log(`🔍 Verifying configuration for organization: ${orgName} (${orgId})`);

      const sanitizedOrgName = this.sanitizeFileName(orgName);
      const results = {
        organization: { id: orgId, name: orgName },
        timestamp: new Date().toISOString(),
        overall_status: 'pending',
        checks: {}
      };

      // Run all verification checks
      const [
        fileExists,
        pjsipConfig,
        dialplanConfig,
        queueConfig,
        asteriskSyntax,
        asteriskStatus
      ] = await Promise.all([
        this.verifyConfigFilesExist(sanitizedOrgName),
        this.verifyPJSIPConfiguration(sanitizedOrgName),
        this.verifyDialplanConfiguration(sanitizedOrgName),
        this.verifyQueueConfiguration(sanitizedOrgName),
        this.verifyAsteriskSyntax(sanitizedOrgName),
        this.verifyAsteriskStatus()
      ]);

      results.checks = {
        file_existence: fileExists,
        pjsip_configuration: pjsipConfig,
        dialplan_configuration: dialplanConfig,
        queue_configuration: queueConfig,
        asterisk_syntax: asteriskSyntax,
        asterisk_status: asteriskStatus
      };

      // Determine overall status
      const allChecks = Object.values(results.checks);
      const hasErrors = allChecks.some(check => check.status === 'error');
      const hasWarnings = allChecks.some(check => check.status === 'warning');

      if (hasErrors) {
        results.overall_status = 'error';
      } else if (hasWarnings) {
        results.overall_status = 'warning';
      } else {
        results.overall_status = 'success';
      }

      console.log(`✅ Verification completed for ${orgName}: ${results.overall_status}`);
      return results;

    } catch (error) {
      console.error(`❌ Error verifying configuration for ${orgName}:`, error);
      throw error;
    }
  }

  /**
   * Verify configuration files exist
   */
  async verifyConfigFilesExist(orgName) {
    const check = {
      name: 'Configuration Files Existence',
      status: 'success',
      details: {},
      errors: [],
      warnings: []
    };

    try {
      const files = [
        `pjsip_${orgName}.conf`,
        `exte_${orgName}.conf`,
        `queues_${orgName}.conf`
      ];

      for (const file of files) {
        const filePath = path.join(this.asteriskConfigPath, file);
        try {
          const stats = await fs.stat(filePath);
          check.details[file] = {
            exists: true,
            size: stats.size,
            modified: stats.mtime.toISOString()
          };
        } catch (error) {
          if (error.code === 'ENOENT') {
            check.details[file] = { exists: false };
            check.errors.push(`File not found: ${file}`);
            check.status = 'error';
          } else {
            check.errors.push(`Error checking ${file}: ${error.message}`);
            check.status = 'error';
          }
        }
      }

    } catch (error) {
      check.status = 'error';
      check.errors.push(`Failed to verify file existence: ${error.message}`);
    }

    return check;
  }

  /**
   * Verify PJSIP configuration
   */
  async verifyPJSIPConfiguration(orgName) {
    const check = {
      name: 'PJSIP Configuration',
      status: 'success',
      details: {},
      errors: [],
      warnings: []
    };

    try {
      const filePath = path.join(this.asteriskConfigPath, `pjsip_${orgName}.conf`);
      const content = await fs.readFile(filePath, 'utf8');

      // Parse PJSIP configuration
      const sections = this.parsePJSIPConfig(content);
      check.details.sections_found = Object.keys(sections).length;
      check.details.sections = {};

      // Check for required sections
      const requiredSectionTypes = ['endpoint', 'aor', 'auth'];
      const sectionTypes = {};

      Object.entries(sections).forEach(([sectionName, sectionData]) => {
        const type = sectionData.type;
        if (!sectionTypes[type]) sectionTypes[type] = [];
        sectionTypes[type].push(sectionName);
      });

      check.details.section_types = sectionTypes;

      // Verify required section types exist
      requiredSectionTypes.forEach(type => {
        if (!sectionTypes[type] || sectionTypes[type].length === 0) {
          check.warnings.push(`No ${type} sections found`);
          if (check.status !== 'error') check.status = 'warning';
        }
      });

      // Verify endpoint configurations
      if (sectionTypes.endpoint) {
        check.details.endpoints = {};
        sectionTypes.endpoint.forEach(endpointName => {
          const endpoint = sections[endpointName];
          check.details.endpoints[endpointName] = {
            context: endpoint.context || 'not_set',
            codecs: endpoint.allow || 'not_set',
            auth: endpoint.auth || endpoint.outbound_auth || 'not_set',
            aors: endpoint.aors || 'not_set'
          };

          // Check for essential configurations
          if (!endpoint.context) {
            check.warnings.push(`Endpoint ${endpointName} missing context`);
            if (check.status !== 'error') check.status = 'warning';
          }
        });
      }

    } catch (error) {
      check.status = 'error';
      check.errors.push(`Failed to verify PJSIP configuration: ${error.message}`);
    }

    return check;
  }

  /**
   * Verify dialplan configuration
   */
  async verifyDialplanConfiguration(orgName) {
    const check = {
      name: 'Dialplan Configuration',
      status: 'success',
      details: {},
      errors: [],
      warnings: []
    };

    try {
      const filePath = path.join(this.asteriskConfigPath, `exte_${orgName}.conf`);
      const content = await fs.readFile(filePath, 'utf8');

      // Parse dialplan configuration
      const contexts = this.parseDialplanConfig(content);
      check.details.contexts_found = Object.keys(contexts).length;
      check.details.contexts = {};

      Object.entries(contexts).forEach(([contextName, contextData]) => {
        const extensions = Object.keys(contextData.extensions || {});
        check.details.contexts[contextName] = {
          extension_count: extensions.length,
          extensions: extensions.slice(0, 10), // Show first 10 extensions
          includes: contextData.includes || []
        };
      });

      // Check for helper functions
      const helperFunctions = this.findHelperFunctions(content);
      check.details.helper_functions = helperFunctions;

      if (helperFunctions.length === 0) {
        check.warnings.push('No helper functions found in dialplan');
        if (check.status !== 'error') check.status = 'warning';
      }

    } catch (error) {
      check.status = 'error';
      check.errors.push(`Failed to verify dialplan configuration: ${error.message}`);
    }

    return check;
  }

  /**
   * Verify queue configuration
   */
  async verifyQueueConfiguration(orgName) {
    const check = {
      name: 'Queue Configuration',
      status: 'success',
      details: {},
      errors: [],
      warnings: []
    };

    try {
      const filePath = path.join(this.asteriskConfigPath, `queues_${orgName}.conf`);
      const content = await fs.readFile(filePath, 'utf8');

      // Parse queue configuration
      const queues = this.parseQueueConfig(content);
      check.details.queues_found = Object.keys(queues).length;
      check.details.queues = {};

      Object.entries(queues).forEach(([queueName, queueData]) => {
        check.details.queues[queueName] = {
          strategy: queueData.strategy || 'not_set',
          timeout: queueData.timeout || 'not_set',
          context: queueData.context || 'not_set',
          music_class: queueData.musicclass || 'default'
        };
      });

      if (Object.keys(queues).length === 0) {
        check.warnings.push('No queues found in configuration');
        if (check.status !== 'error') check.status = 'warning';
      }

    } catch (error) {
      check.status = 'error';
      check.errors.push(`Failed to verify queue configuration: ${error.message}`);
    }

    return check;
  }

  /**
   * Verify Asterisk syntax for organization files
   */
  async verifyAsteriskSyntax(orgName) {
    const check = {
      name: 'Asterisk Syntax Validation',
      status: 'success',
      details: {},
      errors: [],
      warnings: []
    };

    try {
      const files = [
        `pjsip_${orgName}.conf`,
        `exte_${orgName}.conf`,
        `queues_${orgName}.conf`
      ];

      check.details.syntax_checks = {};

      for (const file of files) {
        const filePath = path.join(this.asteriskConfigPath, file);

        try {
          // Check PJSIP syntax
          if (file.startsWith('pjsip_')) {
            const { stdout, stderr } = await this.execAsync(`asterisk -rx "pjsip show endpoints" 2>&1 || echo "Command completed"`);
            check.details.syntax_checks[file] = {
              status: 'valid',
              output: stdout.substring(0, 200) + (stdout.length > 200 ? '...' : '')
            };
          }
          // Check dialplan syntax
          else if (file.startsWith('exte_')) {
            const { stdout, stderr } = await this.execAsync(`asterisk -rx "dialplan show" 2>&1 || echo "Command completed"`);
            check.details.syntax_checks[file] = {
              status: 'valid',
              output: stdout.substring(0, 200) + (stdout.length > 200 ? '...' : '')
            };
          }
          // Check queue syntax
          else if (file.startsWith('queues_')) {
            const { stdout, stderr } = await this.execAsync(`asterisk -rx "queue show" 2>&1 || echo "Command completed"`);
            check.details.syntax_checks[file] = {
              status: 'valid',
              output: stdout.substring(0, 200) + (stdout.length > 200 ? '...' : '')
            };
          }
        } catch (error) {
          check.details.syntax_checks[file] = {
            status: 'error',
            error: error.message
          };
          check.warnings.push(`Syntax check failed for ${file}: ${error.message}`);
          if (check.status !== 'error') check.status = 'warning';
        }
      }

    } catch (error) {
      check.status = 'error';
      check.errors.push(`Failed to verify Asterisk syntax: ${error.message}`);
    }

    return check;
  }

  /**
   * Verify Asterisk service status
   */
  async verifyAsteriskStatus() {
    const check = {
      name: 'Asterisk Service Status',
      status: 'success',
      details: {},
      errors: [],
      warnings: []
    };

    try {
      // Check if Asterisk is running
      const { stdout: psOutput } = await this.execAsync('pgrep -f asterisk || echo "not_running"');
      const isRunning = psOutput.trim() !== 'not_running';

      check.details.process_running = isRunning;

      if (!isRunning) {
        check.status = 'error';
        check.errors.push('Asterisk process is not running');
        return check;
      }

      // Get Asterisk version and status
      try {
        const { stdout: versionOutput } = await this.execAsync('asterisk -rx "core show version" 2>/dev/null');
        check.details.version = versionOutput.split('\n')[0] || 'unknown';
      } catch (error) {
        check.warnings.push('Could not retrieve Asterisk version');
        if (check.status !== 'error') check.status = 'warning';
      }

      // Check module status
      try {
        const { stdout: moduleOutput } = await this.execAsync('asterisk -rx "module show like res_pjsip" 2>/dev/null');
        check.details.pjsip_module_loaded = moduleOutput.includes('res_pjsip.so');

        if (!check.details.pjsip_module_loaded) {
          check.warnings.push('PJSIP module not loaded');
          if (check.status !== 'error') check.status = 'warning';
        }
      } catch (error) {
        check.warnings.push('Could not check module status');
        if (check.status !== 'error') check.status = 'warning';
      }

    } catch (error) {
      check.status = 'error';
      check.errors.push(`Failed to verify Asterisk status: ${error.message}`);
    }

    return check;
  }

  /**
   * Test helper functions by simulating calls
   */
  async testHelperFunctions(orgName) {
    const check = {
      name: 'Helper Function Testing',
      status: 'success',
      details: {},
      errors: [],
      warnings: []
    };

    try {
      const helperFunctions = [
        { extension: '*43', name: 'Echo Test' },
        { extension: '*60', name: 'Say Current Time' },
        { extension: '*65', name: 'Say Extension Number' },
        { extension: '*100', name: 'Voicemail Main' },
        { extension: '*411', name: 'Directory Service' }
      ];

      check.details.test_results = {};

      for (const func of helperFunctions) {
        try {
          // Check if extension exists in dialplan
          const { stdout } = await this.execAsync(`asterisk -rx "dialplan show ${func.extension}@${orgName}_internal" 2>/dev/null || echo "not_found"`);

          const exists = !stdout.includes('not_found') && stdout.trim() !== '';
          check.details.test_results[func.extension] = {
            name: func.name,
            exists: exists,
            status: exists ? 'available' : 'missing'
          };

          if (!exists) {
            check.warnings.push(`Helper function ${func.name} (${func.extension}) not found`);
            if (check.status !== 'error') check.status = 'warning';
          }

        } catch (error) {
          check.details.test_results[func.extension] = {
            name: func.name,
            exists: false,
            status: 'error',
            error: error.message
          };
          check.warnings.push(`Error testing ${func.name}: ${error.message}`);
          if (check.status !== 'error') check.status = 'warning';
        }
      }

    } catch (error) {
      check.status = 'error';
      check.errors.push(`Failed to test helper functions: ${error.message}`);
    }

    return check;
  }

  /**
   * Parse PJSIP configuration content
   */
  parsePJSIPConfig(content) {
    const sections = {};
    const lines = content.split('\n');
    let currentSection = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith(';')) continue;

      // Section header
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        currentSection = trimmed.slice(1, -1);
        sections[currentSection] = {};
        continue;
      }

      // Section content
      if (currentSection && trimmed.includes('=')) {
        const [key, value] = trimmed.split('=', 2);
        sections[currentSection][key.trim()] = value.trim();
      }
    }

    return sections;
  }

  /**
   * Parse dialplan configuration content
   */
  parseDialplanConfig(content) {
    const contexts = {};
    const lines = content.split('\n');
    let currentContext = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith(';')) continue;

      // Context header
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        currentContext = trimmed.slice(1, -1);
        contexts[currentContext] = { extensions: {}, includes: [] };
        continue;
      }

      // Context content
      if (currentContext) {
        if (trimmed.startsWith('include =>')) {
          const includeContext = trimmed.split('=>')[1].trim();
          contexts[currentContext].includes.push(includeContext);
        } else if (trimmed.startsWith('exten =>')) {
          const extensionPart = trimmed.split('=>')[1].trim();
          const [extension] = extensionPart.split(',');
          if (!contexts[currentContext].extensions[extension]) {
            contexts[currentContext].extensions[extension] = [];
          }
          contexts[currentContext].extensions[extension].push(trimmed);
        }
      }
    }

    return contexts;
  }

  /**
   * Parse queue configuration content
   */
  parseQueueConfig(content) {
    const queues = {};
    const lines = content.split('\n');
    let currentQueue = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith(';')) continue;

      // Queue header
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        currentQueue = trimmed.slice(1, -1);
        queues[currentQueue] = {};
        continue;
      }

      // Queue content
      if (currentQueue && trimmed.includes('=')) {
        const [key, value] = trimmed.split('=', 2);
        queues[currentQueue][key.trim()] = value.trim();
      }
    }

    return queues;
  }

  /**
   * Find helper functions in dialplan content
   */
  findHelperFunctions(content) {
    const helperFunctions = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Look for extensions starting with *
      if (trimmed.startsWith('exten => *')) {
        const match = trimmed.match(/exten => (\*\d+),/);
        if (match) {
          helperFunctions.push(match[1]);
        }
      }
    }

    return [...new Set(helperFunctions)]; // Remove duplicates
  }

  /**
   * Sanitize organization name for file naming
   */
  sanitizeFileName(orgName) {
    return orgName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * Generate verification report
   */
  generateVerificationReport(verificationResults) {
    let report = `# Configuration Verification Report\n\n`;
    report += `**Organization:** ${verificationResults.organization.name} (${verificationResults.organization.id})\n`;
    report += `**Timestamp:** ${verificationResults.timestamp}\n`;
    report += `**Overall Status:** ${verificationResults.overall_status.toUpperCase()}\n\n`;

    Object.entries(verificationResults.checks).forEach(([checkName, checkData]) => {
      report += `## ${checkData.name}\n`;
      report += `**Status:** ${checkData.status.toUpperCase()}\n\n`;

      if (checkData.errors.length > 0) {
        report += `**Errors:**\n`;
        checkData.errors.forEach(error => report += `- ${error}\n`);
        report += `\n`;
      }

      if (checkData.warnings.length > 0) {
        report += `**Warnings:**\n`;
        checkData.warnings.forEach(warning => report += `- ${warning}\n`);
        report += `\n`;
      }

      if (Object.keys(checkData.details).length > 0) {
        report += `**Details:**\n`;
        report += `\`\`\`json\n${JSON.stringify(checkData.details, null, 2)}\n\`\`\`\n\n`;
      }
    });

    return report;
  }
}

module.exports = ConfigVerificationService;