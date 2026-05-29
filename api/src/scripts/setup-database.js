const { testConnection, syncDatabase } = require('../models');

async function setupDatabase() {
  console.log('🔄 Setting up PBX API database...\n');

  // Test database connection
  console.log('Testing database connection...');
  await testConnection();

  // Sync database tables
  console.log('\nSynchronizing database tables...');
  await syncDatabase(false); // Set to true to force recreate tables

  console.log('\n✅ Database setup completed successfully!');
  process.exit(0);
}

setupDatabase().catch(error => {
  console.error('❌ Database setup failed:', error);
  process.exit(1);
});