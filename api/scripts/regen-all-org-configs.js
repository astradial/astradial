#!/usr/bin/env node
/**
 * Re-deploy every active org's Asterisk config in one pass, then
 * reload Asterisk once at the end. Useful after a dialplan refactor
 * (e.g. context-name change, member-format change) so every org's
 * queues.conf + ext_<org>.conf are rewritten with the new format
 * without operators having to click "Save" on each queue/IVR.
 *
 * Idempotent: re-running emits the same files. Reload once at end
 * keeps Asterisk impact minimal (vs reload-per-org which thrashes).
 *
 * Usage on a deployed VPS:
 *   cd /app && node scripts/regen-all-org-configs.js
 *
 * Exits 0 on full success, 1 if any org's deploy or the final
 * reload failed (so a deploy hook can gate on this).
 */
'use strict';

const { Organization } = require('../src/models');
const ConfigDeploymentService = require('../src/services/asterisk/configDeploymentService');

(async () => {
  const svc = new ConfigDeploymentService();
  const orgs = await Organization.findAll({
    where: { status: 'active' },
    attributes: ['id', 'name'],
  });
  console.log(`Re-deploying ${orgs.length} active org(s)`);

  let ok = 0;
  let fail = 0;
  for (const org of orgs) {
    try {
      await svc.deployOrganizationConfiguration(org.id, org.name);
      console.log(`✓ ${org.name} (${org.id})`);
      ok++;
    } catch (e) {
      console.error(`✗ ${org.name} (${org.id}): ${e.message}`);
      fail++;
    }
  }

  console.log(`\nReloading Asterisk once for all orgs…`);
  try {
    await svc.reloadAsteriskConfiguration();
    console.log(`✓ Asterisk reload complete`);
  } catch (e) {
    console.error(`✗ Asterisk reload failed: ${e.message}`);
    fail++;
  }

  console.log(`\nDone — deployed=${ok} failed=${fail} total=${orgs.length}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('fatal:', e); process.exit(1); });
