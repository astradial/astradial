#!/usr/bin/env node

const axios = require('axios');

async function deployAllConfigurations() {
  try {
    console.log('🔍 Deploying configurations for all organizations...\n');

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

    // 3. Deploy configuration for each organization
    let successCount = 0;
    let errorCount = 0;

    for (const org of organizations) {
      console.log(`📦 Deploying configuration for: ${org.name} (ID: ${org.id})`);

      try {
        // Get fresh credentials for each organization
        const credResponse = await axios.get(`http://localhost:3000/api/v1/admin/organizations/${org.id}/credentials`, {
          headers: { Authorization: `Bearer ${adminToken}` }
        });

        console.log(`   🔑 Got API credentials for ${org.name}`);

        // Authenticate as organization
        const orgAuthResponse = await axios.post('http://localhost:3000/api/v1/auth/login', {
          api_key: credResponse.data.api_key,
          api_secret: credResponse.data.api_secret_plaintext
        });

        const orgToken = orgAuthResponse.data.token;
        console.log(`   🎫 Authenticated as organization ${org.name}`);

        // Deploy configuration
        const deployResponse = await axios.post('http://localhost:3000/api/v1/config/deploy', {}, {
          headers: {
            Authorization: `Bearer ${orgToken}`,
            'Content-Type': 'application/json'
          }
        });

        console.log(`   ✅ Successfully deployed configuration for ${org.name}`);
        successCount++;

      } catch (error) {
        console.log(`   ❌ Failed to deploy for ${org.name}:`, error.response?.data?.error || error.message);
        errorCount++;
      }

      console.log(''); // Empty line for readability
    }

    console.log('🔄 Verifying deployment results...\n');

    // 4. Check final deployment status
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    const { stdout: pjsipIncludes } = await execAsync('grep "#include.*pjsip_" /etc/asterisk/pjsip.conf || true');
    const { stdout: extIncludes } = await execAsync('grep "#include.*ext_" /etc/asterisk/extensions.conf || true');
    const { stdout: queueIncludes } = await execAsync('grep "#include.*queues_" /etc/asterisk/queues.conf || true');

    const deployedOrgs = new Set();

    // Extract deployed org names from includes
    const pjsipMatches = pjsipIncludes.match(/pjsip_(\w+)\.conf/g) || [];
    pjsipMatches.forEach(match => {
      const orgName = match.replace('pjsip_', '').replace('.conf', '');
      if (orgName !== 'dids') deployedOrgs.add(orgName);
    });

    console.log('📁 Currently deployed organizations in main configs:');
    Array.from(deployedOrgs).sort().forEach(org => console.log(`   - ${org}`));
    console.log();

    // 5. List all organization config files that exist
    const { stdout: allPjsipFiles } = await execAsync('ls -1 /etc/asterisk/pjsip_*.conf 2>/dev/null | grep -v pjsip_dids | grep -v pjsip_notify | grep -v pjsip_wizard || true');
    const { stdout: allExtFiles } = await execAsync('ls -1 /etc/asterisk/ext_*.conf 2>/dev/null || true');
    const { stdout: allQueueFiles } = await execAsync('ls -1 /etc/asterisk/queues_*.conf 2>/dev/null || true');

    const existingOrgFiles = new Set();

    (allPjsipFiles.split('\n').filter(f => f.trim())).forEach(file => {
      const match = file.match(/pjsip_(\w+)\.conf$/);
      if (match) existingOrgFiles.add(match[1]);
    });

    console.log('📂 Organization config files that exist on disk:');
    Array.from(existingOrgFiles).sort().forEach(org => console.log(`   - ${org}`));
    console.log();

    // 6. Final summary
    console.log('═══════════════════════════════════════════════════');
    console.log('📊 DEPLOYMENT SUMMARY:');
    console.log('═══════════════════════════════════════════════════');
    console.log(`   Organizations in database: ${organizations.length}`);
    console.log(`   Successful deployments: ${successCount}`);
    console.log(`   Failed deployments: ${errorCount}`);
    console.log(`   Config files on disk: ${existingOrgFiles.size}`);
    console.log(`   Included in main configs: ${deployedOrgs.size}`);
    console.log();

    if (deployedOrgs.size === organizations.length) {
      console.log('🎉 SUCCESS: All organizations are now deployed and included!');
    } else {
      console.log(`⚠️  WARNING: ${organizations.length - deployedOrgs.size} organizations still missing from main configs`);

      // Show which organizations are missing
      const missingFromConfigs = [];
      for (const org of organizations) {
        const sanitizedName = org.name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_/, '');
        if (!deployedOrgs.has(sanitizedName)) {
          missingFromConfigs.push(`${org.name} (${sanitizedName})`);
        }
      }

      if (missingFromConfigs.length > 0) {
        console.log('\n🚨 Organizations missing from main configs:');
        missingFromConfigs.forEach(org => console.log(`   - ${org}`));
      }
    }

    console.log('\n🔄 Reloading Asterisk configuration...');

    try {
      await execAsync('asterisk -rx "module reload res_pjsip.so"');
      await execAsync('asterisk -rx "dialplan reload"');
      await execAsync('asterisk -rx "module reload app_queue.so"');
      console.log('✅ Asterisk configuration reloaded successfully');
    } catch (reloadError) {
      console.log('⚠️  Failed to reload Asterisk configuration:', reloadError.message);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response?.data) {
      console.error('Response data:', error.response.data);
    }
    process.exit(1);
  }
}

deployAllConfigurations().catch(console.error);