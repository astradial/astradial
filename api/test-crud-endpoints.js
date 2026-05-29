const axios = require('axios');

class CRUDEndpointTester {
  constructor() {
    this.baseUrl = 'http://localhost:3000/api/v1';
    this.apiKey = null;
    this.orgId = null;
    this.createdResources = {
      organizations: [],
      users: [],
      sipTrunks: [],
      dids: [],
      queues: [],
      webhooks: []
    };
    this.testResults = [];
  }

  async runAllCRUDTests() {
    console.log('🧪 Testing ALL CRUD Endpoints...\n');

    try {
      // Test Organizations CRUD
      await this.testOrganizationsCRUD();

      // Test Users CRUD
      await this.testUsersCRUD();

      // Test SIP Trunks CRUD
      await this.testSipTrunksCRUD();

      // Test DIDs CRUD
      await this.testDIDsCRUD();

      // Test Queues CRUD
      await this.testQueuesCRUD();

      // Test Webhooks CRUD
      await this.testWebhooksCRUD();

      // Test special endpoints
      await this.testSpecialEndpoints();

      // Cleanup
      await this.cleanup();

      this.printResults();

    } catch (error) {
      console.error('❌ CRUD test failed:', error.message);
      console.error(error.response?.data || error.stack);
      return false;
    }
  }

