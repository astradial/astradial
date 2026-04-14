# API Endpoints Quick Reference

## Base URL
```
http://103.92.154.211:3003/api/v1
```

## Authentication Endpoints

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| POST | `/auth/login` | ❌ None | Organization authentication - returns JWT token |
| POST | `/admin/auth` | ❌ None | Admin authentication - returns admin JWT token |
| GET | `/admin/organizations/{id}/credentials` | ✅ Admin Token | Get organization API credentials |
| GET | `/admin/organizations` | ✅ Admin Token | List all organizations (admin only) |

## Organization Management

| Method | Endpoint | Auth Required | PUT Supported | Description |
|--------|----------|---------------|---------------|-------------|
| POST | `/organizations` | ✅ Admin Credentials | N/A | Create new organization with full settings |
| GET | `/organizations` | ✅ Bearer Token | N/A | List all organizations for current org |
| GET | `/organizations/{id}` | ✅ Bearer Token | N/A | Get organization details |
| **PUT** | **`/organizations/{id}`** | ✅ Bearer Token | ✅ **YES** | **Update organization settings, features, limits** |
| DELETE | `/organizations/{id}` | ✅ Bearer Token | N/A | Delete organization |

## SIP Trunk Management

| Method | Endpoint | Auth Required | PUT Supported | Description |
|--------|----------|---------------|---------------|-------------|
| POST | `/trunks` | ✅ Bearer Token | N/A | Create new SIP trunk |
| GET | `/trunks` | ✅ Bearer Token | N/A | List all SIP trunks |
| GET | `/trunks/{id}` | ✅ Bearer Token | N/A | Get trunk details |
| **PUT** | **`/trunks/{id}`** | ✅ Bearer Token | ✅ **YES** | **Update trunk configuration** |
| DELETE | `/trunks/{id}` | ✅ Bearer Token | N/A | Delete SIP trunk |

## DID Number Management

| Method | Endpoint | Auth Required | PUT Supported | Description |
|--------|----------|---------------|---------------|-------------|
| POST | `/dids` | ✅ Bearer Token | N/A | Create new DID number |
| GET | `/dids` | ✅ Bearer Token | N/A | List all DID numbers |
| GET | `/dids/{id}` | ✅ Bearer Token | N/A | Get DID details |
| **PUT** | **`/dids/{id}`** | ✅ Bearer Token | ✅ **YES** | **Update DID configuration** |
| **PUT** | **`/dids/{id}/routing`** | ✅ Bearer Token | ✅ **YES** | **Update DID routing only** |
| DELETE | `/dids/{id}` | ✅ Bearer Token | N/A | Delete DID number |

## User Management

| Method | Endpoint | Auth Required | PUT Supported | Description |
|--------|----------|---------------|---------------|-------------|
| POST | `/users` | ✅ Bearer Token | N/A | Create new user with SIP endpoint |
| GET | `/users` | ✅ Bearer Token | N/A | List all users |
| GET | `/users/{id}` | ✅ Bearer Token | N/A | Get user details |
| **PUT** | **`/users/{id}`** | ✅ Bearer Token | ✅ **YES** | **Update user information** |
| DELETE | `/users/{id}` | ✅ Bearer Token | N/A | Delete user |

## Queue Management

| Method | Endpoint | Auth Required | PUT Supported | Description |
|--------|----------|---------------|---------------|-------------|
| POST | `/queues` | ✅ Bearer Token | N/A | Create new queue |
| GET | `/queues` | ✅ Bearer Token | N/A | List all queues |
| GET | `/queues/{id}` | ✅ Bearer Token | N/A | Get queue details with members |
| **PUT** | **`/queues/{id}`** | ✅ Bearer Token | ✅ **YES** | **Update queue configuration** |
| DELETE | `/queues/{id}` | ✅ Bearer Token | N/A | Delete queue |
| POST | `/queues/{id}/members` | ✅ Bearer Token | N/A | Add member to queue (auto-deploy) |
| DELETE | `/queues/{id}/members?userId={uuid}` | ✅ Bearer Token | N/A | Remove member from queue |
| **PUT** | **`/queues/{id}/music`** | ✅ Bearer Token | ✅ **YES** | **Update queue music on hold** |

## Webhook Management

| Method | Endpoint | Auth Required | PUT Supported | Description |
|--------|----------|---------------|---------------|-------------|
| POST | `/webhooks` | ✅ Bearer Token | N/A | Register new webhook |
| GET | `/webhooks` | ✅ Bearer Token | N/A | List all webhooks |
| GET | `/webhooks/{id}` | ✅ Bearer Token | N/A | Get webhook details |
| **PUT** | **`/webhooks/{id}`** | ✅ Bearer Token | ✅ **YES** | **Update webhook configuration** |
| DELETE | `/webhooks/{id}` | ✅ Bearer Token | N/A | Delete webhook |

## Configuration Management

| Method | Endpoint | Auth Required | PUT Supported | Description |
|--------|----------|---------------|---------------|-------------|
| POST | `/config/deploy` | ✅ Bearer Token | N/A | Deploy configuration to Asterisk (AMI reload) |
| GET | `/config/verify` | ✅ Bearer Token | N/A | Verify organization configuration |
| GET | `/config/test-helpers` | ✅ Bearer Token | N/A | Test dialplan helper functions |
| GET | `/config/report` | ✅ Bearer Token | N/A | Generate verification report (Markdown) |
| GET | `/config/list` | ✅ Bearer Token | N/A | List organization config files |
| POST | `/config/reload` | ✅ Bearer Token | N/A | Reload Asterisk modules via AMI |

