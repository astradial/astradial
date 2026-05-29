# Comprehensive API Test Checklist
## Based on OpenAPI Specification (API_SPECIFICATION.yaml)

**Test Date:** 2025-09-19
**Base URL:** http://localhost:3000
**Total Endpoints:** 25+

---

## 🔐 Authentication Endpoints (2)

### Admin Authentication
- [ ] **POST /auth/admin/login**
  - Test valid credentials (admin/admin123)
  - Test invalid credentials
  - Verify JWT token returned
  - Test token format and expiration

- [ ] **POST /auth/admin/get-org-credentials**
  - Test with valid admin token
  - Test with invalid/expired token
  - Verify organization credentials returned
  - Test for specific organization ID

---

## 🏢 Organization Authentication (2)

### Organization Authentication
- [ ] **POST /auth/login**
  - Test with valid org credentials (from admin endpoint)
  - Test with invalid credentials
  - Verify JWT token returned
  - Test token validation

- [ ] **POST /auth/refresh**
  - Test with valid refresh token
  - Test with invalid/expired refresh token
  - Verify new access token returned

---

## ⚙️ Configuration Management (6)

### Configuration Operations
- [ ] **GET /config/status**
  - Test with valid org token
  - Test without authentication
  - Verify configuration status returned

- [ ] **POST /config/deploy**
  - Test with valid org token
  - Test configuration deployment
  - Verify AMI reload triggered
  - Test deployment status response

- [ ] **POST /config/backup**
  - Test configuration backup creation
  - Verify backup file generated
  - Test backup metadata

- [ ] **POST /config/restore**
  - Test configuration restore from backup
  - Test with invalid backup ID
  - Verify restoration process

- [ ] **GET /config/validate**
  - Test configuration validation
  - Test with valid configurations
  - Test with invalid configurations

- [ ] **GET /config/reload**
  - Test Asterisk reload via AMI
  - Verify reload completion
  - Test reload status response

---

## 🏢 Organization Management (1)

### Organization Operations
- [ ] **POST /organizations**
  - Test valid organization creation
  - **Test name validation (no spaces, proper format)**
  - Test duplicate organization names
  - Test invalid characters in name
  - Test required fields validation
  - Verify context_prefix generation

---

## 📞 SIP Trunks Management (4)

### SIP Trunk Operations
- [ ] **GET /sip-trunks**
  - Test retrieving all trunks for organization
  - Test empty trunk list
  - Verify trunk data structure

- [ ] **POST /sip-trunks**
  - Test valid trunk creation
  - Test required fields validation
  - Test duplicate trunk names
  - Verify asterisk_peer_name generation

- [ ] **PUT /sip-trunks/{id}**
  - Test valid trunk updates
  - Test partial updates
  - Test invalid trunk ID
  - Verify configuration updates

- [ ] **DELETE /sip-trunks/{id}**
  - Test trunk deletion
  - Test invalid trunk ID
  - Verify cascade effects

---

## 📱 DID Numbers Management (5)

### DID Operations
- [ ] **GET /dids**
  - Test retrieving all DIDs for organization
  - Test empty DID list
  - Verify DID data structure

- [ ] **POST /dids**
  - Test valid DID creation
  - Test duplicate DID numbers
  - Test routing configuration
  - Test number format validation

- [ ] **PUT /dids/{id}**
  - Test DID updates
  - Test routing changes
  - Test invalid DID ID

- [ ] **DELETE /dids/{id}**
  - Test DID deletion
  - Test invalid DID ID
  - Verify routing cleanup

- [ ] **POST /dids/{id}/routing**
  - Test routing rule creation
  - Test different routing types
  - Test routing validation

---

## 👥 Users Management (4)

### User Operations
- [ ] **GET /users**
  - Test retrieving all users for organization
  - Test pagination if implemented
  - Verify user data structure

- [ ] **POST /users**
  - Test valid user creation
  - Test duplicate extensions
  - Test duplicate usernames
  - Test extension format validation
  - Verify asterisk_endpoint generation

