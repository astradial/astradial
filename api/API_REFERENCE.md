# PBX API - Comprehensive Field Reference

Complete documentation of all API endpoints with detailed field specifications.

## Table of Contents
1. [Authentication](#authentication)
2. [Organizations](#organizations)
3. [SIP Trunks](#sip-trunks)
4. [DID Numbers](#did-numbers)
5. [Users](#users)
6. [Queues](#queues)
7. [Webhooks](#webhooks)
8. [Configuration Management](#configuration-management)
9. [Call Management](#call-management)

---

## Authentication

### 1. Admin Authentication
**POST** `/api/v1/admin/auth`

Authenticate as system administrator.

**Request Body:**
```json
{
  "admin_username": "string (required)",
  "admin_password": "string (required)"
}
```

**Response:**
```json
{
  "success": true,
  "token": "JWT_TOKEN",
  "expires_in": 86400,
  "message": "Admin authenticated successfully"
}
```

### 2. Organization Authentication
**POST** `/api/v1/auth/login`

Authenticate organization to receive JWT token.

**Request Body:**
```json
{
  "api_key": "string (required) - Organization API key",
  "api_secret": "string (required) - Organization API secret"
}
```

**Response:**
```json
{
  "token": "JWT_TOKEN",
  "token_type": "Bearer",
  "expires_in": "24h",
  "organization": { }
}
```

---

## Organizations

### 1. Create Organization
**POST** `/api/v1/organizations`

**Authentication:** Admin credentials in request body

**Request Body:**
```json
{
  // Required Fields
  "name": "string (required, 3-50 chars, alphanumeric + hyphens)",
  "admin_username": "string (required)",
  "admin_password": "string (required)",

  // Optional Fields
  "domain": "string (optional, auto-generated if not provided)",
  "status": "string (optional, enum: active|suspended|deleted, default: active)",

  // Settings Object (optional)
  "settings": {
    "max_trunks": "integer (default: 5)",
    "max_dids": "integer (default: 10)",
    "max_users": "integer (default: 50)",
    "max_queues": "integer (default: 10)",
    "recording_enabled": "boolean (default: false)",
    "webhook_enabled": "boolean (default: true)",
    "features": {
      "call_transfer": "boolean (default: true)",
      "call_recording": "boolean (default: true)",
      "voicemail": "boolean (default: true)",
      "conference": "boolean (default: true)",
      "ivr": "boolean (default: true)",
      "ai_agent": "boolean (default: false)"
    }
  },

  // Limits Object (optional)
  "limits": {
    "concurrent_calls": "integer (default: 10)",
    "monthly_minutes": "integer (default: 10000)",
    "storage_gb": "integer (default: 10)"
  },

  // Contact Info Object (optional)
  "contact_info": {
    "email": "string (email format)",
    "phone": "string",
    "address": "string"
  }
}
```

**Response:**
```json
{
  "id": "uuid",
  "name": "string",
  "domain": "string",
  "context_prefix": "string",
  "api_key": "string",
  "api_secret": "string (only on creation)",
  "status": "string",
  "settings": { },
  "limits": { },
  "contact_info": { },
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### 2. Update Organization Settings
**PUT** `/api/v1/organizations/{organizationId}`

**Authentication:** Bearer Token

**Request Body (all fields optional, merged with existing):**
```json
{
  "name": "string (3-50 chars, alphanumeric + hyphens)",
  "domain": "string",
  "status": "string (enum: active|suspended|deleted)",

  "settings": {
    "max_trunks": "integer",
    "max_dids": "integer",
    "max_users": "integer",
    "max_queues": "integer",
    "recording_enabled": "boolean",
    "webhook_enabled": "boolean",
    "features": {
      "call_transfer": "boolean",
      "call_recording": "boolean",
      "voicemail": "boolean",
      "conference": "boolean",
      "ivr": "boolean",
      "ai_agent": "boolean"
    }
  },

  "limits": {
    "concurrent_calls": "integer",
    "monthly_minutes": "integer",
    "storage_gb": "integer"
  },

  "contact_info": {
    "email": "string (email format)",
    "phone": "string",
    "address": "string"
  }
}
```

**Note:** Settings, limits, and contact_info are merged with existing values, not replaced.

### 3. Get Organization
**GET** `/api/v1/organizations/{id}`

**Authentication:** Bearer Token

**Response:** Organization object (without api_secret)

### 4. List Organizations
**GET** `/api/v1/organizations`

**Authentication:** Bearer Token

**Response:** Array of organization objects

### 5. Delete Organization
**DELETE** `/api/v1/organizations/{id}`

**Authentication:** Bearer Token

---

## SIP Trunks

### 1. Create SIP Trunk
**POST** `/api/v1/trunks`

**Authentication:** Bearer Token

**Request Body:**
```json
{
  // Required Fields
  "name": "string (required, 2-255 chars)",
  "host": "string (required, SIP server hostname/IP)",

  // Optional Fields
  "port": "integer (optional, default: 5060, range: 1-65535)",
  "username": "string (optional)",
  "password": "string (optional)",
  "transport": "string (optional, enum: udp|tcp|tls, default: udp)"
}
```

**Response:**
```json
{
  "id": "uuid",
  "org_id": "uuid",
  "name": "string",
  "host": "string",
  "port": "integer",
  "username": "string",
  "password": "string",
  "transport": "string",
  "asterisk_peer_name": "string",
  "status": "string (active|inactive)",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### 2. Update SIP Trunk
**PUT** `/api/v1/trunks/{id}`

**Authentication:** Bearer Token

**Request Body (all fields optional):**
```json
{
  "name": "string",
  "host": "string",
  "port": "integer",
  "username": "string",
  "password": "string",
  "transport": "string (enum: udp|tcp|tls)",
  "status": "string (enum: active|inactive)"
}
```

### 3. Get SIP Trunk
**GET** `/api/v1/trunks/{id}`

**Authentication:** Bearer Token

### 4. List SIP Trunks
**GET** `/api/v1/trunks`

**Authentication:** Bearer Token

### 5. Delete SIP Trunk
**DELETE** `/api/v1/trunks/{id}`

**Authentication:** Bearer Token

---

## DID Numbers

### 1. Create DID Number
**POST** `/api/v1/dids`

**Authentication:** Bearer Token

**Request Body:**
```json
{
  // Required Fields
  "number": "string (required, phone number)",
  "trunk_id": "uuid (required, must be valid trunk)",
  "routing_type": "string (required, enum: extension|queue|ivr|ai_agent)",
  "routing_destination": "string (required, extension number, queue ID, etc.)",

  // Optional Fields
  "description": "string (optional)",
  "recording_enabled": "boolean (optional, default: false)"
}
```

**Response:**
```json
{
  "id": "uuid",
  "org_id": "uuid",
  "trunk_id": "uuid",
  "number": "string",
  "description": "string",
  "routing_type": "string",
  "routing_destination": "string",
  "recording_enabled": "boolean",
  "status": "string (active|inactive)",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### 2. Update DID Number
**PUT** `/api/v1/dids/{id}`

**Authentication:** Bearer Token

**Request Body (all fields optional):**
```json
{
  "description": "string",
  "routing_type": "string (enum: extension|queue|ivr|ai_agent)",
  "routing_destination": "string",
  "recording_enabled": "boolean",
  "status": "string (enum: active|inactive)",
  "trunk_id": "uuid (must be valid trunk)"
}
```

### 3. Update DID Routing Only
**PUT** `/api/v1/dids/{id}/routing`

**Authentication:** Bearer Token

**Request Body:**
```json
{
  "routing_type": "string (required, enum: extension|queue|ivr|ai_agent)",
  "routing_destination": "string (required)"
}
```

### 4. Get DID Number
**GET** `/api/v1/dids/{id}`

**Authentication:** Bearer Token

### 5. List DID Numbers
**GET** `/api/v1/dids`

**Authentication:** Bearer Token

### 6. Delete DID Number
**DELETE** `/api/v1/dids/{id}`

**Authentication:** Bearer Token

---

## Users

### 1. Create User
**POST** `/api/v1/users`

**Authentication:** Bearer Token

**Request Body:**
```json
{
  // Required Fields
  "extension": "string (required, 3-10 digits)",
  "username": "string (required, 3-50 chars, alphanumeric)",
  "password": "string (required, login password for web authentication)",
  "email": "string (required, valid email)",

  // Optional Fields
  "full_name": "string (optional, 2-255 chars)",
  "role": "string (optional, enum: admin|supervisor|agent|user, default: agent)",
  "sip_password": "string (optional, auto-generated if not provided)"
}
```

**Response:**
```json
{
  "id": "uuid",
  "org_id": "uuid",
  "username": "string",
  "email": "string",
  "extension": "string",
  "full_name": "string",
  "role": "string",
  "asterisk_endpoint": "string",
  "sip_password": "string (returned only on creation)",
  "status": "string (active|inactive)",
  "recording_enabled": "boolean",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### 2. Update User
**PUT** `/api/v1/users/{id}`

**Authentication:** Bearer Token

**Request Body (all fields optional):**
```json
{
  "username": "string (3-50 chars)",
  "email": "string (valid email)",
  "full_name": "string",
  "role": "string (enum: admin|supervisor|agent|user)",
  "status": "string (enum: active|inactive)",
  "recording_enabled": "boolean",
  "password": "string (new password)",
  "extension": "string (must be unique within org)"
}
```

### 3. Get User
**GET** `/api/v1/users/{id}`

**Authentication:** Bearer Token

### 4. List Users
**GET** `/api/v1/users`

**Authentication:** Bearer Token

### 5. Delete User
**DELETE** `/api/v1/users/{id}`

**Authentication:** Bearer Token

---

## Queues

### 1. Create Queue
**POST** `/api/v1/queues`

**Authentication:** Bearer Token

**Request Body:**
```json
{
  // Required Fields
  "name": "string (required, 2-255 chars)",
  "number": "string (required, 3-10 chars, unique within org)",

  // Optional Fields
  "strategy": "string (optional, enum: ringall|leastrecent|fewestcalls|random|rrmemory|linear, default: ringall)",
  "timeout": "integer (optional, seconds, default: 30)",
  "retry": "integer (optional, seconds, default: 5)",
  "music_on_hold": "string (optional, default: 'default')",
  "recording_enabled": "boolean (optional, default: false)"
}
```

**Response:**
```json
{
  "id": "uuid",
  "org_id": "uuid",
  "name": "string",
  "number": "string",
  "strategy": "string",
  "timeout": "integer",
  "retry": "integer",
  "music_on_hold": "string",
  "asterisk_queue_name": "string",
  "recording_enabled": "boolean",
  "active": "boolean",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### 2. Update Queue
**PUT** `/api/v1/queues/{id}`

**Authentication:** Bearer Token

**Request Body (all fields optional):**
```json
{
  "name": "string",
  "number": "string (must be unique)",
  "strategy": "string (enum: ringall|leastrecent|fewestcalls|random|rrmemory|linear)",
  "timeout": "integer",
  "retry": "integer",
  "music_on_hold": "string",
  "recording_enabled": "boolean",
  "active": "boolean"
}
```

### 3. Add Queue Member
**POST** `/api/v1/queues/{id}/members`

**Authentication:** Bearer Token

**Request Body:**
```json
{
  "user_id": "uuid (required, must be valid user in same org)",
  "penalty": "integer (optional, default: 0, 0 = highest priority)"
}
```

**Response:**
```json
{
  "id": "uuid",
  "queue_id": "uuid",
  "user_id": "uuid",
  "penalty": "integer",
  "paused": "boolean"
}
```

**Note:** Automatically deploys configuration to Asterisk

### 4. Remove Queue Member
**DELETE** `/api/v1/queues/{queueId}/members?userId={userId}`

**Authentication:** Bearer Token

**Query Parameters:**
- `userId` (required): UUID of user to remove

### 5. Update Queue Music
**PUT** `/api/v1/queues/{id}/music`

**Authentication:** Bearer Token

**Request Body:**
```json
{
  "music_on_hold": "string (required)"
}
```

### 6. Get Queue
**GET** `/api/v1/queues/{id}`

**Authentication:** Bearer Token

**Response:** Queue object with members array

### 7. List Queues
**GET** `/api/v1/queues`

**Authentication:** Bearer Token

### 8. Delete Queue
**DELETE** `/api/v1/queues/{id}`

**Authentication:** Bearer Token

---

## Webhooks

### 1. Create Webhook
**POST** `/api/v1/webhooks`

**Authentication:** Bearer Token

**Request Body:**
```json
{
  // Required Fields
  "url": "string (required, valid URL)",
  "events": "array (required, list of webhook events)",

  // Optional Fields
  "secret": "string (optional, for HMAC signature verification, auto-generated if not provided)",
  "active": "boolean (optional, default: true)"
}
```

**Supported Events:**
- `call.initiated`
- `call.ringing`
- `call.answered`
- `call.ended`
- `call.failed`
- `queue.entered`
- `queue.abandoned`

**Response:**
```json
{
  "id": "uuid",
  "org_id": "uuid",
  "url": "string",
  "events": "array",
  "secret": "string",
  "active": "boolean",
  "retry_count": "integer",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### 2. Update Webhook
**PUT** `/api/v1/webhooks/{id}`

**Authentication:** Bearer Token

**Request Body (all fields optional):**
```json
{
  "url": "string",
  "events": "array",
  "secret": "string",
  "active": "boolean",
  "retry_count": "integer"
}
```

### 3. Get Webhook
**GET** `/api/v1/webhooks/{id}`

**Authentication:** Bearer Token

### 4. List Webhooks
**GET** `/api/v1/webhooks`

**Authentication:** Bearer Token

### 5. Delete Webhook
**DELETE** `/api/v1/webhooks/{id}`

**Authentication:** Bearer Token

---

## Configuration Management

### 1. Deploy Configuration
**POST** `/api/v1/config/deploy`

**Authentication:** Bearer Token

**Request Body (optional):**
```json
{
  "reload": "boolean (optional, default: true, auto-reload Asterisk via AMI)"
}
```

**Response:**
```json
{
  "success": true,
  "deployment": {
    "files_written": "array",
    "timestamp": "string"
  },
  "reload": {
    "success": true,
    "method": "AMI",
    "actions": "array"
  }
}
```

### 2. Verify Configuration
**GET** `/api/v1/config/verify`

**Authentication:** Bearer Token

**Response:**
```json
{
  "success": true,
  "verification": {
    "organization": { },
    "timestamp": "string",
    "overall_status": "SUCCESS|WARNING|ERROR",
    "checks": { }
  }
}
```

### 3. Test Helper Functions
**GET** `/api/v1/config/test-helpers`

**Authentication:** Bearer Token

### 4. Generate Report
**GET** `/api/v1/config/report`

**Authentication:** Bearer Token

**Response:** Markdown verification report

### 5. List Configurations
**GET** `/api/v1/config/list`

**Authentication:** Bearer Token

### 6. Reload Asterisk
**POST** `/api/v1/config/reload`

**Authentication:** Bearer Token

**Request Body (optional):**
```json
{
  "modules": "array (optional, specific modules to reload)"
}
```

---

## Call Management

### 1. Control Recording
**POST** `/api/v1/calls/{callId}/recording`

**Authentication:** Bearer Token

**Request Body:**
```json
{
  "enabled": "boolean (required)"
}
```

### 2. Get Call Statistics
**GET** `/api/v1/calls/count`

**Authentication:** Bearer Token

**Query Parameters:**
- `status` (optional): Filter by status (active|completed|failed)
- `from` (optional): Start date (ISO format)
- `to` (optional): End date (ISO format)

**Response:**
```json
{
  "total": "integer",
  "active": "integer",
  "completed": "integer",
  "failed": "integer",
  "average_duration": "integer (seconds)",
  "total_duration": "integer (seconds)"
}
```

### 3. Get Live Calls
**GET** `/api/v1/calls/live`

**Authentication:** Bearer Token

**Response:**
```json
{
  "count": "integer",
  "calls": [
    {
      "channel_id": "string",
      "uniqueid": "string",
      "from": "string",
      "from_name": "string",
      "to": "string",
      "to_name": "string",
      "status": "string",
      "context": "string",
      "extension": "string",
      "duration": "integer",
      "application": "string"
    }
  ]
}
```

---

## Field Validation Rules

### Organization Name
- **Pattern:** `^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$`
- **Length:** 3-50 characters
- **Rules:**
  - Must start and end with alphanumeric
  - Can contain hyphens in the middle
  - No spaces or special characters
  - Case-insensitive unique

### Email
- **Format:** Valid email format
- **Example:** `user@example.com`

### Extension
- **Pattern:** Numeric
- **Length:** 3-10 digits
- **Rules:** Unique within organization

### Phone Numbers (DID)
- **Format:** String (can include +, -, spaces)
- **Example:** `+1-555-0123`

### Passwords
- **Min Length:** 8 characters (recommended)
- **Storage:** Hashed with bcrypt

### UUID Format
- **Pattern:** Standard UUID v4
- **Example:** `2c662bff-8f80-483a-8235-74fd48965a9c`

---

## Error Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 204 | No Content (Delete successful) |
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Invalid/missing authentication |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource not found |
| 409 | Conflict - Resource already exists |
| 422 | Validation Error - Invalid data |
| 500 | Internal Server Error |

---

## Notes

1. **Authentication:** All endpoints except `/auth/login`, `/admin/auth`, and `/organizations` (POST) require Bearer token
2. **Timestamps:** All timestamps in ISO 8601 format
3. **UUIDs:** All IDs are UUID v4 format
4. **Merging:** PUT requests for organizations merge settings/limits/contact_info with existing values
5. **Deployment:** Queue member changes trigger automatic configuration deployment
6. **Multi-tenancy:** All resources are isolated by organization
