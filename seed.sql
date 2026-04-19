-- Mock data seed for org d247b87d-5c25-4b80-89bb-9c0edc72ea04 (sample org, prefix org_mo3yhd1r_)
SET @org = 'd247b87d-5c25-4b80-89bb-9c0edc72ea04';
SET @prefix = 'org_mo3yhd1r_';
SET @now = NOW();
SET @bcrypt = '$2b$10$K1p1mHZ2N5XhT8Qn7VyGZe9dPlJmRs4yL8qB0XwEcF3tU2nKdA1Oq'; -- placeholder, any hash
SET FOREIGN_KEY_CHECKS=0;

-- ============================================================
-- SIP TRUNKS
-- ============================================================
SET @trunk1='10000000-0000-0000-0000-000000000001';
SET @trunk2='10000000-0000-0000-0000-000000000002';
SET @trunk3='10000000-0000-0000-0000-000000000003';
INSERT INTO sip_trunks (id, org_id, name, host, username, password, port, transport, trunk_type, max_channels, status, asterisk_peer_name, registration_status, configuration, created_at, updated_at) VALUES
(@trunk1, @org, 'Twilio Primary', 'sip.twilio.com', 'twilio_user', 'secret123', 5060, 'udp', 'outbound', 30, 'active', CONCAT(@prefix,'trunk_twilio'), 'registered', '{}', @now, @now),
(@trunk2, @org, 'Vonage Backup', 'sip.vonage.com', 'vonage_user', 'secret456', 5060, 'tcp', 'outbound', 20, 'active', CONCAT(@prefix,'trunk_vonage'), 'registered', '{}', @now, @now),
(@trunk3, @org, 'ACME VoIP', 'voip.acme.com', 'acme_user', 'secret789', 5060, 'udp', 'peer2peer', 10, 'inactive', CONCAT(@prefix,'trunk_acme'), 'unregistered', '{}', @now, @now);

-- ============================================================
-- USERS (SIP endpoints)
-- ============================================================
SET @u1='20000000-0000-0000-0000-000000000001';
SET @u2='20000000-0000-0000-0000-000000000002';
SET @u3='20000000-0000-0000-0000-000000000003';
SET @u4='20000000-0000-0000-0000-000000000004';
SET @u5='20000000-0000-0000-0000-000000000005';
SET @u6='20000000-0000-0000-0000-000000000006';
INSERT INTO users (id, org_id, username, email, extension, full_name, role, status, password_hash, sip_password, asterisk_endpoint, recording_enabled, routing_type, ring_target, phone_number, created_at, updated_at) VALUES
(@u1, @org, CONCAT(@prefix,'1001'), 'alice@example.com', '1001', 'Alice Johnson', 'agent',      'active', @bcrypt, 'sip_alice_1001', CONCAT(@prefix,'1001'), 1, 'sip', 'ext', NULL, @now, @now),
(@u2, @org, CONCAT(@prefix,'1002'), 'bob@example.com',   '1002', 'Bob Smith',      'agent',      'active', @bcrypt, 'sip_bob_1002',   CONCAT(@prefix,'1002'), 0, 'sip', 'ext', NULL, @now, @now),
(@u3, @org, CONCAT(@prefix,'1003'), 'carol@example.com', '1003', 'Carol White',    'agent',      'active', @bcrypt, 'sip_carol_1003', CONCAT(@prefix,'1003'), 1, 'sip', 'ext', NULL, @now, @now),
(@u4, @org, CONCAT(@prefix,'1004'), 'dan@example.com',   '1004', 'Dan Lee',        'supervisor', 'active', @bcrypt, 'sip_dan_1004',   CONCAT(@prefix,'1004'), 1, 'sip', 'ext', NULL, @now, @now),
(@u5, @org, CONCAT(@prefix,'1005'), 'emma@example.com',  '1005', 'Emma Davis',     'supervisor', 'active', @bcrypt, 'sip_emma_1005',  CONCAT(@prefix,'1005'), 0, 'sip', 'ext', NULL, @now, @now),
(@u6, @org, CONCAT(@prefix,'1006'), 'frank@example.com', '1006', 'Frank Brown',    'admin',      'active', @bcrypt, 'sip_frank_1006', CONCAT(@prefix,'1006'), 0, 'sip', 'ext', NULL, @now, @now);

-- ============================================================
-- ORG_USERS (dashboard logins; admin@example.com owner already created via UI)
-- ============================================================
INSERT INTO org_users (id, org_id, email, name, password_hash, role, status, extension) VALUES
('21000000-0000-0000-0000-000000000001', @org, 'alice@example.com', 'Alice Johnson', @bcrypt, 'agent',   'active', '1001'),
('21000000-0000-0000-0000-000000000002', @org, 'bob@example.com',   'Bob Smith',     @bcrypt, 'agent',   'active', '1002'),
('21000000-0000-0000-0000-000000000003', @org, 'carol@example.com', 'Carol White',   @bcrypt, 'agent',   'active', '1003'),
('21000000-0000-0000-0000-000000000004', @org, 'dan@example.com',   'Dan Lee',       @bcrypt, 'manager', 'active', '1004'),
('21000000-0000-0000-0000-000000000005', @org, 'emma@example.com',  'Emma Davis',    @bcrypt, 'manager', 'active', '1005'),
('21000000-0000-0000-0000-000000000006', @org, 'frank@example.com', 'Frank Brown',   @bcrypt, 'admin',   'active', '1006');