- [ ] **PUT /users/{id}**
  - Test user updates
  - Test extension changes
  - Test password updates
  - Test invalid user ID

- [ ] **DELETE /users/{id}**
  - Test user deletion
  - Test invalid user ID
  - Verify queue membership cleanup

---

## 📋 Queues Management (5)

### Queue Operations
- [ ] **GET /queues**
  - Test retrieving all queues for organization
  - Test empty queue list
  - Verify queue data structure

- [ ] **POST /queues**
  - Test valid queue creation
  - Test duplicate queue numbers
  - Test strategy validation
  - Verify asterisk_queue_name generation

- [ ] **PUT /queues/{id}**
  - Test queue updates
  - Test strategy changes
  - Test timeout modifications
  - Test invalid queue ID

- [ ] **POST /queues/{id}/members**
  - Test adding queue members
  - Test duplicate member addition
  - Test invalid user/queue IDs
  - Test penalty settings

- [ ] **DELETE /queues/{queueId}/members/{userId}**
  - Test removing queue members
  - Test invalid member removal
  - Test cascade effects

---

## 🔗 Webhooks Management (4)

### Webhook Operations
- [ ] **GET /webhooks**
  - Test retrieving all webhooks
  - Test empty webhook list
  - Verify webhook data structure

- [ ] **POST /webhooks**
  - Test webhook creation
  - Test URL validation
  - Test event type validation
  - Test authentication settings

- [ ] **PUT /webhooks/{id}**
  - Test webhook updates
  - Test URL changes
  - Test event modifications
  - Test invalid webhook ID

- [ ] **DELETE /webhooks/{id}**
  - Test webhook deletion
  - Test invalid webhook ID

---

## 📞 Call Management (3)

### Call Operations
- [ ] **POST /calls/initiate**
  - Test call initiation
  - Test valid phone numbers
  - Test invalid numbers
  - Test caller ID settings

- [ ] **POST /calls/{id}/transfer**
  - Test call transfer functionality
  - Test attended transfers
  - Test blind transfers
  - Test invalid call ID

- [ ] **POST /calls/{id}/hangup**
  - Test call termination
  - Test invalid call ID
  - Test already ended calls

---

## 🧪 Testing Endpoints (1)

### Test Operations
- [ ] **GET /test/asterisk-connection**
  - Test Asterisk connectivity
  - Test AMI connection status
  - Verify response format

---

## 📋 Test Execution Plan

### Phase 1: Authentication Flow
1. Admin login and get organization credentials
2. Organization login with retrieved credentials
3. Token refresh functionality

### Phase 2: Core Configuration
1. Configuration status and validation
2. Configuration deployment and reload
3. Backup and restore operations

### Phase 3: Resource Management
1. Organization creation with validation rules
2. SIP trunk CRUD operations
3. User management with proper validation
4. Queue management and member operations
5. DID management and routing

### Phase 4: Advanced Features
1. Webhook management
2. Call management operations
3. System testing endpoints

### Phase 5: Integration Testing
1. End-to-end workflows
2. Multi-tenant isolation verification
3. Context format validation (testorg_internal)
4. Configuration deployment verification

---

## 📊 Success Criteria

- [ ] All endpoints return appropriate HTTP status codes
- [ ] Authentication and authorization working correctly
- [ ] Input validation functioning as documented
- [ ] Error responses are properly formatted
- [ ] Database operations complete successfully
- [ ] Asterisk configuration deployment works
- [ ] Multi-tenant isolation maintained
- [ ] Context naming format is correct (org_internal)
- [ ] Organization name validation enforced

---

## 🚨 Critical Validation Points

1. **Context Format**: Ensure all generated contexts use "testorg_internal" not "testorginternal"
2. **Organization Names**: Must not have spaces, must not start/end with special characters
3. **Authentication**: JWT tokens must be properly validated
4. **Multi-tenancy**: Data isolation between organizations
5. **AMI Integration**: Configuration deployments must trigger proper reloads