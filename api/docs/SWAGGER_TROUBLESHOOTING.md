# Swagger UI Troubleshooting Guide

## ✅ Fixed: Authorization Header Now Working!

The issue was the global security configuration. It's now fixed.

---

## How to Use Swagger UI Correctly

### Step 1: Refresh Browser
**IMPORTANT:** Clear your browser cache or do a hard refresh:
- **Chrome/Edge:** `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
- **Firefox:** `Ctrl+F5` (Windows) or `Cmd+Shift+R` (Mac)

### Step 2: Get Organization Token

1. **Scroll to "Authentication" section**
2. **Click POST `/auth/login`**
3. **Click "Try it out"**
4. **Enter Request Body:**
   ```json
   {
     "api_key": "YOUR_ORG_API_KEY",
     "api_secret": "secret_testorg7h8k2m"
   }
   ```
5. **Click "Execute"**
6. **Copy the `token` from response** (not the whole response, just the token value)

###Step 3: Authorize in Swagger

1. **Click the green "Authorize" button** at the top right
2. **Paste your token** (just the token, no "Bearer " prefix)
3. **Click "Authorize"**
4. **Click "Close"**

### Step 4: Try GET /trunks

1. **Scroll to "SIP Trunks" section**
2. **Click GET `/trunks`**
3. **Click "Try it out"**
4. **Click "Execute"**

### Step 5: Verify Authorization Header

In the "Curl" section, you should now see:
```bash
curl -X 'GET' \
  'http://103.92.154.211:3003/api/v1/trunks' \
  -H 'accept: application/json' \
  -H 'Authorization: Bearer eyJhbG...'  # ← This should appear!
```

✅ **If you see the Authorization header, it's working!**

---

## Required Fields Checklist

### Organizations
**POST /organizations**
- ✅ `name` (required)
- ✅ `admin_username` (required)
- ✅ `admin_password` (required)
- ⭕ `domain` (optional)
- ⭕ `status` (optional)
- ⭕ `settings` (optional)
- ⭕ `limits` (optional)
- ⭕ `contact_info` (optional)

**PUT /organizations/{id}**
- ⭕ All fields optional (merged with existing)

### SIP Trunks
**POST /trunks**
- ✅ `name` (required)
- ✅ `host` (required)
- ⭕ `port` (optional, default: 5060)
- ⭕ `username` (optional)
- ⭕ `password` (optional)
- ⭕ `transport` (optional, default: udp)

**PUT /trunks/{id}**
- ⭕ All fields optional

### DID Numbers
**POST /dids**
- ✅ `number` (required)
- ✅ `trunk_id` (required)
- ✅ `routing_type` (required: extension|queue|ivr|ai_agent)
- ✅ `routing_destination` (required)
- ⭕ `description` (optional)
- ⭕ `recording_enabled` (optional, default: false)

**PUT /dids/{id}**
- ⭕ All fields optional

**PUT /dids/{id}/routing**
- ✅ `routing_type` (required)
- ✅ `routing_destination` (required)

### Users
**POST /users**
- ✅ `extension` (required, 3-10 digits)
- ✅ `username` (required, 3-50 chars)
- ✅ `password` (required, for web login)
- ✅ `email` (required, valid email)
- ⭕ `full_name` (optional)
- ⭕ `role` (optional, default: agent)
- ⭕ `sip_password` (optional, auto-generated)

**PUT /users/{id}**
- ⭕ All fields optional

### Queues
**POST /queues**
- ✅ `name` (required, 2-255 chars)
- ✅ `number` (required, 3-10 chars, unique)
- ⭕ `strategy` (optional, default: ringall)
- ⭕ `timeout` (optional, default: 30)
- ⭕ `retry` (optional, default: 5)
- ⭕ `music_on_hold` (optional, default: default)
- ⭕ `recording_enabled` (optional, default: false)

**PUT /queues/{id}**
- ⭕ All fields optional

**POST /queues/{id}/members**
- ✅ `user_id` (required, UUID)
- ⭕ `penalty` (optional, default: 0)

### Webhooks
**POST /webhooks**
- ✅ `url` (required, valid URL)
- ✅ `events` (required, array of event names)
- ⭕ `secret` (optional, auto-generated)
- ⭕ `active` (optional, default: true)

**PUT /webhooks/{id}**
- ⭕ All fields optional

---

## Common Issues & Solutions

### Issue 1: "Unauthorized" (401) Error

**Cause:** Authorization header not included or invalid token

**Solutions:**
1. Clear browser cache and refresh
2. Click "Authorize" button and enter token
3. Make sure you're using **organization token** (from `/auth/login`), not admin token
4. Token might be expired (24 hours) - get new token

### Issue 2: Authorization Button Not Working

**Cause:** Browser cache or CORS issue

**Solutions:**
1. Hard refresh: `Ctrl+Shift+R` or `Cmd+Shift+R`
2. Clear browser cache completely
3. Try different browser
4. Check browser console for errors (F12)

### Issue 3: Token Expires Quickly

**Cause:** Tokens expire after 24 hours

**Solution:**
- Re-authenticate using `/auth/login` to get new token
- Implement token refresh in your application

### Issue 4: Can't Find Authorize Button

**Location:** Top right of Swagger UI page, green button with lock icon 🔒

### Issue 5: Wrong Token Type

**Problem:** Using admin token for regular operations

**Solution:**
```bash
❌ WRONG: Admin token for trunks/users/queues
✅ CORRECT: Organization token from /auth/login
```

---

## Testing with curl (Bypass Swagger)

If Swagger still doesn't work, test directly with curl:

```bash
# 1. Get token
TOKEN=$(curl -s -X POST http://103.92.154.211:3003/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"api_key":"org_...","api_secret":"secret_..."}' \
  | jq -r '.token')

# 2. Test GET /trunks
curl -X GET http://103.92.154.211:3003/api/v1/trunks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq '.'

# 3. Test POST /trunks
curl -X POST http://103.92.154.211:3003/api/v1/trunks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Trunk",
    "host": "sip.example.com",
    "port": 5060
  }' | jq '.'
```

If curl works but Swagger doesn't, it's a browser/Swagger UI issue.

---

## Swagger UI Cache Issues

### Clear Swagger UI Cache

**Method 1: Hard Refresh**
- Chrome/Edge: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
- Firefox: `Ctrl+F5` or `Cmd+Shift+R`

**Method 2: Clear Browser Data**
1. Open DevTools (F12)
2. Right-click the refresh button
3. Select "Empty Cache and Hard Reload"

**Method 3: Incognito/Private Mode**
- Open Swagger UI in incognito/private browsing mode
- This bypasses all cache

---

## Verify Server Configuration

```bash
# Check if server is running
curl -s http://103.92.154.211:3003/health | jq '.'

# Check Swagger JSON
curl -s https://devpbx.astradial.com/docs/swagger-ui-init.js | grep -i "bearer"

# This should show BearerAuth configuration
```

---

## Contact Support

If issues persist:

1. **Check browser console** (F12) for JavaScript errors
2. **Check Network tab** (F12) to see if Authorization header is being sent
3. **Try different browser** (Chrome, Firefox, Safari)
4. **Test with curl** to verify API is working
5. **Check server logs** for detailed error messages

VPS URL: **https://devpbx.astradial.com**
Swagger UI: **https://devpbx.astradial.com/docs/** (old `/api-docs` path redirects here)

**Note:** Only `BearerAuth` (JWT) is used for authentication. The `ApiKeyAuth` and `ApiSecretAuth` security schemes have been removed from the OpenAPI spec. The Swagger "Authorize" dialog only shows the Bearer token input.
