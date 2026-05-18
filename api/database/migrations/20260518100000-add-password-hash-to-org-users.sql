-- Ensure org_users exists with password_hash column.
--
-- This migration is defensive on TWO axes:
--   1. The original 20260412-org-users.sql may have been skipped on
--      installs that bootstrapped via sync() before OrgUser had a
--      Sequelize model — without the SQL run, the table simply doesn't
--      exist. CREATE TABLE IF NOT EXISTS handles that.
--   2. Even where the original ran, it didn't include password_hash
--      (platform is Firebase-only — never needed it). ALTER TABLE +
--      duplicate-column tolerance in run-migrations.js handles that.
--
-- Together these two statements get every install — fresh OSS, existing
-- OSS, or a platform snapshot — to a state where the OSS local-mode
-- /auth/signup and /auth/login-password endpoints work.

CREATE TABLE IF NOT EXISTS org_users (
  id          CHAR(36) PRIMARY KEY,
  org_id      CHAR(36) NULL,
  email       VARCHAR(255) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  role        ENUM('owner','admin','manager','agent') NOT NULL DEFAULT 'agent',
  status      ENUM('active','suspended','invited') DEFAULT 'invited',
  password_hash VARCHAR(255) NULL,
  firebase_uid VARCHAR(128) NULL,
  extension   VARCHAR(10) NULL,
  last_login  DATETIME NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_org_email (org_id, email),
  INDEX idx_firebase_uid (firebase_uid),
  INDEX idx_org_role (org_id, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE org_users ADD COLUMN password_hash VARCHAR(255) NULL;
