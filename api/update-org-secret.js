const { Organization } = require('./src/models');
const bcrypt = require('bcrypt');

async function updateSecret() {
  try {
    const hash = await bcrypt.hash('testorg123', 10);

    const org = await Organization.findByPk('2c662bff-8f80-483a-8235-74fd48965a9c');
    if (!org) {
      console.log('❌ Organization not found');
      process.exit(1);
    }

    await org.update({ api_secret: hash });
    console.log('✅ Updated api_secret for TestOrg');
    console.log(`API Key: ${org.api_key}`);
    console.log('API Secret: testorg123');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

updateSecret();
