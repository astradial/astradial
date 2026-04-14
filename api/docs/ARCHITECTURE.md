# Multi-Tenant PBX API Architecture

## Overview
This system provides a complete multi-tenant PBX solution with organization isolation, comprehensive call management, and full API access to telephony features.

## Core Principles

### 1. Multi-Tenancy & Isolation
- **Organization Context**: Each organization has a unique context prefix (e.g., `org_123_`)
- **Resource Isolation**: Trunks, DIDs, users, queues are strictly isolated per organization
- **Security**: API key authentication with organization-specific scopes
- **Data Segregation**: Complete data isolation at database and Asterisk context level

### 2. Architecture Layers

```
┌─────────────────────────────────────────────┐
│            REST API Layer                    │
│  (Express.js + Swagger Documentation)        │
├─────────────────────────────────────────────┤
│         Authentication & Authorization       │
│         (JWT + API Keys per Org)            │
├─────────────────────────────────────────────┤
│           Business Logic Layer               │
│  (Organization, Trunk, DID, Queue, Users)    │
├─────────────────────────────────────────────┤
│          Data Access Layer                   │
│      (PostgreSQL/MySQL + Redis Cache)        │
├─────────────────────────────────────────────┤
│        Asterisk Integration Layer            │
│     (ARI + AMI + Dialplan Generation)        │
├─────────────────────────────────────────────┤
│           Asterisk PBX                       │
│    (Multi-Context with Org Isolation)        │
└─────────────────────────────────────────────┘
```

## Database Schema

### Organizations Table
```sql
CREATE TABLE organizations (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    context_prefix VARCHAR(50) UNIQUE NOT NULL, -- e.g., 'org_123_'
    api_key VARCHAR(255) UNIQUE NOT NULL,
    api_secret VARCHAR(255) NOT NULL,
    status ENUM('active', 'suspended', 'deleted') DEFAULT 'active',
    settings JSONB, -- organization-specific settings
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### SIP Trunks Table
```sql
CREATE TABLE sip_trunks (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id),
    name VARCHAR(255) NOT NULL,
    host VARCHAR(255) NOT NULL,
    username VARCHAR(255),
    password VARCHAR(255),
    port INT DEFAULT 5060,
    transport ENUM('udp', 'tcp', 'tls') DEFAULT 'udp',
    codecs VARCHAR(255) DEFAULT 'ulaw,alaw',
    max_channels INT DEFAULT 10,
    status ENUM('active', 'inactive') DEFAULT 'active',
    settings JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### DID Numbers Table
```sql
CREATE TABLE did_numbers (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id),
    trunk_id UUID REFERENCES sip_trunks(id),
    number VARCHAR(20) UNIQUE NOT NULL,
    description VARCHAR(255),
    routing_type ENUM('extension', 'queue', 'ivr', 'ai_agent') NOT NULL,
    routing_destination VARCHAR(255) NOT NULL,
    recording_enabled BOOLEAN DEFAULT false,
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Users Table
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id),
    extension VARCHAR(20) NOT NULL,
    username VARCHAR(100) NOT NULL,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    email VARCHAR(255),
    role ENUM('admin', 'supervisor', 'agent', 'user') DEFAULT 'user',
    sip_password VARCHAR(100),
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(org_id, extension)
);
```

### Queues Table
```sql
CREATE TABLE queues (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id),
    name VARCHAR(255) NOT NULL,
    number VARCHAR(20) NOT NULL,
    strategy ENUM('ringall', 'leastrecent', 'fewestcalls', 'random', 'rrmemory', 'linear') DEFAULT 'ringall',
    timeout INT DEFAULT 15, -- seconds per agent
    max_wait_time INT DEFAULT 300, -- max seconds in queue
    wrap_up_time INT DEFAULT 0, -- seconds after call
    announce_frequency INT DEFAULT 30, -- position announce frequency
    music_on_hold VARCHAR(255) DEFAULT 'default',
    ring_sound VARCHAR(255) DEFAULT 'ring',
    recording_enabled BOOLEAN DEFAULT false,
    settings JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(org_id, number)
);
```

### Queue Members Table
```sql
CREATE TABLE queue_members (
    id UUID PRIMARY KEY,
    queue_id UUID REFERENCES queues(id),
    user_id UUID REFERENCES users(id),
    penalty INT DEFAULT 0, -- priority (0 = highest)
    paused BOOLEAN DEFAULT false,
    added_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(queue_id, user_id)
);
```