-- ============================================================
-- QUEUES
-- ============================================================
SET @q1='30000000-0000-0000-0000-000000000001';
SET @q2='30000000-0000-0000-0000-000000000002';
SET @q3='30000000-0000-0000-0000-000000000003';
INSERT INTO queues (id, org_id, name, number, strategy, status, configuration, created_at, updated_at) VALUES
(@q1, @org, 'Sales',   '2001', 'ringall',    'active', '{}', @now, @now),
(@q2, @org, 'Support', '2002', 'roundrobin', 'active', '{}', @now, @now),
(@q3, @org, 'Billing', '2003', 'leastrecent','active', '{}', @now, @now);

-- ============================================================
-- QUEUE_MEMBERS
-- ============================================================
INSERT INTO queue_members (id, queue_id, user_id, penalty, paused, membership, status, added_at, updated_at) VALUES
('31000000-0000-0000-0000-000000000001', @q1, @u1, 0, 0, 'static', 'available', @now, @now),
('31000000-0000-0000-0000-000000000002', @q1, @u2, 0, 0, 'static', 'available', @now, @now),
('31000000-0000-0000-0000-000000000003', @q2, @u3, 0, 0, 'static', 'available', @now, @now),
('31000000-0000-0000-0000-000000000004', @q2, @u2, 1, 0, 'dynamic','busy',      @now, @now),
('31000000-0000-0000-0000-000000000005', @q3, @u1, 0, 0, 'static', 'available', @now, @now),
('31000000-0000-0000-0000-000000000006', @q3, @u4, 0, 1, 'static', 'paused',    @now, @now);

-- ============================================================
-- DID_NUMBERS
-- ============================================================
INSERT INTO did_numbers (id, org_id, trunk_id, number, description, routing_type, routing_destination, status, call_limit, created_at, updated_at) VALUES
('40000000-0000-0000-0000-000000000001', @org, @trunk1, '+18005551001', 'Sales line',      'queue',     '2001', 'active', 10, @now, @now),
('40000000-0000-0000-0000-000000000002', @org, @trunk1, '+18005551002', 'Support line',    'queue',     '2002', 'active', 10, @now, @now),
('40000000-0000-0000-0000-000000000003', @org, @trunk2, '+18005551003', 'Main IVR',        'ivr',       '9000', 'active', 20, @now, @now),
('40000000-0000-0000-0000-000000000004', @org, @trunk2, '+919876543210','India line',      'extension', '1001', 'active', 5,  @now, @now);

-- ============================================================
-- OUTBOUND_ROUTES
-- ============================================================
INSERT INTO outbound_routes (id, org_id, name, description, trunk_id, dial_pattern, dial_prefix, strip_digits, route_type, status, created_at, updated_at) VALUES
('50000000-0000-0000-0000-000000000001', @org, 'Local Calls',         'US local',      @trunk1, '_NXXNXXXXXX', NULL, 0, 'local',         'active', @now, @now),
('50000000-0000-0000-0000-000000000002', @org, 'Long Distance',       'US LD',         @trunk1, '_1NXXNXXXXXX', NULL, 0, 'long_distance','active', @now, @now),
('50000000-0000-0000-0000-000000000003', @org, 'International',       'Global',        @trunk2, '_011.',      NULL, 0, 'international', 'active', @now, @now);

-- ============================================================
-- GREETINGS
-- ============================================================
SET @g1='60000000-0000-0000-0000-000000000001';
SET @g2='60000000-0000-0000-0000-000000000002';
SET @g3='60000000-0000-0000-0000-000000000003';
INSERT INTO greetings (id, org_id, name, text, language, voice, status, created_at, updated_at) VALUES
(@g1, @org, 'Main Welcome', 'Welcome to Sample Org. Press 1 for sales, 2 for support, 3 for billing.', 'en-IN', 'en-IN-Wavenet-D', 'active', @now, @now),
(@g2, @org, 'After Hours',  'We are currently closed. Please call back Monday through Friday 9 to 6.',   'en-IN', 'en-IN-Wavenet-D', 'active', @now, @now),
(@g3, @org, 'Holiday',      'We are closed for the holiday. Wishing you a happy season.',                 'en-IN', 'en-IN-Wavenet-D', 'inactive', @now, @now);

-- ============================================================
-- IVRS + IVR_MENUS
-- ============================================================
SET @ivr1='70000000-0000-0000-0000-000000000001';
INSERT INTO ivrs (id, org_id, name, extension, description, timeout, max_retries, enable_direct_dial, status, created_at, updated_at) VALUES
(@ivr1, @org, 'Main IVR', '9000', 'Main phone tree', 10, 3, 1, 'active', @now, @now);

INSERT INTO ivr_menus (id, ivr_id, digit, action_type, action_destination, description, `order`, created_at, updated_at) VALUES
('71000000-0000-0000-0000-000000000001', @ivr1, '1', 'queue',     '2001', 'Sales queue',     1, @now, @now),
('71000000-0000-0000-0000-000000000002', @ivr1, '2', 'queue',     '2002', 'Support queue',   2, @now, @now),
('71000000-0000-0000-0000-000000000003', @ivr1, '3', 'queue',     '2003', 'Billing queue',   3, @now, @now),
('71000000-0000-0000-0000-000000000004', @ivr1, '0', 'extension', '1006', 'Operator',        4, @now, @now);

-- ============================================================
-- ROUTING_RULES
-- ============================================================
INSERT INTO routing_rules (id, org_id, name, description, priority, conditions, action_type, action_data, active, time_restrictions, fallback_action, match_count, created_at, updated_at) VALUES
('80000000-0000-0000-0000-000000000001', @org, 'Business Hours → IVR',  'Route inbound to main IVR during business hours', 100, '{"hours":"9-18","days":"mon-fri"}', 'ivr',       '{"extension":"9000"}', 1, '{}', '{}', 42, @now, @now),
('80000000-0000-0000-0000-000000000002', @org, 'After Hours → VM',      'Voicemail after hours',                           90,  '{"hours":"else"}',                   'voicemail', '{"mailbox":"1006"}',   1, '{}', '{}', 17, @now, @now),
('80000000-0000-0000-0000-000000000003', @org, 'Blocked Numbers',       'Hang up on known spam',                          110, '{"from":["+18005559999"]}',          'hangup',    '{}',                   1, '{}', '{}', 3,  @now, @now);

