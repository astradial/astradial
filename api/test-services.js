// Simple service functionality test
const SipTrunkService = require('./src/services/asterisk/sipTrunkService');
const UserProvisioningService = require('./src/services/asterisk/userProvisioningService');
const QueueService = require('./src/services/asterisk/queueService');
const DialplanGenerator = require('./src/services/asterisk/dialplanGenerator');
const fs = require('fs').promises;

async function testServices() {
  console.log('🧪 Testing Core PBX Services...\n');

  try {
    // Test SIP Trunk Service
    console.log('🌐 Testing SIP Trunk Service...');
    const sipTrunkService = new SipTrunkService();

    // Mock organization data
    const mockOrg = {
      id: 'test-org-123',
      name: 'Test Organization',
      context_prefix: 'testorg_',
      users: [{
        id: 'user-1',
        extension: '2001',
        full_name: 'Test User',
        asterisk_endpoint: 'testorg_2001',
        sip_password: 'testpass123',
        recording_enabled: true
      }],
      queues: [{
        id: 'queue-1',
        name: 'Test Support Queue',
        number: 'support',
        strategy: 'ringall',
        timeout: 30,
        retry: 5,
        asterisk_queue_name: 'testorg_support'
      }],
      dids: [],
      routingRules: [],
      trunks: [{
        id: 'trunk-1',
        name: 'Test Trunk',
        host: 'sip.example.com',
        port: 5060,
        username: 'testuser',
        password: 'testpass',
        transport: 'udp',
        asterisk_peer_name: 'testorg_trunk001',
        status: 'active'
      }]
    };

    // Test transport configuration generation
    const transportConfig = await sipTrunkService.generateTransportConfiguration();
    console.log('✅ Transport configuration generated');
    console.log(`📝 Transport config preview: ${transportConfig.substring(0, 150)}...`);

    // Test single trunk configuration
    const singleTrunkConfig = sipTrunkService.generateSingleTrunkConfig(mockOrg.trunks[0], mockOrg);
    console.log('✅ Single trunk configuration generated');
    console.log(`📝 Trunk config preview: ${singleTrunkConfig.substring(0, 150)}...`);

    // Write to temp file
    const tempTrunkFile = '/tmp/test-trunk-config.conf';
    await fs.writeFile(tempTrunkFile, singleTrunkConfig);
    console.log(`✅ Trunk configuration written to: ${tempTrunkFile}`);

    // Test User Provisioning Service
    console.log('\n👤 Testing User Provisioning Service...');
    const userProvisioningService = new UserProvisioningService();

    const mockUser = mockOrg.users[0];

    // Test user configuration generation
    const userConfig = userProvisioningService.generateSingleUserConfig(mockUser, mockOrg);
    console.log('✅ User configuration generated');
    console.log(`📝 User config preview: ${userConfig.substring(0, 150)}...`);

    // Write to temp file
    const tempUserFile = '/tmp/test-user-config.conf';
    await fs.writeFile(tempUserFile, userConfig);
    console.log(`✅ User configuration written to: ${tempUserFile}`);

    // Test Queue Service
    console.log('\n📋 Testing Queue Service...');
    const queueService = new QueueService();

    const mockQueue = {
      ...mockOrg.queues[0],
      members: [{
        user: mockUser,
        penalty: 0,
        paused: false
      }]
    };

    // Test single queue configuration
    const queueConfig = queueService.generateSingleQueueConfig(mockQueue, mockOrg);
    console.log('✅ Queue configuration generated');
    console.log(`📝 Queue config preview: ${queueConfig.substring(0, 150)}...`);

    // Write to temp file
    const tempQueueFile = '/tmp/test-queue-config.conf';
    await fs.writeFile(tempQueueFile, queueConfig);
    console.log(`✅ Queue configuration written to: ${tempQueueFile}`);

    // Test Dialplan Generator
    console.log('\n📝 Testing Dialplan Generator...');
    const dialplanGenerator = new DialplanGenerator();

    // Mock data for dialplan
    const mockData = {
      organization: mockOrg,
      users: [mockUser],
      queues: [mockQueue],
      didNumbers: [{
        id: 'did-1',
        number: '+1234567890',
        routing_type: 'extension',
        routing_destination: '2001'
      }]
    };

    // Test user extension generation
    const userExtension = dialplanGenerator.generateUserExtension(mockUser, mockOrg);
    console.log('✅ User extension dialplan generated');
    console.log(`📝 Extension dialplan preview: ${userExtension.substring(0, 150)}...`);

    // Test queue extension generation
    const queueExtension = dialplanGenerator.generateQueueExtension(mockQueue, mockOrg);
    console.log('✅ Queue extension dialplan generated');
    console.log(`📝 Queue dialplan preview: ${queueExtension.substring(0, 150)}...`);

    // Generate complete dialplan context
    const internalContext = dialplanGenerator.generateInternalContext(mockOrg);
    console.log('✅ Internal context generated');
    console.log(`📝 Internal context preview: ${internalContext.substring(0, 150)}...`);

    // Generate complete dialplan
    const completeDialplan = `[${mockOrg.context_prefix}_internal]\n${internalContext}\n\n[${mockOrg.context_prefix}_incoming]\ninclude => ${mockOrg.context_prefix}_internal\n\n`;
    console.log('✅ Complete dialplan generated');

    // Write to temp file
    const tempDialplanFile = '/tmp/test-dialplan.conf';
    await fs.writeFile(tempDialplanFile, completeDialplan);
    console.log(`✅ Complete dialplan written to: ${tempDialplanFile}`);

    // Verify all files were created
    console.log('\n🔍 Verifying generated files...');
    const files = [tempTrunkFile, tempUserFile, tempQueueFile, tempDialplanFile];

    for (const file of files) {
      const stats = await fs.stat(file);
      console.log(`✅ ${file}: ${stats.size} bytes`);
    }

    // Test if Asterisk is responsive
    console.log('\n🔧 Testing Asterisk CLI (if available)...');
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync('asterisk -rx "core show version"');
      if (stdout.includes('Asterisk')) {
        console.log('✅ Asterisk is running and responsive');
        console.log(`📊 Version: ${stdout.split('\n')[0]}`);
      }
    } catch (error) {
      console.log('⚠️ Asterisk CLI test skipped (may not be running or accessible)');
    }

    // Clean up temp files
    console.log('\n🧹 Cleaning up...');
    for (const file of files) {
      try {
        await fs.unlink(file);
        console.log(`✅ Removed: ${file}`);
      } catch (error) {
        console.log(`⚠️ Could not remove: ${file}`);
      }
    }

    console.log('\n🎉 ALL SERVICE TESTS PASSED!');
    console.log('✅ SIP Trunk Service: Working');
    console.log('✅ User Provisioning Service: Working');
    console.log('✅ Queue Service: Working');
    console.log('✅ Dialplan Generator: Working');
    console.log('✅ Configuration File Generation: Working');

    return true;

  } catch (error) {
    console.error('❌ Service test failed:', error.message);
    console.error(error.stack);
    return false;
  }
}

// Run the tests
if (require.main === module) {
  testServices().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = testServices;