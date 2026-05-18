#!/usr/bin/env node

const https = require('https');
const http = require('http');
const { promisify } = require('util');

class APITester {
  constructor() {
    this.baseUrl = 'http://localhost:3002';
    this.results = [];
    this.adminToken = null;
    this.orgCredentials = null;
    this.orgToken = null;
    this.testOrgId = null;
    this.createdResources = {
      organizations: [],
      sipTrunks: [],
      dids: [],
      users: [],
      queues: [],
      webhooks: []
    };
  }

  async makeRequest(method, path, data = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const options = {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const responseData = body ? JSON.parse(body) : null;
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: responseData
            });
          } catch (e) {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: body
            });
          }
        });
      });

      req.on('error', reject);

      if (data) {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  logTest(category, endpoint, status, success, message = '', details = null) {
    const result = {
      category,
      endpoint,
      status,
      success,
      message,
      details,
      timestamp: new Date().toISOString()
    };

    this.results.push(result);

    const statusIcon = success ? '✅' : '❌';
    const statusText = success ? 'PASS' : 'FAIL';
    console.log(`${statusIcon} [${category}] ${endpoint} - ${statusText} (${status}) ${message}`);

    if (details && !success) {
      console.log(`   Details: ${JSON.stringify(details, null, 2)}`);
    }
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async testAdminAuthentication() {
    console.log('\\n🔐 Testing Admin Authentication...');

    // Test valid admin login
    try {
      const response = await this.makeRequest('POST', '/auth/admin/login', {
        username: 'admin',
        password: 'admin123'
      });

      if (response.status === 200 && response.data && response.data.token) {
        this.adminToken = response.data.token;
        this.logTest('Admin Auth', 'POST /auth/admin/login', response.status, true, 'Valid credentials accepted');
      } else {
        this.logTest('Admin Auth', 'POST /auth/admin/login', response.status, false, 'Valid credentials rejected', response.data);
      }
    } catch (error) {
      this.logTest('Admin Auth', 'POST /auth/admin/login', 0, false, 'Request failed', error.message);
    }

    // Test invalid admin login
    try {
      const response = await this.makeRequest('POST', '/auth/admin/login', {
        username: 'admin',
        password: 'wrongpassword'
      });

      if (response.status === 401) {
        this.logTest('Admin Auth', 'POST /auth/admin/login (invalid)', response.status, true, 'Invalid credentials properly rejected');
      } else {
        this.logTest('Admin Auth', 'POST /auth/admin/login (invalid)', response.status, false, 'Invalid credentials not properly handled', response.data);
      }
    } catch (error) {
      this.logTest('Admin Auth', 'POST /auth/admin/login (invalid)', 0, false, 'Request failed', error.message);
    }

    // Test get org credentials
    if (this.adminToken) {
      try {
        const response = await this.makeRequest('POST', '/auth/admin/get-org-credentials', {
          organizationId: '2c662bff-8f80-483a-8235-74fd48965a9c' // TestOrg from CLAUDE.md
        }, {
          'Authorization': `Bearer ${this.adminToken}`
        });

        if (response.status === 200 && response.data && response.data.apiKey) {
          this.orgCredentials = response.data;
          this.logTest('Admin Auth', 'POST /auth/admin/get-org-credentials', response.status, true, 'Organization credentials retrieved');
        } else {
          this.logTest('Admin Auth', 'POST /auth/admin/get-org-credentials', response.status, false, 'Failed to get org credentials', response.data);
        }
      } catch (error) {
        this.logTest('Admin Auth', 'POST /auth/admin/get-org-credentials', 0, false, 'Request failed', error.message);
      }
    }
  }

  async testOrganizationAuthentication() {
    console.log('\\n🏢 Testing Organization Authentication...');

    if (this.orgCredentials) {
      // Test organization login
      try {
        const response = await this.makeRequest('POST', '/auth/login', {
          apiKey: this.orgCredentials.apiKey,
          apiSecret: this.orgCredentials.apiSecret
        });

        if (response.status === 200 && response.data && response.data.token) {
          this.orgToken = response.data.token;
          this.logTest('Org Auth', 'POST /auth/login', response.status, true, 'Organization login successful');
        } else {
          this.logTest('Org Auth', 'POST /auth/login', response.status, false, 'Organization login failed', response.data);
        }
      } catch (error) {
        this.logTest('Org Auth', 'POST /auth/login', 0, false, 'Request failed', error.message);
      }

      // Test invalid organization credentials
      try {
        const response = await this.makeRequest('POST', '/auth/login', {
          apiKey: 'invalid_key',
          apiSecret: 'invalid_secret'
        });

        if (response.status === 401) {
          this.logTest('Org Auth', 'POST /auth/login (invalid)', response.status, true, 'Invalid org credentials properly rejected');
        } else {
          this.logTest('Org Auth', 'POST /auth/login (invalid)', response.status, false, 'Invalid org credentials not properly handled', response.data);
        }
      } catch (error) {
        this.logTest('Org Auth', 'POST /auth/login (invalid)', 0, false, 'Request failed', error.message);
      }
    }
  }

  async testOrganizationManagement() {
    console.log('\\n🏢 Testing Organization Management...');

    // Test organization creation with valid name
    try {
      const response = await this.makeRequest('POST', '/api/v1/organizations', {
        name: 'TestOrg-API-Test',
        domain: 'testapi.example.com'
      });

      if (response.status === 201 && response.data && response.data.id) {
        this.testOrgId = response.data.id;
        this.createdResources.organizations.push(response.data.id);
        this.logTest('Organization', 'POST /organizations', response.status, true, 'Valid organization created');
      } else {
        this.logTest('Organization', 'POST /organizations', response.status, false, 'Failed to create organization', response.data);
      }
    } catch (error) {
      this.logTest('Organization', 'POST /organizations', 0, false, 'Request failed', error.message);
    }

    // Test organization creation with invalid name (spaces)
    try {
      const response = await this.makeRequest('POST', '/api/v1/organizations', {
        name: 'Test Org With Spaces',
        domain: 'testspaces.example.com'
      });

      if (response.status === 400) {
        this.logTest('Organization', 'POST /organizations (invalid name)', response.status, true, 'Organization name validation working');
      } else {
        this.logTest('Organization', 'POST /organizations (invalid name)', response.status, false, 'Organization name validation failed', response.data);
      }
    } catch (error) {
      this.logTest('Organization', 'POST /organizations (invalid name)', 0, false, 'Request failed', error.message);
    }

    // Test organization creation with invalid name (special chars)
    try {
      const response = await this.makeRequest('POST', '/api/v1/organizations', {
        name: '-TestOrg!',
        domain: 'testspecial.example.com'
      });

      if (response.status === 400) {
        this.logTest('Organization', 'POST /organizations (special chars)', response.status, true, 'Organization name validation working');
      } else {
        this.logTest('Organization', 'POST /organizations (special chars)', response.status, false, 'Organization name validation failed', response.data);
      }
    } catch (error) {
      this.logTest('Organization', 'POST /organizations (special chars)', 0, false, 'Request failed', error.message);
    }
  }

  async testConfigurationManagement() {
    console.log('\\n⚙️ Testing Configuration Management...');

    if (!this.orgToken) {
      this.logTest('Configuration', 'Skipped - No org token', 0, false, 'No organization token available');
      return;
    }

    const headers = { 'Authorization': `Bearer ${this.orgToken}` };

    // Test configuration status
    try {
      const response = await this.makeRequest('GET', '/api/v1/config/status', null, headers);
      this.logTest('Configuration', 'GET /config/status', response.status, response.status === 200, 'Configuration status check');
    } catch (error) {
      this.logTest('Configuration', 'GET /config/status', 0, false, 'Request failed', error.message);
    }

    // Test configuration validation
    try {
      const response = await this.makeRequest('GET', '/api/v1/config/validate', null, headers);
      this.logTest('Configuration', 'GET /config/validate', response.status, response.status === 200, 'Configuration validation');
    } catch (error) {
      this.logTest('Configuration', 'GET /config/validate', 0, false, 'Request failed', error.message);
    }

    // Test configuration deployment
    try {
      const response = await this.makeRequest('POST', '/api/v1/config/deploy', {}, headers);
      this.logTest('Configuration', 'POST /config/deploy', response.status, response.status === 200, 'Configuration deployment');
    } catch (error) {
      this.logTest('Configuration', 'POST /config/deploy', 0, false, 'Request failed', error.message);
    }

    // Test Asterisk reload
    try {
      const response = await this.makeRequest('GET', '/api/v1/config/reload', null, headers);
      this.logTest('Configuration', 'GET /config/reload', response.status, response.status === 200, 'Asterisk reload');
    } catch (error) {
      this.logTest('Configuration', 'GET /config/reload', 0, false, 'Request failed', error.message);
    }
  }

  async testSIPTrunks() {
    console.log('\\n📞 Testing SIP Trunks...');

    if (!this.orgToken) {
      this.logTest('SIP Trunks', 'Skipped - No org token', 0, false, 'No organization token available');
      return;
    }

    const headers = { 'Authorization': `Bearer ${this.orgToken}` };

    // Test getting SIP trunks
    try {
      const response = await this.makeRequest('GET', '/api/v1/sip-trunks', null, headers);
      this.logTest('SIP Trunks', 'GET /sip-trunks', response.status, response.status === 200, 'Get SIP trunks');
    } catch (error) {
      this.logTest('SIP Trunks', 'GET /sip-trunks', 0, false, 'Request failed', error.message);
    }

    // Test creating SIP trunk
    try {
      const response = await this.makeRequest('POST', '/api/v1/sip-trunks', {
        name: 'Test SIP Trunk',
        host: 'sip.testprovider.com',
        port: 5060,
        username: 'testuser',
        password: 'testpass',
        transport: 'udp'
      }, headers);

      if (response.status === 201 && response.data && response.data.id) {
        this.createdResources.sipTrunks.push(response.data.id);
        this.logTest('SIP Trunks', 'POST /sip-trunks', response.status, true, 'SIP trunk created');

        // Test updating SIP trunk
        try {
          const updateResponse = await this.makeRequest('PUT', `/api/v1/sip-trunks/${response.data.id}`, {
            port: 5061,
            transport: 'tcp'
          }, headers);
          this.logTest('SIP Trunks', 'PUT /sip-trunks/{id}', updateResponse.status, updateResponse.status === 200, 'SIP trunk updated');
        } catch (error) {
          this.logTest('SIP Trunks', 'PUT /sip-trunks/{id}', 0, false, 'Update request failed', error.message);
        }

      } else {
        this.logTest('SIP Trunks', 'POST /sip-trunks', response.status, false, 'Failed to create SIP trunk', response.data);
      }
    } catch (error) {
      this.logTest('SIP Trunks', 'POST /sip-trunks', 0, false, 'Request failed', error.message);
    }
  }

  async testUsers() {
    console.log('\\n👥 Testing Users...');

    if (!this.orgToken) {
      this.logTest('Users', 'Skipped - No org token', 0, false, 'No organization token available');
      return;
    }

    const headers = { 'Authorization': `Bearer ${this.orgToken}` };

    // Test getting users
    try {
      const response = await this.makeRequest('GET', '/api/v1/users', null, headers);
      this.logTest('Users', 'GET /users', response.status, response.status === 200, 'Get users');
    } catch (error) {
      this.logTest('Users', 'GET /users', 0, false, 'Request failed', error.message);
    }

    // Test creating user
    try {
      const response = await this.makeRequest('POST', '/api/v1/users', {
        username: 'testuser123',
        email: 'testuser@example.com',
        extension: '2001',
        full_name: 'Test User',
        role: 'agent',
        sip_password: 'testpass123'
      }, headers);

      if (response.status === 201 && response.data && response.data.id) {
        this.createdResources.users.push(response.data.id);
        this.logTest('Users', 'POST /users', response.status, true, 'User created');

        // Test updating user
        try {
          const updateResponse = await this.makeRequest('PUT', `/api/v1/users/${response.data.id}`, {
            full_name: 'Updated Test User'
          }, headers);
          this.logTest('Users', 'PUT /users/{id}', updateResponse.status, updateResponse.status === 200, 'User updated');
        } catch (error) {
          this.logTest('Users', 'PUT /users/{id}', 0, false, 'Update request failed', error.message);
        }

      } else {
        this.logTest('Users', 'POST /users', response.status, false, 'Failed to create user', response.data);
      }
    } catch (error) {
      this.logTest('Users', 'POST /users', 0, false, 'Request failed', error.message);
    }
  }

  async testQueues() {
    console.log('\\n📋 Testing Queues...');

    if (!this.orgToken) {
      this.logTest('Queues', 'Skipped - No org token', 0, false, 'No organization token available');
      return;
    }

    const headers = { 'Authorization': `Bearer ${this.orgToken}` };

    // Test getting queues
    try {
      const response = await this.makeRequest('GET', '/api/v1/queues', null, headers);
      this.logTest('Queues', 'GET /queues', response.status, response.status === 200, 'Get queues');
    } catch (error) {
      this.logTest('Queues', 'GET /queues', 0, false, 'Request failed', error.message);
    }

    // Test creating queue
    try {
      const response = await this.makeRequest('POST', '/api/v1/queues', {
        name: 'Test Support Queue',
        number: 'support',
        strategy: 'ringall',
        timeout: 30,
        retry: 5
      }, headers);

      if (response.status === 201 && response.data && response.data.id) {
        this.createdResources.queues.push(response.data.id);
        this.logTest('Queues', 'POST /queues', response.status, true, 'Queue created');

        // Test updating queue
        try {
          const updateResponse = await this.makeRequest('PUT', `/api/v1/queues/${response.data.id}`, {
            timeout: 45,
            strategy: 'leastrecent'
          }, headers);
          this.logTest('Queues', 'PUT /queues/{id}', updateResponse.status, updateResponse.status === 200, 'Queue updated');
        } catch (error) {
          this.logTest('Queues', 'PUT /queues/{id}', 0, false, 'Update request failed', error.message);
        }

        // Test adding queue member
        if (this.createdResources.users.length > 0) {
          try {
            const memberResponse = await this.makeRequest('POST', `/api/v1/queues/${response.data.id}/members`, {
              userId: this.createdResources.users[0],
              penalty: 0,
              paused: false
            }, headers);
            this.logTest('Queues', 'POST /queues/{id}/members', memberResponse.status, memberResponse.status === 200, 'Queue member added');
          } catch (error) {
            this.logTest('Queues', 'POST /queues/{id}/members', 0, false, 'Request failed', error.message);
          }
        }

      } else {
        this.logTest('Queues', 'POST /queues', response.status, false, 'Failed to create queue', response.data);
      }
    } catch (error) {
      this.logTest('Queues', 'POST /queues', 0, false, 'Request failed', error.message);
    }
  }

  async testDIDs() {
    console.log('\\n📱 Testing DID Numbers...');

    if (!this.orgToken) {
      this.logTest('DIDs', 'Skipped - No org token', 0, false, 'No organization token available');
      return;
    }

    const headers = { 'Authorization': `Bearer ${this.orgToken}` };

    // Test getting DIDs
    try {
      const response = await this.makeRequest('GET', '/api/v1/dids', null, headers);
      this.logTest('DIDs', 'GET /dids', response.status, response.status === 200, 'Get DIDs');
    } catch (error) {
      this.logTest('DIDs', 'GET /dids', 0, false, 'Request failed', error.message);
    }

    // Test creating DID
    try {
      const response = await this.makeRequest('POST', '/api/v1/dids', {
        number: '+1234567890',
        routing_type: 'extension',
        routing_destination: '2001'
      }, headers);

      if (response.status === 201 && response.data && response.data.id) {
        this.createdResources.dids.push(response.data.id);
        this.logTest('DIDs', 'POST /dids', response.status, true, 'DID created');

        // Test updating DID
        try {
          const updateResponse = await this.makeRequest('PUT', `/api/v1/dids/${response.data.id}`, {
            routing_type: 'queue',
            routing_destination: 'support'
          }, headers);
          this.logTest('DIDs', 'PUT /dids/{id}', updateResponse.status, updateResponse.status === 200, 'DID updated');
        } catch (error) {
          this.logTest('DIDs', 'PUT /dids/{id}', 0, false, 'Update request failed', error.message);
        }

      } else {
        this.logTest('DIDs', 'POST /dids', response.status, false, 'Failed to create DID', response.data);
      }
    } catch (error) {
      this.logTest('DIDs', 'POST /dids', 0, false, 'Request failed', error.message);
    }
  }

  async testWebhooks() {
    console.log('\\n🔗 Testing Webhooks...');

    if (!this.orgToken) {
      this.logTest('Webhooks', 'Skipped - No org token', 0, false, 'No organization token available');
      return;
    }

    const headers = { 'Authorization': `Bearer ${this.orgToken}` };

    // Test getting webhooks
    try {
      const response = await this.makeRequest('GET', '/api/v1/webhooks', null, headers);
      this.logTest('Webhooks', 'GET /webhooks', response.status, response.status === 200, 'Get webhooks');
    } catch (error) {
      this.logTest('Webhooks', 'GET /webhooks', 0, false, 'Request failed', error.message);
    }

    // Test creating webhook
    try {
      const response = await this.makeRequest('POST', '/api/v1/webhooks', {
        url: 'https://api.example.com/webhook',
        events: ['call.started', 'call.ended'],
        active: true
      }, headers);

      if (response.status === 201 && response.data && response.data.id) {
        this.createdResources.webhooks.push(response.data.id);
        this.logTest('Webhooks', 'POST /webhooks', response.status, true, 'Webhook created');

        // Test updating webhook
        try {
          const updateResponse = await this.makeRequest('PUT', `/api/v1/webhooks/${response.data.id}`, {
            active: false
          }, headers);
          this.logTest('Webhooks', 'PUT /webhooks/{id}', updateResponse.status, updateResponse.status === 200, 'Webhook updated');
        } catch (error) {
          this.logTest('Webhooks', 'PUT /webhooks/{id}', 0, false, 'Update request failed', error.message);
        }

      } else {
        this.logTest('Webhooks', 'POST /webhooks', response.status, false, 'Failed to create webhook', response.data);
      }
    } catch (error) {
      this.logTest('Webhooks', 'POST /webhooks', 0, false, 'Request failed', error.message);
    }
  }

  async testCallManagement() {
    console.log('\\n📞 Testing Call Management...');

    if (!this.orgToken) {
      this.logTest('Call Management', 'Skipped - No org token', 0, false, 'No organization token available');
      return;
    }

    const headers = { 'Authorization': `Bearer ${this.orgToken}` };

    // Test call initiation (may fail due to no actual endpoints)
    try {
      const response = await this.makeRequest('POST', '/api/v1/calls/initiate', {
        from: '2001',
        to: '+1234567890'
      }, headers);
      this.logTest('Call Management', 'POST /calls/initiate', response.status, response.status < 500, 'Call initiation endpoint accessible');
    } catch (error) {
      this.logTest('Call Management', 'POST /calls/initiate', 0, false, 'Request failed', error.message);
    }
  }

  async testAsteriskConnection() {
    console.log('\\n🧪 Testing Asterisk Connection...');

    // Test Asterisk connection endpoint
    try {
      const response = await this.makeRequest('GET', '/api/v1/test/asterisk-connection');
      this.logTest('Testing', 'GET /test/asterisk-connection', response.status, response.status === 200, 'Asterisk connection test');
    } catch (error) {
      this.logTest('Testing', 'GET /test/asterisk-connection', 0, false, 'Request failed', error.message);
    }
  }

  async testHealthEndpoint() {
    console.log('\\n💚 Testing Health Endpoint...');

    // Test health endpoint
    try {
      const response = await this.makeRequest('GET', '/health');
      this.logTest('Health', 'GET /health', response.status, response.status === 200, 'Health check');
    } catch (error) {
      this.logTest('Health', 'GET /health', 0, false, 'Request failed', error.message);
    }
  }

  async testAPIDocumentation() {
    console.log('\\n📚 Testing API Documentation...');

    // Test API documentation endpoint
    try {
      const response = await this.makeRequest('GET', '/api');
      this.logTest('Documentation', 'GET /api', response.status, response.status === 200, 'API documentation accessible');
    } catch (error) {
      this.logTest('Documentation', 'GET /api', 0, false, 'Request failed', error.message);
    }
  }

  generateReport() {
    console.log('\\n' + '='.repeat(80));
    console.log('📊 COMPREHENSIVE API TEST REPORT');
    console.log('='.repeat(80));

    const categorySummary = {};
    let totalTests = 0;
    let passedTests = 0;

    this.results.forEach(result => {
      if (!categorySummary[result.category]) {
        categorySummary[result.category] = { total: 0, passed: 0 };
      }
      categorySummary[result.category].total++;
      totalTests++;

      if (result.success) {
        categorySummary[result.category].passed++;
        passedTests++;
      }
    });

    console.log(`\\n📈 Overall Results: ${passedTests}/${totalTests} tests passed (${((passedTests/totalTests)*100).toFixed(1)}%)`);

    console.log('\\n📋 Category Breakdown:');
    Object.entries(categorySummary).forEach(([category, stats]) => {
      const percentage = ((stats.passed / stats.total) * 100).toFixed(1);
      const icon = stats.passed === stats.total ? '✅' : stats.passed > 0 ? '⚠️' : '❌';
      console.log(`${icon} ${category}: ${stats.passed}/${stats.total} (${percentage}%)`);
    });

    console.log('\\n🔍 Failed Tests:');
    const failedTests = this.results.filter(r => !r.success);
    if (failedTests.length === 0) {
      console.log('🎉 No failed tests!');
    } else {
      failedTests.forEach(test => {
        console.log(`❌ [${test.category}] ${test.endpoint} - ${test.message}`);
      });
    }

    console.log('\\n🚨 Critical Validation Results:');

    // Check context format validation
    const contextTests = this.results.filter(r => r.message.includes('context') || r.category === 'Configuration');
    console.log(`🔄 Context Format Tests: ${contextTests.filter(t => t.success).length}/${contextTests.length} passed`);

    // Check organization name validation
    const orgValidationTests = this.results.filter(r => r.endpoint.includes('organizations') && r.message.includes('validation'));
    console.log(`🏢 Organization Name Validation: ${orgValidationTests.filter(t => t.success).length}/${orgValidationTests.length} passed`);

    // Check authentication flow
    const authTests = this.results.filter(r => r.category.includes('Auth'));
    console.log(`🔐 Authentication Flow: ${authTests.filter(t => t.success).length}/${authTests.length} passed`);

    console.log('\\n📝 Test Details:');
    this.results.forEach(result => {
      const icon = result.success ? '✅' : '❌';
      console.log(`${icon} [${result.category}] ${result.endpoint} (${result.status}) - ${result.message}`);
    });

    const summary = {
      totalTests,
      passedTests,
      failedTests: totalTests - passedTests,
      successRate: ((passedTests / totalTests) * 100).toFixed(1),
      categorySummary,
      failedTestDetails: failedTests,
      timestamp: new Date().toISOString()
    };

    return summary;
  }

  async runAllTests() {
    console.log('🧪 Starting Comprehensive API Test Suite...');
    console.log(`🎯 Testing against: ${this.baseUrl}`);
    console.log('⏱️  This may take a few minutes...');

    await this.testHealthEndpoint();
    await this.testAPIDocumentation();
    await this.testAdminAuthentication();
    await this.testOrganizationAuthentication();
    await this.testOrganizationManagement();
    await this.testConfigurationManagement();
    await this.testSIPTrunks();
    await this.testUsers();
    await this.testQueues();
    await this.testDIDs();
    await this.testWebhooks();
    await this.testCallManagement();
    await this.testAsteriskConnection();

    const report = this.generateReport();

    // Save detailed report to file
    const fs = require('fs');
    const reportData = {
      summary: report,
      detailedResults: this.results,
      createdResources: this.createdResources
    };

    fs.writeFileSync('api-test-results.json', JSON.stringify(reportData, null, 2));
    console.log('\\n💾 Detailed test results saved to: api-test-results.json');

    return report;
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new APITester();
  tester.runAllTests().then(report => {
    console.log('\\n🏁 Test suite completed!');
    process.exit(report.failedTests === 0 ? 0 : 1);
  }).catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = APITester;