-- ============================================================
-- WEBHOOKS
-- ============================================================
INSERT INTO webhooks (id, org_id, url, events, secret, active, retry_count, `timeout`, headers, delivery_method, content_type, ssl_verify, description, rate_limit, statistics, created_at, updated_at) VALUES
('90000000-0000-0000-0000-000000000001', @org, 'https://hooks.example.com/crm',   '["call.ended","call.answered"]', 'whsec_abc123', 1, 3, 30, '{"X-Source":"astradial"}', 'POST', 'application/json', 1, 'CRM sync',  '{"per_minute":60}', '{"sent":128,"failed":2}', @now, @now),
('90000000-0000-0000-0000-000000000002', @org, 'https://hooks.example.com/slack', '["call.missed"]',                NULL,           1, 3, 15, '{}',                       'POST', 'application/json', 1, 'Slack alerts','{"per_minute":30}', '{"sent":34,"failed":0}',  @now, @now);

-- ============================================================
-- ORG_API_KEYS
-- ============================================================
INSERT INTO org_api_keys (id, org_id, name, api_key, api_secret_hash, status, created_by, created_at, updated_at) VALUES
('a0000000-0000-0000-0000-000000000001', @org, 'Production Key', 'ak_prod_sample_1234567890abcdef', @bcrypt, 'active', 'admin@example.com', @now, @now),
('a0000000-0000-0000-0000-000000000002', @org, 'Dev Key',        'ak_dev_sample_abcdef1234567890',  @bcrypt, 'active', 'admin@example.com', @now, @now);

-- ============================================================
-- ORG_COMPLIANCE
-- ============================================================
INSERT INTO org_compliance (org_id, recording_enabled, recording_consent, retention_cdr_days, retention_recording_days, pii_masking, data_encryption) VALUES
(@org, 1, 'announcement', 365, 180, 0, 1);

-- ============================================================
-- CRM: PIPELINE STAGES
-- ============================================================
INSERT INTO crm_pipeline_stages (id, org_id, pipeline, stage_key, stage_label, sort_order, created_at, updated_at) VALUES
('b0000000-0000-0000-0000-000000000001', @org, 'lead', 'new',         'New',         1, @now, @now),
('b0000000-0000-0000-0000-000000000002', @org, 'lead', 'contacted',   'Contacted',   2, @now, @now),
('b0000000-0000-0000-0000-000000000003', @org, 'lead', 'qualified',   'Qualified',   3, @now, @now),
('b0000000-0000-0000-0000-000000000004', @org, 'lead', 'unqualified', 'Unqualified', 4, @now, @now),
('b0000000-0000-0000-0000-000000000005', @org, 'deal', 'lead',        'Lead',        1, @now, @now),
('b0000000-0000-0000-0000-000000000006', @org, 'deal', 'proposal',    'Proposal',    2, @now, @now),
('b0000000-0000-0000-0000-000000000007', @org, 'deal', 'negotiation', 'Negotiation', 3, @now, @now),
('b0000000-0000-0000-0000-000000000008', @org, 'deal', 'won',         'Won',         4, @now, @now),
('b0000000-0000-0000-0000-000000000009', @org, 'deal', 'lost',        'Lost',        5, @now, @now);

-- ============================================================
-- CRM: COMPANIES
-- ============================================================
SET @c1='c0000000-0000-0000-0000-000000000001';
SET @c2='c0000000-0000-0000-0000-000000000002';
SET @c3='c0000000-0000-0000-0000-000000000003';
SET @c4='c0000000-0000-0000-0000-000000000004';
SET @c5='c0000000-0000-0000-0000-000000000005';
INSERT INTO crm_companies (id, org_id, name, industry, size, phone, email, website, address, notes, created_at, updated_at) VALUES
(@c1, @org, 'Acme Corporation', 'Manufacturing', '201-500', '+18005550101', 'info@acme.com',     'https://acme.com',      '100 Industrial Way, Detroit',      'Key account, renewed 2026',       @now, @now),
(@c2, @org, 'TechInnovate',     'Software',      '51-200',  '+18005550102', 'hello@techinnovate.io','https://techinnovate.io','San Francisco HQ',                'Hot lead, demo scheduled',        @now, @now),
(@c3, @org, 'Global Logistics', 'Shipping',      '500+',    '+18005550103', 'contact@globallog.com','https://globallog.com', 'Rotterdam',                        'Multi-region contract',           @now, @now),
(@c4, @org, 'Bright Solutions', 'Consulting',    '11-50',   '+18005550104', 'sales@bright.co',   'https://bright.co',     'Austin TX',                        'Onboarding in progress',          @now, @now),
(@c5, @org, 'NovaWare',         'SaaS',          '1-10',    '+18005550105', 'hi@novaware.app',   'https://novaware.app',  'Remote-first, Europe',             'Churn risk — flag Dan',           @now, @now);

