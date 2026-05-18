# Hand-maintained Asterisk configs (reference copies)

**⚠️ These files are NOT auto-deployed.** They live under `/etc/asterisk/` on
the live VPS. This directory is a reference snapshot so the repo contains
the canonical current content for disaster recovery / re-provisioning.

## Why they're not in the deploy pipeline

- `deploy-api-prod.yml` and `deploy-api-staging.yml` rsync `api/` to
  `/app/`. They do NOT touch `/etc/asterisk/`.
- These files are hand-edited per-host and each host's copy may legitimately
  differ (e.g., prod vs staging network IPs, per-org DID dispatch tables).
- Auto-syncing them would clobber host-specific tuning and could take
  production PBX down if a mistake is merged.

## What's in here

### `prod/`

Files as they exist on `203.0.113.1` (production VPS):

| File | Purpose |
|---|---|
| `ext_from_cloud.conf` | Receives staging → prod WireGuard outbound, Gotos `staging-outbound`. |
| `ext_staging_outbound.conf` | Dials `PJSIP/${EXTEN}@tata_gateway` for staging-originated PSTN. |
| `ext_tata_gateway.conf` | Per-DID dispatch table — receives calls from Tata NNI trunk, Gotos the right org context. |
| `pjsip_transport.conf` | Global UDP/TCP/TLS transport defs. |
| `pjsip_tata_gateway.conf` | Tata NNI trunk endpoint (contacts NUC at `10.10.10.2:5060`). |
| `pjsip_staging_trunk.conf` | Accepts inbound from staging WG (`10.10.10.3:5060`). |

Also on prod but not duplicated here (auto-generated per-org by
`dialplanGenerator.js` / `sipTrunkService.js`):

- `ext_om_chamber.conf`, `ext_grandestancia.conf`, `ext_zauto_ai.conf`
- `pjsip_astraprivate.conf` (and equivalents for other orgs)
- `queues_<org>.conf`

## Staying in sync

When editing any of these on the VPS:

1. Backup on the VPS: `cp <file> <file>.bak-$(date +%Y-%m-%d)`
2. Make the change. Reload: `asterisk -rx "dialplan reload"` or `pjsip reload`.
3. **Copy the edited file back into this directory** and commit it. Write
   the PR description with the before/after diff for audit.
4. Document the change in `docs/operations/troubleshooting.md` in the
   `internal-docs` repo as a numbered Error entry — future agents hitting
   the same symptom will find it.

## Reprovisioning procedure (future disaster-recovery)

If `/etc/asterisk/` is lost (new VPS, fresh install, accidental `rm`):

```bash
# Copy these files back into place
scp prod/*.conf root@<new-vps>:/etc/asterisk/

# Copy generated per-org files from backup (auto-regen'd on next deploy if missing)
# Or regenerate via the API:
#   POST /api/v1/config/deploy  for each org

asterisk -rx "dialplan reload"
asterisk -rx "pjsip reload"
```

## Current drift status (as of commit)

Files here match `/etc/asterisk/` on `203.0.113.1` as of the commit
timestamp. If you find drift in the future, don't assume this copy is
right — check the VPS first, then update this copy.
