-- Migration: org_users table for RBAC
-- Platform users with roles (separate from SIP extension users)

CREATE TABLE IF NOT EXISTS org_users (
  id          CHAR(36) PRIMARY KEY,
  org_id      CHAR(36) NOT NULL,
  email       VARCHAR(255) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  role        ENUM('owner','admin','manager','agent') NOT NULL DEFAULT 'agent',
  status      ENUM('active','suspended','invited') DEFAULT 'invited',
  firebase_uid VARCHAR(128) NULL,
  extension   VARCHAR(10) NULL,
  last_login  DATETIME NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_org_email (org_id, email),
  INDEX idx_firebase_uid (firebase_uid),
  INDEX idx_org_role (org_id, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
