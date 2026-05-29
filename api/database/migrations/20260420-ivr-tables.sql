-- Create IVR tables + extend IvrMenu action_type enum to include ai_agent.
-- The Ivr / IvrMenu Sequelize models have existed for a while but relied on
-- sequelize.sync() for table creation — a production footgun when schema
-- drifts. This migration creates the tables explicitly and adds the
-- TTS-related fields (greeting_text / greeting_language / greeting_voice)
-- needed by the visual IVR builder.

-- Organizations must exist before we FK to them. This migration is safe to
-- run on any env that already has `organizations`.

CREATE TABLE IF NOT EXISTS `ivrs` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `org_id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `extension` VARCHAR(10) NOT NULL,
  `description` TEXT NULL,
  `greeting_prompt` VARCHAR(255) NULL COMMENT 'Audio file for greeting message (no .wav extension)',
  `greeting_text` TEXT NULL COMMENT 'Source text used to TTS-generate greeting_prompt',
  `greeting_language` VARCHAR(10) NOT NULL DEFAULT 'en-IN' COMMENT 'BCP-47 code passed to Google TTS',
  `greeting_voice` VARCHAR(50) NOT NULL DEFAULT 'en-IN-Wavenet-D' COMMENT 'Google TTS voice name',
  `timeout` INT NOT NULL DEFAULT 10 COMMENT 'Seconds to wait for DTMF input',
  `max_retries` INT NOT NULL DEFAULT 3,
  `invalid_prompt` VARCHAR(255) NULL,
  `timeout_prompt` VARCHAR(255) NULL,
  `enable_direct_dial` BOOLEAN NOT NULL DEFAULT FALSE,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  KEY `ivrs_org_id_idx` (`org_id`),
  UNIQUE KEY `ivrs_org_extension_unique` (`org_id`, `extension`),
  CONSTRAINT `ivrs_org_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `ivr_menus` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `ivr_id` CHAR(36) NOT NULL,
  `digit` VARCHAR(1) NOT NULL COMMENT '0-9, *, #',
  `action_type` ENUM('extension','queue','ivr','voicemail','hangup','callback','ai_agent') NOT NULL,
  `action_destination` VARCHAR(255) NULL COMMENT 'Extension number, queue/ivr UUID, or AI agent user UUID',
  `description` VARCHAR(255) NULL,
  `order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  UNIQUE KEY `ivr_menus_ivr_digit_unique` (`ivr_id`, `digit`),
  CONSTRAINT `ivr_menus_ivr_id_fk` FOREIGN KEY (`ivr_id`) REFERENCES `ivrs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- If the ivr_menus table already existed (from a prior sequelize.sync on
-- staging), add ai_agent to the enum. MySQL will no-op this if already
-- present in the type.
ALTER TABLE `ivr_menus`
  MODIFY COLUMN `action_type`
  ENUM('extension','queue','ivr','voicemail','hangup','callback','ai_agent') NOT NULL;

-- Same defensive ALTERs for the TTS fields on the ivrs table in case the
-- table was already created by sequelize.sync() without the new columns.
-- Each ALTER TABLE ADD COLUMN IF NOT EXISTS requires MariaDB 10.3+ / MySQL
-- 8.0+ which both staging + prod have.
ALTER TABLE `ivrs`
  ADD COLUMN IF NOT EXISTS `greeting_text` TEXT NULL AFTER `greeting_prompt`,
  ADD COLUMN IF NOT EXISTS `greeting_language` VARCHAR(10) NOT NULL DEFAULT 'en-IN' AFTER `greeting_text`,
  ADD COLUMN IF NOT EXISTS `greeting_voice` VARCHAR(50) NOT NULL DEFAULT 'en-IN-Wavenet-D' AFTER `greeting_language`;
