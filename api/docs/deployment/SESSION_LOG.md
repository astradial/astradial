# AstraPBX Deployment Session Log

> This document captures all work done during VPS deployment so any Claude agent can continue seamlessly.

## Session Date: 2026-03-10

---

## 1. VPS Details

- **IP:** 89.116.31.109
- **SSH:** `ssh root@89.116.31.109`
- **OS:** Debian 13 (trixie), kernel 6.12.73
- **RAM:** 8GB | **Disk:** 148GB
- **Domain:** devpbx.astradial.com
- **DNS:** Cloudflare A record → 89.116.31.109 (proxy enabled, orange cloud)

---

## 2. What Was Installed on VPS

### Pre-existing (already on server)
- Node.js v20.20.1
- MariaDB 11.8.3 (running, enabled)
- Asterisk 20.18.2 (running, enabled)
- Git

### Installed during this session
- **Nginx** — `apt-get install nginx`
- **Certbot** — `apt-get install certbot python3-certbot-nginx`
- **PM2** — `npm install -g pm2` (process manager for Node.js)

---

## 3. App Deployment

### Location
- App deployed to: `/opt/astrapbx`
- Synced from local machine using:
  ```bash
  rsync -avz --exclude 'node_modules' --exclude '.env' --exclude '.git' \
    --exclude 'backups' --exclude '.claude' \
    /Users/hari/StudioProjects/AstraPBX/ root@89.116.31.109:/opt/astrapbx/
  ```

### .env file created at `/opt/astrapbx/.env`
```
DB_HOST=localhost
DB_PORT=3306
DB_NAME=pbx_api_db
DB_USER=pbx_api
DB_PASSWORD=pbx_secure_password
DB_DIALECT=mariadb
PORT=8000
NODE_ENV=production
API_PREFIX=/api/v1
SWAGGER_DOMAIN=https://devpbx.astradial.com
AMI_HOST=localhost
AMI_PORT=5038
AMI_USER=pbx_ami_user
AMI_SECRET=pbx_secure_password
ASTERISK_HOST=localhost
ASTERISK_PORT=8088
ASTERISK_USERNAME=pbx_api
ASTERISK_SECRET=pbx_secret
ASTERISK_APP_NAME=pbx_api
ASTERISK_ARI_USERNAME=pbx_api
ASTERISK_ARI_PASSWORD=pbx_secret
ASTERISK_ARI_APP=pbx_api
JWT_SECRET=astrapbx_production_jwt_secret_2026
```

### npm install
```bash
cd /opt/astrapbx && npm install --production
```

### Database migrations
```bash
cd /opt/astrapbx && npx sequelize-cli db:migrate
# Result: all 12 migrations already up to date
```

---

## 4. Database Setup

### Created DB and user
```sql
CREATE DATABASE IF NOT EXISTS pbx_api_db;
CREATE USER IF NOT EXISTS 'pbx_api'@'localhost' IDENTIFIED BY 'pbx_secure_password';
GRANT ALL PRIVILEGES ON pbx_api_db.* TO 'pbx_api'@'localhost';
```

### Database seeded with test data
Ran `node src/scripts/seed-database.js` which created:
- 2 Organizations (Acme Corporation, TechStart Inc)
- 2 SIP Trunks
- 3 DID Numbers
- 3 Users
- 2 Queues
- 2 Queue Members
- 2 Webhooks

### Seed script fixes applied (committed locally)
The seed script (`src/scripts/seed-database.js`) was missing required fields:
1. **`asterisk_endpoint`** — added to all User.create() calls (e.g., `PJSIP/acme_100`)
2. **`asterisk_queue_name`** — added to all Queue.create() calls (e.g., `acme_support`)
3. **`configuration: {}`** — added to Queue.create() calls

### DB schema fixes applied on VPS
MariaDB strict mode rejects inserts when NOT NULL columns lack defaults. Fixed:
```sql
ALTER TABLE queues ALTER COLUMN configuration SET DEFAULT '{}';
ALTER TABLE webhooks ALTER COLUMN rate_limit SET DEFAULT '0';
ALTER TABLE webhooks ALTER COLUMN statistics SET DEFAULT '{}';
ALTER TABLE webhooks ALTER COLUMN headers SET DEFAULT '{}';
```
**Note:** The Webhook model (`src/models/Webhook.js`) does NOT define `rate_limit` or `statistics` fields — these were added by migrations but the model wasn't updated. This causes the "Field 'rate_limit' doesn't have a default value" error when creating webhooks via API. The DB-level defaults fix this.

---

## 5. Test Credentials

### Web Phone Login (POST /api/v1/webphone/login)
| Username | Password | Extension | Org | Role | SIP Password |
|----------|----------|-----------|-----|------|-------------|
| john.doe | admin123 | 100 | Acme Corp | admin | sip_admin_pass |
| jane.smith | agent123 | 101 | Acme Corp | agent | sip_agent_pass |
| mike.tech | tech123 | 200 | TechStart | supervisor | sip_super_pass |