-- ============================================================
-- CRM: CONTACTS
-- ============================================================
SET @ct1='c1000000-0000-0000-0000-000000000001';
SET @ct2='c1000000-0000-0000-0000-000000000002';
SET @ct3='c1000000-0000-0000-0000-000000000003';
SET @ct4='c1000000-0000-0000-0000-000000000004';
SET @ct5='c1000000-0000-0000-0000-000000000005';
SET @ct6='c1000000-0000-0000-0000-000000000006';
SET @ct7='c1000000-0000-0000-0000-000000000007';
SET @ct8='c1000000-0000-0000-0000-000000000008';
SET @ct9='c1000000-0000-0000-0000-000000000009';
SET @ct10='c1000000-0000-0000-0000-000000000010';
INSERT INTO crm_contacts (id, org_id, company_id, first_name, last_name, email, phone, job_title, lead_source, lead_status, notes, created_at, updated_at) VALUES
(@ct1,  @org, @c1, 'Jane',    'Doe',        'jane.doe@acme.com',      '+18005550201', 'VP Operations',   'referral',    'qualified',  'Decision maker',       @now, @now),
(@ct2,  @org, @c1, 'Marcus',  'Lee',        'marcus@acme.com',        '+18005550202', 'IT Director',     'website',     'contacted',  NULL,                   @now, @now),
(@ct3,  @org, @c2, 'Priya',   'Sharma',     'priya@techinnovate.io',  '+18005550203', 'CTO',             'event',       'qualified',  'Met at SaaStr',        @now, @now),
(@ct4,  @org, @c2, 'Oliver',  'Brown',      'oliver@techinnovate.io', '+18005550204', 'Head of Eng',     'website',     'new',        NULL,                   @now, @now),
(@ct5,  @org, @c3, 'Ingrid',  'van Dijk',   'ingrid@globallog.com',   '+18005550205', 'Logistics Mgr',   'cold_call',   'contacted',  'Prefers email',        @now, @now),
(@ct6,  @org, @c3, 'Kenji',   'Tanaka',     'kenji@globallog.com',    '+18005550206', 'Regional Dir',    'referral',    'new',        NULL,                   @now, @now),
(@ct7,  @org, @c4, 'Sofia',   'Alvarez',    'sofia@bright.co',        '+18005550207', 'CEO',             'social',      'qualified',  'Champion for us',      @now, @now),
(@ct8,  @org, @c4, 'David',   'Nguyen',     'david@bright.co',        '+18005550208', 'Ops Lead',        'website',     'contacted',  NULL,                   @now, @now),
(@ct9,  @org, @c5, 'Lena',    'Petrov',     'lena@novaware.app',      '+18005550209', 'Founder',         'event',       'unqualified','Too small fit',        @now, @now),
(@ct10, @org, @c5, 'Amir',    'Khoury',     'amir@novaware.app',      '+18005550210', 'Growth Lead',     'advertisement','new',       NULL,                   @now, @now);

-- ============================================================
-- CRM: DEALS
-- ============================================================
SET @d1='d0000000-0000-0000-0000-000000000001';
SET @d2='d0000000-0000-0000-0000-000000000002';
SET @d3='d0000000-0000-0000-0000-000000000003';
SET @d4='d0000000-0000-0000-0000-000000000004';
SET @d5='d0000000-0000-0000-0000-000000000005';
SET @d6='d0000000-0000-0000-0000-000000000006';
INSERT INTO crm_deals (id, org_id, company_id, contact_id, title, stage, amount, currency, expected_close, notes, created_at, updated_at) VALUES
(@d1, @org, @c1, @ct1, 'Acme — Call Center Expansion', 'negotiation', 120000.00, 'USD', '2026-05-15', 'Decision by EOQ',           @now, @now),
(@d2, @org, @c2, @ct3, 'TechInnovate — Annual License', 'proposal',    48000.00,  'USD', '2026-05-30', 'Waiting on procurement',    @now, @now),
(@d3, @org, @c3, @ct5, 'Global Logistics — EU Region',  'lead',        280000.00, 'EUR', '2026-07-01', 'Early stage',               @now, @now),
(@d4, @org, @c4, @ct7, 'Bright — Upgrade',              'won',         32000.00,  'USD', '2026-04-10', 'Closed last week',          @now, @now),
(@d5, @org, @c5, @ct10,'NovaWare — Starter Plan',       'lost',        6000.00,   'USD', '2026-03-20', 'Went with competitor',      @now, @now),
(@d6, @org, @c1, @ct2, 'Acme — IT Services Add-on',     'proposal',    18000.00,  'USD', '2026-06-10', 'Upsell on existing',        @now, @now);