### Webhooks Table
```sql
CREATE TABLE webhooks (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id),
    url VARCHAR(500) NOT NULL,
    events TEXT[], -- ['call.started', 'call.answered', 'call.ended', etc.]
    secret VARCHAR(255), -- for HMAC validation
    active BOOLEAN DEFAULT true,
    retry_count INT DEFAULT 3,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Call Records Table
```sql
CREATE TABLE call_records (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id),
    call_id VARCHAR(100) UNIQUE NOT NULL,
    from_number VARCHAR(50),
    to_number VARCHAR(50),
    direction ENUM('inbound', 'outbound') NOT NULL,
    status ENUM('ringing', 'answered', 'busy', 'failed', 'no-answer', 'completed') NOT NULL,
    started_at TIMESTAMP,
    answered_at TIMESTAMP,
    ended_at TIMESTAMP,
    duration INT, -- seconds
    recording_url VARCHAR(500),
    queue_id UUID REFERENCES queues(id),
    user_id UUID REFERENCES users(id),
    trunk_id UUID REFERENCES sip_trunks(id),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## API Endpoints Structure

### Organization Management
- `POST /api/v1/organizations` - Create organization
- `GET /api/v1/organizations/:id` - Get organization details
- `PUT /api/v1/organizations/:id` - Update organization
- `DELETE /api/v1/organizations/:id` - Delete organization

### SIP Trunk Management
- `GET /api/v1/trunks` - List all trunks for organization
- `POST /api/v1/trunks` - Create new trunk
- `GET /api/v1/trunks/:id` - Get trunk details
- `PUT /api/v1/trunks/:id` - Update trunk
- `DELETE /api/v1/trunks/:id` - Delete trunk
- `POST /api/v1/trunks/:id/test` - Test trunk connectivity

### DID Management
- `GET /api/v1/dids` - List all DIDs
- `POST /api/v1/dids` - Add new DID
- `GET /api/v1/dids/:id` - Get DID details
- `PUT /api/v1/dids/:id` - Update DID routing
- `DELETE /api/v1/dids/:id` - Remove DID
- `POST /api/v1/dids/:id/routing` - Update routing rules

### User Management
- `GET /api/v1/users` - List users
- `POST /api/v1/users` - Create user
- `GET /api/v1/users/:id` - Get user details
- `PUT /api/v1/users/:id` - Update user
- `DELETE /api/v1/users/:id` - Delete user
- `POST /api/v1/users/:id/extension` - Assign extension

### Queue Management
- `GET /api/v1/queues` - List queues
- `POST /api/v1/queues` - Create queue
- `GET /api/v1/queues/:id` - Get queue details
- `PUT /api/v1/queues/:id` - Update queue settings
- `DELETE /api/v1/queues/:id` - Delete queue
- `POST /api/v1/queues/:id/members` - Add member to queue
- `DELETE /api/v1/queues/:id/members/:userId` - Remove member
- `PUT /api/v1/queues/:id/members/:userId` - Update member (pause/unpause)
- `PUT /api/v1/queues/:id/music` - Update music on hold
- `PUT /api/v1/queues/:id/recording` - Enable/disable recording

### Call Routing
- `GET /api/v1/routing/rules` - Get routing rules
- `POST /api/v1/routing/rules` - Create routing rule
- `PUT /api/v1/routing/rules/:id` - Update routing rule
- `DELETE /api/v1/routing/rules/:id` - Delete routing rule

### Webhook Management
- `GET /api/v1/webhooks` - List webhooks
- `POST /api/v1/webhooks` - Register webhook
- `PUT /api/v1/webhooks/:id` - Update webhook
- `DELETE /api/v1/webhooks/:id` - Delete webhook
- `POST /api/v1/webhooks/:id/test` - Test webhook

### Call Management
- `GET /api/v1/calls/active` - Get active calls
- `GET /api/v1/calls/history` - Get call history
- `GET /api/v1/calls/:id` - Get call details
- `POST /api/v1/calls/:callId/recording` - Start/stop recording
- `POST /api/v1/calls/:id/transfer` - Transfer call
- `POST /api/v1/calls/:id/hangup` - Hangup call

### Statistics & Monitoring
- `GET /api/v1/stats/calls` - Call statistics
- `GET /api/v1/stats/queues` - Queue statistics
- `GET /api/v1/stats/agents` - Agent statistics
- `GET /api/v1/stats/trunks` - Trunk usage statistics

## Asterisk Context Structure

Each organization gets isolated contexts:
```
[org_123_inbound]
; Inbound call handling for organization 123

[org_123_outbound]
; Outbound call handling for organization 123

[org_123_internal]
; Internal extensions for organization 123

[org_123_queues]
; Queue contexts for organization 123

[org_123_features]
; Feature codes for organization 123
```