### API Keys
| Organization | API Key | API Secret |
|-------------|---------|------------|
| Acme Corporation | acme_api_key_123456 | acme_secret_abcdef789 |
| TechStart Inc | tech_api_key_789012 | tech_secret_xyz345def |

### Asterisk Endpoints (for Zoiper/softphones)
| Endpoint | SIP Password | SIP Server |
|----------|-------------|------------|
| acme_100 | sip_admin_pass | 89.116.31.109:5060 |
| acme_101 | sip_agent_pass | 89.116.31.109:5060 |
| tech_200 | sip_super_pass | 89.116.31.109:5060 |

**IMPORTANT:** PJSIP endpoints have NOT been deployed to Asterisk yet. Only DB records exist. Need to hit the deploy API endpoint to generate PJSIP config and reload Asterisk.

---

## 6. Nginx Configuration

File: `/etc/nginx/sites-available/devpbx.astradial.com`
```nginx
server {
    listen 80;
    listen 443 ssl;
    server_name devpbx.astradial.com;

    ssl_certificate /etc/ssl/certs/astrapbx.crt;
    ssl_certificate_key /etc/ssl/private/astrapbx.key;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```
- Symlinked to `/etc/nginx/sites-enabled/`
- Default site removed
- Self-signed SSL cert used for Cloudflare origin (Cloudflare handles public SSL)
- **Cloudflare SSL mode must be "Full" (not "Full Strict")**

---

## 7. Firewall (UFW)

Ports opened during this session:
```bash
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
```

Full open ports:
| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH |
| 80 | TCP | HTTP |
| 443 | TCP | HTTPS |
| 5060 | UDP | SIP |
| 10000-20000 | UDP | RTP media |

---

## 8. PM2 Process Manager

```bash
# App started as:
pm2 start src/server.js --name astrapbx --env production

# Auto-start on reboot configured:
pm2 startup
pm2 save
```

Systemd service: `/etc/systemd/system/pm2-root.service`

---

## 9. Asterisk Configuration on VPS

### AMI (`/etc/asterisk/manager.conf`)
```ini
[general]
enabled = yes
port = 5038
bindaddr = 127.0.0.1

[pbx_ami_user]
secret = pbx_secure_password
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.0/255.255.255.0
read = all
write = all
```

### ARI (`/etc/asterisk/ari.conf`)
```ini
[general]
enabled=yes
pretty=yes
allowed_origins=*

[pbx_api]
type=user
read_only=no
password=pbx_secret
```

### HTTP (`/etc/asterisk/http.conf`)
```ini
[general]
enabled=yes
bindaddr=0.0.0.0
bindport=8088
```

---

## 10. Additional Work Done (Post-Initial Deployment)

### SIP Domain Setup
- Created `devsip.astradial.com` A record → 89.116.31.109 (Cloudflare proxy OFF / DNS only)
- This is for SIP softphone connections (Zoiper etc.) since Cloudflare proxy blocks SIP traffic

### PJSIP Transport Added
- Created `/etc/asterisk/pjsip_transport.conf` with UDP (5060), TCP (5060), WSS (8089)
- Added `#include /etc/asterisk/pjsip_transport.conf` at top of `/etc/asterisk/pjsip.conf`
- External media/signaling address set to `89.116.31.109`

### PJSIP Endpoints Deployed
- Ran `POST /api/v1/organizations/:orgId/regenerate` for both orgs
- All 3 endpoints loaded in Asterisk: `acme_100`, `acme_101`, `tech_200`

### Bug Fixes Applied
1. **`asterisk_endpoint` had `PJSIP/` prefix** — DB stored `PJSIP/acme_100`, causing section names `[PJSIP/acme_100]` which Asterisk couldn't match to SIP REGISTER requests.
   - Fix: `UPDATE users SET asterisk_endpoint = REPLACE(asterisk_endpoint, 'PJSIP/', '')`
   - Fixed seed script locally too

2. **Auth username double underscore** — `userProvisioningService.js:111` was `context_prefix + "_" + extension` → `acme__100` (double underscore because context_prefix already ends with `_`)
   - Fix: Changed to use `endpoint` name directly: `username=${endpoint}` → `acme_100`
   - File: `src/services/asterisk/userProvisioningService.js` line 111

3. **Webhook creation error** — `rate_limit` and `statistics` columns had no DB defaults
   - Fix: `ALTER TABLE webhooks ALTER COLUMN rate_limit SET DEFAULT '0'` etc.

