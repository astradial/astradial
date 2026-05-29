// Fix asterisk_endpoint for user 2004
require('dotenv').config();
const { User } = require('./src/models');

async function fixUserEndpoint() {
  try {
    console.log('Connecting to database...');

    // Find user with extension 2004
    const user = await User.findOne({
      where: { extension: '2004' }
    });

    if (!user) {
      console.error('User with extension 2004 not found');
      return;
    }

    console.log('Current asterisk_endpoint:', user.asterisk_endpoint);

    // Fix double underscore in asterisk_endpoint
    if (user.asterisk_endpoint && user.asterisk_endpoint.includes('__')) {
      const newEndpoint = user.asterisk_endpoint.replace('__', '_');
      await user.update({ asterisk_endpoint: newEndpoint });
      console.log('Updated asterisk_endpoint from:', user.asterisk_endpoint, 'to:', newEndpoint);
    } else {
      console.log('Endpoint already correct or not found');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error fixing user endpoint:', error);
    process.exit(1);
  }
}

fixUserEndpoint();