## Dialplan Helper Functions

Each organization's dialplan includes comprehensive helper functions for testing, convenience, and system management. These functions are automatically generated and isolated per organization.

### Testing & Diagnostics
| Extension | Function | Description |
|-----------|----------|-------------|
| `*43` | Echo Test | Tests audio quality and connection with echo |
| `*87` | Audio Quality Test | Plays 1004Hz milliwatt tone for line testing |
| `*99` | Connection Test | Tests basic connection and plays success message |

### Time & Date Services
| Extension | Function | Description |
|-----------|----------|-------------|
| `*60` | Say Current Time | Announces current time in 12-hour format |
| `*61` | Say Current Date | Announces current date |
| `*62` | Say Time & Date | Announces both current time and date |

### Information Services
| Extension | Function | Description |
|-----------|----------|-------------|
| `*65` | Say My Extension | Announces the caller's extension number |
| `411` | Company Directory | Voice directory lookup for organization users |
| `*44` | System Status | Announces system operational status |

### Voicemail & Messaging
| Extension | Function | Description |
|-----------|----------|-------------|
| `*97` | Voicemail Access | General voicemail access (prompts for extension) |
| `*98` | Check My Voicemail | Direct access to caller's voicemail |

### Conference & Collaboration
| Extension | Function | Description |
|-----------|----------|-------------|
| `8XXX` | Conference Rooms | ConfBridge rooms (8000-8999) with announcements |
| `9XXX` | Meet Me Conference | Traditional MeetMe conferences (9000-9999) |

### Call Management
| Extension | Function | Description |
|-----------|----------|-------------|
| `700` | Call Parking | Park current call and get retrieval number |
| `*8` | Directed Call Pickup | Pick up specific extension's ringing call |
| `**` | Group Call Pickup | Pick up any ringing call in pickup group |

### Feature Codes
| Extension | Function | Description |
|-----------|----------|-------------|
| `*78` | Enable DND | Enable Do Not Disturb for caller's extension |
| `*79` | Disable DND | Disable Do Not Disturb for caller's extension |
| `*72XXXX` | Set Call Forward | Forward all calls to specified extension |
| `*73` | Cancel Call Forward | Disable call forwarding |

### Speed Dial
| Extension | Function | Description |
|-----------|----------|-------------|
| `*74[0-9]XXXX` | Program Speed Dial | Set speed dial slot (0-9) to extension |
| `*75[0-9]` | Use Speed Dial | Dial pre-programmed speed dial number |

### Recording & Monitoring
| Extension | Function | Description |
|-----------|----------|-------------|
| `*1` | Toggle Call Recording | Start/stop recording on active call |
| `*50` | Music on Hold Test | Test organization's music on hold |

### Paging & Intercom
| Extension | Function | Description |
|-----------|----------|-------------|
| `*70` | All-Call Paging | Page all active extensions in organization |
| `*0XXXX` | Intercom | One-way intercom to specific extension |

### Implementation Notes
- All helper functions include organization ID tracking for proper isolation
- Functions use organization-specific context prefixes to prevent cross-tenant access
- Database integration for persistent settings (DND, call forwarding, speed dial)
- Professional audio prompts with proper error handling
- Automatic cleanup and resource management

## Security Considerations

1. **API Authentication**: JWT tokens with organization scope
2. **Rate Limiting**: Per-organization API rate limits
3. **Context Isolation**: Asterisk contexts prevent cross-org access
4. **Encryption**: TLS for API, SRTP for media when possible
5. **Audit Logging**: All API actions logged with organization context
6. **HMAC Webhook Validation**: Secure webhook delivery

## Webhook Event Types

Webhook delivery is triggered by AMI events from Asterisk. `DialBegin` and `DialEnd` AMI events are handled in `asteriskManager.js`, which emits internal events picked up by `eventListenerService.js` and delivered via `webhookService.js`.

- `call.initiated` - Call started (triggered by AMI `DialBegin` event)
- `call.ringing` - Call is ringing
- `call.answered` - Call was answered (triggered by AMI `DialEnd` with `ANSWER` status)
- `call.ended` - Call completed
- `call.failed` - Call failed
- `queue.entered` - Call entered queue
- `queue.abandoned` - Caller hung up in queue
- `queue.timeout` - Queue timeout reached
- `agent.login` - Agent logged into queue
- `agent.logout` - Agent logged out
- `recording.started` - Recording started
- `recording.completed` - Recording finished