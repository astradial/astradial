# Security

If you've deployed an OSS Astradial instance, read this. The defaults
are now safe, but earlier versions of `docker-compose.yml` and
`setup.sh` had two issues that need explicit upgrade steps.

## Reporting vulnerabilities

If you find a security issue please email **security@astradial.in**
with a description and reproduction steps. We aim to acknowledge
within 1 business day. Please don't open a public issue or PR for
unpatched vulnerabilities.

## What changed (2026-05-28)

A Skylink-OSS deployment was hit by an automated MariaDB ransomware
scanner. Root cause + the fixes that landed in the repo:

| Vulnerability | Fix |
|---|---|
| `docker-compose.yml` published MariaDB on `0.0.0.0:3307` | Now binds to `127.0.0.1:3307:3306` |
| `docker-compose.yml` published Redis on `0.0.0.0:6379` | Now binds to `127.0.0.1:6379:6379` |
| `setup.sh` defaulted `DB_PASSWORD` and `DB_ROOT_PASSWORD` to the dictionary word `changeme` | Now generates a 24-byte random hex string per password |

### Why docker-compose `ports:` defaults are dangerous

When you write `ports: - "3307:3306"`, Docker writes iptables rules
directly to its `DOCKER` and `DOCKER-USER` chains. These run **before**
UFW's `INPUT` chain, so the port becomes reachable from the public
internet even when `ufw status` shows no rule for it. The phrase to
remember: **UFW doesn't see Docker port forwards.**

This is documented but easy to miss:
https://docs.docker.com/network/iptables/

## Upgrading an existing deployment

If you deployed before this commit you may be exposed. Check:

```bash
# From OUTSIDE the box, scan for exposed DB ports:
nmap -sT -Pn -p 3306,3307,5432,6379,27017 <your-public-ip>

# If 3307 or 6379 returns "open", you're vulnerable. Pull the latest
# main, then re-run setup or manually patch:
git pull
docker compose down
docker compose up -d
```

Rotate any passwords that may have leaked. The two values to rotate:

```bash
cd /opt/astradial   # or wherever you deployed

# Generate strong replacements
NEW_DB_ROOT=$(openssl rand -hex 24)
NEW_DB_USER=$(openssl rand -hex 24)

# Update .env
sed -i "s|^DB_ROOT_PASSWORD=.*|DB_ROOT_PASSWORD=$NEW_DB_ROOT|" .env
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=$NEW_DB_USER|" .env

# Apply inside MariaDB (volume already exists, env var alone won't update it)
docker exec -i astradial-mariadb-1 mariadb -uroot -p<OLD_ROOT> <<SQL
ALTER USER 'root'@'%'        IDENTIFIED BY '$NEW_DB_ROOT';
ALTER USER 'root'@'localhost' IDENTIFIED BY '$NEW_DB_ROOT';
ALTER USER 'astradial'@'%'   IDENTIFIED BY '$NEW_DB_USER';
FLUSH PRIVILEGES;
SQL

# Restart api so it picks up the new DB_PASSWORD
docker compose restart api
```

## Hardening checklist (recommended)

Even with the defaults secured, run these on any production OSS host:

1. **Confirm port exposure**: `ss -tlnp` — anything bound to `0.0.0.0`
   that isn't 22, 80, 443, 5060/udp, 51820/udp, or your asterisk RTP
   range should be `127.0.0.1`.
2. **UFW + Docker**: even though port-bindings are now localhost-only,
   set the `DOCKER-USER` chain to DROP-by-default and explicit-allow
   only what's needed. See `internal-docs/docs/architecture/network-security.md`.
3. **fail2ban**: install + enable jails for `sshd`, `asterisk-auth`
   (SIP REGISTER brute-force), and `asterisk-scan` (SIP scanner
   patterns).
4. **DB backups off-box**: `mariadb-dump` daily, ship to S3 or any
   remote storage. Ransomware can't drop what you've already mirrored.
5. **MariaDB root password rotation**: even though it's no longer
   exposed, the docker-init phase still uses
   `MARIADB_ROOT_PASSWORD=$DB_ROOT_PASSWORD` from the env. Don't reuse
   between deploys.
6. **Don't expose admin UIs**: keep the editor (3001), netdata
   (19999), pgAdmin etc. behind a VPN or Cloudflare Access.
7. **TLS only**: serve the editor + api over HTTPS via Caddy (the
   default with `--profile domain`).

## Open issues we know about

- The Asterisk AMI port (5038) is exposed inside the api container
  but not to the host. Already safe.
- Editor (3001) is exposed publicly when `--profile domain` is not
  used. For internet-facing deployments, always use the domain
  profile so Caddy handles TLS + you don't expose the raw editor.
- WireGuard reseller plane (`wg-reseller`) is locked down via
  `nft` rules — see `sip-gateway/reseller/lib/wg.sh`.
