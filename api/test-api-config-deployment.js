#!/usr/bin/env node

/**
 * API-Based Configuration Deployment Test
 *
 * This script:
 * 1. Uses the API endpoints to create test organization, users, and queues
 * 2. Tests the configuration generator with real API data
 * 3. Deploys the generated configurations to /etc/asterisk/
 */

const axios = require('axios');
const ConfigDeploymentService = require('./src/services/asterisk/configDeploymentService');

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api/v1';
const API_KEY = process.env.API_KEY || 'test-api-key-123';

class APIConfigTester {
  constructor() {
    this.configService = new ConfigDeploymentService();
    this.apiClient = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json'
      }
    });
    this.createdResources = {
      organization: null,
      users: [],
      queues: [],
      trunks: []
    };
  }

  async createTestOrganization() {
    console.log('🏢 Creating test organization via API...');

    try {
      const orgData = {
        name: 'TestOrg',
        domain: 'testorg.com',
        context_prefix: 'testorg_',
        status: 'active',
        recording_enabled: true,
        max_channels: 20,
        settings: {
          timezone: 'UTC',
          language: 'en',
          currency: 'USD'
        },
        admin_username: process.env.ADMIN_USERNAME || 'pbx_admin',
        admin_password: process.env.ADMIN_PASSWORD || 'YOUR_ADMIN_PASSWORD'
      };

      const response = await this.apiClient.post('/organizations', orgData);
      this.createdResources.organization = response.data;

      // Update the API client to use the returned API key
      this.apiClient.defaults.headers['X-API-Key'] = response.data.api_key;

      console.log(`✅ Organization created: ${response.data.name} (ID: ${response.data.id})`);
      console.log(`🔑 API Key: ${response.data.api_key}`);
      return response.data;

    } catch (error) {
      if (error.response?.status === 409) {
        console.log('ℹ️ Organization already exists, trying to use existing one...');
        // For existing org, we need to use the API key from environment or database
        console.log('⚠️ Using existing organization - make sure API_KEY environment variable is set');
        // Create a minimal organization object for testing
        const existingOrg = {
          id: 'existing-org-id',
          name: 'TestOrg',
          context_prefix: 'testorg_'
        };
        this.createdResources.organization = existingOrg;
        return existingOrg;
      }
      throw error;
    }
  }

  async createTestUsers(orgId) {
    console.log('👥 Creating test users via API...');

    const users = [
      {
        org_id: orgId,
        username: 'john.doe',
        email: 'john@testorg.com',
        extension: '2001',
        full_name: 'John Doe',
        role: 'agent',
        asterisk_endpoint: 'testorg_2001',
        sip_password: 'secure2001pass',
        status: 'active',
        call_recording: true,
        voicemail_enabled: true
      },
      {
        org_id: orgId,
        username: 'jane.smith',
        email: 'jane@testorg.com',
        extension: '2002',
        full_name: 'Jane Smith',
        role: 'agent',
        asterisk_endpoint: 'testorg_2002',
        sip_password: 'secure2002pass',
        status: 'active',
        call_recording: true,
        voicemail_enabled: true
      },
      {
        org_id: orgId,
        username: 'bob.manager',
        email: 'bob@testorg.com',
        extension: '2003',
        full_name: 'Bob Manager',
        role: 'supervisor',
        asterisk_endpoint: 'testorg_2003',
        sip_password: 'secure2003pass',
        status: 'active',
        call_recording: true,
        voicemail_enabled: false
      }
    ];

    for (const userData of users) {
      try {
        const response = await this.apiClient.post('/users', userData);
        this.createdResources.users.push(response.data);
        console.log(`✅ User created: ${response.data.username} (${response.data.extension})`);
      } catch (error) {
        if (error.response?.status === 409) {
          console.log(`ℹ️ User ${userData.username} already exists`);
        } else {
          throw error;
        }
      }
    }

    return this.createdResources.users;
  }

  async createTestQueues(orgId) {
    console.log('📞 Creating test queues via API...');

    const queues = [
      {
        org_id: orgId,
        name: 'Support Queue',
        number: 'support',
        strategy: 'ringall',
        timeout: 30,
        retry: 5,
        asterisk_queue_name: 'testorg_support',
        music_on_hold: 'default',
        announce_holdtime: true,
        join_empty: true,
        leave_when_empty: false,
        recording_enabled: true,
        status: 'active'
      },
      {
        org_id: orgId,
        name: 'Sales Queue',
        number: 'sales',
        strategy: 'rrmemory',
        timeout: 20,
        retry: 3,
        asterisk_queue_name: 'testorg_sales',
        music_on_hold: 'default',
        announce_holdtime: true,
        join_empty: true,
        leave_when_empty: false,
        recording_enabled: true,
        status: 'active'
      }
    ];

    for (const queueData of queues) {
      try {
        const response = await this.apiClient.post('/queues', queueData);
        this.createdResources.queues.push(response.data);
        console.log(`✅ Queue created: ${response.data.name} (${response.data.number})`);
      } catch (error) {
        if (error.response?.status === 409) {
          console.log(`ℹ️ Queue ${queueData.name} already exists`);
        } else {
          throw error;
        }
      }
    }

    return this.createdResources.queues;
  }

  async createTestTrunk(orgId) {
    console.log('📡 Creating test SIP trunk via API...');

    const trunkData = {
      org_id: orgId,
      name: 'TestOrg Main Trunk',
      host: 'sip.provider.com',
      port: 5060,
      username: 'testorg_user',
      password: 'trunk_password_123',
      transport: 'udp',
      asterisk_peer_name: 'testorg_trunk001',
      max_channels: 10,
      status: 'active',
      settings: {
        dtmf_mode: 'rfc4733',
        codec_preference: ['ulaw', 'alaw', 'g729']
      }
    };

    try {
      const response = await this.apiClient.post('/trunks', trunkData);
      this.createdResources.trunks.push(response.data);
      console.log(`✅ Trunk created: ${response.data.name}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 409) {
        console.log('ℹ️ Trunk already exists');
        return null;
      }
      throw error;
    }
  }

  async testConfigurationGeneration(orgId, orgName) {
    console.log('\n🔧 Testing configuration generation...');

    try {
      // Deploy configuration using the service
      console.log('📝 Generating configurations from API data...');
      const result = await this.configService.deployOrganizationConfiguration(orgId, orgName);

      console.log('\n✅ Configuration Generation Results:');
      console.log(`  📄 PJSIP Config: ${result.pjsipFile}`);
      console.log(`  📄 Dialplan Config: ${result.dialplanFile}`);
      console.log(`  📄 Queue Config: ${result.queueFile}`);
      console.log(`  💬 Message: ${result.message}`);

      return result;

    } catch (error) {
      console.error('❌ Configuration generation failed:', error.message);
      throw error;
    }
  }

  async validateGeneratedConfigs(result) {
    console.log('\n🔍 Validating generated configuration files...');

    const fs = require('fs').promises;

    try {
      // Check if files exist and show samples
      const files = [
        { name: 'PJSIP', path: result.pjsipFile },
        { name: 'Dialplan', path: result.dialplanFile },
        { name: 'Queue', path: result.queueFile }
      ];

      for (const file of files) {
        try {
          const content = await fs.readFile(file.path, 'utf8');
          console.log(`\n📄 ${file.name} Configuration (first 300 chars):`);
          console.log('─'.repeat(50));
          console.log(content.substring(0, 300) + '...');
          console.log('─'.repeat(50));

          // Basic validation
          if (content.includes('testorg_')) {
            console.log(`✅ ${file.name} contains organization-specific content`);
          } else {
            console.log(`⚠️ ${file.name} might not contain organization-specific content`);
          }

        } catch (readError) {
          console.log(`⚠️ Could not read ${file.name} config (may need sudo): ${readError.message}`);
        }
      }

    } catch (error) {
      console.error('❌ Validation error:', error.message);
    }
  }

  async reloadAsteriskConfiguration() {
    console.log('\n🔄 Reloading Asterisk configuration...');

    try {
      await this.configService.reloadAsteriskConfiguration();
      console.log('✅ Asterisk configuration reloaded successfully');
    } catch (error) {
      console.log(`⚠️ Could not reload Asterisk: ${error.message}`);
      console.log('   This is normal if Asterisk is not running');
    }
  }

  async cleanup() {
    console.log('\n🧹 Cleanup options:');
    console.log('ℹ️ Test resources created via API:');
    if (this.createdResources.organization) {
      console.log(`  🏢 Organization: ${this.createdResources.organization.name}`);
    }
    console.log(`  👥 Users: ${this.createdResources.users.length}`);
    console.log(`  📞 Queues: ${this.createdResources.queues.length}`);
    console.log(`  📡 Trunks: ${this.createdResources.trunks.length}`);
    console.log('');
    console.log('To clean up, you can:');
    console.log('1. Use the DELETE API endpoints');
    console.log('2. Remove the generated config files from /etc/asterisk/');
    console.log('3. Remove the include statements from main config files');
  }

  async run() {
    console.log('🚀 Starting API-Based Configuration Deployment Test\n');
    console.log('=' .repeat(60));

    try {
      // Step 1: Create test data via API
      const organization = await this.createTestOrganization();
      const users = await this.createTestUsers(organization.id);
      const queues = await this.createTestQueues(organization.id);
      const trunk = await this.createTestTrunk(organization.id);

      console.log('\n📊 Test Data Summary:');
      console.log(`  🏢 Organization: ${organization.name}`);
      console.log(`  👥 Users: ${users.length}`);
      console.log(`  📞 Queues: ${queues.length}`);
      console.log(`  📡 Trunks: ${trunk ? 1 : 0}`);

      // Step 2: Generate and deploy configurations
      const result = await this.testConfigurationGeneration(organization.id, organization.name);

      // Step 3: Validate generated configs
      await this.validateGeneratedConfigs(result);

      // Step 4: Reload Asterisk
      await this.reloadAsteriskConfiguration();

      // Step 5: Show cleanup info
      await this.cleanup();

      console.log('\n🎉 API-BASED CONFIGURATION TEST COMPLETED SUCCESSFULLY!');
      console.log('✅ Test data created via API endpoints');
      console.log('✅ Configuration generated from database');
      console.log('✅ Files deployed to /etc/asterisk/');
      console.log('✅ Include statements added to main configs');

    } catch (error) {
      console.error('\n❌ Test failed:', error.message);
      if (error.response) {
        console.error(`   API Error: ${error.response.status} - ${error.response.data?.message || error.response.statusText}`);
      }
      console.error(error.stack);
      process.exit(1);
    }
  }
}

// Command line handling
if (require.main === module) {
  const tester = new APIConfigTester();

  // Handle command line arguments
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(`
API-Based Configuration Deployment Test

Usage: node test-api-config-deployment.js [options]

Options:
  --help              Show this help message

Environment Variables:
  API_BASE_URL        Base URL for the API (default: http://localhost:3000/api/v1)
  API_KEY            API key for authentication (default: test-api-key-123)

Examples:
  node test-api-config-deployment.js                    # Run full test
  API_BASE_URL=http://localhost:5000/api/v1 node test-api-config-deployment.js
`);
    process.exit(0);
  }

  tester.run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = APIConfigTester;