-- Migration to add trunk_type fields to sip_trunks table
-- This will allow host to be NULL for inbound trunks

ALTER TABLE sip_trunks
  MODIFY COLUMN host VARCHAR(255) NULL;

ALTER TABLE sip_trunks
  ADD COLUMN trunk_type ENUM('inbound', 'outbound', 'peer2peer') DEFAULT 'outbound' NOT NULL AFTER transport;

ALTER TABLE sip_trunks
  ADD COLUMN retry_interval INT DEFAULT 60 NULL AFTER trunk_type;

ALTER TABLE sip_trunks
  ADD COLUMN expiration INT DEFAULT 3600 NULL AFTER retry_interval;

ALTER TABLE sip_trunks
  ADD COLUMN contact_user VARCHAR(255) NULL AFTER expiration;

-- Migrate existing trunk to peer2peer (Exotel Capinex trunk)
UPDATE sip_trunks
SET trunk_type = 'peer2peer'
WHERE name = 'Exotel Capinex' AND org_id = 'd5f87665-455d-4e4d-9e94-4f666f31ebd8';

-- Show the migrated trunk
SELECT id, name, host, port, trunk_type, org_id FROM sip_trunks WHERE org_id = 'd5f87665-455d-4e4d-9e94-4f666f31ebd8';