## Call Routing

| Method | Endpoint | Auth Required | PUT Supported | Description |
|--------|----------|---------------|---------------|-------------|
| POST | `/routing` | ✅ Bearer Token | N/A | Create routing rule |

## Call Management

| Method | Endpoint | Auth Required | PUT Supported | Description |
|--------|----------|---------------|---------------|-------------|
| POST | `/calls/{callId}/recording` | ✅ Bearer Token | N/A | Enable/disable call recording |
| GET | `/calls/count` | ✅ Bearer Token | N/A | Get call statistics |
| GET | `/calls/live` | ✅ Bearer Token | N/A | Get live call status via AMI |

## Testing

| Method | Endpoint | Auth Required | PUT Supported | Description |
|--------|----------|---------------|---------------|-------------|
| POST | `/test/call-event` | ✅ Bearer Token | N/A | Simulate webhook call event for testing |

---

## Summary

### Total Endpoints: **45**

### PUT Endpoints (8 total):
1. ✅ `PUT /organizations/{id}` - Update organization settings, limits, features
2. ✅ `PUT /trunks/{id}` - Update SIP trunk
3. ✅ `PUT /dids/{id}` - Update DID number
4. ✅ `PUT /dids/{id}/routing` - Update DID routing
5. ✅ `PUT /users/{id}` - Update user
6. ✅ `PUT /queues/{id}` - Update queue
7. ✅ `PUT /queues/{id}/music` - Update queue music
8. ✅ `PUT /webhooks/{id}` - Update webhook

### Authentication Types:
- **None** (2): Login endpoints
- **Admin Token** (2): Admin-only operations
- **Bearer Token** (41): Organization operations

---

## Quick Start Example

### 1. Admin Login
```bash
curl -X POST http://103.92.154.211:3003/api/v1/admin/auth \
  -H "Content-Type: application/json" \
  -d '{
    "admin_username": "pbx_admin",
    "admin_password": "YOUR_ADMIN_PASSWORD"
  }'
```

### 2. Create Organization with Features
```bash
curl -X POST http://103.92.154.211:3003/api/v1/organizations \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MyCompany",
    "admin_username": "pbx_admin",
    "admin_password": "YOUR_ADMIN_PASSWORD",
    "settings": {
      "max_users": 100,
      "features": {
        "ai_agent": true,
        "call_recording": true
      }
    },
    "limits": {
      "concurrent_calls": 50
    }
  }'
```

### 3. Get Organization Credentials
```bash
curl -X GET http://103.92.154.211:3003/api/v1/admin/organizations/{org-id}/credentials \
  -H "Authorization: Bearer {admin-token}"
```

### 4. Organization Login
```bash
curl -X POST http://103.92.154.211:3003/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "org_...",
    "api_secret": "secret_..."
  }'
```

### 5. Update Organization Settings (Enable AI Agent)
```bash
curl -X PUT http://103.92.154.211:3003/api/v1/organizations/{org-id} \
  -H "Authorization: Bearer {org-token}" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "features": {
        "ai_agent": true
      }
    }
  }'
```

### 6. Create SIP Trunk
```bash
curl -X POST http://103.92.154.211:3003/api/v1/trunks \
  -H "Authorization: Bearer {org-token}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Main SIP Provider",
    "host": "sip.provider.com",
    "port": 5060,
    "username": "myaccount",
    "password": "secret",
    "transport": "udp"
  }'
```

### 7. Create DID Number
```bash
curl -X POST http://103.92.154.211:3003/api/v1/dids \
  -H "Authorization: Bearer {org-token}" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "+15550123",
    "trunk_id": "{trunk-uuid}",
    "routing_type": "queue",
    "routing_destination": "{queue-uuid}",
    "recording_enabled": true
  }'
```

### 8. Create User
```bash
curl -X POST http://103.92.154.211:3003/api/v1/users \
  -H "Authorization: Bearer {org-token}" \
  -H "Content-Type: application/json" \
  -d '{
    "extension": "1001",
    "username": "john.doe",
    "password": "userpass123",
    "email": "john@company.com",
    "full_name": "John Doe",
    "role": "agent"
  }'
```

### 9. Create Queue
```bash
curl -X POST http://103.92.154.211:3003/api/v1/queues \
  -H "Authorization: Bearer {org-token}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Support Queue",
    "number": "5000",
    "strategy": "ringall",
    "timeout": 30,
    "music_on_hold": "default"
  }'
```

### 10. Add Queue Member (Auto-Deploy)
```bash
curl -X POST http://103.92.154.211:3003/api/v1/queues/{queue-id}/members \
  -H "Authorization: Bearer {org-token}" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "{user-uuid}",
    "penalty": 0
  }'
```

### 11. Deploy Configuration (Manual)
```bash
curl -X POST http://103.92.154.211:3003/api/v1/config/deploy \
  -H "Authorization: Bearer {org-token}" \
  -H "Content-Type: application/json" \
  -d '{
    "reload": true
  }'
```

### 12. Get Live Calls
```bash
curl -X GET http://103.92.154.211:3003/api/v1/calls/live \
  -H "Authorization: Bearer {org-token}"
```

---

## Swagger UI
Interactive API documentation available at:
```
https://devpbx.astradial.com/docs/
```
Old `/api-docs` path redirects to `/docs`.

- Click "Authorize" button to enter Bearer token (only `BearerAuth` / JWT is used)
- All endpoints show required fields and examples
- Try out API calls directly from browser
