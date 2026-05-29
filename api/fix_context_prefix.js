// Fix context_prefix for existing TestOrg organization
require('dotenv').config();
const { Organization } = require('./src/models');

async function fixContextPrefix() {
  try {
    console.log('Connecting to database...');

    // Find TestOrg organization
    const org = await Organization.findOne({
      where: { id: '2c662bff-8f80-483a-8235-74fd48965a9c' }
    });

    if (!org) {
      console.error('TestOrg organization not found');
      return;
    }

    console.log('Current context_prefix:', org.context_prefix);

    // Update context_prefix to remove trailing underscore
    if (org.context_prefix.endsWith('_')) {
      const newPrefix = org.context_prefix.slice(0, -1); // Remove last character
      await org.update({ context_prefix: newPrefix });
      console.log('Updated context_prefix from:', org.context_prefix, 'to:', newPrefix);
    } else {
      console.log('Context prefix already correct');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error fixing context prefix:', error);
    process.exit(1);
  }
}

fixContextPrefix();