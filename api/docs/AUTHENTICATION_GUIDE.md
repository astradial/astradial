# Authentication Guide - Two-Token System

## 🔐 CRITICAL: Understanding the Two-Token System

This API uses **TWO SEPARATE authentication tokens**. Using the wrong token is the #1 cause of authentication errors.

---

## Token Types

| Token Type | Purpose | Used For | Lifetime |
|------------|---------|----------|----------|
| **Admin Token** | System administration | Creating orgs, getting org credentials | 24 hours |
| **Organization Token** | PBX operations | ALL trunks, DIDs, users, queues, etc. | 24 hours |

---

## Visual Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ONE-TIME ADMIN SETUP                              │
└─────────────────────────────────────────────────────────────────────┘

Step 1: Admin Authentication
┌──────────────────────────────┐
│ POST /api/v1/admin/auth      │
│                              │
│ Body:                        │
│ {                            │
│   "admin_username": "...",   │
│   "admin_password": "..."    │
│ }                            │
└──────────────────────────────┘
            ↓
     Returns: ADMIN_TOKEN
            ↓

Step 2: Get Organization Credentials
┌─────────────────────────────────────────────────┐
│ GET /api/v1/admin/organizations/{id}/credentials│
│                                                  │
│ Headers:                                         │
│ Authorization: Bearer ADMIN_TOKEN  ← Use admin! │
└─────────────────────────────────────────────────┘
            ↓
     Returns: api_key + api_secret_plaintext
            ↓

┌─────────────────────────────────────────────────────────────────────┐
│              REGULAR WORKFLOW (EVERY TIME YOU USE API)              │
└─────────────────────────────────────────────────────────────────────┘

Step 3: Organization Authentication
┌──────────────────────────────┐
│ POST /api/v1/auth/login      │
│                              │
│ Body:                        │
│ {                            │
│   "api_key": "org_...",      │
│   "api_secret": "secret_..." │
│ }                            │
└──────────────────────────────┘
            ↓
     Returns: ORG_TOKEN
            ↓

Step 4: Use ORG_TOKEN for ALL API operations
┌─────────────────────────────────────────────────┐
│ ✅ POST /api/v1/trunks                          │
│ Authorization: Bearer ORG_TOKEN  ← Use org!     │
├─────────────────────────────────────────────────┤
│ ✅ POST /api/v1/dids                            │
│ Authorization: Bearer ORG_TOKEN  ← Use org!     │
├─────────────────────────────────────────────────┤
│ ✅ POST /api/v1/users                           │
│ Authorization: Bearer ORG_TOKEN  ← Use org!     │
├─────────────────────────────────────────────────┤
│ ✅ POST /api/v1/queues                          │
│ Authorization: Bearer ORG_TOKEN  ← Use org!     │
├─────────────────────────────────────────────────┤
│ ✅ PUT /api/v1/organizations/{id}               │
│ Authorization: Bearer ORG_TOKEN  ← Use org!     │
└─────────────────────────────────────────────────┘
```

---

## ❌ Common Mistakes

### Mistake #1: Using Admin Token for PBX Operations
```bash
# ❌ WRONG - This will fail!
curl -X POST http://103.92.154.211:3003/api/v1/trunks \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Main Trunk", "host": "sip.provider.com"}'

# ✅ CORRECT - Use organization token
curl -X POST http://103.92.154.211:3003/api/v1/trunks \
  -H "Authorization: Bearer ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Main Trunk", "host": "sip.provider.com"}'
```

### Mistake #2: Confusing Credentials
```bash
# ❌ WRONG - Trying to login with admin credentials
curl -X POST http://103.92.154.211:3003/api/v1/auth/login \
  -d '{"api_key": "admin_username", "api_secret": "admin_password"}'

# ✅ CORRECT - Use organization api_key and api_secret
curl -X POST http://103.92.154.211:3003/api/v1/auth/login \
  -d '{"api_key": "org_...", "api_secret": "secret_..."}'
