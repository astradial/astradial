const {
  Organization,
  SipTrunk,
  DidNumber,
  User,
  Queue,
  QueueMember,
  Webhook
} = require('../models');

async function seedDatabase() {
  console.log('🌱 Seeding PBX API database...\n');

  try {
    // Create test organizations
    console.log('Creating test organizations...');
    const org1 = await Organization.create({
      name: 'Acme Corporation',
      context_prefix: 'acme_',
      api_key: 'acme_api_key_123456',
      api_secret: 'acme_secret_abcdef789',
      contact_info: {
        email: 'admin@acme.com',
        phone: '+1234567890',
        address: '123 Business St, City, State'
      },
      settings: {
        timezone: 'America/New_York',
        business_hours: {
          start: '09:00',
          end: '17:00',
          days: [1, 2, 3, 4, 5]
        }
      },
      limits: {
        max_users: 100,
        max_queues: 10,
        max_trunks: 5,
        max_dids: 50
      }
    });

    const org2 = await Organization.create({
      name: 'TechStart Inc',
      context_prefix: 'tech_',
      api_key: 'tech_api_key_789012',
      api_secret: 'tech_secret_xyz345def',
      contact_info: {
        email: 'support@techstart.com',
        phone: '+1987654321'
      },
      settings: {
        timezone: 'America/Los_Angeles',
        business_hours: {
          start: '08:00',
          end: '18:00',
          days: [1, 2, 3, 4, 5]
        }
      },
      limits: {
        max_users: 50,
        max_queues: 5,
        max_trunks: 2,
        max_dids: 25
      }
    });

    console.log(`✓ Created organizations: ${org1.name}, ${org2.name}`);

    // Create SIP trunks
    console.log('Creating SIP trunks...');
    const trunk1 = await SipTrunk.create({
      org_id: org1.id,
      name: 'Primary Trunk',
      host: 'sip.provider1.com',
      username: 'acme_trunk1',
      password: 'secure_password_123',
      port: 5060,
      transport: 'udp',
      max_channels: 30,
      configuration: {
        qualify: 'yes',
        nat: 'force_rport,comedia',
        canreinvite: 'no',
        dtmfmode: 'rfc2833'
      }
    });

    const trunk2 = await SipTrunk.create({
      org_id: org2.id,
      name: 'Main Provider',
      host: 'gateway.voipprovider.net',
      username: 'techstart_main',
      password: 'provider_pass_456',
      port: 5060,
      transport: 'tcp',
      max_channels: 15,
      configuration: {
        qualify: 'yes',
        nat: 'force_rport,comedia'
      }
    });

    console.log(`✓ Created SIP trunks: ${trunk1.name}, ${trunk2.name}`);

    // Create DID numbers
    console.log('Creating DID numbers...');
    await DidNumber.create({
      org_id: org1.id,
      trunk_id: trunk1.id,
      number: '+15551234567',
      description: 'Main Reception Line',
      routing_type: 'queue',
      routing_destination: 'support'
    });

    await DidNumber.create({
      org_id: org1.id,
      trunk_id: trunk1.id,
      number: '+15551234568',
      description: 'Sales Direct Line',
      routing_type: 'extension',
      routing_destination: '100'
    });

    await DidNumber.create({
      org_id: org2.id,
      trunk_id: trunk2.id,
      number: '+15559876543',
      description: 'Support Hotline',
      routing_type: 'queue',
      routing_destination: 'tech_support'
    });

    console.log('✓ Created DID numbers');

    // Create users
    console.log('Creating users...');
    const user1 = await User.create({
      org_id: org1.id,
      extension: '100',
      username: 'john.doe',
      password_hash: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeL5nALGMo8NWKgk.', // admin123
      sip_password: 'sip_admin_pass',
      asterisk_endpoint: 'acme_100',
      full_name: 'John Doe',
      email: 'john.doe@acme.com',
      role: 'admin',
      call_permissions: {
        internal: true,
        local: true,
        national: true,
        international: false,
        premium: false
      },
      voicemail_enabled: true,
      call_recording: true
    });

    const user2 = await User.create({
      org_id: org1.id,
      extension: '101',
      username: 'jane.smith',
      password_hash: '$2b$12$XG5l7vPMLQJE4zJ4PJOlCOWkz9QmWN5aMO5XH3mQUkJzQb1QXJQey', // agent123
      sip_password: 'sip_agent_pass',
      asterisk_endpoint: 'acme_101',
      full_name: 'Jane Smith',
      email: 'jane.smith@acme.com',
      role: 'agent',
      call_permissions: {
        internal: true,
        local: true,
        national: false,
        international: false,
        premium: false
      }
    });

    const user3 = await User.create({
      org_id: org2.id,
      extension: '200',
      username: 'mike.tech',
      password_hash: '$2b$12$ZzQJmWNHk8SLuD6jPNOtH.Wm3JNLzQ6jM2CeL9XKzN8L1VbNGVfG6', // tech123
      sip_password: 'sip_super_pass',
      asterisk_endpoint: 'tech_200',
      full_name: 'Mike Johnson',
      email: 'mike@techstart.com',
      role: 'supervisor',
      call_permissions: {
        internal: true,
        local: true,
        national: true,
        international: false,
        premium: false
      }
    });

    console.log(`✓ Created users: ${user1.full_name}, ${user2.full_name}, ${user3.full_name}`);

    // Create queues
    console.log('Creating queues...');
    const queue1 = await Queue.create({
      org_id: org1.id,
      name: 'Support Queue',
      number: '800',
      asterisk_queue_name: 'acme_support',
      strategy: 'leastrecent',
      timeout: 20,
      max_wait_time: 600,
      music_on_hold: 'default',
      configuration: {},
      recording_enabled: true,
      wrap_up_time: 30,
      announce_frequency: 45,
      announce_holdtime: true
    });

    const queue2 = await Queue.create({
      org_id: org2.id,
      name: 'Tech Support',
      number: '900',
      asterisk_queue_name: 'tech_support',
      strategy: 'ringall',
      timeout: 15,
      max_wait_time: 300,
      music_on_hold: 'tech_hold',
      configuration: {},
      recording_enabled: false,
      wrap_up_time: 15
    });

    console.log(`✓ Created queues: ${queue1.name}, ${queue2.name}`);

    // Add queue members
    console.log('Adding queue members...');
    await QueueMember.create({
      queue_id: queue1.id,
      user_id: user2.id,
      penalty: 0,
      paused: false
    });

    await QueueMember.create({
      queue_id: queue2.id,
      user_id: user3.id,
      penalty: 0,
      paused: false
    });

    console.log('✓ Added queue members');

    // Create webhooks
    console.log('Creating webhooks...');
    await Webhook.create({
      org_id: org1.id,
      url: 'https://api.acme.com/webhooks/pbx',
      events: ['call.initiated', 'call.answered', 'call.ended', 'queue.entered'],
      secret: 'acme_webhook_secret_123',
      retry_count: 3,
      timeout: 10000,
      headers: {
        'Authorization': 'Bearer acme_api_token'
      }
    });

    await Webhook.create({
      org_id: org2.id,
      url: 'https://techstart.com/api/call-events',
      events: ['call.answered', 'call.ended', 'queue.abandoned'],
      secret: 'tech_webhook_456',
      retry_count: 5,
      timeout: 5000
    });

    console.log('✓ Created webhooks');

    console.log('\n✅ Database seeding completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`   Organizations: 2`);
    console.log(`   SIP Trunks: 2`);
    console.log(`   DID Numbers: 3`);
    console.log(`   Users: 3`);
    console.log(`   Queues: 2`);
    console.log(`   Queue Members: 2`);
    console.log(`   Webhooks: 2`);

    console.log('\n🔐 Test Login Credentials:');
    console.log(`   Acme Corp Admin: john.doe / admin123`);
    console.log(`   Acme Corp Agent: jane.smith / agent123`);
    console.log(`   TechStart Supervisor: mike.tech / tech123`);

    console.log('\n🔑 API Keys for Testing:');
    console.log(`   Acme Corp: acme_api_key_123456`);
    console.log(`   TechStart: tech_api_key_789012`);

    process.exit(0);

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seedDatabase();