#!/usr/bin/env node

const axios = require('axios');

async function deployMissingConfigurations() {
  try {
    console.log('🔍 Checking for missing organization configurations...\n');

    // 1. Get admin token
    const adminAuthResponse = await axios.post('http://localhost:3000/api/v1/admin/auth', {
      admin_username: 'pbx_admin',
      admin_password: process.env.ADMIN_PASSWORD
    });

    const adminToken = adminAuthResponse.data.token;
    console.log('✅ Admin authenticated');

    // 2. Get all organizations
    const orgsResponse = await axios.get('http://localhost:3000/api/v1/organizations', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    const organizations = orgsResponse.data.organizations;
    console.log(`📊 Found ${organizations.length} organizations in database\n`);

    // 3. Get existing organization configuration files
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    const { stdout: pjsipIncludes } = await execAsync('grep "#include.*pjsip_" /etc/asterisk/pjsip.conf || true');
    const { stdout: extIncludes } = await execAsync('grep "#include.*ext_" /etc/asterisk/extensions.conf || true');
    const { stdout: queueIncludes } = await execAsync('grep "#include.*queues_" /etc/asterisk/queues.conf || true');

    const deployedOrgs = new Set();

    // Extract deployed org names from includes
    const pjsipMatches = pjsipIncludes.match(/pjsip_(\w+)\.conf/g) || [];
    const extMatches = extIncludes.match(/ext_(\w+)\.conf/g) || [];
    const queueMatches = queueIncludes.match(/queues_(\w+)\.conf/g) || [];

    pjsipMatches.forEach(match => {
      const orgName = match.replace('pjsip_', '').replace('.conf', '');
      if (orgName !== 'dids') deployedOrgs.add(orgName);
    });

    console.log('📁 Currently deployed organizations:');
    deployedOrgs.forEach(org => console.log(`   - ${org}`));
    console.log();

    // 4. Find organizations missing deployment
    const missingOrgs = [];

    for (const org of organizations) {
      // Sanitize org name like the deployment service does
      const sanitizedName = org.name
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_/, '');

      if (!deployedOrgs.has(sanitizedName)) {
        missingOrgs.push({
          id: org.id,
          name: org.name,
          sanitizedName,
          hasUsers: org.users.length > 0,
          hasTrunks: org.trunks.length > 0,
          hasQueues: org.queues.length > 0
        });
      }
    }

    console.log(`🚨 Missing deployment for ${missingOrgs.length} organizations:`);
    missingOrgs.forEach(org => {
      console.log(`   - ${org.name} (${org.sanitizedName}) - Users: ${org.hasUsers}, Trunks: ${org.hasTrunks}, Queues: ${org.hasQueues}`);
    });
    console.log();

    // 5. Deploy missing configurations
    if (missingOrgs.length > 0) {
      console.log('🚀 Starting deployment of missing configurations...\n');

      for (const org of missingOrgs) {
        console.log(`📦 Deploying configuration for: ${org.name}`);

        try {
          const deployResponse = await axios.post('http://localhost:3000/api/v1/config/deploy', {}, {
            headers: { Authorization: `Bearer ${adminToken}` },
            params: { org_id: org.id }
          });

          console.log(`✅ Successfully deployed configuration for ${org.name}`);
        } catch (error) {
          if (error.response?.status === 404) {
            console.log(`⚠️  Deploy endpoint not found, trying manual deployment for ${org.name}`);

            // Try to get org credentials and authenticate
            try {
              const credResponse = await axios.get(`http://localhost:3000/api/v1/admin/organizations/${org.id}/credentials`, {
                headers: { Authorization: `Bearer ${adminToken}` }
              });

              const orgToken = await axios.post('http://localhost:3000/api/v1/auth/login', {
                api_key: credResponse.data.api_key,
                api_secret: credResponse.data.api_secret_plaintext
              });

              // Try config/deploy with org authentication
              const deployResponse = await axios.post('http://localhost:3000/api/v1/config/deploy', {}, {
                headers: { Authorization: `Bearer ${orgToken.data.token}` }
              });

              console.log(`✅ Successfully deployed configuration for ${org.name} using org auth`);
            } catch (orgError) {
              console.log(`❌ Failed to deploy for ${org.name}:`, orgError.message);
            }
          } else {
            console.log(`❌ Failed to deploy for ${org.name}:`, error.message);
          }
        }
      }

      console.log('\n🔄 Verifying deployment results...');

      // Check again after deployment
      const { stdout: newPjsipIncludes } = await execAsync('grep "#include.*pjsip_" /etc/asterisk/pjsip.conf || true');
      const newPjsipMatches = newPjsipIncludes.match(/pjsip_(\w+)\.conf/g) || [];
      const newDeployedOrgs = new Set();

      newPjsipMatches.forEach(match => {
        const orgName = match.replace('pjsip_', '').replace('.conf', '');
        if (orgName !== 'dids') newDeployedOrgs.add(orgName);
      });

      console.log('\n✅ Final deployment status:');
      console.log(`   - Total organizations: ${organizations.length}`);
      console.log(`   - Deployed organizations: ${newDeployedOrgs.size}`);
      console.log(`   - Missing deployments: ${organizations.length - newDeployedOrgs.size}`);

      if (newDeployedOrgs.size > deployedOrgs.size) {
        console.log(`   - ✅ Successfully deployed ${newDeployedOrgs.size - deployedOrgs.size} additional configurations`);
      }
    } else {
      console.log('✅ All organizations already have deployed configurations!');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response?.data) {
      console.error('Response data:', error.response.data);
    }
    process.exit(1);
  }
}

deployMissingConfigurations().catch(console.error);