```

---

## Complete Shell Script Example

```bash
#!/bin/bash
set -e

BASE_URL="http://103.92.154.211:3003/api/v1"

echo "=== STEP 1: ADMIN AUTHENTICATION ==="
ADMIN_RESPONSE=$(curl -s -X POST "$BASE_URL/admin/auth" \
  -H "Content-Type: application/json" \
  -d '{
    "admin_username": "pbx_admin",
    "admin_password": "YOUR_ADMIN_PASSWORD"
  }')

ADMIN_TOKEN=$(echo $ADMIN_RESPONSE | jq -r '.token')
echo "✅ Admin Token: ${ADMIN_TOKEN:0:20}..."

echo ""
echo "=== STEP 2: GET ORGANIZATION CREDENTIALS ==="
ORG_ID="2c662bff-8f80-483a-8235-74fd48965a9c"  # Your org ID
ORG_CREDS=$(curl -s -X GET "$BASE_URL/admin/organizations/$ORG_ID/credentials" \
  -H "Authorization: Bearer $ADMIN_TOKEN")

API_KEY=$(echo $ORG_CREDS | jq -r '.api_key')
API_SECRET=$(echo $ORG_CREDS | jq -r '.api_secret_plaintext')
echo "✅ API Key: $API_KEY"
echo "✅ API Secret: $API_SECRET"

echo ""
echo "=== STEP 3: ORGANIZATION AUTHENTICATION ==="
ORG_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"api_key\": \"$API_KEY\",
    \"api_secret\": \"$API_SECRET\"
  }")

ORG_TOKEN=$(echo $ORG_RESPONSE | jq -r '.token')
echo "✅ Organization Token: ${ORG_TOKEN:0:20}..."

echo ""
echo "=== STEP 4: CREATE SIP TRUNK (using ORG_TOKEN) ==="
TRUNK_RESPONSE=$(curl -s -X POST "$BASE_URL/trunks" \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Main SIP Provider",
    "host": "sip.provider.com",
    "port": 5060,
    "transport": "udp"
  }')

TRUNK_ID=$(echo $TRUNK_RESPONSE | jq -r '.id')
echo "✅ Trunk Created: $TRUNK_ID"

echo ""
echo "=== STEP 5: CREATE DID (using ORG_TOKEN) ==="
DID_RESPONSE=$(curl -s -X POST "$BASE_URL/dids" \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"number\": \"+15550123\",
    \"trunk_id\": \"$TRUNK_ID\",
    \"routing_type\": \"extension\",
    \"routing_destination\": \"1001\"
  }")

DID_ID=$(echo $DID_RESPONSE | jq -r '.id')
echo "✅ DID Created: $DID_ID"

echo ""
echo "=== STEP 6: CREATE USER (using ORG_TOKEN) ==="
USER_RESPONSE=$(curl -s -X POST "$BASE_URL/users" \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "extension": "1001",
    "username": "john.doe",
    "password": "userpass123",
    "email": "john@company.com",
    "full_name": "John Doe",
    "role": "agent"
  }')

USER_ID=$(echo $USER_RESPONSE | jq -r '.id')
echo "✅ User Created: $USER_ID"

echo ""
echo "=== STEP 7: CREATE QUEUE (using ORG_TOKEN) ==="
QUEUE_RESPONSE=$(curl -s -X POST "$BASE_URL/queues" \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Support Queue",
    "number": "5000",
    "strategy": "ringall",
    "timeout": 30
  }')

QUEUE_ID=$(echo $QUEUE_RESPONSE | jq -r '.id')
echo "✅ Queue Created: $QUEUE_ID"

echo ""
echo "=== STEP 8: ADD QUEUE MEMBER (using ORG_TOKEN) ==="
MEMBER_RESPONSE=$(curl -s -X POST "$BASE_URL/queues/$QUEUE_ID/members" \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"user_id\": \"$USER_ID\",
    \"penalty\": 0
  }")

