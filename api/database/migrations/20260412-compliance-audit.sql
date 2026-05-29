-- Migration: compliance + audit tables
-- Run on: staging 2026-04-12, prod pending

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  org_id      CHAR(36) NOT NULL,
  user_id     CHAR(36) NULL,
  user_email  VARCHAR(255) NULL,
  action      VARCHAR(50) NOT NULL,
  resource    VARCHAR(50) NOT NULL,
  resource_id VARCHAR(255) NULL,
  details     JSON NULL,
  ip_address  VARCHAR(45) NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_org_date (org_id, created_at),
  INDEX idx_audit_org_action (org_id, action),
  INDEX idx_audit_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS org_compliance (
  org_id                    CHAR(36) PRIMARY KEY,
  recording_enabled         BOOLEAN DEFAULT TRUE,
  recording_consent         ENUM('announcement','explicit_opt_in','opt_out') DEFAULT 'announcement',
  retention_cdr_days        INT DEFAULT 365,
  retention_recording_days  INT DEFAULT 180,
  pii_masking               BOOLEAN DEFAULT FALSE,
  data_encryption           BOOLEAN DEFAULT TRUE,
  updated_at                DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed defaults for existing orgs
INSERT IGNORE INTO org_compliance (org_id) SELECT id FROM organizations WHERE status = 'active';
