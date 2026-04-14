const { sequelize } = require('../models');

async function resetAndSeed() {
  console.log('🔄 Resetting and seeding database...\n');

  try {
    // Drop all tables and recreate them
    console.log('Dropping existing tables...');
    await sequelize.drop();
    console.log('✓ Tables dropped');

    // Recreate tables
    console.log('Creating tables...');
    await sequelize.sync({ force: true });
    console.log('✓ Tables created');

    // Run seed script
    console.log('\nRunning seed script...');
    require('./seed-database');

  } catch (error) {
    console.error('❌ Reset failed:', error);
    process.exit(1);
  }
}

resetAndSeed();