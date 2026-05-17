'use strict';

/**
 * Test fixture factories — build deterministic queue/user/member objects
 * for unit tests without touching the DB. Mirrors the shape that the
 * Sequelize finders produce (toJSON output).
 */

function makeOrg(over = {}) {
  return {
    id: 'org-00000000-0000-0000-0000-000000000001',
    name: 'TestOrg',
    context_prefix: 'org_test',
    stasis_app: 'pbx_api',
    outboundRoutes: [{ trunk: { asterisk_peer_name: 'org_test_trunk' } }],
    settings: { recording_enabled: true },
    ...over,
  };
}

function makeUser(over = {}) {
  return {
    id: 'usr-00000000-0000-0000-0000-000000000001',
    full_name: 'Test User',
    username: 'testuser',
    extension: '1001',
    status: 'active',
    ring_target: 'ext',
    routing_type: 'sip',
    asterisk_endpoint: 'org_test_1001',
    phone_number: null,
    failover_destination_user_id: null,
    failover_phone_number: null,
    failover_timeout_seconds: 30,
    recording_enabled: true,
    ...over,
  };
}

function makeSoftphoneUser(over = {}) {
  return makeUser({ ring_target: 'ext', routing_type: 'sip', ...over });
}

function makePhoneTargetUser(over = {}) {
  return makeUser({
    ring_target: 'phone',
    routing_type: 'sip',
    phone_number: '+919876543210',
    asterisk_endpoint: null,
    ...over,
  });
}

function makeAiAgentUser(over = {}) {
  return makeUser({
    ring_target: 'ext',
    routing_type: 'ai_agent',
    routing_destination: 'agent-uuid-here',
    asterisk_endpoint: null,
    ...over,
  });
}

function makeInactiveUser(over = {}) {
  return makeUser({ status: 'inactive', ...over });
}

function makeQueueMember(user, over = {}) {
  return {
    id: 'qm0-00000000-0000-0000-0000-000000000001',
    user_id: user.id,
    user,
    penalty: 0,
    paused: false,
    ring_timeout_seconds: 20,
    ...over,
  };
}

function makeQueue(over = {}) {
  return {
    id: 'queue-00000000-0000-0000-0000-000000000001',
    org_id: 'org-00000000-0000-0000-0000-000000000001',
    name: 'TestQueue',
    number: '5001',
    asterisk_queue_name: 'org_test_5001',
    strategy: 'linear',
    timeout: 20,
    weight: 0,
    max_callers: 0,
    max_wait_time: 300,
    retry: 5,
    music_on_hold: 'default',
    join_empty: false,
    leave_when_empty: true,
    ring_inuse: false,
    members: [],
    timeout_destination: null,
    timeout_destination_type: 'extension',
    recording_enabled: true,
    ...over,
  };
}

function makeCdrRow(over = {}) {
  return {
    id: 1000,
    calldate: new Date(),
    src: '919876543210',
    dst: '918765432100',
    dcontext: 'org_test__incoming',
    channel: 'PJSIP/tata_gateway-00000001',
    dstchannel: 'PJSIP/org_test_1001-00000002',
    lastapp: 'Queue',
    lastdata: 'org_test_5001,ct,,,300',
    duration: 30,
    billsec: 25,
    disposition: 'ANSWERED',
    uniqueid: '1000000000.1',
    linkedid: '1000000000.1',
    recordingfile: '20260516-100000-919876543210-1001.wav',
    accountcode: 'org-00000000-0000-0000-0000-000000000001',
    peeraccount: '',
    ...over,
  };
}

module.exports = {
  makeOrg,
  makeUser,
  makeSoftphoneUser,
  makePhoneTargetUser,
  makeAiAgentUser,
  makeInactiveUser,
  makeQueueMember,
  makeQueue,
  makeCdrRow,
};