-- ============================================================
-- CRM: ACTIVITIES
-- ============================================================
INSERT INTO crm_activities (id, org_id, contact_id, company_id, deal_id, type, subject, body, due_date, completed, created_at, updated_at) VALUES
('e0000000-0000-0000-0000-000000000001', @org, @ct1,  @c1, @d1,  'call',    'Discovery call',           'Initial scoping call — 45 min',          DATE_SUB(@now, INTERVAL 10 DAY), 1, @now, @now),
('e0000000-0000-0000-0000-000000000002', @org, @ct1,  @c1, @d1,  'email',   'Proposal sent',            'Sent v2 pricing deck',                   DATE_SUB(@now, INTERVAL 7 DAY),  1, @now, @now),
('e0000000-0000-0000-0000-000000000003', @org, @ct1,  @c1, @d1,  'meeting', 'Negotiation call',         'Review terms with procurement',          DATE_ADD(@now, INTERVAL 3 DAY),  0, @now, @now),
('e0000000-0000-0000-0000-000000000004', @org, @ct3,  @c2, @d2,  'call',    'Demo call',                'Product demo for CTO + team',            DATE_SUB(@now, INTERVAL 4 DAY),  1, @now, @now),
('e0000000-0000-0000-0000-000000000005', @org, @ct3,  @c2, @d2,  'task',    'Send MSA draft',           NULL,                                     DATE_ADD(@now, INTERVAL 1 DAY),  0, @now, @now),
('e0000000-0000-0000-0000-000000000006', @org, @ct5,  @c3, @d3,  'email',   'Intro email',              'Sent intro + capabilities deck',         DATE_SUB(@now, INTERVAL 2 DAY),  1, @now, @now),
('e0000000-0000-0000-0000-000000000007', @org, @ct5,  @c3, @d3,  'call',    'Discovery call scheduled', NULL,                                     DATE_ADD(@now, INTERVAL 5 DAY),  0, @now, @now),
('e0000000-0000-0000-0000-000000000008', @org, @ct7,  @c4, @d4,  'meeting', 'Kickoff',                  'Kickoff with Bright Solutions team',     DATE_SUB(@now, INTERVAL 14 DAY), 1, @now, @now),
('e0000000-0000-0000-0000-000000000009', @org, @ct7,  @c4, @d4,  'note',    'Contract signed',          'DocuSign completed by Sofia',            DATE_SUB(@now, INTERVAL 12 DAY), 1, @now, @now),
('e0000000-0000-0000-0000-000000000010', @org, @ct10, @c5, @d5,  'call',    'Loss review',              'Went with cheaper competitor',           DATE_SUB(@now, INTERVAL 20 DAY), 1, @now, @now),
('e0000000-0000-0000-0000-000000000011', @org, @ct2,  @c1, @d6,  'email',   'Upsell pitch',             NULL,                                     DATE_SUB(@now, INTERVAL 1 DAY),  1, @now, @now),
('e0000000-0000-0000-0000-000000000012', @org, @ct2,  @c1, @d6,  'task',    'Follow up in 3 days',      NULL,                                     DATE_ADD(@now, INTERVAL 3 DAY),  0, @now, @now),
('e0000000-0000-0000-0000-000000000013', @org, @ct4,  @c2, NULL, 'note',    'Warm handoff from Priya',  'Oliver is technical champion',           @now,                            0, @now, @now),
('e0000000-0000-0000-0000-000000000014', @org, @ct8,  @c4, NULL, 'call',    'Onboarding check-in',      'Ops going well',                         DATE_SUB(@now, INTERVAL 5 DAY),  1, @now, @now),
('e0000000-0000-0000-0000-000000000015', @org, @ct6,  @c3, @d3,  'email',   'NDA sent',                 NULL,                                     DATE_ADD(@now, INTERVAL 2 DAY),  0, @now, @now);

-- ============================================================
-- CRM: CUSTOM FIELDS + VALUES
-- ============================================================
SET @cf1='f0000000-0000-0000-0000-000000000001';
SET @cf2='f0000000-0000-0000-0000-000000000002';
SET @cf3='f0000000-0000-0000-0000-000000000003';
INSERT INTO crm_custom_fields (id, org_id, entity_type, field_name, field_label, field_type, required, sort_order, created_at, updated_at) VALUES
(@cf1, @org, 'contact', 'preferred_contact_time', 'Preferred Contact Time', 'select', 0, 1, @now, @now),
(@cf2, @org, 'company', 'tier',                   'Account Tier',           'select', 0, 2, @now, @now),
(@cf3, @org, 'deal',    'competitor',             'Competitor',             'text',   0, 3, @now, @now);

INSERT INTO crm_custom_field_values (id, field_id, entity_id, value, created_at, updated_at) VALUES
('f1000000-0000-0000-0000-000000000001', @cf1, @ct1,  'Morning',     @now, @now),
('f1000000-0000-0000-0000-000000000002', @cf1, @ct3,  'Afternoon',   @now, @now),
('f1000000-0000-0000-0000-000000000003', @cf2, @c1,   'Platinum',    @now, @now),
('f1000000-0000-0000-0000-000000000004', @cf2, @c3,   'Gold',        @now, @now),
('f1000000-0000-0000-0000-000000000005', @cf3, @d5,   'RivalCo Inc', @now, @now);

