# PBX API - Onboarding Guide

Complete step-by-step guide to onboard a new server and organizations using the API.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Step 1: Initial Server Setup](#step-1-initial-server-setup)
4. [Step 2: Admin Authentication](#step-2-admin-authentication)
5. [Step 3: Configure Global Settings](#step-3-configure-global-settings)
6. [Step 4: Create Organization](#step-4-create-organization)
7. [Step 5: Configure SIP Trunk](#step-5-configure-sip-trunk)
8. [Step 6: Configure DID Numbers](#step-6-configure-did-numbers)
9. [Step 7: Create Users/Extensions](#step-7-create-usersextensions)
10. [Step 8: Create Call Queues](#step-8-create-call-queues)
11. [Step 9: Create IVR Menus](#step-9-create-ivr-menus)
12. [Step 10: Deploy Configuration](#step-10-deploy-configuration)
13. [Step 11: Verify Deployment](#step-11-verify-deployment)
14. [Multi-Tenant Setup](#multi-tenant-setup)
15. [Troubleshooting](#troubleshooting)

---

## Overview

This guide walks you through:
- Setting up a new PBX server from scratch
- Configuring global Asterisk settings
- Creating and configuring organizations (tenants)
- Setting up complete telephony infrastructure via API

**Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│                    PBX API Server                        │
│                  (REST API - Port 3003)                  │
└───────────────────┬─────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
┌───────▼────────┐    ┌────────▼────────┐
│   MariaDB      │    │    Asterisk     │
│   (Storage)    │    │   (PBX Engine)  │
└────────────────┘    └─────────────────┘
```

---

## Prerequisites

Before starting:
- ✅ PBX API server installed and running (see [INSTALLATION.md](INSTALLATION.md))
- ✅ MariaDB database configured and migrated
- ✅ Asterisk installed with PJSIP and AMI enabled
- ✅ Admin credentials configured in `.env`
- ✅ API accessible at `http://your-server:3003`

**Required Information:**
- Your server IP address
- SIP trunk credentials from your provider
- DID numbers to configure
- Organization details

---

## Step 1: Initial Server Setup

### 1.1 Verify API is Running

```bash
curl http://localhost:3003/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-10-03T12:00:00.000Z",
  "uptime": 123.45
}
```

### 1.2 Access API Documentation

Open browser: `http://your-server:3003/api`

This provides interactive Swagger UI for testing all endpoints.

---

## Step 2: Admin Authentication

### 2.1 Get Admin Token

```bash
curl -X POST http://localhost:3003/api/v1/admin/auth \
  -H "Content-Type: application/json" \
  -d '{
    "admin_username": "pbx_admin",
    "admin_password": "your_admin_password"
  }'
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24h"
}
```

**Save this token** - you'll need it for all admin API calls.

### 2.2 Set Environment Variable (Optional)

```bash
export ADMIN_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

Now you can use `$ADMIN_TOKEN` in subsequent requests.

---

## Step 3: Configure Global Settings

Global settings apply to the entire Asterisk server (all organizations).

### 3.1 Get Current Global Settings

```bash
curl -X GET http://localhost:3003/api/v1/admin/settings \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### 3.2 Configure PJSIP Transport

```bash
curl -X PUT http://localhost:3003/api/v1/admin/settings \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pjsip_transport": {
      "udp": {
        "enabled": true,
        "bind": "0.0.0.0:5060",
        "external_media_address": "YOUR_PUBLIC_IP",
        "external_signaling_address": "YOUR_PUBLIC_IP",
        "local_net": ["192.168.1.0/24", "10.0.0.0/8"]
      },
      "tcp": {
        "enabled": false,
        "bind": "0.0.0.0:5060"
      },
      "tls": {
        "enabled": false,
        "bind": "0.0.0.0:5061",
        "cert_file": "/etc/asterisk/keys/asterisk.pem",
        "privkey_file": "/etc/asterisk/keys/asterisk.key"
      }
    }
  }'
```

**Replace:**
- `YOUR_PUBLIC_IP` - Your server's public IP address
- `local_net` - Your internal network ranges

### 3.3 Configure RTP (Media)

```bash
curl -X PUT http://localhost:3003/api/v1/admin/settings \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rtp_config": {
      "rtp_start": 10000,
      "rtp_end": 20000,
      "rtcp_mux": false,
      "ice_support": true,
      "stun_server": "stun.l.google.com:19302"
    }
  }'
```

**Firewall Requirements:**
```bash
# Allow SIP signaling
sudo ufw allow 5060/udp

# Allow RTP media
sudo ufw allow 10000:20000/udp
```

### 3.4 Configure SIP Global Settings

```bash
curl -X PUT http://localhost:3003/api/v1/admin/settings \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sip_global": {
      "user_agent": "MyPBX v1.0",
      "default_expiry": 3600,
      "min_expiry": 60,
      "max_expiry": 7200,
      "mwi_disable_initial_unsolicited": false,
      "ignore_uri_user_options": false,
      "send_rpid": true
    },
    "codecs": {
      "disallow": "all",
      "allow": ["ulaw", "alaw", "g722", "opus"]
    }
  }'
```

### 3.5 Deploy Global Settings

**Option A: Deploy with Reload (Recommended)**
```bash
curl -X POST http://localhost:3003/api/v1/admin/settings/deploy \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Option B: Deploy with Full Restart (⚠️ Drops all active calls)**
```bash
curl -X POST http://localhost:3003/api/v1/admin/settings/deploy?restart=true \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Global settings deployed with module reload",
  "deployment": {
    "pjsip_transport": { "success": true, "file": "/etc/asterisk/pjsip_transport.conf" },
    "rtp": { "success": true, "file": "/etc/asterisk/rtp.conf" },
    "sip_global": { "success": true, "file": "/etc/asterisk/pjsip_global.conf" },
    "reload_results": [
      { "module": "res_pjsip.so", "success": true },
      { "module": "res_rtp_asterisk.so", "success": true }
    ]
  }
}
```

---

## Step 4: Create Organization

Organizations are isolated tenants with separate configurations.

### 4.1 Create Organization

```bash
curl -X POST http://localhost:3003/api/v1/organizations \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Corporation",
    "domain": "acme.example.com",
    "context_prefix": "acme",
    "max_users": 100,
    "max_channels": 50,
    "recording_enabled": true,
    "contact_email": "admin@acme.com",
    "contact_phone": "+1-555-0100"
  }'
```

**Response:**
```json
{
  "success": true,
  "organization": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Acme Corporation",
    "api_key": "acme_live_1a2b3c4d5e6f7g8h9i0j",
    "api_secret": "sk_live_9z8y7x6w5v4u3t2s1r0q",
    "context_prefix": "acme",
    "domain": "acme.example.com",
    "created_at": "2025-10-03T12:00:00.000Z"
  }
}
```

**Important:** Save the `api_key` and `api_secret` - you'll need these for organization-level API calls.

### 4.2 Set Organization Token

```bash
export ORG_API_KEY="acme_live_1a2b3c4d5e6f7g8h9i0j"
export ORG_API_SECRET="sk_live_9z8y7x6w5v4u3t2s1r0q"
export ORG_ID="550e8400-e29b-41d4-a716-446655440000"
```

### 4.3 Get Organization Auth Token

```bash
curl -X POST http://localhost:3003/api/v1/auth \
  -H "X-API-Key: $ORG_API_KEY" \
  -H "X-API-Secret: $ORG_API_SECRET"
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24h",
  "organization": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Acme Corporation"
  }
}
```

```bash
export ORG_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## Step 5: Configure SIP Trunk

SIP trunks connect your PBX to external phone networks.

### 5.1 Create Outbound SIP Trunk

```bash
curl -X POST http://localhost:3003/api/v1/trunks \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Main SIP Trunk",
    "trunk_type": "sip",
    "direction": "bidirectional",
    "host": "sip.yourprovider.com",
    "username": "your_trunk_username",
    "password": "your_trunk_password",
    "port": 5060,
    "transport": "udp",
    "registration": true,
    "max_channels": 10,
    "codec_priority": ["ulaw", "alaw", "g722"],
    "enabled": true
  }'
```

**Replace:**
- `host` - Your SIP provider's host
- `username` - Trunk username from provider
- `password` - Trunk password from provider

**Response:**
```json
{
  "success": true,
  "trunk": {
    "id": "660e8400-e29b-41d4-a716-446655440001",
    "name": "Main SIP Trunk",
    "trunk_type": "sip",
    "status": "active",
    "created_at": "2025-10-03T12:05:00.000Z"
  }
}
```

```bash
export TRUNK_ID="660e8400-e29b-41d4-a716-446655440001"
```

---

## Step 6: Configure DID Numbers

DID numbers are inbound phone numbers that route to your system.

### 6.1 Add DID Number - Route to Extension

```bash
curl -X POST http://localhost:3003/api/v1/dids \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "did_number": "+15551234567",
    "description": "Main Office Line",
    "trunk_id": "'$TRUNK_ID'",
    "destination_type": "extension",
    "destination_value": "100",
    "enabled": true
  }'
```

### 6.2 Add DID Number - Route to IVR

```bash
curl -X POST http://localhost:3003/api/v1/dids \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "did_number": "+15551234568",
    "description": "Customer Support Line",
    "trunk_id": "'$TRUNK_ID'",
    "destination_type": "ivr",
    "destination_value": "main-menu",
    "enabled": true
  }'
```

### 6.3 Add DID Number - Route to Queue

```bash
curl -X POST http://localhost:3003/api/v1/dids \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "did_number": "+15551234569",
    "description": "Sales Queue",
    "trunk_id": "'$TRUNK_ID'",
    "destination_type": "queue",
    "destination_value": "sales",
    "enabled": true
  }'
```

---

## Step 7: Create Users/Extensions

Users get SIP credentials and extension numbers.

### 7.1 Create User with Extension

```bash
curl -X POST http://localhost:3003/api/v1/users \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "john.doe",
    "email": "john.doe@acme.com",
    "full_name": "John Doe",
    "extension": "100",
    "sip_password": "SecurePass123!",
    "voicemail_enabled": true,
    "voicemail_pin": "1234",
    "call_recording": true,
    "max_contacts": 3,
    "role": "user"
  }'
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "770e8400-e29b-41d4-a716-446655440002",
    "username": "john.doe",
    "extension": "100",
    "sip_uri": "sip:100@acme.example.com",
    "sip_username": "100",
    "sip_password": "SecurePass123!",
    "voicemail_enabled": true,
    "created_at": "2025-10-03T12:10:00.000Z"
  }
}
```

**SIP Registration Details:**
- **SIP Server:** `acme.example.com` or `YOUR_SERVER_IP`
- **Username:** `100`
- **Password:** `SecurePass123!`
- **Port:** `5060`
- **Transport:** `UDP`

### 7.2 Create Multiple Users

```bash
# Sales Agent 1
curl -X POST http://localhost:3003/api/v1/users \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "jane.smith",
    "email": "jane.smith@acme.com",
    "full_name": "Jane Smith",
    "extension": "101",
    "sip_password": "SecurePass456!",
    "voicemail_enabled": true,
    "voicemail_pin": "5678",
    "role": "user"
  }'

# Sales Agent 2
curl -X POST http://localhost:3003/api/v1/users \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "bob.jones",
    "email": "bob.jones@acme.com",
    "full_name": "Bob Jones",
    "extension": "102",
    "sip_password": "SecurePass789!",
    "voicemail_enabled": true,
    "voicemail_pin": "9012",
    "role": "user"
  }'
```

---

## Step 8: Create Call Queues

Call queues distribute incoming calls to multiple agents.

### 8.1 Create Sales Queue

```bash
curl -X POST http://localhost:3003/api/v1/queues \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "sales",
    "display_name": "Sales Department",
    "strategy": "rrmemory",
    "max_wait_time": 300,
    "max_callers": 50,
    "announce_frequency": 30,
    "announce_holdtime": true,
    "music_on_hold": "default",
    "retry_interval": 5,
    "wrap_up_time": 15,
    "member_timeout": 20
  }'
```

**Response:**
```json
{
  "success": true,
  "queue": {
    "id": "880e8400-e29b-41d4-a716-446655440003",
    "name": "sales",
    "display_name": "Sales Department",
    "strategy": "rrmemory",
    "created_at": "2025-10-03T12:15:00.000Z"
  }
}
```

```bash
export QUEUE_ID="880e8400-e29b-41d4-a716-446655440003"
```

### 8.2 Add Members to Queue

```bash
# Add Jane Smith (Extension 101)
curl -X POST http://localhost:3003/api/v1/queues/$QUEUE_ID/members \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "member_type": "extension",
    "member_id": "101",
    "priority": 1,
    "penalty": 0
  }'

# Add Bob Jones (Extension 102)
curl -X POST http://localhost:3003/api/v1/queues/$QUEUE_ID/members \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "member_type": "extension",
    "member_id": "102",
    "priority": 1,
    "penalty": 0
  }'
```

**Queue Strategies:**
- `ringall` - Ring all members simultaneously
- `rrmemory` - Round robin with memory (remembers last agent)
- `leastrecent` - Call least recently called agent
- `fewestcalls` - Agent with fewest calls
- `random` - Random agent selection

---

## Step 9: Create IVR Menus

IVR (Interactive Voice Response) provides automated menu systems.

### 9.1 Create Main IVR

```bash
curl -X POST http://localhost:3003/api/v1/ivrs \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "main-menu",
    "description": "Main Company Menu",
    "greeting_message": "Thank you for calling Acme Corporation. For sales, press 1. For support, press 2. For the directory, press 3.",
    "timeout": 10,
    "max_retries": 3,
    "invalid_sound": "invalid",
    "enabled": true
  }'
```

**Response:**
```json
{
  "success": true,
  "ivr": {
    "id": "990e8400-e29b-41d4-a716-446655440004",
    "name": "main-menu",
    "description": "Main Company Menu",
    "created_at": "2025-10-03T12:20:00.000Z"
  }
}
```

```bash
export IVR_ID="990e8400-e29b-41d4-a716-446655440004"
```

### 9.2 Add IVR Menu Options

```bash
# Option 1: Sales Queue
curl -X POST http://localhost:3003/api/v1/ivrs/$IVR_ID/options \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "digit": "1",
    "action": "queue",
    "action_data": "sales",
    "description": "Sales Department"
  }'

# Option 2: Support Extension
curl -X POST http://localhost:3003/api/v1/ivrs/$IVR_ID/options \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "digit": "2",
    "action": "extension",
    "action_data": "100",
    "description": "Support Line"
  }'

# Option 0: Operator
curl -X POST http://localhost:3003/api/v1/ivrs/$IVR_ID/options \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "digit": "0",
    "action": "extension",
    "action_data": "100",
    "description": "Operator"
  }'
```

---

## Step 10: Deploy Configuration

After creating all resources, deploy the configuration to Asterisk.

### 10.1 Deploy Organization Configuration

```bash
curl -X POST http://localhost:3003/api/v1/deploy/$ORG_ID \
  -H "Authorization: Bearer $ORG_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Configuration deployed successfully",
  "deployed_at": "2025-10-03T12:25:00.000Z",
  "files_generated": [
    "/etc/asterisk/pjsip_acme.conf",
    "/etc/asterisk/extensions_acme.conf",
    "/etc/asterisk/queues_acme.conf"
  ],
  "reload_results": {
    "pjsip": "Success",
    "dialplan": "Success",
    "queues": "Success"
  }
}
```

### 10.2 Verify Asterisk Configuration

```bash
# Check PJSIP endpoints
sudo asterisk -rx "pjsip show endpoints"

# Check extensions
sudo asterisk -rx "dialplan show acme_internal"

# Check queues
sudo asterisk -rx "queue show sales"
```

---

## Step 11: Verify Deployment

### 11.1 Check Live Calls

```bash
curl -X GET http://localhost:3003/api/v1/calls/live \
  -H "Authorization: Bearer $ORG_TOKEN"
```

### 11.2 Test Call via API (Click-to-Call)

```bash
curl -X POST http://localhost:3003/api/v1/calls/originate \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "100",
    "to": "101",
    "caller_id": "Test Call"
  }'
```

### 11.3 Register SIP Client

Configure a softphone (e.g., Zoiper, Linphone):
- **Account:** `100@YOUR_SERVER_IP`
- **Username:** `100`
- **Password:** `SecurePass123!`
- **Domain:** `YOUR_SERVER_IP`
- **Port:** `5060`
- **Transport:** `UDP`

### 11.4 Make Test Calls

1. **Extension to Extension:** Dial `101` from extension `100`
2. **Inbound DID:** Call `+15551234567` from external phone
3. **IVR Test:** Call DID routed to IVR and test menu options
4. **Queue Test:** Call DID routed to queue

---

## Multi-Tenant Setup

To add additional organizations, repeat Steps 4-11 for each tenant.

### Example: Add Second Organization

```bash
# Create second organization
curl -X POST http://localhost:3003/api/v1/organizations \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "TechCorp Inc",
    "domain": "techcorp.example.com",
    "context_prefix": "techcorp",
    "max_users": 50,
    "max_channels": 25,
    "recording_enabled": false
  }'

# Get new organization credentials
# ... (follow steps 4.2 - 4.3)

# Configure trunk, DIDs, users, queues for new org
# ... (follow steps 5-9)

# Deploy second organization
curl -X POST http://localhost:3003/api/v1/deploy/$ORG2_ID \
  -H "Authorization: Bearer $ORG2_TOKEN"
```

**Tenant Isolation:**
- Each organization has separate:
  - API keys and secrets
  - Asterisk contexts (`acme_*`, `techcorp_*`)
  - SIP endpoints
  - Extensions
  - Queues and IVRs
  - Call routing

---

## Troubleshooting

### Issue: Organization Authentication Failed

```bash
# Verify organization exists
curl -X GET http://localhost:3003/api/v1/organizations/$ORG_ID \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Check API key/secret
curl -X POST http://localhost:3003/api/v1/auth \
  -H "X-API-Key: $ORG_API_KEY" \
  -H "X-API-Secret: $ORG_API_SECRET" -v
```

### Issue: SIP Registration Failed

```bash
# Check PJSIP endpoints in Asterisk
sudo asterisk -rx "pjsip show endpoints"

# Check PJSIP registrations
sudo asterisk -rx "pjsip show registrations"

# Check if configuration deployed
ls -la /etc/asterisk/pjsip_*

# Reload PJSIP
sudo asterisk -rx "module reload res_pjsip.so"
```

### Issue: Calls Not Routing

```bash
# Check dialplan
sudo asterisk -rx "dialplan show acme_internal"

# Check DID routing
curl -X GET http://localhost:3003/api/v1/dids \
  -H "Authorization: Bearer $ORG_TOKEN"

# Verify trunk status
curl -X GET http://localhost:3003/api/v1/trunks \
  -H "Authorization: Bearer $ORG_TOKEN"

# Check Asterisk console for errors
sudo asterisk -rvvv
```

### Issue: Queue Not Working

```bash
# Check queue exists
sudo asterisk -rx "queue show sales"

# Check queue members
sudo asterisk -rx "queue show sales members"

# Reload queue configuration
sudo asterisk -rx "module reload app_queue.so"

# Check deployment
curl -X POST http://localhost:3003/api/v1/deploy/$ORG_ID \
  -H "Authorization: Bearer $ORG_TOKEN"
```

### Issue: Global Settings Not Applied

```bash
# Check global settings
curl -X GET http://localhost:3003/api/v1/admin/settings \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Redeploy global settings
curl -X POST http://localhost:3003/api/v1/admin/settings/deploy \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Check generated files
ls -la /etc/asterisk/{pjsip_transport,rtp,pjsip_global}.conf
```

### Issue: Port Already in Use

```bash
# Check what's using port 5060
sudo lsof -i :5060

# Check Asterisk status
sudo systemctl status asterisk

# Restart Asterisk
sudo systemctl restart asterisk
```

---

## Quick Reference

### Admin Endpoints
```bash
POST /api/v1/admin/auth                    # Get admin token
GET  /api/v1/admin/settings                # Get global settings
PUT  /api/v1/admin/settings                # Update global settings
POST /api/v1/admin/settings/deploy         # Deploy global settings
POST /api/v1/organizations                 # Create organization
GET  /api/v1/organizations                 # List organizations
```

### Organization Endpoints
```bash
POST /api/v1/auth                          # Get org token
POST /api/v1/trunks                        # Create trunk
POST /api/v1/dids                          # Create DID
POST /api/v1/users                         # Create user
POST /api/v1/queues                        # Create queue
POST /api/v1/queues/{id}/members           # Add queue member
POST /api/v1/ivrs                          # Create IVR
POST /api/v1/ivrs/{id}/options             # Add IVR option
POST /api/v1/deploy/{orgId}                # Deploy org config
GET  /api/v1/calls/live                    # Get live calls
POST /api/v1/calls/originate               # Make call
```

---

## Next Steps

After completing onboarding:

1. **Configure Webhooks** - Receive real-time call events
2. **Setup Call Recording** - Access recorded calls
3. **Monitor Call Statistics** - View live call metrics
4. **Configure Outbound Routes** - Set up outbound call routing rules
5. **Setup Voicemail** - Configure voicemail boxes
6. **Integrate AI Agents** - Route calls to AI voice agents

---

## Support

- **Installation Issues:** [INSTALLATION.md](INSTALLATION.md)
- **API Documentation:** http://your-server:3003/api
- **GitHub Issues:** https://github.com/saynth-ai/asterisk-api/issues

---

**Created:** 2025-10-03
**Version:** 1.0
**License:** MIT
