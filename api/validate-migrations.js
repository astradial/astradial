#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔍 Validating migration files...\n');

const migrationsDir = path.join(__dirname, 'database', 'migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.js')).sort();

console.log(`Found ${migrationFiles.length} migration files:`);
migrationFiles.forEach(file => console.log(`  ✓ ${file}`));

console.log('\n🧪 Testing migration syntax...');

let allValid = true;

for (const file of migrationFiles) {
  try {
    const filePath = path.join(migrationsDir, file);
    const migration = require(filePath);

    // Check that migration has required methods
    if (typeof migration.up !== 'function') {
      console.log(`  ❌ ${file}: Missing 'up' method`);
      allValid = false;
      continue;
    }

    if (typeof migration.down !== 'function') {
      console.log(`  ❌ ${file}: Missing 'down' method`);
      allValid = false;
      continue;
    }

    console.log(`  ✅ ${file}: Syntax valid`);

  } catch (error) {
    console.log(`  ❌ ${file}: Syntax error - ${error.message}`);
    allValid = false;
  }
}

console.log(`\n📊 Migration Validation Summary:`);
console.log(`  Total files: ${migrationFiles.length}`);
console.log(`  Status: ${allValid ? '✅ All valid' : '❌ Errors found'}`);

if (allValid) {
  console.log('\n🎉 All migration files are syntactically correct!');
  console.log('📋 Migration order:');
  migrationFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. ${file}`);
  });
} else {
  console.log('\n⚠️  Please fix the errors above before running migrations.');
  process.exit(1);
}

console.log('\n📝 Next steps:');
console.log('  1. Fix any database connection issues');
console.log('  2. Run: npx sequelize-cli db:migrate');
console.log('  3. Verify tables created correctly');