-- Fix missing columns that Sequelize models expect but migrations didn't create

-- Users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS routing_type ENUM('sip','ai_agent') DEFAULT 'sip' AFTER recording_enabled;
ALTER TABLE users ADD COLUMN IF NOT EXISTS routing_destination VARCHAR(255) NULL AFTER routing_type;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50) NULL AFTER routing_destination;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ring_target ENUM('ext','phone') DEFAULT 'ext' AFTER phone_number;

-- Queues table
ALTER TABLE queues ADD COLUMN IF NOT EXISTS timeout_destination VARCHAR(255) NULL;
ALTER TABLE queues ADD COLUMN IF NOT EXISTS timeout_destination_type VARCHAR(50) NULL;
ALTER TABLE queues ADD COLUMN IF NOT EXISTS greeting_id CHAR(36) NULL;
ALTER TABLE queues ADD COLUMN IF NOT EXISTS announce_round_seconds INT DEFAULT 0;
ALTER TABLE queues ADD COLUMN IF NOT EXISTS retry INT DEFAULT 5;
ALTER TABLE queues ADD COLUMN IF NOT EXISTS service_level INT DEFAULT 60;
ALTER TABLE queues ADD COLUMN IF NOT EXISTS weight INT DEFAULT 0;
ALTER TABLE queues ADD COLUMN IF NOT EXISTS autopause ENUM('yes','no','all') DEFAULT 'no';
