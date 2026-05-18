const { Organization, SipTrunk, OutboundRoute } = require('./src/models');

async function createTestOutboundRoute() {
  try {
    // Find first active organization
    const org = await Organization.findOne({ where: { status: 'active' } });
    if (!org) {
      console.log('❌ No active organization found');
      return;
    }

    console.log(`✅ Found organization: ${org.name} (${org.id})`);

    // Find first active SIP trunk for this org
    const trunk = await SipTrunk.findOne({
      where: { org_id: org.id, status: 'active' }
    });

    if (!trunk) {
      console.log('❌ No active SIP trunk found for this organization');
      console.log('Creating a test SIP trunk...');

      const newTrunk = await SipTrunk.create({
        org_id: org.id,
        name: 'Test SIP Provider',
        host: 'sip.testprovider.com',
        port: 5060,
        transport: 'udp',
        username: 'testuser',
        password: 'testpass',
        asterisk_peer_name: `trunk_${org.context_prefix}test`,
        status: 'active'
      });

      console.log(`✅ Created test trunk: ${newTrunk.name} (${newTrunk.asterisk_peer_name})`);
      trunk = newTrunk;
    } else {
      console.log(`✅ Found trunk: ${trunk.name} (${trunk.asterisk_peer_name})`);
    }

    // Check if outbound route already exists
    const existingRoute = await OutboundRoute.findOne({
      where: { org_id: org.id, trunk_id: trunk.id }
    });

    if (existingRoute) {
      console.log(`✅ Outbound route already exists: ${existingRoute.name}`);
      console.log(JSON.stringify(existingRoute.toJSON(), null, 2));
      return;
    }

    // Create test outbound route
    const route = await OutboundRoute.create({
      org_id: org.id,
      trunk_id: trunk.id,
      name: 'US/Canada Long Distance',
      dial_pattern: '_1NXXNXXXXXX',
      strip_digits: 0,
      prepend_digits: null,
      route_type: 'long_distance',
      priority: 10,
      caller_id_override: null,
      caller_id_name_override: null,
      recording_enabled: false,
      status: 'active'
    });

    console.log(`✅ Created outbound route: ${route.name}`);
    console.log(JSON.stringify(route.toJSON(), null, 2));

    // Now generate dialplan to test
    const DialplanGenerator = require('./src/services/asterisk/dialplanGenerator');
    const generator = new DialplanGenerator();

    console.log('\n🎯 Generating dialplan...');
    const dialplans = await generator.generateDialplansForOrganization(org.id);

    console.log('\n📋 Outbound Context:');
    console.log(dialplans.contexts[`${org.context_prefix}_outbound`]);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

createTestOutboundRoute();
