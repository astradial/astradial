-- Migration: org_users table for authentication and RBAC
-- Platform users with roles (separate from SIP extension users)

CREATE TABLE IF NOT EXISTS org_users (
  id            CHAR(36) PRIMARY KEY,
  org_id        CHAR(36) NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NULL,
  role          ENUM('owner','admin','manager','agent') NOT NULL DEFAULT 'agent',
  status        ENUM('active','suspended','invited') DEFAULT 'invited',
  extension     VARCHAR(10) NULL,
  last_login    DATETIME NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_org_id (org_id),
  INDEX idx_org_role (org_id, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