  async testOrganizationsCRUD() {
    console.log('🏢 Testing Organizations CRUD...');

    try {
      // CREATE Organization
      const createResponse = await axios.post(`${this.baseUrl}/organizations`, {
        name: 'CRUD Test Organization',
        domain: 'crudtest.com'
      });

      const org = createResponse.data;
      this.orgId = org.id;
      this.apiKey = org.api_key;
      this.createdResources.organizations.push(org.id);
      this.addResult('Organizations', 'CREATE', true, `Created org: ${org.name}`);

      // READ Organization
      const readResponse = await axios.get(`${this.baseUrl}/organizations/${org.id}`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('Organizations', 'READ', true, `Retrieved org: ${readResponse.data.name}`);

      // UPDATE Organization
      const updateResponse = await axios.put(`${this.baseUrl}/organizations/${org.id}`, {
        name: 'Updated CRUD Test Organization',
        max_channels: 100
      }, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('Organizations', 'UPDATE', true, `Updated org: ${updateResponse.data.name}`);

      // LIST Organizations
      const listResponse = await axios.get(`${this.baseUrl}/organizations`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('Organizations', 'LIST', true, `Listed ${listResponse.data.length} organizations`);

    } catch (error) {
      this.addResult('Organizations', 'CRUD', false, error.response?.data?.message || error.message);
    }
  }

  async testUsersCRUD() {
    console.log('👥 Testing Users CRUD...');

    try {
      // CREATE User
      const createResponse = await axios.post(`${this.baseUrl}/users`, {
        username: 'crudtestuser',
        email: 'crudtest@example.com',
        password: 'testpass123',
        extension: '3001',
        full_name: 'CRUD Test User',
        role: 'agent'
      }, {
        headers: { 'X-API-Key': this.apiKey }
      });

      const user = createResponse.data;
      this.createdResources.users.push(user.id);
      this.addResult('Users', 'CREATE', true, `Created user: ${user.full_name}`);

      // READ User
      const readResponse = await axios.get(`${this.baseUrl}/users/${user.id}`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('Users', 'READ', true, `Retrieved user: ${readResponse.data.full_name}`);

      // UPDATE User
      const updateResponse = await axios.put(`${this.baseUrl}/users/${user.id}`, {
        full_name: 'Updated CRUD Test User',
        role: 'supervisor'
      }, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('Users', 'UPDATE', true, `Updated user: ${updateResponse.data.full_name}`);

      // LIST Users
      const listResponse = await axios.get(`${this.baseUrl}/users`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('Users', 'LIST', true, `Listed ${listResponse.data.length} users`);

    } catch (error) {
      this.addResult('Users', 'CRUD', false, error.response?.data?.message || error.message);
    }
  }

  async testSipTrunksCRUD() {
    console.log('🌐 Testing SIP Trunks CRUD...');

    try {
      // CREATE SIP Trunk
      const createResponse = await axios.post(`${this.baseUrl}/trunks`, {
        name: 'CRUD Test Trunk',
        host: 'sip.crudtest.com',
        port: 5060,
        username: 'cruduser',
        password: 'crudpass',
        transport: 'udp'
      }, {
        headers: { 'X-API-Key': this.apiKey }
      });

      const trunk = createResponse.data;
      this.createdResources.sipTrunks.push(trunk.id);
      this.addResult('SIP Trunks', 'CREATE', true, `Created trunk: ${trunk.name}`);

      // READ SIP Trunk
      const readResponse = await axios.get(`${this.baseUrl}/trunks/${trunk.id}`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('SIP Trunks', 'READ', true, `Retrieved trunk: ${readResponse.data.name}`);

      // UPDATE SIP Trunk
      const updateResponse = await axios.put(`${this.baseUrl}/trunks/${trunk.id}`, {
        name: 'Updated CRUD Test Trunk',
        port: 5061
      }, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('SIP Trunks', 'UPDATE', true, `Updated trunk: ${updateResponse.data.name}`);

      // LIST SIP Trunks
      const listResponse = await axios.get(`${this.baseUrl}/trunks`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('SIP Trunks', 'LIST', true, `Listed ${listResponse.data.length} trunks`);

    } catch (error) {
      this.addResult('SIP Trunks', 'CRUD', false, error.response?.data?.message || error.message);
    }
  }

  async testDIDsCRUD() {
    console.log('📞 Testing DIDs CRUD...');

    try {
      // CREATE DID
      const createResponse = await axios.post(`${this.baseUrl}/dids`, {
        number: '+1555123CRUD',
        country_code: 'US',
        routing_type: 'extension',
        routing_destination: '3001',
        active: true
      }, {
        headers: { 'X-API-Key': this.apiKey }
      });

      const did = createResponse.data;
      this.createdResources.dids.push(did.id);
      this.addResult('DIDs', 'CREATE', true, `Created DID: ${did.number}`);

      // READ DID
      const readResponse = await axios.get(`${this.baseUrl}/dids/${did.id}`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('DIDs', 'READ', true, `Retrieved DID: ${readResponse.data.number}`);

      // UPDATE DID
      const updateResponse = await axios.put(`${this.baseUrl}/dids/${did.id}`, {
        routing_type: 'queue',
        routing_destination: 'support'
      }, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('DIDs', 'UPDATE', true, `Updated DID routing: ${updateResponse.data.routing_type}`);

      // LIST DIDs
      const listResponse = await axios.get(`${this.baseUrl}/dids`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('DIDs', 'LIST', true, `Listed ${listResponse.data.length} DIDs`);

    } catch (error) {
      this.addResult('DIDs', 'CRUD', false, error.response?.data?.message || error.message);
    }
  }

  async testQueuesCRUD() {
    console.log('📋 Testing Queues CRUD...');

    try {
      // CREATE Queue
      const createResponse = await axios.post(`${this.baseUrl}/queues`, {
        name: 'CRUD Test Queue',
        number: 'crudtest',
        strategy: 'ringall',
        timeout: 30,
        retry: 5,
        active: true
      }, {
        headers: { 'X-API-Key': this.apiKey }
      });

      const queue = createResponse.data;
      this.createdResources.queues.push(queue.id);
      this.addResult('Queues', 'CREATE', true, `Created queue: ${queue.name}`);

      // READ Queue
      const readResponse = await axios.get(`${this.baseUrl}/queues/${queue.id}`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('Queues', 'READ', true, `Retrieved queue: ${readResponse.data.name}`);

      // UPDATE Queue
      const updateResponse = await axios.put(`${this.baseUrl}/queues/${queue.id}`, {
        name: 'Updated CRUD Test Queue',
        strategy: 'leastrecent',
        timeout: 45
      }, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('Queues', 'UPDATE', true, `Updated queue: ${updateResponse.data.name}`);

      // LIST Queues
      const listResponse = await axios.get(`${this.baseUrl}/queues`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('Queues', 'LIST', true, `Listed ${listResponse.data.length} queues`);

      // Test Queue Members (if we have users)
      if (this.createdResources.users.length > 0) {
        const userId = this.createdResources.users[0];

        // ADD Queue Member
        const addMemberResponse = await axios.post(`${this.baseUrl}/queues/${queue.id}/members`, {
          user_id: userId,
          penalty: 0,
          paused: false
        }, {
          headers: { 'X-API-Key': this.apiKey }
        });
        this.addResult('Queue Members', 'ADD', true, 'Added queue member');

        // LIST Queue Members
        const membersResponse = await axios.get(`${this.baseUrl}/queues/${queue.id}/members`, {
          headers: { 'X-API-Key': this.apiKey }
        });
        this.addResult('Queue Members', 'LIST', true, `Listed ${membersResponse.data.length} members`);
      }

    } catch (error) {
      this.addResult('Queues', 'CRUD', false, error.response?.data?.message || error.message);
    }
  }

  async testWebhooksCRUD() {
    console.log('🔗 Testing Webhooks CRUD...');

    try {
      // CREATE Webhook
      const createResponse = await axios.post(`${this.baseUrl}/webhooks`, {
        url: 'https://example.com/webhook',
        events: ['call.initiated', 'call.answered', 'call.ended'],
        active: true,
        secret: 'crudsecret123'
      }, {
        headers: { 'X-API-Key': this.apiKey }
      });

      const webhook = createResponse.data;
      this.createdResources.webhooks.push(webhook.id);
      this.addResult('Webhooks', 'CREATE', true, `Created webhook: ${webhook.url}`);

      // READ Webhook
      const readResponse = await axios.get(`${this.baseUrl}/webhooks/${webhook.id}`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('Webhooks', 'READ', true, `Retrieved webhook: ${readResponse.data.url}`);

      // UPDATE Webhook
      const updateResponse = await axios.put(`${this.baseUrl}/webhooks/${webhook.id}`, {
        url: 'https://updated.example.com/webhook',
        events: ['call.initiated', 'call.ended']
      }, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('Webhooks', 'UPDATE', true, `Updated webhook: ${updateResponse.data.url}`);

      // LIST Webhooks
      const listResponse = await axios.get(`${this.baseUrl}/webhooks`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('Webhooks', 'LIST', true, `Listed ${listResponse.data.length} webhooks`);

      // TEST Webhook
      const testResponse = await axios.post(`${this.baseUrl}/webhooks/${webhook.id}/test`, {}, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('Webhooks', 'TEST', true, 'Webhook test triggered');

    } catch (error) {
      this.addResult('Webhooks', 'CRUD', false, error.response?.data?.message || error.message);
    }
  }

  async testSpecialEndpoints() {
    console.log('🔧 Testing Special Endpoints...');

    try {
      // Health endpoint
      const healthResponse = await axios.get('http://localhost:3000/health');
      this.addResult('Special', 'Health Check', true, `Server uptime: ${healthResponse.data.uptime.toFixed(1)}s`);

      // Statistics endpoints
      if (this.createdResources.users.length > 0) {
        const statsResponse = await axios.get(`${this.baseUrl}/users/${this.createdResources.users[0]}/stats`, {
          headers: { 'X-API-Key': this.apiKey }
        });
        this.addResult('Special', 'User Stats', true, 'Retrieved user statistics');
      }

      // Configuration generation
      if (this.createdResources.sipTrunks.length > 0) {
        const configResponse = await axios.get(`${this.baseUrl}/trunks/${this.createdResources.sipTrunks[0]}/config`, {
          headers: { 'X-API-Key': this.apiKey }
        });
        this.addResult('Special', 'Trunk Config', true, 'Generated trunk configuration');
      }

      // Dialplan generation
      const dialplanResponse = await axios.get(`${this.baseUrl}/dialplan/${this.orgId}`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('Special', 'Dialplan Generation', true, 'Generated dialplan');

      // Call statistics
      const callStatsResponse = await axios.get(`${this.baseUrl}/calls/stats`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      this.addResult('Special', 'Call Stats', true, 'Retrieved call statistics');

    } catch (error) {
      this.addResult('Special', 'Endpoints', false, error.response?.data?.message || error.message);
    }
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test data...');

    // Delete in reverse dependency order
    const cleanupOrder = [
      { type: 'webhooks', endpoint: 'webhooks' },
      { type: 'queues', endpoint: 'queues' },
      { type: 'dids', endpoint: 'dids' },
      { type: 'sipTrunks', endpoint: 'trunks' },
      { type: 'users', endpoint: 'users' },
      { type: 'organizations', endpoint: 'organizations' }
    ];

    for (const resource of cleanupOrder) {
      for (const id of this.createdResources[resource.type]) {
        try {
          await axios.delete(`${this.baseUrl}/${resource.endpoint}/${id}`, {
            headers: { 'X-API-Key': this.apiKey }
          });
          this.addResult('Cleanup', `Delete ${resource.type}`, true, `Deleted ${resource.type}: ${id}`);
        } catch (error) {
          this.addResult('Cleanup', `Delete ${resource.type}`, false, error.response?.data?.message || error.message);
        }
      }
    }
  }

  addResult(category, operation, success, message) {
    this.testResults.push({ category, operation, success, message, timestamp: new Date() });
    const status = success ? '✅' : '❌';
    console.log(`  ${status} ${operation}: ${message}`);
  }

  printResults() {
    console.log('\n🏁 CRUD Test Results Summary\n');
    console.log('=' .repeat(60));

    const categories = [...new Set(this.testResults.map(r => r.category))];
    let totalTests = 0;
    let passedTests = 0;

    categories.forEach(category => {
      const categoryResults = this.testResults.filter(r => r.category === category);
      const categoryPassed = categoryResults.filter(r => r.success).length;
      const categoryTotal = categoryResults.length;

      console.log(`\n${category}: ${categoryPassed}/${categoryTotal} passed`);
      console.log('-'.repeat(40));

      categoryResults.forEach(result => {
        const status = result.success ? '✅' : '❌';
        console.log(`  ${status} ${result.operation}`);
        if (!result.success) {
          console.log(`      Error: ${result.message}`);
        }
      });

      totalTests += categoryTotal;
      passedTests += categoryPassed;
    });

    console.log('\n' + '='.repeat(60));
    console.log(`TOTAL: ${passedTests}/${totalTests} tests passed`);

    if (passedTests === totalTests) {
      console.log('\n🎉 ALL CRUD ENDPOINTS WORKING PERFECTLY!');
      console.log('✅ Create operations: Working');
      console.log('✅ Read operations: Working');
      console.log('✅ Update operations: Working');
      console.log('✅ Delete operations: Working');
      console.log('✅ List operations: Working');
      console.log('✅ Special endpoints: Working');
    } else {
      console.log(`\n⚠️  ${totalTests - passedTests} operations failed. Please review the errors above.`);
    }

    return passedTests === totalTests;
  }
}

// Run the tests
if (require.main === module) {
  const tester = new CRUDEndpointTester();
  tester.runAllCRUDTests().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = CRUDEndpointTester;