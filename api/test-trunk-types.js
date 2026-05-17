#!/usr/bin/env node

/**
 * Test script for all three trunk types:
 * - inbound: Register TO provider (requires username/password)
 * - outbound: Receive calls FROM provider (requires username/password)
 * - peer2peer: Mutual connection (authentication optional)
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';
const ORG_ID = '2c662bff-8f80-483a-8235-74fd48965a9c'; // TestOrg

// You need to get the API key from the admin endpoint
const API_KEY = process.env.API_KEY || 'your_api_key_here';

async function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
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

async function testInboundTrunk() {
  console.log('\n📥 Testing INBOUND Trunk (Register TO provider)...');
  console.log('='.repeat(60));

  const trunkData = {
    name: 'Test Inbound Registration Trunk',
    host: 'sip.provider.com',
    port: 5060,
    username: 'myusername',
    password: 'mypassword',
    transport: 'udp',
    trunk_type: 'inbound',
    retry_interval: 60,
    expiration: 3600,
    contact_user: 'myusername'
  };

  try {
    const response = await makeRequest('POST', '/api/v1/trunks', trunkData);

    if (response.status === 201) {
      console.log('✅ PASS: Inbound trunk created successfully');
      console.log('📋 Trunk ID:', response.data.id);
      console.log('📋 Type:', response.data.trunk_type);
      console.log('📋 Peer Name:', response.data.asterisk_peer_name);
      return response.data.id;
    } else {
      console.log('❌ FAIL: Expected status 201, got', response.status);
      console.log('Error:', response.data);
      return null;
    }
  } catch (error) {
    console.log('❌ ERROR:', error.message);
    return null;
  }
}

async function testOutboundTrunk() {
  console.log('\n📤 Testing OUTBOUND Trunk (Receive FROM provider)...');
  console.log('='.repeat(60));

  const trunkData = {
    name: 'Test Outbound Trunk',
    host: '203.0.113.10',
    port: 5060,
    username: 'trunk_user',
    password: 'trunk_pass',
    transport: 'udp',
    trunk_type: 'outbound'
  };

  try {
    const response = await makeRequest('POST', '/api/v1/trunks', trunkData);

    if (response.status === 201) {
      console.log('✅ PASS: Outbound trunk created successfully');
      console.log('📋 Trunk ID:', response.data.id);
      console.log('📋 Type:', response.data.trunk_type);
      console.log('📋 Peer Name:', response.data.asterisk_peer_name);
      return response.data.id;
    } else {
      console.log('❌ FAIL: Expected status 201, got', response.status);
      console.log('Error:', response.data);
      return null;
    }
  } catch (error) {
    console.log('❌ ERROR:', error.message);
    return null;
  }
}

async function testPeer2PeerTrunkWithAuth() {
  console.log('\n🤝 Testing PEER2PEER Trunk (WITH authentication)...');
  console.log('='.repeat(60));

  const trunkData = {
    name: 'Test Peer2Peer With Auth',
    host: '198.51.100.20',
    port: 5060,
    username: 'peer_user',
    password: 'peer_pass',
    transport: 'udp',
    trunk_type: 'peer2peer'
  };

  try {
    const response = await makeRequest('POST', '/api/v1/trunks', trunkData);

    if (response.status === 201) {
      console.log('✅ PASS: Peer2peer trunk with auth created successfully');
      console.log('📋 Trunk ID:', response.data.id);
      console.log('📋 Type:', response.data.trunk_type);
      console.log('📋 Peer Name:', response.data.asterisk_peer_name);
      return response.data.id;
    } else {
      console.log('❌ FAIL: Expected status 201, got', response.status);
      console.log('Error:', response.data);
      return null;
    }
  } catch (error) {
    console.log('❌ ERROR:', error.message);
    return null;
  }
}

async function testPeer2PeerTrunkWithoutAuth() {
  console.log('\n🤝 Testing PEER2PEER Trunk (WITHOUT authentication)...');
  console.log('='.repeat(60));

  const trunkData = {
    name: 'Test Peer2Peer No Auth',
    host: '198.51.100.30',
    port: 5060,
    transport: 'udp',
    trunk_type: 'peer2peer'
    // No username/password - should work for peer2peer
  };

  try {
    const response = await makeRequest('POST', '/api/v1/trunks', trunkData);

    if (response.status === 201) {
      console.log('✅ PASS: Peer2peer trunk without auth created successfully');
      console.log('📋 Trunk ID:', response.data.id);
      console.log('📋 Type:', response.data.trunk_type);
      console.log('📋 Peer Name:', response.data.asterisk_peer_name);
      return response.data.id;
    } else {
      console.log('❌ FAIL: Expected status 201, got', response.status);
      console.log('Error:', response.data);
      return null;
    }
  } catch (error) {
    console.log('❌ ERROR:', error.message);
    return null;
  }
}

async function testInboundWithoutAuth() {
  console.log('\n🚫 Testing INBOUND Trunk without auth (should FAIL)...');
  console.log('='.repeat(60));

  const trunkData = {
    name: 'Test Inbound No Auth',
    host: 'sip.provider.com',
    port: 5060,
    transport: 'udp',
    trunk_type: 'inbound'
    // Missing username/password - should fail
  };

  try {
    const response = await makeRequest('POST', '/api/v1/trunks', trunkData);

    if (response.status === 400) {
      console.log('✅ PASS: Correctly rejected inbound trunk without auth');
      console.log('📋 Error message:', response.data.error);
    } else {
      console.log('❌ FAIL: Expected status 400, got', response.status);
      console.log('Response:', response.data);
    }
  } catch (error) {
    console.log('❌ ERROR:', error.message);
  }
}

async function testOutboundWithoutAuth() {
  console.log('\n🚫 Testing OUTBOUND Trunk without auth (should FAIL)...');
  console.log('='.repeat(60));

  const trunkData = {
    name: 'Test Outbound No Auth',
    host: '203.0.113.40',
    port: 5060,
    transport: 'udp',
    trunk_type: 'outbound'
    // Missing username/password - should fail
  };

  try {
    const response = await makeRequest('POST', '/api/v1/trunks', trunkData);

    if (response.status === 400) {
      console.log('✅ PASS: Correctly rejected outbound trunk without auth');
      console.log('📋 Error message:', response.data.error);
    } else {
      console.log('❌ FAIL: Expected status 400, got', response.status);
      console.log('Response:', response.data);
    }
  } catch (error) {
    console.log('❌ ERROR:', error.message);
  }
}

async function listAllTrunks() {
  console.log('\n📋 Listing all trunks...');
  console.log('='.repeat(60));

  try {
    const response = await makeRequest('GET', '/api/v1/trunks');

    if (response.status === 200) {
      console.log(`Found ${response.data.length} trunk(s):`);
      response.data.forEach((trunk, index) => {
        console.log(`\n${index + 1}. ${trunk.name}`);
        console.log(`   Type: ${trunk.trunk_type}`);
        console.log(`   Host: ${trunk.host}:${trunk.port}`);
        console.log(`   Peer Name: ${trunk.asterisk_peer_name}`);
        console.log(`   Has Auth: ${trunk.username ? 'Yes' : 'No'}`);
      });
    } else {
      console.log('❌ Failed to list trunks:', response.status);
      console.log('Response:', response.data);
    }
  } catch (error) {
    console.log('❌ ERROR:', error.message);
  }
}

async function main() {
  console.log('🚀 Starting Trunk Types Test Suite');
  console.log('='.repeat(60));
  console.log(`Using API Key: ${API_KEY.substring(0, 10)}...`);

  // Test valid scenarios
  await testInboundTrunk();
  await testOutboundTrunk();
  await testPeer2PeerTrunkWithAuth();
  await testPeer2PeerTrunkWithoutAuth();

  // Test validation (should fail)
  await testInboundWithoutAuth();
  await testOutboundWithoutAuth();

  // List all trunks
  await listAllTrunks();

  console.log('\n✅ Test suite completed!');
  console.log('='.repeat(60));
}

// Run the tests
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { makeRequest };
