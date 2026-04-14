-- Add routing columns to users table (if not present)
ALTER TABLE users ADD COLUMN IF NOT EXISTS routing_type ENUM('sip','ai_agent') DEFAULT 'sip' AFTER recording_enabled;
ALTER TABLE users ADD COLUMN IF NOT EXISTS routing_destination VARCHAR(255) NULL AFTER routing_type;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50) NULL AFTER routing_destination;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ring_target ENUM('ext','phone') DEFAULT 'ext' AFTER phone_number;