echo "✅ Queue Member Added"
echo "$MEMBER_RESPONSE" | jq '.'

echo ""
echo "========================================="
echo "✅ COMPLETE! All resources created using ORG_TOKEN"
echo "========================================="
```

---

## Token Usage Reference

### Admin Token - Use ONLY for:
- ✅ `POST /admin/auth` - Login as admin
- ✅ `GET /admin/organizations/{id}/credentials` - Get org credentials
- ✅ `GET /admin/organizations` - List all organizations (admin only)
- ❌ **DO NOT use for any other endpoints!**

### Organization Token - Use for EVERYTHING ELSE:
- ✅ `POST /auth/login` - Get this token first!
- ✅ `POST /trunks` - Create SIP trunk
- ✅ `PUT /trunks/{id}` - Update SIP trunk
- ✅ `POST /dids` - Create DID
- ✅ `PUT /dids/{id}` - Update DID
- ✅ `POST /users` - Create user
- ✅ `PUT /users/{id}` - Update user
- ✅ `POST /queues` - Create queue
- ✅ `PUT /queues/{id}` - Update queue
- ✅ `POST /queues/{id}/members` - Add queue member
- ✅ `PUT /organizations/{id}` - Update organization settings
- ✅ `POST /webhooks` - Create webhook
- ✅ `POST /config/deploy` - Deploy configuration
- ✅ `GET /calls/live` - Get live calls
- ✅ **ALL other PBX operations**

---

## Quick Test Commands

### Test Admin Authentication
```bash
curl -X POST http://103.92.154.211:3003/api/v1/admin/auth \
  -H "Content-Type: application/json" \
  -d '{
    "admin_username": "pbx_admin",
    "admin_password": "YOUR_ADMIN_PASSWORD"
  }' | jq '.'
```

### Test Organization Authentication
```bash
curl -X POST http://103.92.154.211:3003/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "YOUR_API_KEY",
    "api_secret": "YOUR_API_SECRET"
  }' | jq '.'
```

### Test Creating Trunk (with ORG token)
```bash
curl -X POST http://103.92.154.211:3003/api/v1/trunks \
  -H "Authorization: Bearer YOUR_ORG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Trunk",
    "host": "sip.example.com",
    "port": 5060
  }' | jq '.'
```

---

## Troubleshooting

### Error: "Unauthorized" on trunk/user/queue creation
**Problem:** You're using admin token instead of organization token
**Solution:** Get organization token via `/auth/login` and use that

### Error: "Invalid credentials" on organization login
**Problem:** Using wrong credentials or admin credentials
**Solution:** Use the `api_key` and `api_secret_plaintext` from the credentials endpoint

### Error: "Organization not found"
**Problem:** Using wrong organization ID or token for different org
**Solution:** Verify organization ID and ensure token matches organization

### Token Expired
**Problem:** Token is older than 24 hours
**Solution:** Re-authenticate to get new token

---

## Security Best Practices

1. **Never expose admin credentials** - Keep them secure
2. **Rotate organization secrets regularly** - Use credentials endpoint to regenerate
3. **Use HTTPS in production** - Never send tokens over HTTP
4. **Store tokens securely** - Use environment variables or secure storage
5. **Implement token refresh** - Re-authenticate when token expires
6. **One token per application** - Don't share tokens between applications

---

## FAQ

**Q: Can I use admin token for everything?**
A: No! Admin token is ONLY for admin endpoints. Use organization token for all PBX operations.

**Q: How long do tokens last?**
A: Both admin and organization tokens expire after 24 hours.

**Q: Can I have multiple organization tokens?**
A: Yes, you can generate new tokens anytime by calling `/auth/login` again.

**Q: What happens if I use the wrong token?**
A: You'll get a 401 Unauthorized error.

**Q: Do I need to re-authenticate for every API call?**
A: No! Get the token once, then reuse it for all requests until it expires.
