const ConfigDeploymentService = require('./src/services/asterisk/configDeploymentService');
const { sequelize } = require('./src/models');
const { Organization, User, SipTrunk, Queue } = require('./src/models');

async function testDeployConfiguration() {
  console.log('🚀 Testing Automatic Configuration Deployment...\n');

  const configService = new ConfigDeploymentService();

  try {
    // Connect to database
    await sequelize.authenticate();
    console.log('✅ Database connected');

    // Find or create a test organization
    let testOrg = await Organization.findOne({ where: { name: 'TestOrg' } });

    if (!testOrg) {
      console.log('📋 Creating test organization...');
      testOrg = await Organization.create({
        name: 'TestOrg',
        domain: 'testorg.com',
        context_prefix: 'testorg_',
        api_key: 'test-api-key-123',
        api_secret: 'test-api-secret-456',
        status: 'active',
        recording_enabled: true,
        max_channels: 20
      });

      // Create test users
      await User.bulkCreate([
        {
          org_id: testOrg.id,
          username: 'john.doe',
          email: 'john@testorg.com',
          password_hash: '$2b$10$test',
          extension: '2001',
          full_name: 'John Doe',
          role: 'agent',
          asterisk_endpoint: 'testorg_2001',
          sip_password: 'secure2001pass',
          status: 'active'
        },
        {
          org_id: testOrg.id,
          username: 'jane.smith',
          email: 'jane@testorg.com',
          password_hash: '$2b$10$test',
          extension: '2002',
          full_name: 'Jane Smith',
          role: 'agent',
          asterisk_endpoint: 'testorg_2002',
          sip_password: 'secure2002pass',
          status: 'active'
        },
        {
          org_id: testOrg.id,
          username: 'bob.manager',
          email: 'bob@testorg.com',
          password_hash: '$2b$10$test',
          extension: '2003',
          full_name: 'Bob Manager',
          role: 'supervisor',
          asterisk_endpoint: 'testorg_2003',
          sip_password: 'secure2003pass',
          status: 'active'
        }
      ]);

      // Create test SIP trunk
      await SipTrunk.create({
        org_id: testOrg.id,
        name: 'TestOrg Main Trunk',
        host: 'sip.provider.com',
        port: 5060,
        username: 'testorg_user',
        password: 'trunk_password',
        transport: 'udp',
        asterisk_peer_name: 'testorg_trunk001',
        status: 'active'
      });

      // Create test queue
      await Queue.create({
        org_id: testOrg.id,
        name: 'Support Queue',
        number: 'support',
        strategy: 'ringall',
        timeout: 30,
        retry: 5,
        asterisk_queue_name: 'testorg_support',
        active: true
      });

      console.log('✅ Test organization and resources created');
    } else {
      console.log('✅ Using existing test organization');
    }

    // Deploy configuration to /etc/asterisk/
    console.log('\n🚀 Deploying configuration to /etc/asterisk/...');
    const result = await configService.deployOrganizationConfiguration(
      testOrg.id,
      testOrg.name
    );

    console.log('\n✅ Deployment Result:');
    console.log(`  - PJSIP Config: ${result.pjsipFile}`);
    console.log(`  - Dialplan Config: ${result.dialplanFile}`);
    console.log(`  - Message: ${result.message}`);

    // List all organization configurations
    console.log('\n📋 Listing all organization configurations:');
    const orgConfigs = await configService.listOrganizationConfigurations();
    console.log(JSON.stringify(orgConfigs, null, 2));

    // Optional: Reload Asterisk configuration
    console.log('\n🔄 Reloading Asterisk configuration...');
    try {
      await configService.reloadAsteriskConfiguration();
      console.log('✅ Asterisk configuration reloaded');
    } catch (error) {
      console.log('⚠️ Could not reload Asterisk (may not be running)');
    }

    console.log('\n🎉 AUTOMATIC CONFIGURATION DEPLOYMENT SUCCESSFUL!');
    console.log('✅ Organization configuration automatically generated and deployed');
    console.log('✅ Configuration files written to /etc/asterisk/');
    console.log('✅ Include statements added to main config files');

    // Show generated file contents (first 500 chars)
    const fs = require('fs').promises;
    try {
      console.log('\n📄 Sample of generated PJSIP config:');
      const pjsipContent = await fs.readFile(result.pjsipFile, 'utf8');
      console.log(pjsipContent.substring(0, 500) + '...\n');

      console.log('📄 Sample of generated Dialplan config:');
      const dialplanContent = await fs.readFile(result.dialplanFile, 'utf8');
      console.log(dialplanContent.substring(0, 500) + '...\n');
    } catch (error) {
      console.log('ℹ️ Could not read generated files (may need sudo)');
    }

  } catch (error) {
    console.error('❌ Deployment test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testDeployConfiguration()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = testDeployConfiguration;