### Zoiper SIP Credentials (FINAL — working)
| User | SIP Username | SIP Password | SIP Domain |
|------|-------------|-------------|------------|
| John Doe | `acme_100` | `sip_admin_pass` | `devsip.astradial.com` |
| Jane Smith | `acme_101` | `sip_agent_pass` | `devsip.astradial.com` |
| Mike Johnson | `tech_200` | `sip_super_pass` | `devsip.astradial.com` |

---

## 11. Pending / TODO

- [x] ~~Deploy PJSIP endpoints to Asterisk~~ — DONE
- [x] ~~Webhook creation error~~ — DONE (DB defaults fixed)
- [ ] **Webhook model update** — `src/models/Webhook.js` is missing `rate_limit` and `statistics` fields. Only DB defaults fix it currently.
- [ ] **Web phone login broken** — bcrypt password hashes in seed script are pre-computed and don't match. Need to regenerate or use API to create users.
- [ ] **Certbot SSL** — Using self-signed cert with Cloudflare proxy. If proxy disabled, run `certbot --nginx -d devpbx.astradial.com`.
- [ ] **Production JWT secret** — Currently hardcoded. Consider stronger random secret.
- [ ] **Zoiper registration** — Testing in progress. If still 401, check Asterisk logs: `tail -20 /var/log/asterisk/messages.log`

---

## 11. Useful Commands

```bash
# SSH
ssh root@89.116.31.109

# App management
pm2 status
pm2 logs astrapbx
pm2 restart astrapbx
pm2 logs astrapbx --err --lines 50   # error logs only

# Redeploy code from local
rsync -avz --exclude 'node_modules' --exclude '.env' --exclude '.git' \
  --exclude 'backups' --exclude '.claude' \
  /Users/hari/StudioProjects/AstraPBX/ root@89.116.31.109:/opt/astrapbx/
ssh root@89.116.31.109 "cd /opt/astrapbx && npm install --production && pm2 restart astrapbx"

# Database
ssh root@89.116.31.109 "mariadb pbx_api_db -e 'SELECT username, extension, role FROM users;'"

# Re-seed (clean + seed)
ssh root@89.116.31.109 "mariadb pbx_api_db -e 'DELETE FROM queue_members; DELETE FROM webhooks; DELETE FROM queues; DELETE FROM users; DELETE FROM did_numbers; DELETE FROM sip_trunks; DELETE FROM organizations;' && cd /opt/astrapbx && node src/scripts/seed-database.js"

# Nginx
ssh root@89.116.31.109 "nginx -t && systemctl reload nginx"

# Asterisk
ssh root@89.116.31.109 "asterisk -rx 'pjsip show endpoints'"
ssh root@89.116.31.109 "asterisk -rx 'core reload'"

# Test endpoints
curl -s https://devpbx.astradial.com/api/ | head -20
curl -s https://devpbx.astradial.com/phone/
```

---

## 12. File Changes Made Locally

### `src/scripts/seed-database.js`
- Added `asterisk_endpoint` field to all 3 User.create() calls (without `PJSIP/` prefix)
- Added `asterisk_queue_name` field to all 2 Queue.create() calls
- Added `configuration: {}` to all 2 Queue.create() calls

### `src/services/asterisk/userProvisioningService.js`
- Line 111: Changed auth username from `${org.context_prefix}_${user.extension}` to `${endpoint}` to avoid double underscore

### `docs/deployment/VPS_DEPLOYMENT.md` (new)
- Deployment summary document

### `docs/deployment/SESSION_LOG.md` (this file)
- Comprehensive session log for agent handoff

---

## 13. Quick Reference for New Agents

**To redeploy code changes:**
```bash
rsync -avz --exclude 'node_modules' --exclude '.env' --exclude '.git' --exclude 'backups' --exclude '.claude' /Users/hari/StudioProjects/AstraPBX/ root@89.116.31.109:/opt/astrapbx/
ssh root@89.116.31.109 "cd /opt/astrapbx && npm install --production && pm2 restart astrapbx"
```

**To regenerate Asterisk configs after DB changes:**
```bash
curl -s -X POST https://devpbx.astradial.com/api/v1/organizations/df27aa9e-2074-47f2-abcf-31b66c37b0f5/regenerate  # Acme
curl -s -X POST https://devpbx.astradial.com/api/v1/organizations/7f657178-2708-4df4-96fc-a4894c0ad37f/regenerate  # TechStart
ssh root@89.116.31.109 "asterisk -rx 'core reload'"
```

**To check SIP registration status:**
```bash
ssh root@89.116.31.109 "asterisk -rx 'pjsip show endpoints'"
ssh root@89.116.31.109 "tail -20 /var/log/asterisk/messages.log"
```

---

## Session: 2026-03-10 (Swagger UI & Recording API Fixes)

### Problem
- GET `/calls/{callId}/recording` endpoint showed **unlocked padlock** in Swagger UI
- Swagger UI did not send Authorization header when executing requests for this endpoint
- Result: 401 "Authentication required" error from Swagger UI

