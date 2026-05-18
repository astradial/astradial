-- Add 'pending' to organizations.status enum so the OSS request-org →
-- admin-approve flow can park orgs in a holding state until a sysadmin
-- flips them active.
--
-- MariaDB ALTER on an ENUM column rewrites the values list. We list
-- 'pending' first so existing rows (which default to 'active') keep
-- their value.

ALTER TABLE organizations
  MODIFY COLUMN status ENUM('pending','active','suspended','deleted') DEFAULT 'active';
