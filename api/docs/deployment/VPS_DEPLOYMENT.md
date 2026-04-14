# AstraPBX VPS Deployment

## Deployment Summary

| Component | Details |
|-----------|---------|
| **URL** | https://devpbx.astradial.com |
| **Swagger Docs** | https://devpbx.astradial.com/docs/ (old `/api-docs` redirects) |
| **VPS IP** | 89.116.31.109 |
| **App Location** | `/opt/astrapbx` |
| **Process Manager** | PM2 (auto-starts on reboot) |
| **Reverse Proxy** | Nginx with self-signed cert (Cloudflare handles public SSL) |
| **Database** | MariaDB 11.8.3 — `pbx_api_db` with all migrations applied |
| **Asterisk ARI** | Connected (port 8088) |
| **Asterisk AMI** | Connected (port 5038) |
| **Node.js** | v20.20.1 |
| **OS** | Debian 13 (trixie) |

## Firewall (UFW) Open Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH |
| 80 | TCP | HTTP |
| 443 | TCP | HTTPS |
| 5060 | UDP | SIP |
| 10000-20000 | UDP | RTP media |

## DNS Configuration

- **Domain:** devpbx.astradial.com
- **DNS Provider:** Cloudflare
- **Record Type:** A record pointing to 89.116.31.109
- **Cloudflare Proxy:** Enabled (orange cloud)
- **SSL Mode:** Must be set to **Full** (not Full Strict) — origin uses self-signed cert

## Useful Commands

```bash
# SSH into VPS
ssh root@89.116.31.109

# View app logs
pm2 logs astrapbx

# Restart app
pm2 restart astrapbx

# Check app status
pm2 status

# Redeploy code (from local machine)
rsync -avz --exclude 'node_modules' --exclude '.env' --exclude '.git' --exclude 'backups' --exclude '.claude' \
  /Users/hari/StudioProjects/AstraPBX/ root@89.116.31.109:/opt/astrapbx/

# Install deps and restart (on VPS)
cd /opt/astrapbx && npm install --production && pm2 restart astrapbx

# Run migrations (on VPS)
cd /opt/astrapbx && npx sequelize-cli db:migrate

# Nginx config
cat /etc/nginx/sites-available/devpbx.astradial.com
nginx -t && systemctl reload nginx
```

## Configuration Files on VPS

| File | Purpose |
|------|---------|
| `/opt/astrapbx/.env` | App environment variables |
| `/etc/nginx/sites-available/devpbx.astradial.com` | Nginx reverse proxy config |
| `/etc/ssl/certs/astrapbx.crt` | Self-signed SSL cert (for Cloudflare origin) |
| `/etc/ssl/private/astrapbx.key` | SSL private key |
| `/etc/asterisk/manager.conf` | AMI config (user: `pbx_ami_user`) |
| `/etc/asterisk/ari.conf` | ARI config (user: `pbx_api`) |
| `/etc/asterisk/http.conf` | Asterisk HTTP (port 8088) |

## Deployment Date

- **Initial Deployment:** 2026-03-10