### Root Cause
**Cloudflare was caching `swagger-ui-init.js`** (the file that contains the embedded OpenAPI spec) with `max-age: 14400` (4 hours). Every change to the spec on the server was invisible to browsers because Cloudflare kept serving the stale cached version.

### Changes Made

#### 1. Swagger UI path changed: `/api-docs` → `/docs`
- **Why:** To bypass Cloudflare's cached version of the old `/api-docs/swagger-ui-init.js`
- **Files:** `src/server.js` (lines ~148-160)
- Old `/api-docs` now redirects to `/docs`
- New URL: `https://devpbx.astradial.com/docs/`

#### 2. No-cache middleware added for Swagger UI
- **File:** `src/server.js`
- Express middleware sets `Cache-Control: no-store, no-cache, must-revalidate` on all `/docs/*` routes
- Prevents Cloudflare from caching swagger files in the future

#### 3. Removed unused security schemes from OpenAPI spec
- **File:** `docs/API_SPECIFICATION.yaml`
- Removed `ApiKeyAuth` and `ApiSecretAuth` from `components/securitySchemes`
- Only `BearerAuth` (JWT) remains — this is the only auth method used
- Swagger "Authorize" dialog now only shows Bearer token input

#### 4. Recording endpoint spec rewritten
- **File:** `docs/API_SPECIFICATION.yaml`
- Path changed from `/calls/{id}/recording` to `/calls/{callId}/recording`
- Parameter name: `callId` (consistent with Swagger UI display)
- Response content type: `application/octet-stream` (was `audio/wav`)
- Curl example updated to show `Authorization: Bearer` header

#### 5. Server route updated to match
- **File:** `src/server.js`
- `app.get('/api/v1/calls/:callId/recording', ...)` (was `:id`)
- `app.post('/api/v1/calls/:callId/recording', ...)` (was `:id`)
- Handler uses `req.params.callId` instead of `req.params.id`

#### 6. Nginx config updated
- **File:** `/etc/nginx/sites-enabled/devpbx.astradial.com`
- Added `/api-docs/` location block with no-cache headers (for future-proofing)

### Key Lesson
**Cloudflare caches `.js` files by default** even on the free plan. `swagger-ui-express` embeds the full OpenAPI spec inside `swagger-ui-init.js`. When you update the spec and restart the server, Cloudflare keeps serving the old JS file. Always set `no-cache` headers for dynamic Swagger UI files, or use a cache-busting strategy.

### Verification
```bash
# Check Cloudflare cache status (should show BYPASS or DYNAMIC, not HIT)
curl -s -I 'https://devpbx.astradial.com/docs/swagger-ui-init.js' | grep cf-cache

# Test recording endpoint with auth
TOKEN=$(curl -s -X POST https://devpbx.astradial.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"api_key":"acme_api_key_123456","api_secret":"acme_secret_abcdef789"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
curl -s -w '\nHTTP: %{http_code}\n' "https://devpbx.astradial.com/api/v1/calls/test-uuid/recording" \
  -H "Authorization: Bearer $TOKEN"
# Expected: 404 (call not found) — NOT 401 (auth error)
```

---

## Session: 2026-03-10 (Webhook System for Real Calls)

### Problem
Webhooks were registered in the database but never fired for actual SIP calls. The AMI event listener was not handling `DialBegin` or `DialEnd` events, so `callInitiated` and `callAnswered` internal events were never emitted.

### Changes Made

#### 1. AMI event handlers added in `src/services/asterisk/asteriskManager.js`
- Added `DialBegin` AMI event handler that emits `callInitiated` event with caller, destination, and channel info
- Added `DialEnd` AMI event handler that emits `callAnswered` event (on `ANSWER` dial status) with call details and duration

#### 2. Event wiring in `src/services/eventListenerService.js`
- Wired `callInitiated` and `callAnswered` events to trigger webhook delivery via `webhookService.js`
- Webhooks subscribed to `call.initiated` and `call.answered` events now fire when real SIP calls occur

### How It Works
```
SIP Call → Asterisk → AMI DialBegin event → asteriskManager emits 'callInitiated'
                                          → eventListenerService catches it
                                          → webhookService delivers to subscribed URLs

SIP Call Answered → Asterisk → AMI DialEnd event (ANSWER) → asteriskManager emits 'callAnswered'
                                                           → eventListenerService catches it
                                                           → webhookService delivers to subscribed URLs
```

### Testing
```bash
# Register a webhook for call events
TOKEN="your_org_token"
curl -s -X POST https://devpbx.astradial.com/api/v1/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-endpoint.com/webhook", "events": ["call.initiated", "call.answered"]}'

# Make a real call between two registered SIP endpoints (e.g., acme_100 calls acme_101)
# The webhook URL will receive POST requests with call event data
```
