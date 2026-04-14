#!/usr/bin/env node

/**
 * Script to encrypt existing plaintext passwords in the database
 * This should be run once after implementing password encryption
 */

const crypto = require('crypto');
const { sequelize, SipTrunk } = require('../src/models');

// Encryption configuration (same as in SipTrunk model)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-encryption-key-please-change';
const ENCRYPTION_ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function encryptPassword(password) {
  if (!password) return null;

  const iv = crypto.randomBytes(IV_LENGTH);
  const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  let encrypted = cipher.update(password, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return iv.toString('hex') + ':' + encrypted;
}

function isEncrypted(password) {
  // Check if password is already encrypted (contains IV separator)
  return password && password.includes(':') && password.split(':').length === 2;
}

async function encryptExistingPasswords() {
  try {
    console.log('Connecting to database...');
    await sequelize.authenticate();
    console.log('Connected successfully.\n');

    // Get all trunks with passwords (bypassing hooks to get raw data)
    console.log('Fetching trunks with passwords...');
    const trunks = await sequelize.query(
      'SELECT id, name, password FROM sip_trunks WHERE password IS NOT NULL',
      { type: sequelize.QueryTypes.SELECT }
    );

    console.log(`Found ${trunks.length} trunks with passwords.\n`);

    let encryptedCount = 0;
    let skippedCount = 0;

    for (const trunk of trunks) {
      if (isEncrypted(trunk.password)) {
        console.log(`⏭️  Skipping "${trunk.name}" - already encrypted`);
        skippedCount++;
        continue;
      }

      console.log(`🔒 Encrypting password for trunk: "${trunk.name}"`);
      const encryptedPassword = encryptPassword(trunk.password);

      // Update directly without triggering hooks
      await sequelize.query(
        'UPDATE sip_trunks SET password = ? WHERE id = ?',
        { replacements: [encryptedPassword, trunk.id] }
      );

      encryptedCount++;
    }

    console.log('\n✅ Encryption complete!');
    console.log(`   - Encrypted: ${encryptedCount} passwords`);
    console.log(`   - Skipped: ${skippedCount} passwords (already encrypted)`);

    await sequelize.close();
  } catch (error) {
    console.error('❌ Error encrypting passwords:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run the script
encryptExistingPasswords();