-- ============================================================
-- CALL_RECORDS (30 mixed inbound/outbound/internal)
-- ============================================================
INSERT INTO call_records (id, org_id, call_id, channel_id, from_number, to_number, caller_id_name, direction, status, trunk_id, user_id, queue_id, started_at, answered_at, ended_at, duration, talk_time, wait_time, hangup_cause, cost, variables, asterisk_uniqueid, transfer_info, conference_info, billing_info, created_at, updated_at) VALUES
-- Inbound answered
('ca000000-0000-0000-0000-000000000001', @org, 'call_001', 'PJSIP/1001-0001', '+18005552001', '+18005551001', 'Customer 1', 'inbound','completed',@trunk1, @u1, @q1, DATE_SUB(@now, INTERVAL 2 HOUR),  DATE_SUB(@now, INTERVAL 119 MINUTE), DATE_SUB(@now, INTERVAL 112 MINUTE),  420, 410, 10, 'NORMAL_CLEARING',    0.15, '{}', 'uniq_001', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000002', @org, 'call_002', 'PJSIP/1002-0002', '+18005552002', '+18005551001', 'Customer 2', 'inbound','completed',@trunk1, @u2, @q1, DATE_SUB(@now, INTERVAL 3 HOUR),  DATE_SUB(@now, INTERVAL 179 MINUTE), DATE_SUB(@now, INTERVAL 170 MINUTE),  540, 525, 15, 'NORMAL_CLEARING',    0.21, '{}', 'uniq_002', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000003', @org, 'call_003', 'PJSIP/1003-0003', '+18005552003', '+18005551002', 'Customer 3', 'inbound','completed',@trunk1, @u3, @q2, DATE_SUB(@now, INTERVAL 4 HOUR),  DATE_SUB(@now, INTERVAL 239 MINUTE), DATE_SUB(@now, INTERVAL 232 MINUTE),  420, 410, 10, 'NORMAL_CLEARING',    0.15, '{}', 'uniq_003', '{}', '{}', '{}', @now, @now),
-- Inbound missed / no_answer
('ca000000-0000-0000-0000-000000000004', @org, 'call_004', 'PJSIP/1004-0004', '+18005552004', '+18005551001', 'Customer 4', 'inbound','no_answer',@trunk1, NULL,@q1, DATE_SUB(@now, INTERVAL 5 HOUR),  NULL,                                 DATE_SUB(@now, INTERVAL 299 MINUTE),   30, 0,  30, 'NO_ANSWER',          0.00, '{}', 'uniq_004', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000005', @org, 'call_005', 'PJSIP/1005-0005', '+18005552005', '+18005551002', 'Customer 5', 'inbound','busy',     @trunk1, NULL,@q2, DATE_SUB(@now, INTERVAL 6 HOUR),  NULL,                                 DATE_SUB(@now, INTERVAL 359 MINUTE),    5, 0,   5, 'USER_BUSY',          0.00, '{}', 'uniq_005', '{}', '{}', '{}', @now, @now),
-- Outbound
('ca000000-0000-0000-0000-000000000006', @org, 'call_006', 'PJSIP/1001-0006', '+18005551001', '+18005552006', 'Alice J',     'outbound','completed',@trunk1, @u1, NULL, DATE_SUB(@now, INTERVAL 7 HOUR),  DATE_SUB(@now, INTERVAL 419 MINUTE), DATE_SUB(@now, INTERVAL 414 MINUTE),  300, 290, 10, 'NORMAL_CLEARING',   0.12, '{}', 'uniq_006', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000007', @org, 'call_007', 'PJSIP/1002-0007', '+18005551001', '+18005552007', 'Bob S',       'outbound','completed',@trunk1, @u2, NULL, DATE_SUB(@now, INTERVAL 8 HOUR),  DATE_SUB(@now, INTERVAL 479 MINUTE), DATE_SUB(@now, INTERVAL 470 MINUTE),  540, 525, 15, 'NORMAL_CLEARING',   0.21, '{}', 'uniq_007', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000008', @org, 'call_008', 'PJSIP/1003-0008', '+18005551002', '+18005552008', 'Carol W',     'outbound','failed',   @trunk2, @u3, NULL, DATE_SUB(@now, INTERVAL 9 HOUR),  NULL,                                 DATE_SUB(@now, INTERVAL 539 MINUTE),   10, 0,  10, 'UNALLOCATED_NUMBER', 0.00, '{}', 'uniq_008', '{}', '{}', '{}', @now, @now),
-- Internal
('ca000000-0000-0000-0000-000000000009', @org, 'call_009', 'PJSIP/1001-0009', '1001', '1004', 'Alice J',                     'internal','completed',NULL,    @u1, NULL, DATE_SUB(@now, INTERVAL 10 HOUR), DATE_SUB(@now, INTERVAL 599 MINUTE), DATE_SUB(@now, INTERVAL 595 MINUTE),  240, 235,  5, 'NORMAL_CLEARING',   0.00, '{}', 'uniq_009', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000010', @org, 'call_010', 'PJSIP/1005-0010', '1005', '1006', 'Emma D',                      'internal','completed',NULL,    @u5, NULL, DATE_SUB(@now, INTERVAL 11 HOUR), DATE_SUB(@now, INTERVAL 659 MINUTE), DATE_SUB(@now, INTERVAL 656 MINUTE),  180, 175,  5, 'NORMAL_CLEARING',   0.00, '{}', 'uniq_010', '{}', '{}', '{}', @now, @now),
-- More recent (past 24h mix)
('ca000000-0000-0000-0000-000000000011', @org, 'call_011', 'PJSIP/1001-0011', '+18005552011','+18005551001','Customer 11',   'inbound','completed',@trunk1, @u1, @q1, DATE_SUB(@now, INTERVAL 12 HOUR), DATE_SUB(@now, INTERVAL 719 MINUTE), DATE_SUB(@now, INTERVAL 710 MINUTE),  540, 525, 15, 'NORMAL_CLEARING',   0.21, '{}', 'uniq_011', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000012', @org, 'call_012', 'PJSIP/1002-0012', '+18005552012','+18005551001','Customer 12',   'inbound','completed',@trunk1, @u2, @q1, DATE_SUB(@now, INTERVAL 13 HOUR), DATE_SUB(@now, INTERVAL 779 MINUTE), DATE_SUB(@now, INTERVAL 770 MINUTE),  540, 525, 15, 'NORMAL_CLEARING',   0.21, '{}', 'uniq_012', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000013', @org, 'call_013', 'PJSIP/1003-0013', '+18005552013','+18005551002','Customer 13',   'inbound','completed',@trunk1, @u3, @q2, DATE_SUB(@now, INTERVAL 14 HOUR), DATE_SUB(@now, INTERVAL 839 MINUTE), DATE_SUB(@now, INTERVAL 831 MINUTE),  480, 465, 15, 'NORMAL_CLEARING',   0.18, '{}', 'uniq_013', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000014', @org, 'call_014', 'PJSIP/1001-0014', '+18005552014','+18005551003','Customer 14',   'inbound','completed',@trunk2, @u1, NULL, DATE_SUB(@now, INTERVAL 15 HOUR), DATE_SUB(@now, INTERVAL 899 MINUTE), DATE_SUB(@now, INTERVAL 890 MINUTE),  540, 530, 10, 'NORMAL_CLEARING',   0.21, '{}', 'uniq_014', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000015', @org, 'call_015', 'PJSIP/1004-0015', '+18005552015','+18005551001','Customer 15',   'inbound','cancelled',@trunk1, NULL,@q1, DATE_SUB(@now, INTERVAL 16 HOUR), NULL,                                 DATE_SUB(@now, INTERVAL 959 MINUTE),    8, 0,   8, 'NORMAL_CLEARING',   0.00, '{}', 'uniq_015', '{}', '{}', '{}', @now, @now),
-- Older records (past week)
('ca000000-0000-0000-0000-000000000016', @org, 'call_016', 'PJSIP/1002-0016', '+18005552016','+18005551001','Customer 16',   'inbound','completed',@trunk1, @u2, @q1, DATE_SUB(@now, INTERVAL 1 DAY),   DATE_SUB(@now, INTERVAL 1439 MINUTE),DATE_SUB(@now, INTERVAL 1430 MINUTE), 540, 525, 15, 'NORMAL_CLEARING',   0.21, '{}', 'uniq_016', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000017', @org, 'call_017', 'PJSIP/1003-0017', '+18005552017','+18005551002','Customer 17',   'inbound','completed',@trunk1, @u3, @q2, DATE_SUB(@now, INTERVAL 2 DAY),   DATE_SUB(@now, INTERVAL 2879 MINUTE),DATE_SUB(@now, INTERVAL 2870 MINUTE), 540, 525, 15, 'NORMAL_CLEARING',   0.21, '{}', 'uniq_017', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000018', @org, 'call_018', 'PJSIP/1001-0018', '+18005551001','+18005552018','Alice J',       'outbound','completed',@trunk1, @u1, NULL, DATE_SUB(@now, INTERVAL 3 DAY),   DATE_SUB(@now, INTERVAL 4319 MINUTE),DATE_SUB(@now, INTERVAL 4310 MINUTE), 540, 525, 15, 'NORMAL_CLEARING',   0.21, '{}', 'uniq_018', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000019', @org, 'call_019', 'PJSIP/1002-0019', '+18005551001','+18005552019','Bob S',         'outbound','completed',@trunk1, @u2, NULL, DATE_SUB(@now, INTERVAL 4 DAY),   DATE_SUB(@now, INTERVAL 5759 MINUTE),DATE_SUB(@now, INTERVAL 5750 MINUTE), 540, 525, 15, 'NORMAL_CLEARING',   0.21, '{}', 'uniq_019', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000020', @org, 'call_020', 'PJSIP/1005-0020', '+18005551002','+918001002003','Emma D',       'outbound','completed',@trunk2, @u5, NULL, DATE_SUB(@now, INTERVAL 5 DAY),   DATE_SUB(@now, INTERVAL 7199 MINUTE),DATE_SUB(@now, INTERVAL 7175 MINUTE), 1500,1475, 25, 'NORMAL_CLEARING',   0.85, '{}', 'uniq_020', '{}', '{}', '{}', @now, @now),
-- More variety
('ca000000-0000-0000-0000-000000000021', @org, 'call_021', 'PJSIP/1001-0021', '+18005552021','+18005551001','Customer 21',   'inbound','completed',@trunk1, @u1, @q1, DATE_SUB(@now, INTERVAL 6 DAY),   DATE_SUB(@now, INTERVAL 8639 MINUTE),DATE_SUB(@now, INTERVAL 8630 MINUTE), 540, 525, 15, 'NORMAL_CLEARING',   0.21, '{}', 'uniq_021', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000022', @org, 'call_022', 'PJSIP/1006-0022', '1006','1001','Frank B',                        'internal','completed',NULL,    @u6, NULL, DATE_SUB(@now, INTERVAL 7 DAY),   DATE_SUB(@now, INTERVAL 10079 MINUTE),DATE_SUB(@now,INTERVAL 10075 MINUTE),240, 235,  5, 'NORMAL_CLEARING',   0.00, '{}', 'uniq_022', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000023', @org, 'call_023', 'PJSIP/1003-0023', '+18005552023','+18005551002','Customer 23',   'inbound','no_answer',@trunk1, NULL,@q2, DATE_SUB(@now, INTERVAL 8 DAY),   NULL,                                 DATE_SUB(@now, INTERVAL 11519 MINUTE), 30, 0,  30, 'NO_ANSWER',        0.00, '{}', 'uniq_023', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000024', @org, 'call_024', 'PJSIP/1001-0024', '+18005552024','+18005551001','Customer 24',   'inbound','completed',@trunk1, @u1, @q1, DATE_SUB(@now, INTERVAL 9 DAY),   DATE_SUB(@now, INTERVAL 12959 MINUTE),DATE_SUB(@now,INTERVAL 12950 MINUTE),540, 525, 15, 'NORMAL_CLEARING',  0.21, '{}', 'uniq_024', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000025', @org, 'call_025', 'PJSIP/1002-0025', '+18005552025','+18005551001','Customer 25',   'inbound','completed',@trunk1, @u2, @q1, DATE_SUB(@now, INTERVAL 10 DAY),  DATE_SUB(@now, INTERVAL 14399 MINUTE),DATE_SUB(@now,INTERVAL 14390 MINUTE),540, 525, 15, 'NORMAL_CLEARING',  0.21, '{}', 'uniq_025', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000026', @org, 'call_026', 'PJSIP/1003-0026', '+18005552026','+18005551002','Customer 26',   'inbound','completed',@trunk1, @u3, @q2, DATE_SUB(@now, INTERVAL 11 DAY),  DATE_SUB(@now, INTERVAL 15839 MINUTE),DATE_SUB(@now,INTERVAL 15830 MINUTE),540, 525, 15, 'NORMAL_CLEARING',  0.21, '{}', 'uniq_026', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000027', @org, 'call_027', 'PJSIP/1001-0027', '+18005551001','+18005552027','Alice J',       'outbound','completed',@trunk1, @u1, NULL, DATE_SUB(@now, INTERVAL 12 DAY),  DATE_SUB(@now, INTERVAL 17279 MINUTE),DATE_SUB(@now,INTERVAL 17270 MINUTE),540, 525, 15, 'NORMAL_CLEARING',  0.21, '{}', 'uniq_027', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000028', @org, 'call_028', 'PJSIP/1002-0028', '+18005551001','+18005552028','Bob S',         'outbound','failed',   @trunk1, @u2, NULL, DATE_SUB(@now, INTERVAL 13 DAY),  NULL,                                 DATE_SUB(@now, INTERVAL 18719 MINUTE),15, 0,  15, 'CONGESTION',         0.00, '{}', 'uniq_028', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000029', @org, 'call_029', 'PJSIP/1004-0029', '1004','1002','Dan L',                          'internal','completed',NULL,    @u4, NULL, DATE_SUB(@now, INTERVAL 14 DAY),  DATE_SUB(@now, INTERVAL 20159 MINUTE),DATE_SUB(@now,INTERVAL 20155 MINUTE),240, 235,  5, 'NORMAL_CLEARING',  0.00, '{}', 'uniq_029', '{}', '{}', '{}', @now, @now),
('ca000000-0000-0000-0000-000000000030', @org, 'call_030', 'PJSIP/1001-0030', '+18005552030','+18005551001','Customer 30',   'inbound','completed',@trunk1, @u1, @q1, DATE_SUB(@now, INTERVAL 15 DAY),  DATE_SUB(@now, INTERVAL 21599 MINUTE),DATE_SUB(@now,INTERVAL 21590 MINUTE),540, 525, 15, 'NORMAL_CLEARING',  0.21, '{}', 'uniq_030', '{}', '{}', '{}', @now, @now);

-- ============================================================
-- AUDIT_LOG
-- ============================================================
INSERT INTO audit_log (org_id, user_email, action, resource, resource_id, details, ip_address) VALUES
(@org, 'admin@example.com', 'create',   'organization', @org,              '{"name":"sample org"}',                        '127.0.0.1'),
(@org, 'admin@example.com', 'login',    'auth',         'admin@example.com','{"method":"password"}',                       '127.0.0.1'),
(@org, 'admin@example.com', 'create',   'user',         '1001',             '{"email":"alice@example.com"}',               '127.0.0.1'),
(@org, 'admin@example.com', 'create',   'user',         '1002',             '{"email":"bob@example.com"}',                 '127.0.0.1'),
(@org, 'admin@example.com', 'create',   'queue',        '2001',             '{"name":"Sales"}',                            '127.0.0.1'),
(@org, 'alice@example.com', 'answer',   'call',         'call_001',         '{"duration":420}',                            '10.0.0.5'),
(@org, 'bob@example.com',   'answer',   'call',         'call_002',         '{"duration":540}',                            '10.0.0.6'),
(@org, 'dan@example.com',   'supervise','call',         'call_011',         '{"mode":"monitor"}',                          '10.0.0.9'),
(@org, 'admin@example.com', 'update',   'ivr',          '9000',             '{"action":"add_menu_item"}',                  '127.0.0.1'),
(@org, 'frank@example.com', 'create',   'contact',      'jane.doe@acme.com','{"source":"crm_page"}',                       '10.0.0.7');

SET FOREIGN_KEY_CHECKS=1;

-- Summary
SELECT 'users' tbl, COUNT(*) n FROM users WHERE org_id=@org
UNION ALL SELECT 'org_users',    COUNT(*) FROM org_users WHERE org_id=@org
UNION ALL SELECT 'sip_trunks',   COUNT(*) FROM sip_trunks WHERE org_id=@org
UNION ALL SELECT 'queues',       COUNT(*) FROM queues WHERE org_id=@org
UNION ALL SELECT 'queue_members',COUNT(*) FROM queue_members qm JOIN queues q ON qm.queue_id=q.id WHERE q.org_id=@org
UNION ALL SELECT 'did_numbers',  COUNT(*) FROM did_numbers WHERE org_id=@org
UNION ALL SELECT 'outbound_routes',COUNT(*) FROM outbound_routes WHERE org_id=@org
UNION ALL SELECT 'greetings',    COUNT(*) FROM greetings WHERE org_id=@org
UNION ALL SELECT 'ivrs',         COUNT(*) FROM ivrs WHERE org_id=@org
UNION ALL SELECT 'ivr_menus',    COUNT(*) FROM ivr_menus m JOIN ivrs i ON m.ivr_id=i.id WHERE i.org_id=@org
UNION ALL SELECT 'routing_rules',COUNT(*) FROM routing_rules WHERE org_id=@org
UNION ALL SELECT 'webhooks',     COUNT(*) FROM webhooks WHERE org_id=@org
UNION ALL SELECT 'org_api_keys', COUNT(*) FROM org_api_keys WHERE org_id=@org
UNION ALL SELECT 'org_compliance',COUNT(*) FROM org_compliance WHERE org_id=@org
UNION ALL SELECT 'crm_pipeline_stages',COUNT(*) FROM crm_pipeline_stages WHERE org_id=@org
UNION ALL SELECT 'crm_companies',COUNT(*) FROM crm_companies WHERE org_id=@org
UNION ALL SELECT 'crm_contacts', COUNT(*) FROM crm_contacts WHERE org_id=@org
UNION ALL SELECT 'crm_deals',    COUNT(*) FROM crm_deals WHERE org_id=@org
UNION ALL SELECT 'crm_activities',COUNT(*) FROM crm_activities WHERE org_id=@org
UNION ALL SELECT 'crm_custom_fields',COUNT(*) FROM crm_custom_fields WHERE org_id=@org
UNION ALL SELECT 'crm_custom_field_values', COUNT(*) FROM crm_custom_field_values v JOIN crm_custom_fields f ON v.field_id=f.id WHERE f.org_id=@org
UNION ALL SELECT 'call_records', COUNT(*) FROM call_records WHERE org_id=@org
UNION ALL SELECT 'audit_log',    COUNT(*) FROM audit_log WHERE org_id=@org;
