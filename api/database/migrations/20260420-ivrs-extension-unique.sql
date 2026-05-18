-- Add the UNIQUE(org_id, extension) index on `ivrs` if sequelize.sync()
-- auto-created the table without it. Safe to run multiple times; MySQL /
-- MariaDB errors quietly when an identically-named index already exists,
-- so we use a PROCEDURE wrapper that swallows ER_DUP_KEYNAME.
--
-- Why this is needed: the main migration (20260420-ivr-tables.sql) has
-- `CREATE TABLE IF NOT EXISTS` with a `UNIQUE KEY ivrs_org_extension_unique`,
-- but on staging the table was already materialised by Sequelize's
-- `sequelize.sync({ alter: false })` boot call before the migration ran.
-- Result: the table existed, the CREATE TABLE was skipped, and the UNIQUE
-- was never added. Two IVRs with the same extension slipped through.

DROP PROCEDURE IF EXISTS add_ivrs_extension_unique;

DELIMITER $$
CREATE PROCEDURE add_ivrs_extension_unique()
BEGIN
  DECLARE CONTINUE HANDLER FOR 1061, 1068 BEGIN END;  -- ER_DUP_KEYNAME, ER_MULTIPLE_PRI_KEY
  ALTER TABLE `ivrs` ADD UNIQUE KEY `ivrs_org_extension_unique` (`org_id`, `extension`);
END$$
DELIMITER ;

CALL add_ivrs_extension_unique();
DROP PROCEDURE add_ivrs_extension_unique;
