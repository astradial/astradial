#!/usr/bin/env node

/**
 * Multi-Tenant PBX API Server
 * Complete implementation with all requested features
 */

const express = require('express');

// Cloud archival of call recordings is OPT-IN and has no default bucket.
// A default would mean every self-hosted install writes its customers' call
// audio into whichever bucket was baked into the source, and bills that
// bucket's owner. Unset = recordings stay on local disk; playback, stitching
// and deletion all degrade gracefully rather than reaching for someone
// else's storage.
const GCS_BUCKET = process.env.GCS_BUCKET || '';
const GCS_BUCKET_PATH = process.env.GCS_BUCKET_PATH || 'astra_pbx/recordings';
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const crypto = require('crypto');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

// Import database models
const { sequelize } = require('./models');
const { requireRole, requirePermission, getPermissions, ROLE_LEVELS } = require('./middleware/rbac');
const { Organization, User, SipTrunk, DidNumber, Queue, QueueMember, Webhook, CallRecord, Ivr, IvrMenu, OutboundRoute, GlobalSettings } = require('./models');

// Import services
const ConfigDeploymentService = require('./services/asterisk/configDeploymentService');
const ConfigVerificationService = require('./services/asterisk/configVerificationService');
const eventListenerService = require('./services/eventListenerService');

// Import routes
const organizationRoutes = require('./routes/organizations');
const crmRoutes = require('./routes/crm');
const didPoolRoutes = require('./routes/didPool');
const apiKeyRoutes = require('./routes/apiKeys');
const customerTunnelRoutes = require('./routes/customer-tunnels');
const ticketAlertRoutes = require('./routes/ticket-alerts');
const adminWhatsappRoutes = require('./routes/admin-whatsapp');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

// Trust proxy - Required when behind Nginx to get real client IP
app.set('trust proxy', true);

// CORS Middleware - Allow all origins for API access
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-API-Secret'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Custom morgan token for real IP address (supports proxy)
morgan.token('real-ip', (req) => {
  return req.ip || req.connection.remoteAddress;
});

// Morgan logging with real IP
app.use(morgan(':real-ip - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'));

// Load and setup Swagger documentation with dynamic server configuration
const swaggerDocument = YAML.load('./docs/API_SPECIFICATION.yaml');
const { execSync } = require('child_process');

/**
 * Wrap a raw 8 kHz mu-law byte stream in a 58-byte WAVE/mu-law header
 * so browsers can decode it via <audio>. Asterisk's `.ulaw` file
 * format is headerless raw mu-law; browsers need a WAV container.
 * Same payload bytes either way — only a header is prepended.
 *
 * WAVE format code 0x0007 = mu-law. The `fact` chunk is mandatory
 * for non-PCM WAV formats per spec.
 */
function wrapMulawAsWav(mulaw) {
  const dataSize = mulaw.length;
  const headerSize = 58;
  const buf = Buffer.alloc(headerSize + dataSize);
  let p = 0;
  buf.write('RIFF', p, 'ascii'); p += 4;
  buf.writeUInt32LE(headerSize + dataSize - 8, p); p += 4;
  buf.write('WAVE', p, 'ascii'); p += 4;
  buf.write('fmt ', p, 'ascii'); p += 4;
  buf.writeUInt32LE(18, p); p += 4;        // fmt chunk size (non-PCM)
  buf.writeUInt16LE(7, p); p += 2;         // WAVE_FORMAT_MULAW
  buf.writeUInt16LE(1, p); p += 2;         // channels
  buf.writeUInt32LE(8000, p); p += 4;      // sample rate
  buf.writeUInt32LE(8000, p); p += 4;      // byte rate
  buf.writeUInt16LE(1, p); p += 2;         // block align
  buf.writeUInt16LE(8, p); p += 2;         // bits per sample
  buf.writeUInt16LE(0, p); p += 2;         // cbSize extension (none)
  buf.write('fact', p, 'ascii'); p += 4;
  buf.writeUInt32LE(4, p); p += 4;         // fact chunk size
  buf.writeUInt32LE(dataSize, p); p += 4;  // num samples
  buf.write('data', p, 'ascii'); p += 4;
  buf.writeUInt32LE(dataSize, p); p += 4;
  mulaw.copy(buf, p);
  return buf;
}

// Get public IP address from Amazon checkip service
function getPublicIP() {
  try {
    const publicIP = execSync('curl -s checkip.amazonaws.com', { timeout: 3000 }).toString().trim();
    if (publicIP && /^(\d{1,3}\.){3}\d{1,3}$/.test(publicIP)) {
      return publicIP;
    }
  } catch (error) {
    console.error('Failed to get public IP:', error.message);
  }
  return 'localhost';
}

// Override servers in Swagger document with dynamic configuration
const customDomain = process.env.SWAGGER_DOMAIN;
const serverIP = getPublicIP();
const serverPort = process.env.PORT || 3000;

swaggerDocument.servers = [];

// Add custom domain if provided (supports both with and without protocol)
if (customDomain) {
  let domainUrl;
  if (customDomain.startsWith('http://') || customDomain.startsWith('https://')) {
    domainUrl = customDomain;
  } else {
    // Default to https for custom domains without protocol
    domainUrl = `https://${customDomain}`;
  }
  swaggerDocument.servers.push({
    url: `${domainUrl}/api/v1`,
    description: 'Production API (Custom Domain)'
  });
}

// Add IP-based server
swaggerDocument.servers.push({
  url: `http://${serverIP}:${serverPort}/api/v1`,
  description: `Public API Server (${serverIP}:${serverPort})`
});

// Add localhost
swaggerDocument.servers.push({
  url: `http://localhost:${serverPort}/api/v1`,
  description: 'Localhost Development'
});

// Log server configuration
console.log('📡 Swagger servers configured:');
swaggerDocument.servers.forEach(server => {
  console.log(`   - ${server.description}: ${server.url}`);
});

// Log to verify admin/settings path
console.log('Admin settings path:', swaggerDocument.paths['/admin/settings'] ? '/admin/settings ✓' : 'NOT FOUND');

// Swagger UI options to enable authorization persistence
const swaggerOptions = {
  swaggerOptions: {
    persistAuthorization: true,  // Keep authorization when page refreshes
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
    url: '/api-spec.json'  // Serve spec from local endpoint
  },
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "PBX API Documentation"
};

// Serve the OpenAPI spec as JSON
app.get('/api-spec.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(swaggerDocument);
});

// Mount Swagger UI - use separate middleware to avoid conflicts
app.use('/api-docs', swaggerUi.serveFiles(swaggerDocument, swaggerOptions));
app.get('/api-docs', swaggerUi.setup(swaggerDocument, swaggerOptions));

// Scalar API Reference UI — branded, with server selector + sidebar grouping by tag.
const { apiReference } = require("@scalar/express-api-reference");
app.use("/reference", apiReference({
  spec: { content: swaggerDocument },
  theme: "purple",
  showSidebar: true,
  hideDownloadButton: false,
  hideTestRequestButton: false,
  darkMode: true,
  metaData: {
    title: "AstraPBX API Reference",
    description: "Multi-tenant cloud PBX — control calls, users, queues, IVRs, trunks, and webhooks over HTTP.",
  },
  // Render a clean top-left brand link. Scalar picks up `info.title` from the
  // spec if `metaData.title` isn't set; we set both so the tab title and the
  // rendered header stay consistent.
  customCss: `
    .scalar-api-reference .sidebar { border-right: 1px solid rgba(255,255,255,0.05); }
    .scalar-api-reference h1.t-editor__heading { font-weight: 600; letter-spacing: -0.01em; }
  `,
}));

// Alternative paths for API documentation
app.use('/api', swaggerUi.serveFiles(swaggerDocument, swaggerOptions));
app.get('/api', swaggerUi.setup(swaggerDocument, swaggerOptions));

app.use('/docs', swaggerUi.serveFiles(swaggerDocument, swaggerOptions));
app.get('/docs', swaggerUi.setup(swaggerDocument, swaggerOptions));

// Mount routes
app.use('/api/v1/organizations', organizationRoutes);

// ========================================
// IN-MEMORY STORAGE FOR ACTIVE CALLS AND ROUTING RULES
// Database models are used for persistent data
// ========================================

const db = {
  routingRules: new Map(),
  activeCalls: new Map()
};

// JWT Secret (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_here_change_in_production';

// Initialize services
const configDeploymentService = new ConfigDeploymentService();
const configVerificationService = new ConfigVerificationService();

// ========================================
// AUTHENTICATION MIDDLEWARE
// ========================================

const authenticateOrg = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];

  // Also accept internal key (for workflow engine + editor server-to-server calls).
  // org_id is optional — admin endpoints (e.g. did-pool/admin/*) operate across
  // all orgs and don't have a single org scope. Without org_id, req.orgId stays
  // null and individual handlers can decide whether they need it.
  const internalKey = req.headers['x-internal-key'];
  if (internalKey && internalKey === process.env.INTERNAL_API_KEY) {
    const orgId = req.body?.org_id || req.query?.org_id;
    if (orgId) {
      const org = await Organization.findByPk(orgId);
      if (org && org.status === 'active') {
        req.orgId = org.id;
        req.organization = org;
        return next();
      }
    }
    req.internalKeyAuth = true;
    return next();
  }

  if (!apiKey && !authHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    let organization = null;

    // Check org-generated API key (ak_ prefix)
    if (apiKey && apiKey.startsWith('ak_')) {
      const { OrgApiKey } = require('./models');
      const orgKey = await OrgApiKey.findOne({ where: { api_key: apiKey, status: 'active' } });
      if (orgKey) {
        organization = await Organization.findByPk(orgKey.org_id);
        if (organization) {
          req.orgApiKeyPermissions = orgKey.permissions || [];
          // Update last_used_at (fire and forget)
          orgKey.update({ last_used_at: new Date() }).catch(() => {});
        }
      }
    }

    // Check org-level API Key (org_ prefix)
    if (apiKey && !organization) {
      organization = await Organization.findOne({
        where: { api_key: apiKey, status: 'active' }
      });
    }

    // Check JWT Token
    if (authHeader && !organization) {
      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, JWT_SECRET);
      organization = await Organization.findByPk(decoded.orgId);
    }

    if (!organization || organization.status !== 'active') {
      return res.status(401).json({ error: 'Invalid authentication or organization not active' });
    }

    req.orgId = organization.id;
    req.organization = organization;

    // Enrich with user context if JWT has userId (user-level token from /auth/user-login)
    if (authHeader) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.userId) {
          req.userId = decoded.userId;
          req.userEmail = decoded.email;
          req.userRole = decoded.role;
        }
      } catch {}
    }

    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// Admin authentication middleware for organization creation
const authenticateAdmin = async (req, res, next) => {
  const { admin_username, admin_password } = req.body;

  if (!admin_username || !admin_password) {
    return res.status(401).json({
      error: 'Admin credentials required',
      required_fields: ['admin_username', 'admin_password']
    });
  }

  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminUsername || !adminPassword) {
    return res.status(500).json({
      error: 'Admin credentials not configured on server'
    });
  }

  if (admin_username !== adminUsername || admin_password !== adminPassword) {
    return res.status(401).json({
      error: 'Invalid admin credentials'
    });
  }

  next();
};

// ========================================
// HELPER FUNCTIONS
// ========================================

const generateContextPrefix = () => {
  const timestamp = Date.now().toString(36);
  return `org_${timestamp}_`;
};

const triggerWebhooks = async (orgId, event, data) => {
  try {
    const webhooks = await Webhook.findAll({
      where: {
        org_id: orgId,
        active: true,
        events: {
          [require('sequelize').Op.contains]: [event]
        }
      }
    });

    for (const webhook of webhooks) {
      try {
        const payload = {
          event,
          timestamp: new Date().toISOString(),
          organization_id: orgId,
          data
        };

        // Add HMAC signature if secret is configured
        const headers = { 'Content-Type': 'application/json' };
        if (webhook.secret) {
          const signature = crypto
            .createHmac('sha256', webhook.secret)
            .update(JSON.stringify(payload))
            .digest('hex');
          headers['X-Webhook-Signature'] = signature;
        }

        // Send webhook (in production, use queue system)
        axios.post(webhook.url, payload, { headers, timeout: 5000 })
          .catch(err => console.error(`Webhook failed: ${webhook.url}`, err.message));
      } catch (error) {
        console.error('Webhook error:', error);
      }
    }
  } catch (error) {
    console.error('Error fetching webhooks:', error);
  }
};

// ========================================
// API ENDPOINTS
// ========================================

// Health check
app.get('/health', (req, res) => {
  const eventStatus = eventListenerService.getStatus();

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: 'connected',
      eventListener: eventStatus.isRunning ? 'running' : 'stopped',
      ari: eventStatus.ari.connected ? 'connected' : 'disconnected',
      ami: eventStatus.ami.connected ? 'connected' : 'disconnected'
    },
    activeCalls: eventStatus.ari.activeCalls
  });
});

// Event Listener Service status endpoint
app.get('/api/v1/events/status', (req, res) => {
  const status = eventListenerService.getStatus();

  res.json({
    service: 'Event Listener Service',
    ...status,
    description: {
      isRunning: 'Whether the event listener service is active',
      ari: {
        connected: 'Asterisk REST Interface connection status',
        activeCalls: 'Number of currently active calls being monitored'
      },
      ami: {
        connected: 'Asterisk Manager Interface connection status'
      }
    }
  });
});

// ========================================
// CONFIGURATION VALIDATION ENDPOINTS
// ========================================

// Verify organization configuration
app.get('/api/v1/config/verify', authenticateOrg, async (req, res) => {
  try {
    const orgId = req.organization.id;
    const orgName = req.organization.name;

    const verificationResults = await configVerificationService.verifyOrganizationConfiguration(orgId, orgName);

    res.json({
      success: true,
      verification: verificationResults
    });

  } catch (error) {
    console.error('Error verifying configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify configuration',
      details: error.message
    });
  }
});

// Deploy organization configuration
app.post('/api/v1/config/deploy', authenticateOrg, requireRole('admin'), async (req, res) => {
  try {
    const orgId = req.orgId;
    const orgName = req.organization.name;
    const { reload = true } = req.body || {}; // Default to true for auto-reload

    const deploymentResult = await configDeploymentService.deployOrganizationConfiguration(orgId, orgName);

    // Auto-reload Asterisk configuration via AMI if requested
    let reloadResult = null;
    if (reload) {
      try {
        const AsteriskManager = require('./services/asterisk/asteriskManager');
        const asteriskManager = new AsteriskManager();

        // Connect to AMI and reload Asterisk core (without dropping calls)
        await asteriskManager.connect();

        // Use 'core reload' instead of individual module reloads to avoid dropping calls
        await asteriskManager.coreReload();

        await asteriskManager.disconnect();

        reloadResult = {
          success: true,
          method: 'AMI',
          action: 'core reload',
          message: 'Asterisk configuration reloaded successfully without dropping calls'
        };
      } catch (reloadError) {
        console.error('Error reloading Asterisk configuration via AMI:', reloadError);
        reloadResult = {
          success: false,
          method: 'AMI',
          error: 'Failed to reload Asterisk configuration via AMI',
          details: reloadError.message
        };
      }
    }

    res.json({
      success: true,
      deployment: deploymentResult,
      reload: reloadResult
    });

  } catch (error) {
    console.error('Error deploying configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to deploy configuration',
      details: error.message
    });
  }
});

// Test helper functions
app.get('/api/v1/config/test-helpers', authenticateOrg, async (req, res) => {
  try {
    const orgName = req.organization.name;

    const testResults = await configVerificationService.testHelperFunctions(orgName);

    res.json({
      success: true,
      tests: testResults
    });

  } catch (error) {
    console.error('Error testing helper functions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test helper functions',
      details: error.message
    });
  }
});

// Generate verification report
app.get('/api/v1/config/report', authenticateOrg, async (req, res) => {
  try {
    const orgId = req.organization.id;
    const orgName = req.organization.name;

    const verificationResults = await configVerificationService.verifyOrganizationConfiguration(orgId, orgName);
    const report = configVerificationService.generateVerificationReport(verificationResults);

    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="${orgName}_verification_report.md"`);
    res.send(report);

  } catch (error) {
    console.error('Error generating verification report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate verification report',
      details: error.message
    });
  }
});

// List organization configurations
app.get('/api/v1/config/list', authenticateOrg, async (req, res) => {
  try {
    const configurations = await configDeploymentService.listOrganizationConfigurations();

    res.json({
      success: true,
      configurations: configurations
    });

  } catch (error) {
    console.error('Error listing configurations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list configurations',
      details: error.message
    });
  }
});

// Reload Asterisk configuration using AMI core reload
app.post('/api/v1/config/reload', authenticateOrg, requireRole('admin'), async (req, res) => {
  try {
    const AsteriskManager = require('./services/asterisk/asteriskManager');
    const asteriskManager = new AsteriskManager();

    // Connect to AMI and use core reload to avoid dropping calls
    await asteriskManager.connect();
    await asteriskManager.coreReload();
    await asteriskManager.disconnect();

    res.json({
      success: true,
      method: 'AMI',
      action: 'core reload',
      message: 'Asterisk configuration reloaded successfully without dropping calls'
    });

  } catch (error) {
    console.error('Error reloading Asterisk configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reload Asterisk configuration',
      details: error.message
    });
  }
});

// ========================================
// AUTHENTICATION
// ========================================

// Login endpoint to generate JWT token
app.post('/api/v1/auth/login', async (req, res) => {
  try {
    const { api_key, api_secret } = req.body;

    if (!api_key || !api_secret) {
      return res.status(400).json({
        error: 'API key and secret are required',
        required_fields: ['api_key', 'api_secret']
      });
    }

    // Find organization by API key
    const organization = await Organization.findOne({
      where: { api_key }
    });

    if (!organization) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Validate API secret
    const isValidSecret = await organization.validateApiSecret(api_secret);
    if (!isValidSecret) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        orgId: organization.id,
        orgName: organization.name,
        apiKey: organization.api_key
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      token_type: 'Bearer',
      expires_in: '24h',
      organization: {
        id: organization.id,
        name: organization.name,
        api_key: organization.api_key
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========================================
// AUTHENTICATION — EMAIL + PASSWORD (OSS local mode)
// ========================================
//
// These endpoints back the OSS Sign In UI (editor/app/dashboard/page.tsx)
// when USE_FIREBASE=false. They mirror platform's Firebase-backed flow
// in shape — same JSON contracts and JWT claims — so the dashboard
// renderer is identical, only the source of identity changes.
//
// Three flows:
//   1. /auth/signup            — new user, auto-creates an org, returns JWT
//   2. /auth/login-password    — existing user signs in with email+password
//   3. /auth/admin-login-password — system admin (env-credentialled)
//
// Existing /auth/login (api_key + api_secret) and /auth/email-login
// (Firebase-trusted) are untouched.

// POST /api/v1/auth/signup
// Body: { email, password, name }
// Creates a user with NO organisation yet. The frontend then collects
// org details and POSTs them to /auth/request-org with the
// `isOnboarding` token returned here. An admin must approve the org
// before the user can sign in normally.
//
// This two-step flow mirrors platform's Firebase-based signup →
// request-org → admin approve flow, without depending on Firebase.
app.post('/api/v1/auth/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existingRows = await sequelize.query(
      'SELECT id FROM org_users WHERE LOWER(email) = LOWER(?) LIMIT 1',
      { replacements: [email], type: sequelize.QueryTypes.SELECT }
    );
    if (existingRows && existingRows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    const displayName = (name && name.trim()) || email.split('@')[0];

    await sequelize.query(
      `INSERT INTO org_users (id, org_id, email, name, role, status, password_hash, created_at, updated_at)
       VALUES (?, NULL, ?, ?, 'owner', 'invited', ?, NOW(), NOW())`,
      { replacements: [userId, email, displayName, passwordHash] }
    );

    // Short-lived onboarding token — only useful for /auth/request-org.
    const token = jwt.sign(
      { userId, email, role: 'owner', isOnboarding: true },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(201).json({
      token,
      token_type: 'Bearer',
      expires_in: '1h',
      requires_org_request: true,
      user: {
        id: userId,
        email,
        name: displayName,
        org_id: null,
        org_name: null,
        role: 'owner',
        permissions: [],
      },
    });
  } catch (error) {
    console.error('Signup error:', error);
    // Never leak internal error details to the login form. The full
    // error (including SQL state) lands in server logs for operators.
    res.status(500).json({ error: 'Signup failed. Please try again or contact support.' });
  }
});

// POST /api/v1/auth/request-org
// Auth: Bearer <onboarding token from /auth/signup or
//                /auth/login-password when user has no org yet>
// Body: { org_name, contact_phone, contact_email?, industry, address?,
//         company_size?, expected_users?, description? }
//
// Creates the organisation in status='pending' and links the
// authenticated user as its owner. Sysadmin must Approve from the
// admin dashboard for the org to become usable.
app.post('/api/v1/auth/request-org', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Auth token required' });
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (!decoded.userId) {
      return res.status(403).json({ error: 'Token is not eligible for org request' });
    }

    const {
      org_name,
      contact_phone,
      contact_email,
      industry,
      address,
      company_size,
      expected_users,
      description,
    } = req.body || {};

    if (!org_name || !org_name.trim()) {
      return res.status(400).json({ error: 'org_name is required' });
    }
    if (!contact_phone || !contact_phone.trim()) {
      return res.status(400).json({ error: 'contact_phone is required' });
    }
    if (!industry || !industry.trim()) {
      return res.status(400).json({ error: 'industry is required' });
    }

    // Verify the user exists + still has no org (idempotency guard:
    // resubmitting the form shouldn't create duplicate orgs).
    const userRows = await sequelize.query(
      'SELECT id, email, name, org_id FROM org_users WHERE id = ? LIMIT 1',
      { replacements: [decoded.userId], type: sequelize.QueryTypes.SELECT }
    );
    const user = userRows && userRows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.org_id) {
      return res.status(409).json({ error: 'You already have an organisation linked to this account' });
    }

    const apiKey = `org_${uuidv4().replace(/-/g, '')}`;
    const apiSecret = uuidv4();
    const hashedSecret = await bcrypt.hash(apiSecret, 10);

    const organization = await Organization.create({
      name: org_name.trim(),
      domain: `${org_name.trim().toLowerCase().replace(/\s+/g, '')}.local`,
      context_prefix: generateContextPrefix(),
      api_key: apiKey,
      api_secret: hashedSecret,
      status: 'pending',
      contact_info: {
        email: contact_email || user.email,
        phone: contact_phone,
        industry,
        address: address || null,
        company_size: company_size || null,
        expected_users: expected_users || null,
        description: description || null,
      },
    });

    await sequelize.query(
      'UPDATE org_users SET org_id = ?, status = ? WHERE id = ?',
      { replacements: [organization.id, 'active', user.id] }
    );

    res.status(201).json({
      ok: true,
      organization: {
        id: organization.id,
        name: organization.name,
        status: 'pending',
      },
      message: 'Your organisation is awaiting admin approval. You\'ll be able to log in once approved.',
    });
  } catch (error) {
    console.error('Request-org error:', error);
    res.status(500).json({ error: 'Failed to submit organisation request. Please try again.' });
  }
});

// POST /api/v1/auth/login-password
// Body: { email, password }
// Validates bcrypt password_hash on org_users, returns a JWT bound to
// the user's org and role.
app.post('/api/v1/auth/login-password', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }

    const rows = await sequelize.query(
      `SELECT id, org_id, email, name, role, status, password_hash
       FROM org_users
       WHERE LOWER(email) = LOWER(?)
       LIMIT 1`,
      { replacements: [email], type: sequelize.QueryTypes.SELECT }
    );
    const user = rows && rows[0];
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.status && user.status !== 'active') {
      return res.status(403).json({ error: `Account is ${user.status}` });
    }

    // Three cases:
    //  (a) User has no org yet → onboarding token, requires_org_request.
    //  (b) Org is pending admin approval → 202, status hint, no token.
    //  (c) Org is active → normal full-access JWT.
    if (!user.org_id) {
      const onboardingToken = jwt.sign(
        { userId: user.id, email: user.email, role: 'owner', isOnboarding: true },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
      return res.status(200).json({
        token: onboardingToken,
        token_type: 'Bearer',
        expires_in: '1h',
        requires_org_request: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          org_id: null,
          org_name: null,
          role: user.role,
          permissions: [],
        },
      });
    }

    const org = await Organization.findByPk(user.org_id, {
      attributes: ['name', 'api_key', 'status'],
    });
    if (!org) {
      return res.status(404).json({ error: 'Organization for this account no longer exists' });
    }
    if (org.status === 'pending') {
      return res.status(202).json({
        pending_approval: true,
        org_name: org.name,
        message: `Your organisation "${org.name}" is awaiting admin approval.`,
      });
    }
    if (org.status !== 'active') {
      return res.status(403).json({ error: `Your organisation is ${org.status}. Contact your administrator.` });
    }

    const token = jwt.sign(
      {
        orgId: user.org_id,
        orgName: org.name,
        apiKey: org.api_key,
        userId: user.id,
        email: user.email,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      token_type: 'Bearer',
      expires_in: '24h',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        org_id: user.org_id,
        org_name: org.name,
        role: user.role,
        permissions: [],
      },
    });
  } catch (error) {
    console.error('Login-password error:', error);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// POST /api/v1/auth/admin-login-password
// Body: { email, password }
// Validates against ADMIN_EMAIL + ADMIN_PASSWORD env vars (the system
// admin credentials provisioned by setup.sh). Returns a JWT with
// isAdmin=true that gates /api/v1/admin/* endpoints.
app.post('/api/v1/auth/admin-login-password', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }

    const adminEmailRaw = process.env.ADMIN_EMAIL || '';
    const adminPasswordRaw = process.env.ADMIN_PASSWORD || '';
    if (!adminEmailRaw || !adminPasswordRaw) {
      return res.status(503).json({ error: 'Admin login disabled — ADMIN_EMAIL and ADMIN_PASSWORD must be set on the server' });
    }

    // Support comma-separated ADMIN_EMAIL for multiple sysadmins.
    const allowed = adminEmailRaw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!allowed.includes(String(email).toLowerCase()) || password !== adminPasswordRaw) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const token = jwt.sign(
      { isAdmin: true, email: String(email).toLowerCase(), role: 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      token_type: 'Bearer',
      expires_in: '8h',
      admin_key: process.env.INTERNAL_API_KEY || token,
      user: { email: String(email).toLowerCase(), role: 'admin' },
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Admin login failed. Please try again.' });
  }
});

// POST /api/v1/admin/approve-org/:orgId
// Admin flips a pending org to status='active'. Mirrors platform's
// /api/pbx/admin/approve-org route shape so the same UI works in both.
app.post('/api/v1/admin/approve-org/:orgId', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Admin token required' });
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid admin token' });
    }
    if (!decoded.isAdmin) return res.status(403).json({ error: 'Admin access required' });

    const org = await Organization.findByPk(req.params.orgId);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (org.status === 'active') {
      return res.json({ ok: true, message: 'Already active', organization: { id: org.id, status: org.status } });
    }

    await org.update({ status: 'active' });
    res.json({ ok: true, organization: { id: org.id, name: org.name, status: 'active' } });
  } catch (error) {
    console.error('Approve-org error:', error);
    res.status(500).json({ error: 'Approve failed. Please try again.' });
  }
});

// Internal helper — verify admin JWT, return decoded payload or send error.
// Used by suspend/reactivate/delete endpoints below.
function _requireAdminJwt(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'Admin token required' });
    return null;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return null;
    }
    return decoded;
  } catch {
    res.status(401).json({ error: 'Invalid admin token' });
    return null;
  }
}

// POST /api/v1/admin/orgs/:orgId/suspend
// Active → suspended. Org-scoped users can't log in (login-password
// returns 403). Data is preserved; reversible via /reactivate.
app.post('/api/v1/admin/orgs/:orgId/suspend', async (req, res) => {
  try {
    if (!_requireAdminJwt(req, res)) return;
    const org = await Organization.findByPk(req.params.orgId);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (org.status === 'deleted') {
      return res.status(409).json({ error: 'Cannot suspend a deleted organisation' });
    }
    await org.update({ status: 'suspended' });
    res.json({ ok: true, organization: { id: org.id, name: org.name, status: 'suspended' } });
  } catch (error) {
    console.error('Suspend-org error:', error);
    res.status(500).json({ error: 'Suspend failed. Please try again.' });
  }
});

// POST /api/v1/admin/orgs/:orgId/reactivate
// Suspended (or pending) → active. Lets the org log in normally again.
app.post('/api/v1/admin/orgs/:orgId/reactivate', async (req, res) => {
  try {
    if (!_requireAdminJwt(req, res)) return;
    const org = await Organization.findByPk(req.params.orgId);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (org.status === 'deleted') {
      return res.status(409).json({ error: 'Cannot reactivate a deleted organisation. Recreate it instead.' });
    }
    await org.update({ status: 'active' });
    res.json({ ok: true, organization: { id: org.id, name: org.name, status: 'active' } });
  } catch (error) {
    console.error('Reactivate-org error:', error);
    res.status(500).json({ error: 'Reactivate failed. Please try again.' });
  }
});

// DELETE /api/v1/admin/orgs/:orgId
// Soft-delete: flips status='deleted'. The row stays in the DB so
// related CDRs / tickets / queue history aren't orphaned and the
// context_prefix can't be reused for a future org. To hard-delete,
// the operator runs a DB script directly — UI never offers it.
app.delete('/api/v1/admin/orgs/:orgId', async (req, res) => {
  try {
    if (!_requireAdminJwt(req, res)) return;
    const org = await Organization.findByPk(req.params.orgId);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (org.status === 'deleted') {
      return res.json({ ok: true, message: 'Already deleted', organization: { id: org.id, status: 'deleted' } });
    }
    await org.update({ status: 'deleted' });
    res.json({ ok: true, organization: { id: org.id, name: org.name, status: 'deleted' } });
  } catch (error) {
    console.error('Delete-org error:', error);
    res.status(500).json({ error: 'Delete failed. Please try again.' });
  }
});

// POST /api/v1/admin/impersonate/:orgId
// Admin uses their JWT to get a per-org JWT they can drive the dashboard
// with. Mirrors platform's /api/admin/impersonate flow.
app.post('/api/v1/admin/impersonate/:orgId', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Admin token required' });
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid admin token' });
    }
    if (!decoded.isAdmin) return res.status(403).json({ error: 'Admin access required' });

    const org = await Organization.findByPk(req.params.orgId);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    // Fetch owner so we can return user info matching platform's shape
    let ownerRow = null;
    try {
      const rows = await sequelize.query(
        `SELECT id, email, name, role FROM org_users WHERE org_id = ? AND role = 'owner' LIMIT 1`,
        { replacements: [org.id], type: sequelize.QueryTypes.SELECT }
      );
      ownerRow = rows && rows[0];
    } catch { /* table may not exist yet on fresh installs — non-fatal */ }

    const orgToken = jwt.sign(
      {
        orgId: org.id,
        orgName: org.name,
        apiKey: org.api_key,
        userId: ownerRow?.id,
        email: ownerRow?.email,
        role: ownerRow?.role || 'admin',
        impersonating: true,
      },
      JWT_SECRET,
      { expiresIn: '4h' }
    );

    res.json({
      token: orgToken,
      user: {
        id: ownerRow?.id || null,
        email: ownerRow?.email || null,
        name: ownerRow?.name || null,
        org_id: org.id,
        org_name: org.name,
        role: ownerRow?.role || 'admin',
        permissions: [],
        impersonating: true,
      },
    });
  } catch (error) {
    console.error('Impersonate error:', error);
    res.status(500).json({ error: 'Could not enter organisation. Please try again.' });
  }
});

// ========================================
// ORGANIZATION MANAGEMENT
// ========================================

// Get all organizations (admin endpoint - requires authentication)
app.get('/api/v1/organizations', authenticateOrg, async (req, res) => {
  try {
    const organizations = await Organization.findAll({
      attributes: { exclude: ['api_secret'] }
    });
    res.json(organizations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get organization by ID
app.get('/api/v1/organizations/:id', authenticateOrg, async (req, res) => {
  try {
    const organization = await Organization.findByPk(req.params.id, {
      attributes: { exclude: ['api_secret'] }
    });

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Only allow organization to view its own data
    if (organization.id !== req.orgId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(organization);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new organization (Admin only)
app.post('/api/v1/organizations', authenticateAdmin, async (req, res) => {
  try {
    const {
      name,
      domain,
      contact_info,
      settings,
      limits,
      status = 'active'
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Display-name validation. Lenient — context_prefix (the value that
    // actually has to be safe for asterisk contexts + file paths) is
    // generated separately via generateContextPrefix(). Name just has
    // to be a sensible business name: 2-100 chars, no control bytes,
    // and at least one letter/digit so empty-ish strings (whitespace,
    // "...") are rejected.
    const trimmedName = String(name).trim();
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      return res.status(400).json({
        error: 'Invalid organization name length',
        message: 'Organization name must be between 2 and 100 characters long.'
      });
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(trimmedName) || !/[a-zA-Z0-9]/.test(trimmedName)) {
      return res.status(400).json({
        error: 'Invalid organization name',
        message: 'Organization name must contain at least one letter or digit and no control characters.'
      });
    }

    // Check for duplicate organization name
    const existingOrg = await Organization.findOne({
      where: { name: name }
    });

    if (existingOrg) {
      return res.status(409).json({
        error: 'Organization name already exists',
        message: `An organization with the name "${name}" already exists. Please choose a different name.`
      });
    }

    const apiKey = `org_${uuidv4().replace(/-/g, '')}`;
    const apiSecret = uuidv4();
    const hashedSecret = await bcrypt.hash(apiSecret, 10);

    // Prepare organization data with defaults
    const orgData = {
      name,
      domain: domain || `${name.toLowerCase().replace(/\s+/g, '')}.local`,
      context_prefix: generateContextPrefix(),
      api_key: apiKey,
      api_secret: hashedSecret,
      status: status,
      settings: settings || {
        max_trunks: 5,
        max_dids: 10,
        max_users: 50,
        max_queues: 10,
        recording_enabled: true,
        webhook_enabled: true,
        features: {
          call_transfer: true,
          call_recording: true,
          voicemail: true,
          conference: true,
          ivr: true,
          ai_agent: false
        }
      },
      limits: limits || {
        concurrent_calls: 10,
        monthly_minutes: 10000,
        storage_gb: 10
      },
      contact_info: contact_info || {
        email: null,
        phone: null,
        address: null
      }
    };

    const organization = await Organization.create(orgData);

    // Auto-provision: create org_users owner row + first SIP extension (1001)
    const ownerEmail = contact_info?.email;
    if (ownerEmail) {
      try {
        await sequelize.query(
          `INSERT INTO org_users (id, org_id, email, name, role, status, extension, created_at, updated_at)
           VALUES (UUID(), ?, ?, ?, 'owner', 'active', '1001', NOW(), NOW())`,
          { replacements: [organization.id, ownerEmail, ownerEmail.split('@')[0]] }
        );
        console.log(`✅ Created owner org_user ${ownerEmail} for org ${organization.name}`);
      } catch (ouErr) {
        console.warn('⚠️ org_users owner creation failed (non-fatal):', ouErr.message);
      }
    }

    try {
      const crypto = require('crypto');
      const sipPass = crypto.randomBytes(8).toString('hex');
      const hashedSipLoginPass = await bcrypt.hash(sipPass, 10);
      await User.create({
        org_id: organization.id,
        username: `owner_${organization.context_prefix.replace(/_$/, '')}`,
        email: ownerEmail || null,
        full_name: 'Owner',
        extension: '1001',
        role: 'admin',
        status: 'active',
        password_hash: hashedSipLoginPass,
        sip_password: sipPass,
        asterisk_endpoint: `${organization.context_prefix}1001`,
        recording_enabled: true,
        routing_type: 'sip',
        ring_target: 'ext',
      });
      console.log(`✅ Auto-provisioned SIP extension 1001 for org ${organization.name}`);

      // Auto-deploy Asterisk config for the new org
      await configDeploymentService.deployOrganizationConfiguration(organization.id, organization.name);
      await configDeploymentService.reloadAsteriskConfiguration();
      console.log(`✅ Auto-deployed config for new org ${organization.name}`);
    } catch (provErr) {
      console.warn('⚠️ SIP extension auto-provision failed (non-fatal):', provErr.message);
    }

    // Return organization data with plain api_secret only on creation
    const { api_secret: _, ...responseData } = organization.toJSON();
    res.status(201).json({
      ...responseData,
      api_secret: apiSecret
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update organization
app.put('/api/v1/organizations/:id', authenticateOrg, async (req, res) => {
  try {
    const organization = await Organization.findByPk(req.params.id);

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Only allow organization to update its own data
    if (organization.id !== req.orgId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { name, domain, status, settings, limits, contact_info } = req.body;
    const updateData = {};

    // Handle name update with validation
    if (name !== undefined) {
      const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

      if (!namePattern.test(name)) {
        return res.status(400).json({
          error: 'Invalid organization name',
          message: 'Organization name must start and end with alphanumeric characters, contain only letters, numbers, and hyphens, and cannot contain spaces or special characters.'
        });
      }

      if (name.length < 3 || name.length > 50) {
        return res.status(400).json({
          error: 'Invalid organization name length',
          message: 'Organization name must be between 3 and 50 characters long.'
        });
      }

      // Check for duplicate organization name
      const existingOrg = await Organization.findOne({
        where: {
          name: name,
          id: { [require('sequelize').Op.ne]: req.params.id }
        }
      });

      if (existingOrg) {
        return res.status(409).json({
          error: 'Organization name already exists',
          message: `An organization with the name "${name}" already exists. Please choose a different name.`
        });
      }

      updateData.name = name;
    }

    // Handle other fields
    if (domain !== undefined) updateData.domain = domain;
    if (status !== undefined) updateData.status = status;

    // Handle settings update (merge with existing settings)
    if (settings !== undefined) {
      updateData.settings = {
        ...organization.settings,
        ...settings,
        features: {
          ...organization.settings.features,
          ...(settings.features || {})
        }
      };
    }

    // Handle limits update (merge with existing limits)
    if (limits !== undefined) {
      updateData.limits = {
        ...organization.limits,
        ...limits
      };
    }

    // Handle contact_info update (merge with existing contact_info)
    if (contact_info !== undefined) {
      updateData.contact_info = {
        ...organization.contact_info,
        ...contact_info
      };
    }

    await organization.update(updateData);

    const { api_secret, ...orgData } = organization.toJSON();
    res.json(orgData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete organization
app.delete('/api/v1/organizations/:id', authenticateOrg, async (req, res) => {
  try {
    const organization = await Organization.findByPk(req.params.id);

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Only allow organization to delete its own data
    if (organization.id !== req.orgId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await organization.destroy();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin authentication endpoint to get JWT token
app.post('/api/v1/admin/auth', async (req, res) => {
  try {
    const { admin_username, admin_password } = req.body;

    if (!admin_username || !admin_password) {
      return res.status(401).json({
        error: 'Admin credentials required',
        required_fields: ['admin_username', 'admin_password']
      });
    }

    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminUsername || !adminPassword) {
      return res.status(500).json({
        error: 'Admin credentials not configured on server'
      });
    }

    if (admin_username !== adminUsername || admin_password !== adminPassword) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    // Generate JWT token for admin
    const token = jwt.sign(
      {
        isAdmin: true,
        username: admin_username
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      message: 'Admin authenticated successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin endpoint to get organization API credentials (requires admin JWT)
app.get('/api/v1/admin/organizations/:id/credentials', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Admin token required' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }
    } catch (jwtError) {
      return res.status(401).json({ error: 'Invalid admin token' });
    }

    const organization = await Organization.findByPk(req.params.id);

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Generate new plain text API secret and update organization
    const crypto = require('crypto');
    const bcrypt = require('bcrypt');

    const plainTextSecret = `secret_${organization.context_prefix.replace(/[_]/g, '')}${Math.random().toString(36).substring(2, 8)}`;
    const hashedSecret = await bcrypt.hash(plainTextSecret, 10);

    // Update organization with new secret
    await organization.update({ api_secret: hashedSecret });

    // Return the API credentials with plain text secret
    res.json({
      id: organization.id,
      name: organization.name,
      api_key: organization.api_key,
      api_secret_plaintext: plainTextSecret,
      api_secret_hash: hashedSecret,
      note: "Fresh API secret generated. Use api_secret_plaintext for API calls."
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin endpoint to list all organizations (requires admin JWT)
app.get('/api/v1/admin/organizations', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Admin token required' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }
    } catch (jwtError) {
      return res.status(401).json({ error: 'Invalid admin token' });
    }

    // Hide soft-deleted orgs from the admin list. They stay in the DB
    // so historical CDR / ticket records keep their foreign keys.
    const organizations = await Organization.findAll({
      where: { status: { [require('sequelize').Op.ne]: 'deleted' } },
      attributes: ['id', 'name', 'context_prefix', 'api_key', 'status', 'contact_info', 'createdAt']
    });

    res.json(organizations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// ADMIN GLOBAL SETTINGS
// ========================================

/**
 * Get Global PBX Settings
 * Returns all global configuration including PJSIP transport, RTP, codecs, etc.
 */
app.get('/api/v1/admin/settings', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Admin token required' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }
    } catch (jwtError) {
      return res.status(401).json({ error: 'Invalid admin token' });
    }

    // Get settings - there should only be one record
    let settings = await GlobalSettings.findOne();

    // If no settings exist, create default settings
    if (!settings) {
      settings = await GlobalSettings.create({});
    }

    res.json({
      success: true,
      settings: {
        id: settings.id,
        pjsip_transport: settings.pjsip_transport,
        rtp_config: settings.rtp_config,
        sip_global: settings.sip_global,
        codecs: settings.codecs,
        system: settings.system,
        ami_config: settings.ami_config,
        security: settings.security,
        voicemail: settings.voicemail,
        logging: settings.logging,
        features: settings.features,
        custom_config: settings.custom_config,
        last_deployed_at: settings.last_deployed_at,
        deployed_by: settings.deployed_by,
        version: settings.version,
        updated_at: settings.updated_at,
        created_at: settings.created_at
      }
    });

  } catch (error) {
    console.error('❌ Error fetching global settings:', error);
    res.status(500).json({
      error: 'Failed to fetch global settings',
      details: error.message
    });
  }
});

/**
 * Update Global PBX Settings
 * Updates global configuration and optionally deploys to Asterisk
 */
app.put('/api/v1/admin/settings', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Admin token required' });
    }

    let adminUser = 'admin';
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      adminUser = decoded.username || 'admin';
    } catch (jwtError) {
      return res.status(401).json({ error: 'Invalid admin token' });
    }

    const {
      pjsip_transport,
      rtp_config,
      sip_global,
      codecs,
      system,
      ami_config,
      security,
      voicemail,
      logging,
      features,
      custom_config,
      deploy = false  // Whether to immediately deploy to Asterisk
    } = req.body;

    // Get or create settings
    let settings = await GlobalSettings.findOne();
    if (!settings) {
      settings = await GlobalSettings.create({});
    }

    // Prepare update data
    const updateData = {};
    if (pjsip_transport !== undefined) updateData.pjsip_transport = pjsip_transport;
    if (rtp_config !== undefined) updateData.rtp_config = rtp_config;
    if (sip_global !== undefined) updateData.sip_global = sip_global;
    if (codecs !== undefined) updateData.codecs = codecs;
    if (system !== undefined) updateData.system = system;
    if (ami_config !== undefined) updateData.ami_config = ami_config;
    if (security !== undefined) updateData.security = security;
    if (voicemail !== undefined) updateData.voicemail = voicemail;
    if (logging !== undefined) updateData.logging = logging;
    if (features !== undefined) updateData.features = features;
    if (custom_config !== undefined) updateData.custom_config = custom_config;

    // Increment version
    updateData.version = settings.version + 1;

    // Update settings
    await settings.update(updateData);

    // Deploy to Asterisk if requested
    let deployResult = null;
    if (deploy) {
      try {
        const deploymentService = require('./services/deployment/deploymentService');
        // For PUT endpoint, always use reload (no restart option here)
        deployResult = await deploymentService.deployGlobalSettings(settings, { restart: false });

        // Update deployment metadata
        await settings.update({
          last_deployed_at: new Date(),
          deployed_by: adminUser
        });

      } catch (deployError) {
        console.error('❌ Deployment error:', deployError);
        return res.status(500).json({
          error: 'Settings updated but deployment failed',
          settings_version: settings.version,
          deployment_error: deployError.message
        });
      }
    }

    res.json({
      success: true,
      message: deploy ? 'Settings updated and deployed successfully' : 'Settings updated successfully',
      settings: {
        id: settings.id,
        version: settings.version,
        last_deployed_at: settings.last_deployed_at,
        deployed_by: settings.deployed_by
      },
      deployment: deployResult
    });

  } catch (error) {
    console.error('❌ Error updating global settings:', error);
    res.status(500).json({
      error: 'Failed to update global settings',
      details: error.message
    });
  }
});

/**
 * Deploy current global settings to Asterisk
 * Applies the current global configuration to Asterisk via AMI
 * Query param: ?restart=true to perform full Asterisk restart (WARNING: drops all calls)
 */
app.post('/api/v1/admin/settings/deploy', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Admin token required' });
    }

    let adminUser = 'admin';
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      adminUser = decoded.username || 'admin';
    } catch (jwtError) {
      return res.status(401).json({ error: 'Invalid admin token' });
    }

    // Get restart option from query or body
    const restart = req.query.restart === 'true' || req.body.restart === true;

    // Get current settings
    const settings = await GlobalSettings.findOne();
    if (!settings) {
      return res.status(404).json({
        error: 'No global settings found',
        message: 'Please configure settings first'
      });
    }

    // Deploy to Asterisk with restart option
    const deploymentService = require('./services/deployment/deploymentService');
    const deployResult = await deploymentService.deployGlobalSettings(settings, { restart });

    // Update deployment metadata
    await settings.update({
      last_deployed_at: new Date(),
      deployed_by: adminUser
    });

    res.json({
      success: true,
      message: restart
        ? 'Global settings deployed with Asterisk restart (all calls dropped)'
        : 'Global settings deployed with module reload',
      deployment: deployResult,
      settings_version: settings.version,
      deployed_at: settings.last_deployed_at,
      restart_performed: restart,
      warning: restart ? 'Full Asterisk restart performed - all active calls were dropped' : null
    });

  } catch (error) {
    console.error('❌ Error deploying global settings:', error);
    res.status(500).json({
      error: 'Failed to deploy global settings',
      details: error.message
    });
  }
});

// ========================================
// CRM ROUTES
// ========================================
app.use('/api/v1/crm', authenticateOrg, crmRoutes);
app.use('/api/v1/did-pool', authenticateOrg, didPoolRoutes);
app.use('/api/v1/api-keys', authenticateOrg, apiKeyRoutes);
app.use('/api/v1/customer-tunnels', authenticateOrg, customerTunnelRoutes);
app.use('/api/v1/orgs/:orgId/ticket-alerts', authenticateOrg, ticketAlertRoutes);
app.use('/api/v1/admin/whatsapp', adminWhatsappRoutes);

// ========================================
// SIP TRUNK MANAGEMENT
// ========================================

app.get('/api/v1/trunks', authenticateOrg, async (req, res) => {
  try {
    const trunks = await SipTrunk.findAll({
      where: { org_id: req.orgId }
    });

    // Enrich each trunk with live status from Asterisk. The DB's
    // `registration_status` column was never being populated for peer2peer
    // trunks (and unreliable even for outbound), so the editor was showing
    // 'unknown' across the board. The CLI helper does ONE
    // `pjsip show contacts` + ONE `pjsip show registrations`, parses both,
    // and we look up by peer_name (or peer_name + '_aor' to handle the
    // org-trunk vs system-trunk naming split). Errors fall through with
    // live_status=null so the response shape is stable.
    let statuses = null;
    try {
      const cli = new (require('./services/asterisk/cliService'))();
      statuses = await cli.getAllTrunkStatuses();
    } catch (e) {
      console.error('[trunks] live-status fetch failed:', e.message);
    }

    const enriched = trunks.map(t => {
      const data = t.toJSON();
      let live_status = null;
      // DB column is `asterisk_peer_name`, NOT `peer_name`. Easy miss —
      // the model attribute and value are both unintuitive. Org trunks
      // use generated names like `trunk_<orgPrefix>_<suffix>`; pjsip
      // exposes them with `_aor` suffix. System tata_gateway has the
      // bare name. Try both lookups.
      const peerName = data.asterisk_peer_name;
      if (statuses && peerName) {
        const hit = statuses.get(peerName) || statuses.get(`${peerName}_aor`);
        if (hit) live_status = hit;
      }
      return { ...data, live_status };
    });

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/trunks', authenticateOrg, async (req, res) => {
  try {
    const {
      name,
      host,
      username,
      password,
      port = 5060,
      transport = 'udp',
      trunk_type = 'outbound',
      retry_interval = 60,
      expiration = 3600,
      contact_user
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Host is NOT required for inbound type (dynamic registration)
    // Host IS required for outbound and peer2peer types
    if (trunk_type !== 'inbound' && !host) {
      return res.status(400).json({
        error: 'Host is required for outbound and peer2peer trunk types',
        note: 'Inbound trunks do not require host - remote provider registers dynamically'
      });
    }

    // Validate trunk_type
    const validTrunkTypes = ['inbound', 'outbound', 'peer2peer'];
    if (!validTrunkTypes.includes(trunk_type)) {
      return res.status(400).json({
        error: 'Invalid trunk_type',
        valid_types: validTrunkTypes,
        description: {
          inbound: 'Remote provider registers TO our server (they register to us)',
          outbound: 'We register TO remote provider (we initiate registration)',
          peer2peer: 'No registration - SIP OPTIONS keepalive only'
        }
      });
    }

    // Validate required fields based on trunk type
    if (trunk_type === 'inbound' && (!username || !password)) {
      return res.status(400).json({
        error: 'Username and password are required for inbound trunks (for authenticating the remote provider)'
      });
    }

    if (trunk_type === 'outbound' && (!username || !password)) {
      return res.status(400).json({
        error: 'Username and password are required for outbound registration trunks'
      });
    }

    // peer2peer: no authentication required (uses SIP OPTIONS for keepalive)

    // Check trunk limit
    const trunkCount = await SipTrunk.count({ where: { org_id: req.orgId } });
    const maxTrunks = req.organization.settings?.max_trunks || 5;
    if (trunkCount >= maxTrunks) {
      return res.status(403).json({
        error: 'Trunk limit reached',
        current: trunkCount,
        limit: maxTrunks
      });
    }

    // Normalize host:port — users often paste "sip.provider.com:5060"
    // into the Host field. Without this, host gets stored verbatim and
    // the deploy renders "host:5060:5060" because port is appended
    // again from the separate port column. The port encoded in host
    // wins; if absent we keep the explicit port value.
    let normalizedHost = host || null;
    let normalizedPort = port;
    if (normalizedHost && typeof normalizedHost === 'string') {
      const colonIdx = normalizedHost.lastIndexOf(':');
      if (colonIdx > 0) {
        const hostPart = normalizedHost.slice(0, colonIdx);
        const portPart = normalizedHost.slice(colonIdx + 1);
        const parsedPort = parseInt(portPart, 10);
        if (Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
          normalizedHost = hostPart;
          normalizedPort = parsedPort;
        }
      }
    }

    const trunk = await SipTrunk.create({
      org_id: req.orgId,
      name,
      host: trunk_type === 'inbound' ? null : normalizedHost,
      port: trunk_type === 'inbound' ? null : normalizedPort,
      username,
      password,
      transport,
      trunk_type,
      retry_interval: trunk_type === 'outbound' ? retry_interval : null,
      expiration: trunk_type === 'outbound' ? expiration : null,
      contact_user: trunk_type === 'outbound' ? (contact_user || username) : null,
      asterisk_peer_name: `${req.organization.context_prefix}trunk${Date.now()}`,
      status: 'active'
    });

    // Auto-deploy: a brand-new trunk does nothing until asterisk knows
    // about it. Without this the dashboard shows the row with
    // status=active but pjsip has no endpoint for it. Errors here are
    // non-fatal — the trunk row is already saved; the operator can
    // re-deploy via /api/v1/config/deploy if reload fails.
    try {
      await configDeploymentService.deployOrganizationConfiguration(req.orgId, req.organization.name);
      await configDeploymentService.reloadAsteriskConfiguration();
    } catch (deployErr) {
      console.warn('⚠️  Trunk created but auto-deploy failed:', deployErr.message);
    }

    res.status(201).json(trunk);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/trunks/:id', authenticateOrg, async (req, res) => {
  try {
    const trunk = await SipTrunk.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!trunk) {
      return res.status(404).json({ error: 'Trunk not found' });
    }

    res.json(trunk);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/v1/trunks/:id', authenticateOrg, async (req, res) => {
  try {
    const trunk = await SipTrunk.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!trunk) {
      return res.status(404).json({ error: 'Trunk not found' });
    }

    const allowedFields = ['name', 'host', 'port', 'username', 'password', 'transport', 'status', 'max_channels', 'trunk_type', 'retry_interval', 'expiration', 'contact_user'];
    const updateData = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    // Validate trunk_type if being updated
    if (updateData.trunk_type) {
      const validTrunkTypes = ['inbound', 'outbound', 'peer2peer'];
      if (!validTrunkTypes.includes(updateData.trunk_type)) {
        return res.status(400).json({
          error: 'Invalid trunk_type',
          valid_types: validTrunkTypes
        });
      }
    }

    await trunk.update(updateData);
    res.json(trunk);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/v1/trunks/:id', authenticateOrg, async (req, res) => {
  try {
    const trunk = await SipTrunk.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!trunk) {
      return res.status(404).json({ error: 'Trunk not found' });
    }

    await trunk.destroy();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// DID NUMBER MANAGEMENT
// ========================================

app.get('/api/v1/dids', authenticateOrg, async (req, res) => {
  try {
    const dids = await DidNumber.findAll({
      where: { org_id: req.orgId },
      include: [{
        model: SipTrunk,
        as: 'trunk',
        attributes: ['name', 'host']
      }]
    });
    res.json(dids);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/dids/:id', authenticateOrg, async (req, res) => {
  try {
    const did = await DidNumber.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      },
      include: [{
        model: SipTrunk,
        as: 'trunk',
        attributes: ['name', 'host']
      }]
    });

    if (!did) {
      return res.status(404).json({ error: 'DID not found' });
    }

    res.json(did);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/dids', authenticateOrg, async (req, res) => {
  try {
    const { number, trunk_id, description, routing_type, routing_destination, recording_enabled = true } = req.body;

    if (!number || !trunk_id || !routing_type || !routing_destination) {
      return res.status(400).json({ error: 'Required fields missing' });
    }

    // Check DID limit
    const didCount = await DidNumber.count({ where: { org_id: req.orgId } });
    const maxDids = req.organization.settings?.max_dids || 10;
    if (didCount >= maxDids) {
      return res.status(403).json({
        error: 'DID limit reached',
        current: didCount,
        limit: maxDids
      });
    }

    // Verify trunk belongs to organization
    const trunk = await SipTrunk.findOne({
      where: {
        id: trunk_id,
        org_id: req.orgId
      }
    });

    if (!trunk) {
      return res.status(400).json({ error: 'Invalid trunk' });
    }

    const did = await DidNumber.create({
      org_id: req.orgId,
      trunk_id,
      number,
      description,
      routing_type,
      routing_destination,
      recording_enabled,
      status: 'active'
    });

    res.status(201).json(did);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/v1/dids/:id', authenticateOrg, async (req, res) => {
  try {
    const did = await DidNumber.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!did) {
      return res.status(404).json({ error: 'DID not found' });
    }

    const allowedFields = ['description', 'routing_type', 'routing_destination', 'recording_enabled', 'status'];
    const updateData = {};

    // If trunk_id is being updated, verify it belongs to organization
    if (req.body.trunk_id) {
      const trunk = await SipTrunk.findOne({
        where: {
          id: req.body.trunk_id,
          org_id: req.orgId
        }
      });
      if (!trunk) {
        return res.status(400).json({ error: 'Invalid trunk' });
      }
      updateData.trunk_id = req.body.trunk_id;
    }

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    await did.update(updateData);

    // Auto-deploy config when routing changes
    if (updateData.routing_type || updateData.routing_destination) {
      try {
        await configDeploymentService.deployOrganizationConfiguration(req.orgId, req.organization.name);
        await configDeploymentService.reloadAsteriskConfiguration();
      } catch (deployErr) { console.warn('⚠️ Auto-deploy after DID update:', deployErr.message); }
    }

    res.json(did);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/v1/dids/:id/routing', authenticateOrg, async (req, res) => {
  try {
    const did = await DidNumber.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!did) {
      return res.status(404).json({ error: 'DID not found' });
    }

    const { routing_type, routing_destination } = req.body;
    if (!routing_type || !routing_destination) {
      return res.status(400).json({ error: 'Routing type and destination required' });
    }

    await did.update({ routing_type, routing_destination });

    // Auto-deploy config when routing changes
    try {
      await configDeploymentService.deployOrganizationConfiguration(req.orgId, req.organization.name);
      await configDeploymentService.reloadAsteriskConfiguration();
    } catch (deployErr) { console.warn('⚠️ Auto-deploy after DID routing:', deployErr.message); }

    res.json(did);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/v1/dids/:id', authenticateOrg, async (req, res) => {
  try {
    const did = await DidNumber.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!did) {
      return res.status(404).json({ error: 'DID not found' });
    }

    await did.destroy();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// CALL ROUTING
// ========================================

app.post('/api/v1/routing', authenticateOrg, (req, res) => {
  const { destination_type, destination, conditions = {} } = req.body;

  if (!destination_type || !destination) {
    return res.status(400).json({ error: 'Destination type and destination required' });
  }

  const ruleId = uuidv4();
  const rule = {
    id: ruleId,
    org_id: req.orgId,
    destination_type,
    destination,
    conditions,
    priority: req.body.priority || 100,
    active: true,
    created_at: new Date().toISOString()
  };

  db.routingRules.set(ruleId, rule);

  res.status(201).json(rule);
});

// ========================================
// USER MANAGEMENT
// ========================================

app.get('/api/v1/users', authenticateOrg, async (req, res) => {
  try {
    const users = await User.findAll({
      where: { org_id: req.orgId },
      attributes: { exclude: ['password_hash', 'sip_password'] }
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/users/registrations
 *
 * Returns the live PJSIP registration state for every user in the org.
 * Joins the DB user list with the parsed `pjsip show contacts` map.
 *
 * Cached: the underlying Asterisk CLI call is memoized for 30s, so a
 * heavy editor (24 users × 30s polling = ~50 calls/min/operator) sees
 * the same Map without re-shelling. Pass `?force=1` to bypass.
 *
 * Response shape: array of
 *   { user_id, extension, asterisk_endpoint, registered, status,
 *     contact_ip, contact_port, rtt_ms, last_check_at }
 *
 * - registered: boolean — true iff status is 'reachable' or 'nonqual'
 *   (NonQual means the contact is registered but qualify hasn't completed,
 *   typically a NAT-keepalive gap). False if absent from Asterisk OR
 *   status is 'unreachable'.
 * - status: 'reachable' | 'unreachable' | 'nonqual' | 'unregistered'
 *
 * Must be defined BEFORE /api/v1/users/:id because Express matches in
 * registration order; otherwise "registrations" would be matched as
 * an `:id` parameter.
 */
app.get('/api/v1/users/registrations', authenticateOrg, async (req, res) => {
  // Look up users FIRST so we can always return a per-user row even when
  // Asterisk is unreachable (gracefully-degraded response — see below).
  let userRows;
  try {
    userRows = await User.findAll({
      where: { org_id: req.orgId },
      attributes: ['id', 'extension', 'asterisk_endpoint']
    });
  } catch (dbErr) {
    console.error('GET /api/v1/users/registrations: DB query failed:', dbErr);
    return res.status(500).json({ error: dbErr.message });
  }

  const pjsipRegSvc = require('./services/asterisk/pjsipRegistrationsService');
  const force = req.query.force === '1' || req.query.force === 'true';
  let map;
  let fetchedAt;
  let fromCache = false;
  let asteriskUnreachable = false;
  let asteriskError = null;
  try {
    const result = await pjsipRegSvc.getAllUserRegistrations({ force });
    map = result.map;
    fetchedAt = result.fetchedAt;
    fromCache = result.fromCache;
  } catch (asteriskErr) {
    // Asterisk CLI unreachable (dev env without Asterisk, transient outage,
    // pjsip module not loaded). Return a 200 with `asterisk_unreachable:true`
    // and ALL users marked unknown — frontend can show a degraded banner
    // instead of falsely showing all dots green from stale data. (UAT review
    // of PR B flagged this as the most important fix — silent failure during
    // a BSNL/Rail incident would mislead the operator into thinking all
    // phones are healthy.)
    console.error('GET /api/v1/users/registrations: Asterisk query failed:', asteriskErr);
    map = new Map();
    fetchedAt = Date.now();
    asteriskUnreachable = true;
    asteriskError = asteriskErr.message;
  }

  const rows = userRows.map((u) => {
    // PJSIP endpoint name = the stored `asterisk_endpoint` field, written
    // at user create/update time. The model enforces non-null so we trust
    // it (no fallback construction — earlier versions had a dead-code
    // fallback that was unreachable AND would have mis-matched if it
    // ever fired due to inconsistent prefix conventions across routes).
    const endpointName = u.asterisk_endpoint;
    const reg = map.get(endpointName);
    if (!reg) {
      return {
        user_id: u.id,
        extension: u.extension,
        asterisk_endpoint: endpointName,
        // When Asterisk is unreachable, status is "unknown" — distinct
        // from "unregistered" which means Asterisk says no contact exists.
        registered: false,
        status: asteriskUnreachable ? 'unknown' : 'unregistered',
        contact_ip: null,
        contact_port: null,
        rtt_ms: null,
        last_check_at: new Date(fetchedAt).toISOString()
      };
    }
    return {
      user_id: u.id,
      extension: u.extension,
      asterisk_endpoint: endpointName,
      registered: reg.status === 'reachable' || reg.status === 'nonqual',
      status: reg.status,
      contact_ip: reg.contact_ip,
      contact_port: reg.contact_port,
      rtt_ms: reg.rtt_ms,
      last_check_at: new Date(fetchedAt).toISOString()
    };
  });

  res.json({
    registrations: rows,
    fetched_at: new Date(fetchedAt).toISOString(),
    from_cache: fromCache,
    count: rows.length,
    // Surface to the frontend whether the underlying Asterisk query
    // worked. Frontend renders a degraded-state banner when this is true
    // so the operator knows the dots they're looking at are unknown,
    // not authoritatively "unregistered".
    asterisk_unreachable: asteriskUnreachable,
    asterisk_error: asteriskError
  });
});

app.get('/api/v1/users/:id', authenticateOrg, async (req, res) => {
  try {
    const user = await User.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      },
      attributes: { exclude: ['password_hash', 'sip_password'] }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/users', authenticateOrg, async (req, res) => {
  try {
    const {
      extension, username, password, full_name, email, role = 'agent',
      // Optional routing fields — were silently dropped before this fix,
      // causing editor "Phone" / "AI agent" routing selections to revert to
      // the model defaults (ring_target='ext', routing_type='sip') the
      // moment the user list refreshed.
      phone_number, ring_target, routing_type, routing_destination,
    } = req.body;

    if (!extension || !username || !password || !email) {
      return res.status(400).json({ error: 'Required fields missing' });
    }

    // Check user limit
    const userCount = await User.count({ where: { org_id: req.orgId } });
    const maxUsers = req.organization.settings?.max_users || 50;
    if (userCount >= maxUsers) {
      return res.status(403).json({
        error: 'User limit reached',
        current: userCount,
        limit: maxUsers
      });
    }

    // Check if extension already exists for this org
    const existingUser = await User.findOne({
      where: {
        org_id: req.orgId,
        extension: extension
      }
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Extension already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const sipPassword = uuidv4().substring(0, 12);

    const user = await User.create({
      org_id: req.orgId,
      username,
      email,
      password_hash: hashedPassword,
      extension,
      full_name,
      role,
      asterisk_endpoint: `${req.organization.context_prefix}_${extension}`,
      sip_password: sipPassword,
      status: 'active',
      recording_enabled: req.organization.recording_enabled,
      // Only include each routing field if the client explicitly sent it,
      // so omitting them preserves the model's defaults rather than
      // overwriting with undefined.
      ...(phone_number !== undefined && { phone_number }),
      ...(ring_target !== undefined && { ring_target }),
      ...(routing_type !== undefined && { routing_type }),
      ...(routing_destination !== undefined && { routing_destination }),
    });

    // Return user data excluding sensitive fields but include SIP password on creation
    const { password_hash, ...userData } = user.toJSON();
    res.status(201).json(userData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/v1/users/:id', authenticateOrg, async (req, res) => {
  try {
    const user = await User.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const allowedFields = [
      'username', 'email', 'full_name', 'role', 'status', 'recording_enabled',
      'phone_number', 'ring_target', 'routing_type', 'routing_destination'
      // failover_destination_user_id, failover_timeout_seconds — handled
      // separately below (need DB validation for same-org constraint
      // + numeric bounds, so they can't go through the generic loop)
    ];
    const updateData = {};

    // failover_destination_user_id — must reference a user in the SAME
    // org (FK alone doesn't catch cross-org refs). NULL clears the
    // failover. Self-loop is forbidden (single-hop semantic means
    // pointing at yourself is meaningless and would risk dialplan
    // ambiguity). Target must be SIP-routed with ring_target='ext':
    // mobile-callout and AI-agent targets fail silently in the dialplan
    // (Dial(PJSIP/<them>) → CHANUNAVAIL → fall-through announce), which
    // the operator never expects — so we reject those at the API.
    if (req.body.failover_destination_user_id !== undefined) {
      const fid = req.body.failover_destination_user_id;
      if (fid === null || fid === '') {
        updateData.failover_destination_user_id = null;
      } else if (typeof fid !== 'string') {
        return res.status(400).json({ error: 'Failover destination must be a user ID (UUID) or empty' });
      } else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fid)) {
        // Defensive: avoid letting a malformed string hit the UUID column
        // and explode in Sequelize → caught-500. Surface a clean 400.
        return res.status(400).json({ error: 'Failover destination is not a valid user ID' });
      } else {
        if (fid === user.id) {
          return res.status(400).json({ error: 'Failover destination cannot be the same user (self-loop forbidden)' });
        }
        const failoverUser = await User.findOne({
          where: { id: fid, org_id: req.orgId },
          attributes: ['id', 'routing_type', 'ring_target', 'asterisk_endpoint', 'extension']
        });
        if (!failoverUser) {
          return res.status(400).json({
            error: 'Failover destination must be a user in your organization'
          });
        }
        if (failoverUser.routing_type !== 'sip' || failoverUser.ring_target !== 'ext') {
          return res.status(400).json({
            error: `Failover destination must be a SIP/IP-Phone user. Extension ${failoverUser.extension} routes to ${failoverUser.routing_type === 'ai_agent' ? 'an AI agent' : 'an external phone number'} and cannot receive failover calls.`
          });
        }
        if (!failoverUser.asterisk_endpoint) {
          return res.status(400).json({
            error: `Failover destination (extension ${failoverUser.extension}) is missing a SIP endpoint and cannot receive failover calls.`
          });
        }
        updateData.failover_destination_user_id = fid;
      }
    }

    // failover_phone_number — external phone (E.164-ish with optional
    // +91 prefix + 10 digits). Mutually exclusive with the user-ID
    // destination: an operator picks ONE of (SIP user, phone). Both
    // null = no failover.
    //
    // We strip non-digit characters and take the trailing 10 digits at
    // store time (matching the existing ring_target='phone' shape in
    // the dialplan generator), but ONLY if the input is recognisable
    // as a phone number — anything that doesn't parse to 10 digits
    // gets rejected with 400 so the operator finds out at save time,
    // not at call time.
    if (req.body.failover_phone_number !== undefined) {
      const raw = req.body.failover_phone_number;
      if (raw === null || raw === '') {
        updateData.failover_phone_number = null;
      } else if (typeof raw !== 'string') {
        return res.status(400).json({ error: 'Failover phone number must be a string' });
      } else {
        const digits = String(raw).replace(/[^0-9]/g, '');
        if (digits.length < 10 || digits.length > 13) {
          return res.status(400).json({
            error: 'Failover phone number must contain 10 digits (with an optional +91 country code).'
          });
        }
        // Store as +91XXXXXXXXXX (E.164) for consistency. The dialplan
        // generator strips back to 10 digits when emitting Dial().
        const last10 = digits.slice(-10);
        updateData.failover_phone_number = `+91${last10}`;
      }
    }

    // Mutual exclusion: at most one of user-ID / phone-number may be
    // set. Compute "effective after this request" values for both
    // fields — if the request didn't touch a field, fall back to the
    // current stored value — then reject if both are non-null.
    const effectiveUserId = updateData.failover_destination_user_id !== undefined
      ? updateData.failover_destination_user_id
      : user.failover_destination_user_id;
    const effectivePhone = updateData.failover_phone_number !== undefined
      ? updateData.failover_phone_number
      : user.failover_phone_number;
    if (effectiveUserId && effectivePhone) {
      return res.status(400).json({
        error: 'Failover destination must be either a SIP user OR a phone number, not both. Clear one before setting the other.'
      });
    }

    // failover_timeout_seconds — bounded 5..120. Lower = more responsive
    // failover but less chance for the primary to answer.
    if (req.body.failover_timeout_seconds !== undefined) {
      const t = Number(req.body.failover_timeout_seconds);
      if (!Number.isInteger(t) || t < 5 || t > 120) {
        return res.status(400).json({
          error: 'Failover timeout (seconds) must be a whole number between 5 and 120'
        });
      }
      updateData.failover_timeout_seconds = t;
    }

    // outbound_did: must be a DID assigned to this org (or explicit null to clear)
    if (req.body.outbound_did !== undefined) {
      if (req.body.outbound_did === null || req.body.outbound_did === '') {
        updateData.outbound_did = null;
      } else {
        const wantNum = String(req.body.outbound_did).trim();
        const [row] = await sequelize.query(
          "SELECT number FROM did_numbers WHERE org_id=? AND number=? AND pool_status='assigned' AND status='active' LIMIT 1",
          { replacements: [req.orgId, wantNum], type: sequelize.QueryTypes.SELECT }
        );
        if (!row) {
          return res.status(400).json({ error: `outbound_did ${wantNum} is not assigned to your organization` });
        }
        updateData.outbound_did = wantNum;
      }
    }

    // Handle password update separately
    if (req.body.password) {
      updateData.password_hash = await bcrypt.hash(req.body.password, 10);
    }

    // Handle extension update (check for conflicts)
    if (req.body.extension && req.body.extension !== user.extension) {
      const existingUser = await User.findOne({
        where: {
          org_id: req.orgId,
          extension: req.body.extension,
          id: { [require('sequelize').Op.ne]: user.id }
        }
      });

      if (existingUser) {
        return res.status(409).json({ error: 'Extension already exists' });
      }

      updateData.extension = req.body.extension;
      updateData.asterisk_endpoint = `${req.organization.context_prefix}_${req.body.extension}`;
    }

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    const prevStatus = user.status;
    await user.update(updateData);

    // Off-shift flow: when an agent's status flips, regenerate the org's
    // queue config. The generator's `member =>` emit skips users whose
    // status !== 'active', so the flip needs to land in queues.conf or
    // Asterisk will keep ringing (or keep ignoring) the previous state.
    if (updateData.status !== undefined && updateData.status !== prevStatus) {
      try {
        await configDeploymentService.deployOrganizationConfiguration(req.orgId, req.organization.name);
        await configDeploymentService.reloadAsteriskConfiguration();
      } catch (deployErr) {
        console.warn('⚠️ Auto-deploy after user status change:', deployErr.message);
      }
    }

    // Return updated user without sensitive fields
    const { password_hash, sip_password, ...userData } = user.toJSON();
    res.json(userData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update only the routing fields of a user. The editor calls this from
// handleEdit() after the main PUT, so the main PUT can stick to identity
// fields (name/email/role) while routing has its own dedicated endpoint
// that mirrors PUT /api/v1/dids/:id/routing.
app.put('/api/v1/users/:id/routing', authenticateOrg, async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.id, org_id: req.orgId }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { routing_type, routing_destination, ring_target, phone_number } = req.body;

    const updateData = {};
    if (routing_type !== undefined) updateData.routing_type = routing_type;
    if (routing_destination !== undefined) {
      updateData.routing_destination = routing_destination || null;
    }
    if (ring_target !== undefined) updateData.ring_target = ring_target;
    if (phone_number !== undefined) updateData.phone_number = phone_number || null;

    // ring_target='phone' is meaningless without a phone_number — reject early
    // rather than silently saving an unreachable route.
    const finalRingTarget = updateData.ring_target ?? user.ring_target;
    const finalPhoneNumber = updateData.phone_number ?? user.phone_number;
    if (finalRingTarget === 'phone' && !finalPhoneNumber) {
      return res.status(400).json({
        error: 'phone_number is required when ring_target is "phone"'
      });
    }

    await user.update(updateData);

    const { password_hash, sip_password, ...userData } = user.toJSON();
    res.json(userData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/v1/users/:id', authenticateOrg, async (req, res) => {
  try {
    const user = await User.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await user.destroy();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// QUEUE MANAGEMENT
// ========================================

app.get('/api/v1/queues', authenticateOrg, async (req, res) => {
  try {
    const queues = await Queue.findAll({
      where: { org_id: req.orgId },
      include: [{
        model: QueueMember,
        as: 'members',
        include: [{
          model: User,
          as: 'user',
          attributes: ['id', 'full_name', 'extension', 'status']
        }]
      }]
    });
    res.json(queues);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/queues/:id', authenticateOrg, async (req, res) => {
  try {
    const queue = await Queue.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      },
      include: [{
        model: QueueMember,
        as: 'members',
        include: [{
          model: User,
          as: 'user',
          attributes: ['id', 'full_name', 'extension', 'status']
        }]
      }]
    });

    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    res.json(queue);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/queues', authenticateOrg, async (req, res) => {
  try {
    const {
      name,
      number,
      strategy = 'ringall',
      timeout = 30,
      retry = 5,
      music_on_hold = 'default',
      recording_enabled = true
    } = req.body;

    if (!name || !number) {
      return res.status(400).json({ error: 'Name and number required' });
    }

    // Check queue limit
    const queueCount = await Queue.count({ where: { org_id: req.orgId } });
    const maxQueues = req.organization.settings?.max_queues || 10;
    if (queueCount >= maxQueues) {
      return res.status(403).json({
        error: 'Queue limit reached',
        current: queueCount,
        limit: maxQueues
      });
    }

    // Check if queue number already exists for this org
    const existingQueue = await Queue.findOne({
      where: {
        org_id: req.orgId,
        number: number
      }
    });

    if (existingQueue) {
      return res.status(409).json({ error: 'Queue number already exists' });
    }

    const queue = await Queue.create({
      org_id: req.orgId,
      name,
      number,
      strategy,
      timeout,
      retry,
      music_on_hold,
      asterisk_queue_name: `${req.organization.context_prefix}${number}`,
      recording_enabled,
      active: true
    });

    res.status(201).json(queue);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/v1/queues/:id', authenticateOrg, async (req, res) => {
  try {
    const queue = await Queue.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    const allowedFields = [
      'name', 'strategy', 'timeout', 'retry', 'music_on_hold', 'recording_enabled', 'active', 'status',
      'max_wait_time', 'wrap_up_time', 'weight', 'max_callers', 'max_len',
      'greeting_id', 'periodic_announce', 'periodic_announce_frequency',
      'min_announce_frequency', 'relative_periodic_announce',
      'ring_sound', 'announce_frequency', 'announce_holdtime',
      'announce_position', 'announce_position_limit', 'announce_round_seconds',
      'autopause', 'autopausedelay', 'autopausebusy', 'autopauseunavail',
      'service_level', 'timeoutpriority', 'memberdelay',
      'join_empty', 'leave_when_empty', 'ring_inuse', 'ringinuse', 'reportholdtime',
      'queue_youarenext', 'queue_thereare', 'queue_callswaiting', 'queue_holdtime',
      'queue_minutes', 'queue_seconds', 'queue_thankyou', 'queue_reporthold',
      'timeout_destination', 'timeout_destination_type'
    ];
    const updateData = {};

    // Handle number update (check for conflicts)
    if (req.body.number && req.body.number !== queue.number) {
      const existingQueue = await Queue.findOne({
        where: {
          org_id: req.orgId,
          number: req.body.number,
          id: { [require('sequelize').Op.ne]: queue.id }
        }
      });

      if (existingQueue) {
        return res.status(409).json({ error: 'Queue number already exists' });
      }

      updateData.number = req.body.number;
      updateData.asterisk_queue_name = `${req.organization.context_prefix}${req.body.number}`;
    }

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    // If greeting_id was provided, resolve to a periodic_announce path Asterisk understands.
    // Asterisk's periodic-announce wants a path relative to /var/lib/asterisk/sounds with no extension.
    // Greeting files live at /var/lib/asterisk/sounds/greetings/<audio_file>, so the path is "greetings/<basename>".
    if (req.body.greeting_id !== undefined) {
      if (req.body.greeting_id) {
        try {
          const greetingRows = await sequelize.query(
            'SELECT audio_file FROM greetings WHERE id = ? AND org_id = ?',
            { replacements: [req.body.greeting_id, req.orgId], type: sequelize.QueryTypes.SELECT }
          );
          if (greetingRows && greetingRows[0] && greetingRows[0].audio_file) {
            const fname = String(greetingRows[0].audio_file).replace(/\.(wav|gsm|ulaw|alaw|sln)$/i, '');
            updateData.periodic_announce = `greetings/${fname}`;
          }
        } catch (e) { console.error('Greeting lookup failed:', e.message); }
      } else {
        updateData.periodic_announce = null;
      }
    }

    await queue.update(updateData);

    // Redeploy organization config so Asterisk picks up the new queue settings
    try {
      const organization = await Organization.findByPk(req.orgId);
      await configDeploymentService.deployOrganizationConfiguration(req.orgId, organization.name);
      // Reload Asterisk so the new dialplan/queues files take effect in memory
      await configDeploymentService.reloadAsteriskConfiguration();
      console.log(`✅ Configuration deployed + Asterisk reloaded for org ${organization.name} after queue update`);
    } catch (deployError) {
      console.error('⚠️  Failed to deploy/reload configuration after queue update:', deployError.message);
    }

    res.json(queue);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/v1/queues/:id', authenticateOrg, async (req, res) => {
  try {
    const queue = await Queue.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    await queue.destroy();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/queues/:id/members', authenticateOrg, async (req, res) => {
  try {
    const queue = await Queue.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    // Accept either { user_id } (single, legacy) or { user_ids: [...] } (batch).
    // `ring_timeout_seconds` is optional (5-300); model defaults to 20.
    const { user_id, user_ids, penalty = 0, ring_timeout_seconds } = req.body;
    const requestedIds = Array.isArray(user_ids)
      ? user_ids.filter(Boolean)
      : (user_id ? [user_id] : []);

    if (requestedIds.length === 0) {
      return res.status(400).json({ error: 'user_id or user_ids required' });
    }

    // Validate all requested users belong to the org in a single query
    const validUsers = await User.findAll({
      where: {
        id: requestedIds,
        org_id: req.orgId
      }
    });
    const validUserIds = new Set(validUsers.map(u => u.id));
    const invalidIds = requestedIds.filter(id => !validUserIds.has(id));

    // Find any existing memberships so we can skip them instead of erroring out the whole batch
    const existingMembers = await QueueMember.findAll({
      where: {
        queue_id: req.params.id,
        user_id: requestedIds
      }
    });
    const existingUserIds = new Set(existingMembers.map(m => m.user_id));

    // Create members for valid + non-existing users
    const created = [];
    const skipped = [];
    for (const uid of requestedIds) {
      if (!validUserIds.has(uid)) {
        skipped.push({ user_id: uid, reason: 'invalid_user' });
        continue;
      }
      if (existingUserIds.has(uid)) {
        skipped.push({ user_id: uid, reason: 'already_member' });
        continue;
      }
      try {
        // ring_timeout_seconds is honored only when the caller passes a
        // valid integer; Sequelize validates 5-300 and defaults to 20.
        const member = await QueueMember.create({
          queue_id: req.params.id,
          user_id: uid,
          penalty,
          paused: false,
          ring_timeout_seconds: Number.isInteger(ring_timeout_seconds)
            ? ring_timeout_seconds
            : undefined
        });
        created.push(member);
      } catch (e) {
        skipped.push({ user_id: uid, reason: 'create_failed', error: e.message });
      }
    }

    // Deploy organization configuration ONCE after all members are added
    if (created.length > 0) {
      try {
        const organization = await Organization.findByPk(req.orgId);
        await configDeploymentService.deployOrganizationConfiguration(req.orgId, organization.name);
        await configDeploymentService.reloadAsteriskConfiguration();
        console.log(`✅ Configuration deployed + Asterisk reloaded for org ${organization.name} after adding ${created.length} queue member(s)`);
      } catch (deployError) {
        console.error('⚠️  Failed to deploy/reload configuration after adding queue members:', deployError.message);
      }
    }

    // Backwards-compat: if a single user_id was sent and exactly one member created, return that member directly
    if (user_id && !user_ids && created.length === 1) {
      return res.status(201).json(created[0]);
    }
    // If nothing was created, surface the first failure reason as a 4xx
    if (created.length === 0) {
      const firstSkip = skipped[0] || {};
      const status = firstSkip.reason === 'already_member' ? 409 : 400;
      return res.status(status).json({ error: firstSkip.reason || 'no_members_created', skipped });
    }
    res.status(201).json({ created, skipped });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a queue member's penalty (priority) and/or ring_timeout_seconds.
// Either field may be sent independently. After the update, the org's
// config is redeployed and Asterisk reloaded so the new value lands on
// active queues without restart.
app.patch('/api/v1/queues/:queueId/members/:userId', authenticateOrg, async (req, res) => {
  try {
    const queue = await Queue.findOne({
      where: { id: req.params.queueId, org_id: req.orgId }
    });
    if (!queue) return res.status(404).json({ error: 'Queue not found' });

    const { penalty, ring_timeout_seconds } = req.body || {};
    const updates = {};
    if (penalty !== undefined) {
      const p = Number(penalty);
      if (!Number.isInteger(p) || p < 0 || p > 10) {
        return res.status(400).json({ error: 'penalty must be an integer 0-10' });
      }
      updates.penalty = p;
    }
    if (ring_timeout_seconds !== undefined) {
      const r = Number(ring_timeout_seconds);
      if (!Number.isInteger(r) || r < 5 || r > 300) {
        return res.status(400).json({ error: 'ring_timeout_seconds must be an integer 5-300' });
      }
      updates.ring_timeout_seconds = r;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'no updatable fields in request body' });
    }

    const member = await QueueMember.findOne({
      where: { queue_id: req.params.queueId, user_id: req.params.userId }
    });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    await member.update(updates);

    // Redeploy + reload so the per-member ring time / penalty takes
    // effect on Asterisk immediately. Failure here is logged but does
    // not roll back the DB update — the next deploy will pick it up.
    try {
      const organization = await Organization.findByPk(req.orgId);
      await configDeploymentService.deployOrganizationConfiguration(req.orgId, organization.name);
      await configDeploymentService.reloadAsteriskConfiguration();
      console.log(`✅ Configuration deployed + Asterisk reloaded after updating queue member ${member.id}`);
    } catch (deployError) {
      console.error('⚠️  Failed to deploy/reload after queue-member update:', deployError.message);
    }

    res.json({ success: true, queue_member: member });
  } catch (error) {
    console.error('Error updating queue member:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/v1/queues/:queueId/members', authenticateOrg, async (req, res) => {
  try {
    const queue = await Queue.findOne({
      where: {
        id: req.params.queueId,
        org_id: req.orgId
      }
    });

    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const member = await QueueMember.findOne({
      where: {
        queue_id: req.params.queueId,
        user_id: userId
      }
    });

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    await member.destroy();

    // Redeploy organization config so Asterisk drops the member from the live queue
    try {
      const organization = await Organization.findByPk(req.orgId);
      await configDeploymentService.deployOrganizationConfiguration(req.orgId, organization.name);
      await configDeploymentService.reloadAsteriskConfiguration();
      console.log(`✅ Configuration deployed + Asterisk reloaded for org ${organization.name} after removing queue member`);
    } catch (deployError) {
      console.error('⚠️  Failed to deploy/reload configuration after removing queue member:', deployError.message);
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/v1/queues/:id/music', authenticateOrg, async (req, res) => {
  try {
    const queue = await Queue.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    const { music_on_hold } = req.body;
    const updateData = {};

    if (music_on_hold !== undefined) {
      updateData.music_on_hold = music_on_hold;
    }

    await queue.update(updateData);
    res.json(queue);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===================================
// Outbound Route Management
// ===================================

// List all outbound routes
app.get('/api/v1/outbound-routes', authenticateOrg, async (req, res) => {
  try {
    const routes = await OutboundRoute.findAll({
      where: { org_id: req.orgId },
      include: [
        { model: SipTrunk, as: 'trunk', attributes: ['id', 'name', 'asterisk_peer_name', 'host', 'status'] }
      ],
      order: [['priority', 'ASC']]
    });
    res.json(routes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get specific outbound route
app.get('/api/v1/outbound-routes/:id', authenticateOrg, async (req, res) => {
  try {
    const route = await OutboundRoute.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      },
      include: [
        { model: SipTrunk, as: 'trunk' }
      ]
    });

    if (!route) {
      return res.status(404).json({ error: 'Outbound route not found' });
    }

    res.json(route);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create outbound route
app.post('/api/v1/outbound-routes', authenticateOrg, async (req, res) => {
  try {
    const {
      name,
      description,
      trunk_id,
      dial_pattern,
      dial_prefix,
      strip_digits,
      prepend_digits,
      caller_id_override,
      caller_id_name_override,
      recording_enabled,
      max_channels,
      route_type,
      priority,
      time_conditions,
      user_permissions
    } = req.body;

    // Verify trunk belongs to organization
    const trunk = await SipTrunk.findOne({
      where: {
        id: trunk_id,
        org_id: req.orgId
      }
    });

    if (!trunk) {
      return res.status(404).json({ error: 'SIP trunk not found or does not belong to organization' });
    }

    const route = await OutboundRoute.create({
      org_id: req.orgId,
      name,
      description,
      trunk_id,
      dial_pattern,
      dial_prefix,
      strip_digits: strip_digits || 0,
      prepend_digits,
      caller_id_override,
      caller_id_name_override,
      recording_enabled: recording_enabled !== false,
      max_channels,
      route_type: route_type || 'custom',
      priority: priority || 10,
      time_conditions,
      user_permissions,
      status: 'active'
    });

    const createdRoute = await OutboundRoute.findByPk(route.id, {
      include: [{ model: SipTrunk, as: 'trunk' }]
    });

    res.status(201).json(createdRoute);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update outbound route
app.put('/api/v1/outbound-routes/:id', authenticateOrg, async (req, res) => {
  try {
    const route = await OutboundRoute.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!route) {
      return res.status(404).json({ error: 'Outbound route not found' });
    }

    const {
      name,
      description,
      trunk_id,
      dial_pattern,
      dial_prefix,
      strip_digits,
      prepend_digits,
      caller_id_override,
      caller_id_name_override,
      recording_enabled,
      max_channels,
      route_type,
      priority,
      time_conditions,
      user_permissions,
      status
    } = req.body;

    // If trunk_id is being changed, verify it belongs to organization
    if (trunk_id && trunk_id !== route.trunk_id) {
      const trunk = await SipTrunk.findOne({
        where: {
          id: trunk_id,
          org_id: req.orgId
        }
      });

      if (!trunk) {
        return res.status(404).json({ error: 'SIP trunk not found or does not belong to organization' });
      }
    }

    await route.update({
      name: name !== undefined ? name : route.name,
      description: description !== undefined ? description : route.description,
      trunk_id: trunk_id !== undefined ? trunk_id : route.trunk_id,
      dial_pattern: dial_pattern !== undefined ? dial_pattern : route.dial_pattern,
      dial_prefix: dial_prefix !== undefined ? dial_prefix : route.dial_prefix,
      strip_digits: strip_digits !== undefined ? strip_digits : route.strip_digits,
      prepend_digits: prepend_digits !== undefined ? prepend_digits : route.prepend_digits,
      caller_id_override: caller_id_override !== undefined ? caller_id_override : route.caller_id_override,
      caller_id_name_override: caller_id_name_override !== undefined ? caller_id_name_override : route.caller_id_name_override,
      recording_enabled: recording_enabled !== undefined ? recording_enabled : route.recording_enabled,
      max_channels: max_channels !== undefined ? max_channels : route.max_channels,
      route_type: route_type !== undefined ? route_type : route.route_type,
      priority: priority !== undefined ? priority : route.priority,
      time_conditions: time_conditions !== undefined ? time_conditions : route.time_conditions,
      user_permissions: user_permissions !== undefined ? user_permissions : route.user_permissions,
      status: status !== undefined ? status : route.status
    });

    const updatedRoute = await OutboundRoute.findByPk(route.id, {
      include: [{ model: SipTrunk, as: 'trunk' }]
    });

    res.json(updatedRoute);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete outbound route
app.delete('/api/v1/outbound-routes/:id', authenticateOrg, async (req, res) => {
  try {
    const route = await OutboundRoute.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!route) {
      return res.status(404).json({ error: 'Outbound route not found' });
    }

    await route.destroy();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// WEBHOOK MANAGEMENT
// ========================================

app.get('/api/v1/webhooks', authenticateOrg, async (req, res) => {
  try {
    const webhooks = await Webhook.findAll({
      where: { org_id: req.orgId }
    });
    res.json(webhooks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/webhooks/:id', authenticateOrg, async (req, res) => {
  try {
    const webhook = await Webhook.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    res.json(webhook);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/webhooks', authenticateOrg, async (req, res) => {
  try {
    const { url, events, secret } = req.body;

    if (!url || !events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'URL and events array required' });
    }

    const webhook = await Webhook.create({
      org_id: req.orgId,
      url,
      events,
      secret: secret || uuidv4(),
      active: true,
      retry_count: 3
    });

    res.status(201).json(webhook);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/v1/webhooks/:id', authenticateOrg, async (req, res) => {
  try {
    const webhook = await Webhook.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const allowedFields = ['url', 'events', 'secret', 'active', 'retry_count'];
    const updateData = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    await webhook.update(updateData);
    res.json(webhook);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/v1/webhooks/:id', authenticateOrg, async (req, res) => {
  try {
    const webhook = await Webhook.findOne({
      where: {
        id: req.params.id,
        org_id: req.orgId
      }
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    await webhook.destroy();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// CALL MANAGEMENT & STATISTICS
// ========================================

app.post('/api/v1/calls/:callId/recording', authenticateOrg, requireRole('admin'), (req, res) => {
  const { enabled } = req.body;

  // In production, this would interact with Asterisk
  const call = db.activeCalls.get(req.params.callId);
  if (call && call.org_id === req.orgId) {
    call.recording_enabled = enabled;
    db.activeCalls.set(req.params.callId, call);

    res.json({
      call_id: req.params.callId,
      recording_enabled: enabled,
      message: enabled ? 'Recording started' : 'Recording stopped'
    });
  } else {
    res.status(404).json({ error: 'Call not found' });
  }
});

/**
 * GET /api/v1/calls/contacts-map
 *
 * Returns the org's user / queue / DID lookup data the editor needs
 * to render call-log rows like a phone-book — replacing raw numbers
 * ("Queue 5002", "916382136190") with resolved names ("Reception",
 * "Girija R", DID descriptions, etc.).
 *
 * Fetched once per dashboard load; cached client-side. Avoids
 * per-row JOINs in the heavier /calls SELECT (which already
 * deduplicates by linkedid and is hot-path).
 *
 * Response shape stable — additive only; the editor's resolver
 * tolerates missing optional fields.
 */
app.get('/api/v1/calls/contacts-map', authenticateOrg, async (req, res) => {
  try {
    const { User, Queue, DidNumber } = require('./models');
    const [users, queues, dids] = await Promise.all([
      User.findAll({
        where: { org_id: req.orgId },
        attributes: ['id', 'full_name', 'username', 'extension', 'phone_number',
                     'ring_target', 'routing_type', 'failover_phone_number', 'status'],
        raw: true,
      }),
      Queue.findAll({
        where: { org_id: req.orgId },
        attributes: ['id', 'name', 'number', 'strategy', 'status'],
        raw: true,
      }),
      DidNumber.findAll({
        where: { org_id: req.orgId },
        attributes: ['id', 'number', 'description', 'routing_type'],
        raw: true,
      }),
    ]);
    res.json({ users, queues, dids });
  } catch (error) {
    console.error('contacts-map error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/calls/count', authenticateOrg, async (req, res) => {
  try {
    const { status, from, to } = req.query;

    const where = { org_id: req.orgId };

    if (status) {
      where.status = status;
    }

    if (from) {
      where.started_at = {
        [require('sequelize').Op.gte]: new Date(from)
      };
    }

    if (to) {
      if (where.started_at) {
        where.started_at[require('sequelize').Op.lte] = new Date(to);
      } else {
        where.started_at = {
          [require('sequelize').Op.lte]: new Date(to)
        };
      }
    }

    const calls = await CallRecord.findAll({ where });
    const active = Array.from(db.activeCalls.values()).filter(c => c.org_id === req.orgId).length;
    const completed = calls.filter(c => c.status === 'completed').length;
    const failed = calls.filter(c => c.status === 'failed').length;

    const totalDuration = calls.reduce((sum, c) => sum + (c.duration || 0), 0);
    const avgDuration = calls.length > 0 ? Math.round(totalDuration / calls.length) : 0;

    res.json({
      total: calls.length,
      active,
      completed,
      failed,
      average_duration: avgDuration,
      total_duration: totalDuration
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function to convert HH:MM:SS duration to total seconds
function convertDurationToSeconds(durationStr) {
  if (!durationStr || durationStr === '0') return 0;

  const parts = durationStr.split(':');
  if (parts.length !== 3) {
    // If not in HH:MM:SS format, try to parse as seconds
    return parseInt(durationStr) || 0;
  }

  const hours = parseInt(parts[0]) || 0;
  const minutes = parseInt(parts[1]) || 0;
  const seconds = parseInt(parts[2]) || 0;

  return hours * 3600 + minutes * 60 + seconds;
}

app.get('/api/v1/calls/live', authenticateOrg, async (req, res) => {
  // Hoisted so the catch block can disconnect the SAME instance — the
  // previous code created a NEW AsteriskManager in catch and disconnected
  // that one, leaking the original connection on every error path. Over
  // time that exhausts the AMI's permit cap and live-calls hangs.
  let asteriskManager = null;
  try {
    const AsteriskManager = require('./services/asterisk/asteriskManager');
    asteriskManager = new AsteriskManager();

    await asteriskManager.connect();

    // Get live channels from Asterisk AMI using CoreShowChannels command
    const amiResponse = await asteriskManager.sendAction('CoreShowChannels');

    // Log the full response to see what we're getting
    console.log('Full AMI Response:', amiResponse);
    console.log('Response lines after split:', amiResponse.response?.split('\r\n'));

    // Parse the response to get active channels
    const channels = [];
    const orgPrefix = req.organization.context_prefix;

    // Parse AMI response - simpler regex-based approach to extract channel blocks
    if (amiResponse && amiResponse.response) {
      const responseText = amiResponse.response;

      // Split by "Event: CoreShowChannel" to get each channel block
      const channelBlocks = responseText.split('Event: CoreShowChannel');

      console.log(`Found ${channelBlocks.length - 1} channel blocks to process`);

      // Skip first block (headers) and process each channel
      for (let i = 1; i < channelBlocks.length; i++) {
        const block = channelBlocks[i];
        const currentChannel = { Event: 'CoreShowChannel' };

        // Extract key-value pairs from this block
        const lines = block.split('\r\n');
        for (const line of lines) {
          if (line.includes(': ')) {
            const [key, value] = line.split(': ', 2);
            if (key && key.trim() && value !== undefined) {
              currentChannel[key.trim()] = value.trim();
            }
          }
        }

        console.log('Parsed channel:', JSON.stringify(currentChannel, null, 2));

        // Process this channel if it has the required data.
        // Org match is boundary-aware — bare substring `includes(prefix)`
        // makes `org_mp3` accidentally match `org_mp3t4g5m`, leaking one
        // org's live channels into another org's view (and vice-versa).
        // Match the prefix only when followed by `_`, `-`, `@`, end-of-
        // string, or the start of a channel-id segment, so cross-org
        // contamination is impossible.
        const orgBoundaryRe = new RegExp('(^|[^a-zA-Z0-9_])' + orgPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[_\\-@/.])');
        const containsOrg = (s) => typeof s === 'string' && orgBoundaryRe.test(s);
        if (currentChannel.Channel) {
          const matchesOrg = containsOrg(currentChannel.Channel) ||
                            containsOrg(currentChannel.CallerIDNum) ||
                            containsOrg(currentChannel.ConnectedLineNum) ||
                            containsOrg(currentChannel.Context);

          console.log(`Checking org match for channel ${currentChannel.Channel}: orgPrefix=${orgPrefix}, matchesOrg=${matchesOrg}`);

          if (matchesOrg) {
            console.log('Processing channel with Duration:', currentChannel.Duration);
            const convertedDuration = convertDurationToSeconds(currentChannel.Duration || '0');
            console.log(`Converted duration from "${currentChannel.Duration}" to ${convertedDuration} seconds`);

            // Determine direction from channel name and context
            const chName = currentChannel.Channel || '';
            const chContext = currentChannel.Context || '';
            let direction = 'internal';
            if (chName.includes('trunk')) {
              direction = chContext.includes('outbound') ? 'outbound' : 'inbound';
            } else if (chContext.includes('outbound')) {
              direction = 'outbound';
            }

            // For inbound: CallerIDNum=external caller, ConnectedLineNum=may be caller echo
            // Extract real destination from Application/ApplicationData or Context
            let toNumber = currentChannel.ConnectedLineNum || currentChannel.Exten || '<unknown>';
            let callerId = currentChannel.CallerIDNum || '';
            if (direction === 'inbound') {
              // caller_id for inbound = the DID number dialed (from ApplicationData or Exten)
              const appData = currentChannel.ApplicationData || '';
              if (currentChannel.Application === 'Queue') {
                // In queue: show queue number from ApplicationData (e.g. "org_demo__5001,ct,45")
                const qNum = appData.split(',')[0]?.split('_').pop() || '';
                toNumber = qNum ? 'Queue ' + qNum : toNumber;
              } else if (currentChannel.Application === 'Dial') {
                toNumber = appData.split(',')[0]?.split('/').pop()?.split('@')[0] || toNumber;
              }
              // DID = the number after stripping +91/0 prefix from the original dest
              const exten = currentChannel.Exten || '';
              if (exten && exten !== 's') callerId = exten;
            }

            // For outbound/internal: extract extension from channel name
            let fromNumber = currentChannel.CallerIDNum || currentChannel.Exten || 'Unknown';
            if (direction !== 'inbound' && chName.includes('PJSIP/')) {
              // Extensions can be 2-6 digits per the dialplan generator;
              // hard-coding 4 dropped any extension that didn't happen to
              // be exactly four digits long (3-digit short codes, 5-digit
              // long-form extensions used by larger orgs) and the UI then
              // displayed "Unknown" as the from-number.
              const extMatch = chName.match(/PJSIP\/\w+_(\d{2,6})-/);
              if (extMatch) fromNumber = extMatch[1];
            }

            channels.push({
              channel_id: currentChannel.Channel,
              uniqueid: currentChannel.Uniqueid || '',
              linkedid: currentChannel.Linkedid || '',
              from: fromNumber,
              from_name: currentChannel.CallerIDName || '',
              to: toNumber,
              to_name: currentChannel.ConnectedLineName || '<unknown>',
              caller_id: callerId,
              direction: direction,
              status: currentChannel.ChannelStateDesc || 'Up',
              context: chContext,
              extension: currentChannel.Exten || '',
              priority: currentChannel.Priority || '',
              duration: convertedDuration,
              application: currentChannel.Application || '',
              application_data: currentChannel.ApplicationData || '',
              bridge_id: currentChannel.BridgeId || null
            });
          }
        }
      }
    }

    // Disconnect from AMI
    await asteriskManager.disconnect();

    // Deduplicate: group by linkedid, keep the most relevant channel per call
    // For inbound: prefer trunk channel (has real caller info)
    // For outbound/internal: prefer extension channel (has correct from + is the one to transfer)
    const callMap = new Map();
    for (const ch of channels) {
      const key = ch.linkedid || ch.uniqueid || ch.channel_id;
      const existing = callMap.get(key);
      const isLocal = ch.channel_id.startsWith("Local/");
      const isTrunk = ch.channel_id.includes("trunk");
      if (!existing) {
        callMap.set(key, ch);
      } else if (isLocal) {
        // Never prefer Local channels
      } else if (ch.direction === 'inbound' && isTrunk) {
        // For inbound, prefer trunk (has real caller)
        callMap.set(key, ch);
      } else if (ch.direction !== 'inbound' && !isTrunk && existing.channel_id.includes("trunk")) {
        // For outbound/internal, prefer extension channel over trunk
        callMap.set(key, ch);
      }
    }
    const dedupedCalls = Array.from(callMap.values());

    // Resolve `qm<hex>` queue-member helper tokens to operator-friendly
    // labels. The token appears in fields like `caller_id`, `extension`,
    // `to`, `application_data` whenever a channel is currently inside
    // the per-member `qm<hex>` helper context (e.g., a member-leg Local
    // channel mid-ring). Without this, the live-calls UI shows the raw
    // 34-char internal handle in the CallerID column.
    const QM_RE = /qm[a-f0-9]{32}/g;
    const qmHexes = new Set();
    const scanFields = ['from', 'to', 'caller_id', 'extension', 'application_data'];
    for (const ch of dedupedCalls) {
      for (const f of scanFields) {
        const v = ch[f];
        if (typeof v === 'string') {
          for (const m of v.matchAll(QM_RE)) qmHexes.add(m[0]);
        }
      }
    }
    if (qmHexes.size > 0) {
      const memberIds = Array.from(qmHexes).map(qm => {
        const h = qm.slice(2);
        return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
      });
      const memberRows = await sequelize.query(
        "SELECT qm.id, u.extension, u.full_name FROM queue_members qm " +
        "JOIN users u ON qm.user_id = u.id WHERE qm.id IN (?) AND u.org_id = ?",
        { replacements: [memberIds, req.orgId], type: sequelize.QueryTypes.SELECT }
      );
      const map = new Map();
      for (const m of memberRows) {
        map.set('qm' + m.id.replace(/-/g, ''), m);
      }
      const subst = (s) => typeof s === 'string'
        ? s.replace(QM_RE, (qm) => {
            const m = map.get(qm);
            return m ? (m.extension || m.full_name || qm) : qm;
          })
        : s;
      for (const ch of dedupedCalls) {
        for (const f of scanFields) ch[f] = subst(ch[f]);
      }
    }

    res.json({
      count: dedupedCalls.length,
      calls: dedupedCalls
    });

  } catch (error) {
    console.error('Error fetching live calls from AMI:', error);

    // Disconnect the SAME AsteriskManager instance we connected above so
    // the AMI session isn't leaked. The previous code instantiated a new
    // one here, which left the original connection orphaned.
    if (asteriskManager) {
      try { await asteriskManager.disconnect(); } catch { /* ignore */ }
    }

    res.status(500).json({
      error: 'Failed to fetch live calls from Asterisk',
      message: error.message
    });
  }
});

// ========================================
// SIMULATE CALL EVENTS (for testing webhooks)
// ========================================

app.post('/api/v1/test/call-event', authenticateOrg, async (req, res) => {
  try {
    const { event_type = 'call.initiated', from, to } = req.body;

    const callId = `call_${uuidv4()}`;
    const callData = {
      id: callId,
      org_id: req.orgId,
      from_number: from || '+1234567890',
      to_number: to || '+0987654321',
      direction: 'inbound',
      status: 'ringing',
      started_at: new Date().toISOString()
    };

    // Store as active call (in-memory for simulation)
    db.activeCalls.set(callId, callData);

    // Trigger webhooks
    await triggerWebhooks(req.orgId, event_type, {
      call_id: callId,
      from: callData.from_number,
      to: callData.to_number,
      status: callData.status
    });

    // Simulate call flow
    if (event_type === 'call.initiated') {
      setTimeout(() => {
        callData.status = 'answered';
        callData.answered_at = new Date().toISOString();
        triggerWebhooks(req.orgId, 'call.answered', {
          call_id: callId,
          from: callData.from_number,
          to: callData.to_number,
          status: 'answered'
        });
      }, 2000);

      setTimeout(async () => {
        callData.status = 'completed';
        callData.ended_at = new Date().toISOString();
        callData.duration = 30; // 30 seconds call

        // Store in database as completed call record
        try {
          await CallRecord.create({
            call_id: callId,
            org_id: req.orgId,
            from_number: callData.from_number,
            to_number: callData.to_number,
            direction: callData.direction,
            status: 'completed',
            started_at: callData.started_at,
            answered_at: callData.answered_at,
            ended_at: callData.ended_at,
            duration: callData.duration
          });
        } catch (error) {
          console.error('Failed to store call record:', error);
        }

        // Remove from active calls
        db.activeCalls.delete(callId);

        triggerWebhooks(req.orgId, 'call.ended', {
          call_id: callId,
          from: callData.from_number,
          to: callData.to_number,
          status: 'completed',
          duration: callData.duration
        });
      }, 5000);
    }

    res.json({
      message: 'Call event simulated',
      call_id: callId,
      event: event_type
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// API DOCUMENTATION
// ========================================

app.get('/api', (req, res) => {
  res.json({
    name: 'Multi-Tenant PBX API',
    version: '1.0.0',
    base_url: `http://${HOST}:${PORT}/api/v1`,
    documentation: {
      swagger: '/api-docs',
      postman: 'https://documenter.getpostman.com/view/pbx-api'
    },
    testing: {
      description: 'Available test scripts for API functionality verification',
      scripts: {
        services: {
          file: 'test-services.js',
          command: 'node test-services.js',
          description: 'Test core PBX services (SipTrunk, User, Queue, Dialplan) with mock data',
          features: ['SIP trunk configuration', 'User provisioning', 'Queue management', 'Dialplan generation']
        },
        integration: {
          file: 'test-real-integration.js',
          command: 'node test-real-integration.js',
          description: 'End-to-end integration tests with real database and Asterisk integration',
          features: ['Database operations', 'Asterisk configuration', 'Full workflow testing']
        },
        api: {
          file: 'test-api.js',
          command: 'node test-api.js',
          description: 'API endpoint testing script',
          note: 'Tests all REST API endpoints with authentication'
        }
      },
      usage: {
        prerequisites: ['Server running on port 3000', 'Database connection configured', 'Valid API credentials'],
        examples: [
          'npm start  # Start the server',
          'node test-services.js  # Test core services',
          'node test-real-integration.js  # Test full integration',
          'node test-api.js  # Test API endpoints'
        ]
      }
    },
    authentication: {
      policy: 'All API endpoints require authentication except organization creation and JWT login',
      methods: ['API Key (X-API-Key header)', 'JWT Bearer Token'],
      obtain_credentials: {
        api_key: 'POST /api/v1/organizations (creates new org with API key/secret)',
        jwt_token: 'POST /api/v1/auth/login (exchange API key/secret for JWT token)'
      },
      headers_required: {
        api_key: 'X-API-Key: your-api-key-here',
        jwt: 'Authorization: Bearer your-jwt-token-here',
        content_type: 'Content-Type: application/json'
      },
      public_endpoints: [
        '/health - Health check endpoint',
        '/api - API documentation',
        'POST /api/v1/organizations - Create new organization',
        'POST /api/v1/auth/login - Generate JWT token'
      ]
    },
    api_prerequisites: {
      description: 'Prerequisites and dependencies for API endpoints',
      general: {
        authentication: 'Valid API key or JWT token required for all endpoints except public ones',
        organization: 'Organization must exist before creating any resources'
      },
      specific_endpoints: {
        did_management: {
          create_did: 'Requires existing SIP trunk (trunk_id parameter)',
          note: 'DIDs cannot be created without a valid SIP trunk to route calls through'
        },
        queue_management: {
          add_queue_member: 'Requires existing queue and user',
          note: 'Both queue_id and user_id must exist before adding members'
        },
        user_management: {
          create_user: 'Only requires organization (org_id is automatically set from authentication)',
          note: 'Users can be created independently of other resources'
        },
        sip_trunk_management: {
          create_trunk: 'Only requires organization (org_id is automatically set from authentication)',
          note: 'SIP trunks are foundational resources for DID routing'
        },
        webhook_management: {
          create_webhook: 'Only requires organization (org_id is automatically set from authentication)',
          note: 'Webhooks can be created independently'
        },
        call_records: {
          create_record: 'May require existing user, queue, or trunk depending on call type',
          note: 'Call records link to existing resources when available'
        }
      },
      typical_setup_order: [
        '1. Create organization (POST /api/v1/organizations)',
        '2. Create SIP trunks (POST /api/v1/trunks)',
        '3. Create DID numbers (POST /api/v1/dids) - requires trunk_id',
        '4. Create users (POST /api/v1/users)',
        '5. Create queues (POST /api/v1/queues)',
        '6. Add queue members (POST /api/v1/queues/:id/members) - requires user_id',
        '7. Configure webhooks and other optional features'
      ],
      important_notes: [
        'DID creation will fail if trunk_id does not exist',
        'Queue member operations require both queue and user to exist',
        'All resources are tenant-isolated by organization',
        'Deleting a trunk may affect associated DIDs',
        'Deleting a user will remove them from all queues'
      ]
    },
    endpoints: {
      authentication: {
        login: {
          method: 'POST',
          url: '/api/v1/auth/login',
          description: 'Generate JWT token using API credentials',
          auth_required: false,
          body: {
            api_key: 'string (required, organization API key)',
            api_secret: 'string (required, organization API secret)'
          },
          example: {
            api_key: 'org_1234567890abcdef',
            api_secret: 'your-api-secret-here'
          },
          responses: {
            '200': {
              description: 'JWT token generated successfully',
              example: {
                token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                token_type: 'Bearer',
                expires_in: '24h',
                organization: {
                  id: 'uuid',
                  name: 'Organization Name',
                  api_key: 'org_1234567890abcdef'
                }
              }
            },
            '400': {
              description: 'Missing required fields',
              example: { error: 'API key and secret are required' }
            },
            '401': {
              description: 'Invalid credentials',
              example: { error: 'Invalid credentials' }
            }
          }
        }
      },
      organizations: {
        create: {
          method: 'POST',
          url: '/api/v1/organizations',
          description: 'Create a new organization',
          auth_required: false,
          body: {
            name: 'string (required, 3-50 chars, alphanumeric and hyphens only, cannot start/end with special chars or contain spaces)',
            context_prefix: 'string (optional, alphanumeric+underscore)',
            contact_info: {
              email: 'string (optional)',
              phone: 'string (optional)',
              address: 'string (optional)'
            }
          },
          example: {
            name: 'Acme-Corp',
            context_prefix: 'acme_',
            contact_info: {
              email: 'admin@acme.com',
              phone: '+1-555-0123'
            }
          },
          response: {
            id: 'uuid',
            name: 'string',
            context_prefix: 'string',
            api_key: 'string',
            status: 'active|suspended|deleted',
            created_at: 'timestamp'
          }
        },
        list: {
          method: 'GET',
          url: '/api/v1/organizations',
          description: 'List all organizations (admin only)',
          auth_required: true,
          query_params: {
            page: 'number (optional, default: 1)',
            limit: 'number (optional, default: 20, max: 100)',
            status: 'string (optional: active|suspended|deleted)'
          }
        },
        get: {
          method: 'GET',
          url: '/api/v1/organizations/:id',
          description: 'Get organization details',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          }
        },
        update: {
          method: 'PUT',
          url: '/api/v1/organizations/:id',
          description: 'Update organization',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          },
          body: {
            name: 'string (optional, 3-50 chars, alphanumeric and hyphens only, cannot start/end with special chars or contain spaces)',
            status: 'string (optional: active|suspended|deleted)',
            contact_info: 'object (optional)'
          }
        },
        delete: {
          method: 'DELETE',
          url: '/api/v1/organizations/:id',
          description: 'Delete organization',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          }
        }
      },
      trunks: {
        list: {
          method: 'GET',
          url: '/api/v1/trunks',
          description: 'List SIP trunks',
          auth_required: true,
          query_params: {
            page: 'number (optional)',
            limit: 'number (optional)',
            status: 'string (optional: active|inactive)'
          }
        },
        create: {
          method: 'POST',
          url: '/api/v1/trunks',
          description: 'Create SIP trunk',
          auth_required: true,
          body: {
            name: 'string (required, 2-255 chars)',
            host: 'string (required)',
            port: 'number (optional, default: 5060, range: 1-65535)',
            username: 'string (optional)',
            password: 'string (optional)',
            transport: 'string (optional: udp|tcp|tls, default: udp)'
          },
          example: {
            name: 'Primary SIP Trunk',
            host: 'sip.provider.com',
            port: 5060,
            username: 'trunk_user',
            password: 'secure_password',
            transport: 'udp'
          }
        },
        get: {
          method: 'GET',
          url: '/api/v1/trunks/:id',
          description: 'Get SIP trunk details',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          }
        },
        update: {
          method: 'PUT',
          url: '/api/v1/trunks/:id',
          description: 'Update SIP trunk',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          },
          body: {
            name: 'string (optional)',
            host: 'string (optional)',
            port: 'number (optional)',
            username: 'string (optional)',
            password: 'string (optional)',
            transport: 'string (optional: udp|tcp|tls)'
          }
        },
        delete: {
          method: 'DELETE',
          url: '/api/v1/trunks/:id',
          description: 'Delete SIP trunk',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          }
        }
      },
      dids: {
        list: {
          method: 'GET',
          url: '/api/v1/dids',
          description: 'List DID numbers',
          auth_required: true,
          query_params: {
            page: 'number (optional)',
            limit: 'number (optional)',
            trunk_id: 'uuid (optional, filter by trunk)'
          }
        },
        create: {
          method: 'POST',
          url: '/api/v1/dids',
          description: 'Create DID number',
          auth_required: true,
          body: {
            number: 'string (required, phone number)',
            trunk_id: 'uuid (required)',
            routing_type: 'string (required: extension|queue|ivr|ai_agent)',
            routing_destination: 'string (required)',
            description: 'string (optional)'
          },
          example: {
            number: '+1-555-0100',
            trunk_id: 'trunk-uuid-here',
            routing_type: 'extension',
            routing_destination: '1001',
            description: 'Main reception line'
          }
        },
        get: {
          method: 'GET',
          url: '/api/v1/dids/:id',
          description: 'Get DID details',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          }
        },
        update: {
          method: 'PUT',
          url: '/api/v1/dids/:id',
          description: 'Update DID number',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          },
          body: {
            routing_type: 'string (optional)',
            routing_destination: 'string (optional)',
            description: 'string (optional)'
          }
        },
        delete: {
          method: 'DELETE',
          url: '/api/v1/dids/:id',
          description: 'Delete DID number',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          }
        },
        update_routing: {
          method: 'PUT',
          url: '/api/v1/dids/:id/routing',
          description: 'Update DID routing only',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          },
          body: {
            routing_type: 'string (required: extension|queue|ivr|ai_agent)',
            routing_destination: 'string (required)'
          }
        }
      },
      users: {
        list: {
          method: 'GET',
          url: '/api/v1/users',
          description: 'List users',
          auth_required: true,
          query_params: {
            page: 'number (optional)',
            limit: 'number (optional)',
            role: 'string (optional: admin|agent|user)',
            status: 'string (optional: active|inactive)'
          }
        },
        create: {
          method: 'POST',
          url: '/api/v1/users',
          description: 'Create user',
          auth_required: true,
          body: {
            username: 'string (required, 3-50 chars, alphanumeric)',
            email: 'string (required, valid email)',
            password: 'string (required, login password for web authentication)',
            full_name: 'string (optional, 2-255 chars)',
            extension: 'string (required, 3-10 digits)',
            role: 'string (optional: admin|supervisor|agent|user, default: agent)',
            sip_password: 'string (optional, auto-generated if not provided, for SIP phone registration)'
          },
          example: {
            username: 'john.doe',
            email: 'john.doe@company.com',
            password: 'secure_login_pass',
            full_name: 'John Doe',
            extension: '1001',
            role: 'agent',
            sip_password: 'sip_phone_pass'
          }
        },
        get: {
          method: 'GET',
          url: '/api/v1/users/:id',
          description: 'Get user details',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          }
        },
        update: {
          method: 'PUT',
          url: '/api/v1/users/:id',
          description: 'Update user',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          },
          body: {
            email: 'string (optional)',
            full_name: 'string (optional)',
            role: 'string (optional)',
            status: 'string (optional: active|inactive)',
            recording_enabled: 'boolean (optional)'
          }
        },
        delete: {
          method: 'DELETE',
          url: '/api/v1/users/:id',
          description: 'Delete user',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          }
        }
      },
      queues: {
        list: {
          method: 'GET',
          url: '/api/v1/queues',
          description: 'List call queues',
          auth_required: true,
          query_params: {
            page: 'number (optional)',
            limit: 'number (optional)',
            active: 'boolean (optional)'
          }
        },
        create: {
          method: 'POST',
          url: '/api/v1/queues',
          description: 'Create call queue',
          auth_required: true,
          body: {
            name: 'string (required, 2-255 chars)',
            number: 'string (required, 3-10 chars)',
            strategy: 'string (optional: ringall|leastrecent|fewestcalls|random|rrmemory|linear)',
            timeout: 'number (optional, seconds, default: 30)',
            retry: 'number (optional, seconds, default: 5)',
            max_wait_time: 'number (optional, seconds)',
            music_on_hold: 'string (optional)'
          },
          example: {
            name: 'Support Queue',
            number: 'support',
            strategy: 'ringall',
            timeout: 30,
            retry: 5,
            max_wait_time: 300
          }
        },
        get: {
          method: 'GET',
          url: '/api/v1/queues/:id',
          description: 'Get queue details with members',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          }
        },
        update: {
          method: 'PUT',
          url: '/api/v1/queues/:id',
          description: 'Update queue',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          },
          body: {
            name: 'string (optional)',
            strategy: 'string (optional)',
            timeout: 'number (optional)',
            retry: 'number (optional)',
            active: 'boolean (optional)'
          }
        },
        delete: {
          method: 'DELETE',
          url: '/api/v1/queues/:id',
          description: 'Delete queue',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          }
        },
        add_member: {
          method: 'POST',
          url: '/api/v1/queues/:id/members',
          description: 'Add user to queue',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          },
          body: {
            user_id: 'uuid (required)',
            penalty: 'number (optional, default: 0)',
            paused: 'boolean (optional, default: false)'
          }
        },
        remove_member: {
          method: 'DELETE',
          url: '/api/v1/queues/:queueId/members?userId=:userId',
          description: 'Remove user from queue',
          auth_required: true,
          path_params: {
            queueId: 'uuid (required)',
            userId: 'uuid (required, query parameter)'
          }
        }
      },
      webhooks: {
        list: {
          method: 'GET',
          url: '/api/v1/webhooks',
          description: 'List webhooks',
          auth_required: true
        },
        create: {
          method: 'POST',
          url: '/api/v1/webhooks',
          description: 'Create webhook',
          auth_required: true,
          body: {
            url: 'string (required, valid URL)',
            events: 'array (required, webhook event types)',
            secret: 'string (optional, for signature verification)',
            active: 'boolean (optional, default: true)'
          },
          example: {
            url: 'https://myapp.com/webhooks/pbx',
            events: ['call.initiated', 'call.ended'],
            secret: 'webhook-secret-key',
            active: true
          }
        },
        get: {
          method: 'GET',
          url: '/api/v1/webhooks/:id',
          description: 'Get webhook details',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          }
        },
        update: {
          method: 'PUT',
          url: '/api/v1/webhooks/:id',
          description: 'Update webhook',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          },
          body: {
            url: 'string (optional)',
            events: 'array (optional)',
            active: 'boolean (optional)'
          }
        },
        delete: {
          method: 'DELETE',
          url: '/api/v1/webhooks/:id',
          description: 'Delete webhook',
          auth_required: true,
          path_params: {
            id: 'uuid (required)'
          }
        }
      }
    },
    response_codes: {
      200: 'Success',
      201: 'Created',
      400: 'Bad Request - Invalid parameters',
      401: 'Unauthorized - Invalid API key',
      403: 'Forbidden - Insufficient permissions',
      404: 'Not Found - Resource not found',
      409: 'Conflict - Resource already exists',
      422: 'Validation Error - Invalid data',
      500: 'Internal Server Error'
    },
    webhook_events: [
      'call.initiated',
      'call.ringing',
      'call.answered',
      'call.ended',
      'call.failed',
      'queue.entered',
      'queue.abandoned'
    ],
    queue_strategies: [
      'ringall',
      'leastrecent',
      'fewestcalls',
      'random',
      'rrmemory',
      'linear'
    ],
    routing_types: [
      'extension',
      'queue',
      'ivr',
      'ai_agent'
    ]
  });
});

// ========================================
// ERROR HANDLING
// ========================================

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// ========================================
// CLICK TO CALL API
// ========================================

/**
 * Click-to-Call endpoint
 * Initiates a call between two numbers using Asterisk Originate
 */
// Internal: Hangup a channel via AMI (used by pipecat bot end_call)
// Transfer a live call via AMI Redirect (authenticated, for UI)
app.post('/api/v1/calls/transfer', authenticateOrg, async (req, res) => {
  const { channel_id, destination, destination_type = 'extension' } = req.body;
  if (!channel_id || !destination) return res.status(400).json({ error: 'channel_id and destination required' });
  try {
    const org = req.organization;
    const prefix = org?.context_prefix || '';
    let context = prefix + '_internal';
    let exten = destination;
    if (destination_type === 'queue') { context = prefix + '_queue'; }
    else if (destination_type === 'external') { context = prefix + '_outbound'; }
    const AsteriskManager = require('./services/asterisk/asteriskManager');
    const ami = new AsteriskManager();
    await ami.connect();
    await ami.sendAction('Redirect', { Channel: channel_id, Context: context, Exten: exten, Priority: '1' });
    await ami.disconnect();
    console.log('UI Transfer: ' + channel_id + ' -> ' + exten + ' (' + context + ')');
    res.json({ success: true, channel_id, destination: exten, context });
  } catch (error) {
    console.error('Transfer failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Internal: Count active outbound calls for an org (used by workflow engine concurrency)
app.post('/api/v1/calls/automation-count', async (req, res) => {
  const ik = req.headers['x-internal-key'];
  if (!ik || ik !== process.env.INTERNAL_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const { org_id } = req.body;
  if (!org_id) return res.status(400).json({ error: 'org_id required' });
  try {
    const org = await Organization.findByPk(org_id);
    if (!org) return res.json({ count: 0, channels: [] });
    const prefix = org.context_prefix || '';
    const AsteriskManager = require('./services/asterisk/asteriskManager');
    const ami = new AsteriskManager();
    await ami.connect();
    const amiResponse = await ami.sendAction('CoreShowChannels');
    await ami.disconnect();
    let count = 0;
    const channels = [];
    if (amiResponse && amiResponse.response) {
      const blocks = amiResponse.response.split('Event: CoreShowChannel');
      for (let i = 1; i < blocks.length; i++) {
        const ch = {};
        for (const line of blocks[i].split('\r\n')) {
          if (line.includes(': ')) {
            const [k, v] = line.split(': ', 2);
            if (k && v) ch[k.trim()] = v.trim();
          }
        }
        if (!ch.Channel) continue;
        if (!ch.Channel.includes(prefix)) continue;
        if (ch.Channel.startsWith('Local/')) continue;
        count++;
        channels.push(ch.Channel);
      }
    }
    res.json({ count, channels });
  } catch (error) {
    console.error('automation-count error:', error.message);
    res.json({ count: 0, channels: [] });
  }
});

// Hangup a live call via AMI (authenticated, for UI)
app.post('/api/v1/calls/hangup-channel', authenticateOrg, async (req, res) => {
  const { channel_id } = req.body;
  if (!channel_id) return res.status(400).json({ error: 'channel_id required' });
  try {
    const AsteriskManager = require('./services/asterisk/asteriskManager');
    const ami = new AsteriskManager();
    await ami.connect();
    await ami.sendAction('Hangup', { Channel: channel_id });
    await ami.disconnect();
    console.log('UI Hangup: ' + channel_id);
    res.json({ success: true, channel_id });
  } catch (error) {
    console.error('Hangup failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Internal: Transfer/redirect a channel to a queue via AMI
app.post('/api/v1/calls/transfer-channel', async (req, res) => {
  const ik = req.headers['x-internal-key'];
  if (!ik || ik !== process.env.INTERNAL_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const { channel_id, queue } = req.body;
  if (!channel_id || !queue) return res.status(400).json({ error: 'channel_id and queue required' });
  try {
    // Look up org context_prefix from DB for correct queue context
    const org = await Organization.findByPk(req.body.org_id || '');
    const orgPrefix = org ? org.context_prefix : '';
    const queueContext = orgPrefix ? orgPrefix + '_queue' : 'default';
    const AsteriskManager = require('./services/asterisk/asteriskManager');
    const ami = new AsteriskManager();
    await ami.connect();
    await ami.sendAction('Redirect', { Channel: channel_id, Context: queueContext, Exten: queue, Priority: '1' });
    await ami.disconnect();
    console.log('Transfer: ' + channel_id + ' -> Queue ' + queue + ' (context: ' + queueContext + ')');
    res.json({ success: true, channel_id, queue, context: queueContext });
  } catch (error) {
    console.error('Transfer failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/v1/calls/hangup", async (req, res) => {
  const ik = req.headers["x-internal-key"];
  if (!ik || ik !== process.env.INTERNAL_API_KEY) return res.status(401).json({ error: "Unauthorized" });
  const { channel_id } = req.body;
  if (!channel_id) return res.status(400).json({ error: "channel_id required" });
  try {
    const AsteriskManager = require("./services/asterisk/asteriskManager");
    const ami = new AsteriskManager();
    await ami.connect();
    await ami.sendAction("Hangup", { Channel: channel_id });
    await ami.disconnect();
    console.log("Hangup sent for channel: " + channel_id);
    res.json({ success: true, channel_id });
  } catch (error) {
    console.error("Hangup failed:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/calls/click-to-call', authenticateOrg, async (req, res) => {
  try {
    const { from, to, to_type = 'extension', caller_id, timeout = 30, context, variables = {} } = req.body;

    // Validate caller_id (or pick org default) — single source of truth
    let resolvedCid;
    try {
      resolvedCid = await resolveCallerId(req.orgId, caller_id);
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message, code: e.code });
    }

    // Validate required fields
    if (!from || !to) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['from', 'to']
      });
    }

    // Validate to_type
    const validTypes = ['extension', 'queue', 'ivr', 'ai_agent', 'external'];
    if (!validTypes.includes(to_type)) {
      return res.status(400).json({
        error: 'Invalid to_type',
        valid_types: validTypes
      });
    }

    // Get organization context prefix
    const org = req.organization;
    const dialContext = context || `${org.context_prefix}_internal`;

    // Prepare channel variables
    const channelVars = {
      __ORG_ID: org.id,
      __CLICK_TO_CALL: '1',
      ...variables
    };

    // Determine destination based on type
    let destination;
    let destContext = dialContext;

    switch (to_type) {
      case 'extension':
        destination = to;
        destContext = `${org.context_prefix}_internal`;
        break;

      case 'queue':
        destination = to; // Queue number or name
        destContext = `${org.context_prefix}_queue`;
        break;

      case 'ivr':
        destination = to; // IVR extension
        destContext = `${org.context_prefix}_ivr`;
        break;

      case 'ai_agent':
        // For AI agents, use Stasis application
        destination = to;
        destContext = `${org.context_prefix}_internal`;
        channelVars.__AI_AGENT_ID = to;
        break;

      case 'external':
        // External number goes through outbound context
        destination = to;
        destContext = `${org.context_prefix}_outbound`;
        break;

      default:
        destination = to;
        destContext = dialContext;
    }

    // Build AMI originate command
    const AsteriskManager = require('./services/asterisk/asteriskManager');
    const asteriskManager = new AsteriskManager();

    try {
      await asteriskManager.connect();

      // Originate call: First call 'from', then bridge to destination
      const response = await asteriskManager.originate({
        channel: `Local/${from}@${org.context_prefix}_internal`,
        exten: destination,
        context: destContext,
        priority: 1,
        callerid: resolvedCid,
        timeout: timeout * 1000,
        variables: channelVars,
        async: true
      });

      await asteriskManager.disconnect();

      res.json({
        success: true,
        message: 'Call initiated successfully',
        call: {
          from,
          to,
          to_type,
          caller_id: resolvedCid,
          destination,
          context: destContext,
          timeout,
          response: response
        }
      });

    } catch (amiError) {
      console.error('❌ AMI Error:', amiError);

      // Attempt to disconnect
      try {
        await asteriskManager.disconnect();
      } catch (e) {}

      return res.status(500).json({
        error: 'Failed to initiate call via AMI',
        details: amiError.message
      });
    }

  } catch (error) {
    console.error('❌ Click-to-call error:', error);
    res.status(500).json({
      error: 'Failed to initiate click-to-call',
      details: error.message
    });
  }
});

/**
 * POST /api/v1/calls/originate-to-ai
 * Originate a call to remote party and connect to AI agent Stasis app
 */
app.post('/api/v1/calls/originate-to-ai', authenticateOrg, async (req, res) => {
  try {
    const orgId = req.orgId; // Set by authenticateOrg middleware

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found'
      });
    }

    const {
      to,
      caller_id,
      ai_agent_app = 'ai_agent',
      wss_url,
      timeout = 30,
      variables = {}
    } = req.body;

    // Validate caller_id (or pick org default) — single source of truth
    let resolvedCid;
    try {
      resolvedCid = await resolveCallerId(orgId, caller_id);
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message, code: e.code });
    }

    // Validate required fields
    if (!to) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['to']
      });
    }

    // Validate WSS URL if provided
    if (wss_url && !wss_url.startsWith('wss://') && !wss_url.startsWith('ws://')) {
      return res.status(400).json({
        error: 'Invalid WSS URL',
        message: 'WSS URL must start with wss:// or ws://'
      });
    }

    // Get organization for context prefix
    const org = await Organization.findByPk(orgId);
    if (!org) {
      return res.status(404).json({
        error: 'Organization not found'
      });
    }

    // Determine the channel to originate based on destination type
    let channel;
    let endpoint;

    // Check if 'to' is an extension or external number
    if (/^\d{3,4}$/.test(to)) {
      // Internal extension
      channel = `PJSIP/${to}`;
      endpoint = `PJSIP/${to}`;
    } else {
      // External number - route through trunk
      // Ensure context prefix ends with underscore
      const contextPrefix = org.context_prefix.endsWith('_') ? org.context_prefix : org.context_prefix + '_';
      channel = `Local/${to}@${contextPrefix}_outbound`;
      endpoint = to;
    }

    // Create AMI manager instance
    const AsteriskManager = require('./services/asterisk/asteriskManager');
    const ami = new AsteriskManager();

    try {
      await ami.connect();

      // Build channel variables
      const channelVars = {
        ORG_ID: orgId,
        CALL_TYPE: 'ai-agent-outbound',
        AI_AGENT_APP: ai_agent_app,
        DESTINATION: to,
        ...variables
      };

      // Add WSS URL with custom variables encoded as query params
      if (wss_url) {
        const url = new URL(wss_url);
        for (const [k, v] of Object.entries(variables)) {
          if (v && typeof v === 'string') url.searchParams.set(k, v);
        }
        channelVars.WSS_URL = url.toString();
      }

      // For external numbers, use PJSIP trunk directly (not Local channel)
      if (!(/^\d{3,4}$/.test(to))) {
        const SipTrunk = require('./models').SipTrunk;
        const trunk = await SipTrunk.findOne({ where: { org_id: orgId, status: 'active' } });
        if (trunk && trunk.asterisk_peer_name) {
          channel = `PJSIP/${to}@${trunk.asterisk_peer_name}`;
          console.log('originate-to-ai: trunk=' + trunk.asterisk_peer_name + ' channel=' + channel);
        }
      }

      // Originate: dial via trunk, connect to Stasis/ARI for bot handling
      const originateResult = await ami.originate({
        channel: channel,
        application: 'Stasis',
        data: channelVars.WSS_URL ? "pbx_api," + ai_agent_app + "," + channelVars.WSS_URL : "pbx_api," + ai_agent_app,
        callerid: resolvedCid,
        timeout: timeout * 1000,
        variables: channelVars,
        async: true
      });

      await ami.disconnect();

      // Log outbound bot call to asterisk_cdr so it appears in call history
      const recName = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + '-' + to + '-ai-bot.wav';
      try {
        await sequelize.query(
          `INSERT INTO asterisk_cdr (calldate, src, dst, dcontext, channel, disposition, duration, billsec, accountcode, uniqueid, linkedid, recordingfile)
           VALUES (NOW(), ?, ?, 'ai-outbound', ?, 'ANSWERED', 0, 0, ?, ?, ?, ?)`,
          { replacements: [resolvedCid, to, channel, orgId, 'ai_' + Date.now(), 'ai_' + Date.now(), recName] }
        );
      } catch (e) { console.error('CDR insert for AI call failed:', e.message); }

      res.json({
        success: true,
        message: 'Call to AI agent initiated successfully',
        call: {
          to,
          endpoint,
          caller_id: resolvedCid,
          ai_agent_app,
          wss_url: wss_url || null,
          timeout,
          channel,
          response: originateResult
        }
      });

    } catch (amiError) {
      await ami.disconnect();
      throw amiError;
    }

  } catch (error) {
    console.error('Error initiating AI agent call:', error);
    res.status(500).json({
      error: 'Failed to initiate AI agent call',
      details: error.message
    });
  }
});

app.get("/api/v1/moh", authenticateOrg, async (req, res) => {
  try {
    const fs = require("fs");
    const p = require("path");
    const d = "/var/lib/asterisk/moh";
    const orgPrefix = req.organization?.context_prefix || '';
    const system_classes = ["default"];
    const org_classes = [];

    // Scan MOH directory for org-specific classes
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith(orgPrefix)) {
          const className = entry.name;
          const classDir = p.join(d, className);
          const files = fs.readdirSync(classDir).filter(f => f.match(/\.(wav|mp3|ogg)$/)).map(f => ({
            filename: f, size: 0, uploaded_at: ''
          }));
          org_classes.push({ class: className.replace(orgPrefix, '').replace('_', ''), moh_class_name: className, file_count: files.length, files });
        }
      }
    } catch {}

    res.json({ system_classes, org_classes });
  } catch { res.json({ system_classes: ["default"], org_classes: [] }); }
});

app.post("/api/v1/moh/upload", authenticateOrg, async (req, res) => {
  try {
    const multer = require('multer');
    const fs = require('fs');
    const p = require('path');
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const orgPrefix = req.organization?.context_prefix || '';
    const tmpUpload = multer({ dest: '/tmp/', limits: { fileSize: 50 * 1024 * 1024 } });
    tmpUpload.single('audio')(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'No audio file provided' });
      const className = (req.body.class_name || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
      const mohClass = orgPrefix + '_' + className;
      const classDir = p.join('/var/lib/asterisk/moh', mohClass);
      fs.mkdirSync(classDir, { recursive: true });
      // Write THREE files: .wav (legacy fallback / human-readable),
      // .ulaw (raw G.711 mu-law) and .alaw (raw G.711 a-law). When
      // Asterisk's MOH plays on a PSTN call it picks the format that
      // matches the channel's native codec, so:
      //  - softphone calls (typically mu-law)  → .ulaw, no transcode
      //  - Tata-trunk inbound (a-law)          → .alaw, no transcode
      //  - anything else falls back to .wav, which Asterisk transcodes.
      //
      // The previous single-file pcm_s16le WAV forced an on-the-fly
      // transcode on every PSTN call → audible glitches mid-playback
      // (the customer's complaint). See operations/troubleshooting.md
      // Error 57/58 — same pattern that fixed greeting audio for Tata
      // inbound on the Indian alaw trunk.
      const baseName = p.basename(req.file.originalname, p.extname(req.file.originalname))
        .replace(/[^a-zA-Z0-9_-]/g, '_') || 'audio';
      const safeName = `${baseName}.wav`;
      const dest = p.join(classDir, safeName);
      const destUlaw = p.join(classDir, `${baseName}.ulaw`);
      const destAlaw = p.join(classDir, `${baseName}.alaw`);
      try {
        // Single ffmpeg invocation with three outputs — each output's
        // flags come BEFORE its filename. mono / 8kHz across all three;
        // raw `-f mulaw` / `-f alaw` for the G.711 outputs (no WAV
        // container so Asterisk doesn't have to parse a header on every
        // file open during the MOH loop).
        await execFileAsync('ffmpeg', [
          '-y', '-loglevel', 'error',
          '-i', req.file.path,
          '-ac', '1', '-ar', '8000', '-acodec', 'pcm_s16le', dest,
          '-ac', '1', '-ar', '8000', '-f', 'mulaw', destUlaw,
          '-ac', '1', '-ar', '8000', '-f', 'alaw', destAlaw,
        ]);
      } catch (ffErr) {
        try { fs.unlinkSync(req.file.path); } catch {}
        // Best-effort cleanup of any partial outputs so a failed encode
        // doesn't leave a stale .ulaw / .alaw next to a deleted .wav.
        for (const f of [dest, destUlaw, destAlaw]) {
          try { fs.unlinkSync(f); } catch {}
        }
        const detail = (ffErr.stderr || ffErr.message || '').toString().trim().slice(-500);
        return res.status(400).json({ error: `Audio conversion failed: ${detail}` });
      }
      try { fs.unlinkSync(req.file.path); } catch {}
      // Register the class in musiconhold.conf if new, then reload MOH so
      // Asterisk picks up the new file without a restart. Without
      // ensureOrgClass, `moh reload` is a no-op for first-upload classes
      // because the class block doesn't exist in the config yet.
      try {
        const MusicOnHoldService = require('./services/asterisk/mohService');
        const moh = new MusicOnHoldService();
        await moh.ensureOrgClass(orgPrefix, className);
        await moh.reloadMusicOnHold();
      } catch (reloadErr) {
        console.error('moh register/reload failed:', reloadErr.message);
      }
      console.log('MOH uploaded:', dest);
      res.json({ moh_class_name: mohClass, filename: safeName });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/v1/moh/import-system-file", authenticateOrg, async (req, res) => {
  try {
    const fs = require('fs');
    const p = require('path');
    const SYSTEM_MOH_DIR = '/var/lib/asterisk/moh';
    const orgPrefix = req.organization?.context_prefix || '';
    const { filename } = req.body;
    if (!filename || !/^[a-zA-Z0-9._-]+$/.test(filename)) return res.status(400).json({ error: 'Invalid filename' });
    const srcPath = p.resolve(SYSTEM_MOH_DIR, filename);
    if (!srcPath.startsWith(SYSTEM_MOH_DIR + '/') || !fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) {
      return res.status(404).json({ error: 'System file not found' });
    }
    const basename = p.basename(filename, p.extname(filename)).replace(/[^a-zA-Z0-9_-]/g, '_');
    const className = orgPrefix + '_sys_' + basename;
    const classDir = p.join(SYSTEM_MOH_DIR, className);
    fs.mkdirSync(classDir, { recursive: true });
    const destPath = p.join(classDir, filename);
    if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
      try {
        const MusicOnHoldService = require('./services/asterisk/mohService');
        const moh = new MusicOnHoldService();
        // ensureOrgClass joins prefix + className with `_`, so pass
        // `sys_<basename>` to produce `<orgPrefix>_sys_<basename>`.
        await moh.ensureOrgClass(orgPrefix, 'sys_' + basename);
        await moh.reloadMusicOnHold();
      } catch (reloadErr) {
        console.error('moh register/reload failed:', reloadErr.message);
      }
    }
    console.log('Imported system MOH file to class:', className);
    res.json({ moh_class_name: className, filename });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/v1/moh/:className/:filename", authenticateOrg, async (req, res) => {
  try {
    const fs = require('fs');
    const p = require('path');
    const orgPrefix = req.organization?.context_prefix || '';
    const { className, filename } = req.params;
    if (!className.startsWith(orgPrefix)) return res.status(403).json({ error: 'Cannot delete files from other orgs' });
    const filePath = p.resolve('/var/lib/asterisk/moh', className, filename);
    const base = p.resolve('/var/lib/asterisk/moh', className);
    if (!filePath.startsWith(base)) return res.status(400).json({ error: 'Invalid path' });
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    // Clean up the .ulaw + .alaw siblings written next to the .wav by
    // the upload handler. Operators see one filename in the UI but the
    // upload generates three on disk — leaving stale siblings after a
    // delete would cause Asterisk to pick a half-deleted set.
    const baseNoExt = p.basename(filename, p.extname(filename));
    for (const ext of ['.ulaw', '.alaw', '.wav']) {
      const sibling = p.resolve(base, `${baseNoExt}${ext}`);
      if (sibling !== filePath && sibling.startsWith(base + p.sep) && fs.existsSync(sibling)) {
        try { fs.unlinkSync(sibling); } catch {}
      }
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/v1/greetings", authenticateOrg, async (req, res) => {
  try {
    const { Greeting } = require('./models');
    const greetings = await Greeting.findAll({ where: { org_id: req.orgId }, order: [['created_at', 'DESC']], raw: true });
    res.json(greetings);
  } catch (error) {
    res.json([]);
  }
});
app.post("/api/v1/greetings", authenticateOrg, async (req, res) => {
  try {
    const { Greeting } = require('./models');
    const { v4: uuidv4 } = require('uuid');
    const TTSService = require('./services/ttsService');
    const id = uuidv4();
    const {
      name,
      text,
      language = 'en-IN',
      voice = 'en-IN-Chirp3-HD-Achernar',
      tts_model = 'chirp3-hd',
      style_instructions = null,
      status = 'active'
    } = req.body;
    // Validate the model + style-instructions pairing. style_instructions
    // is ONLY honored by Gemini models (chirp3-hd has no prompt input).
    // Reject explicitly instead of silently dropping it so operators
    // know their style prompt is not being used.
    const modelDef = TTSService.MODELS[tts_model];
    if (!modelDef) {
      return res.status(400).json({ error: `Unknown tts_model: ${tts_model}. Valid: ${Object.keys(TTSService.MODELS).join(', ')}` });
    }
    if (style_instructions && !modelDef.supportsStyleInstructions) {
      return res.status(400).json({ error: `style_instructions is only supported for Gemini TTS models (received tts_model=${tts_model})` });
    }
    if (style_instructions && String(style_instructions).length > 500) {
      return res.status(400).json({ error: 'style_instructions must be ≤ 500 characters' });
    }
    let audio_file = null;
    try {
      const tts = new TTSService();
      audio_file = await tts.saveGreetingAudio(id, text, language, voice, {
        model: tts_model,
        styleInstructions: style_instructions || undefined,
      });
      console.log('TTS audio generated for greeting', id);
    } catch (ttsErr) {
      console.error('TTS failed:', ttsErr.message);
    }
    const greeting = await Greeting.create({
      id, org_id: req.orgId, name, text, language, voice,
      tts_model, style_instructions, status, audio_file
    });
    res.json(greeting);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/v1/greetings/:id", authenticateOrg, async (req, res) => {
  try {
    const { Greeting } = require('./models');
    const TTSService = require('./services/ttsService');
    const greeting = await Greeting.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!greeting) return res.status(404).json({ error: 'Greeting not found' });
    const { name, text, language, voice, tts_model, style_instructions, status } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (status !== undefined) updateData.status = status;
    if (text !== undefined) updateData.text = text;
    if (language !== undefined) updateData.language = language;
    if (voice !== undefined) updateData.voice = voice;
    if (tts_model !== undefined) {
      if (!TTSService.MODELS[tts_model]) {
        return res.status(400).json({ error: `Unknown tts_model: ${tts_model}. Valid: ${Object.keys(TTSService.MODELS).join(', ')}` });
      }
      updateData.tts_model = tts_model;
    }
    if (style_instructions !== undefined) {
      // Validate against the (incoming or stored) model.
      const effectiveModel = updateData.tts_model || greeting.tts_model;
      const modelDef = TTSService.MODELS[effectiveModel];
      if (style_instructions && modelDef && !modelDef.supportsStyleInstructions) {
        return res.status(400).json({ error: `style_instructions is only supported for Gemini TTS models (effective tts_model=${effectiveModel})` });
      }
      if (style_instructions && String(style_instructions).length > 500) {
        return res.status(400).json({ error: 'style_instructions must be ≤ 500 characters' });
      }
      // Normalize empty-string → null so the textChanged check below
      // doesn't trigger a billed regen for the no-op "" → null case.
      updateData.style_instructions = style_instructions || null;
    }
    const textChanged =
      (text !== undefined && text !== greeting.text) ||
      (language !== undefined && language !== greeting.language) ||
      (voice !== undefined && voice !== greeting.voice) ||
      (tts_model !== undefined && tts_model !== greeting.tts_model) ||
      (updateData.style_instructions !== undefined && updateData.style_instructions !== greeting.style_instructions);
    if (textChanged) {
      try {
        const tts = new TTSService();
        if (greeting.audio_file) await tts.deleteGreetingAudio(greeting.audio_file);
        updateData.audio_file = await tts.saveGreetingAudio(
          greeting.id,
          updateData.text || greeting.text,
          updateData.language || greeting.language,
          updateData.voice || greeting.voice,
          {
            model: updateData.tts_model || greeting.tts_model,
            styleInstructions:
              (updateData.style_instructions !== undefined ? updateData.style_instructions : greeting.style_instructions) || undefined,
          }
        );
        console.log('TTS audio regenerated for greeting', greeting.id);
      } catch (ttsErr) {
        console.error('TTS failed:', ttsErr.message);
      }
    }
    await greeting.update(updateData);
    res.json(greeting);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/v1/greetings/:id", authenticateOrg, async (req, res) => {
  try {
    const { Greeting } = require('./models');
    const greeting = await Greeting.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!greeting) return res.status(404).json({ error: 'Greeting not found' });
    if (greeting.audio_file) {
      const TTSService = require('./services/ttsService');
      try { await new TTSService().deleteGreetingAudio(greeting.audio_file); } catch {}
    }
    await greeting.destroy();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════════════════════════════════
// IVR (Interactive Voice Response)
// Models: Ivr (tree root, greeting + prompts) + IvrMenu (digit → action).
// Dialplan generation lives in dialplanGenerator.js `generateIvrContext`.
// TTS generation uses the existing services/ttsService.js (Google TTS).
// ══════════════════════════════════════════════════════════════════════

// Supported Google TTS languages + their Chirp 3 HD voices. We curate a
// short list (2 female + 2 male) per language rather than dumping all ~30
// Chirp 3 HD voices Google offers, because operators typically just want
// a clear human voice — the celestial-name set is the same across every
// language so a handful is plenty. The full list can be fetched at
// runtime via TTSService.listVoices() if needed.
//
// Six languages explicitly requested by the user (2026-05-13):
// English (India), Hindi, Tamil, Telugu, Malayalam, Kannada.
// Marathi/Gujarati/Bengali/en-US/en-GB were in the old WaveNet list but
// the user did not call them out for the Chirp 3 HD upgrade; can be
// added later if needed.
//
// Backwards-compatibility: WaveNet voice names like `en-IN-Wavenet-D`
// still work in Google's API, so any greeting created before this
// upgrade keeps playing fine — we just no longer surface WaveNet voices
// in this list.
const SUPPORTED_TTS_VOICES = [
  { language: 'en-IN', label: 'English (India)', voices: ['en-IN-Chirp3-HD-Achernar', 'en-IN-Chirp3-HD-Aoede', 'en-IN-Chirp3-HD-Achird', 'en-IN-Chirp3-HD-Algenib'] },
  { language: 'hi-IN', label: 'Hindi',           voices: ['hi-IN-Chirp3-HD-Achernar', 'hi-IN-Chirp3-HD-Aoede', 'hi-IN-Chirp3-HD-Achird', 'hi-IN-Chirp3-HD-Algenib'] },
  { language: 'ta-IN', label: 'Tamil',           voices: ['ta-IN-Chirp3-HD-Achernar', 'ta-IN-Chirp3-HD-Aoede', 'ta-IN-Chirp3-HD-Achird', 'ta-IN-Chirp3-HD-Algenib'] },
  { language: 'te-IN', label: 'Telugu',          voices: ['te-IN-Chirp3-HD-Achernar', 'te-IN-Chirp3-HD-Aoede', 'te-IN-Chirp3-HD-Achird', 'te-IN-Chirp3-HD-Algenib'] },
  { language: 'ml-IN', label: 'Malayalam',       voices: ['ml-IN-Chirp3-HD-Achernar', 'ml-IN-Chirp3-HD-Aoede', 'ml-IN-Chirp3-HD-Achird', 'ml-IN-Chirp3-HD-Algenib'] },
  { language: 'kn-IN', label: 'Kannada',         voices: ['kn-IN-Chirp3-HD-Achernar', 'kn-IN-Chirp3-HD-Aoede', 'kn-IN-Chirp3-HD-Achird', 'kn-IN-Chirp3-HD-Algenib'] },
];

app.get('/api/v1/tts/voices', authenticateOrg, (req, res) => {
  res.json(SUPPORTED_TTS_VOICES);
});

// Available TTS models — keyed by model id (chirp3-hd, gemini-flash,
// gemini-pro). Returns the dropdown-ready metadata: label, description,
// whether the model accepts a style prompt, and the voice/language set
// it supports. The editor uses this to drive the Model picker, the
// Voice picker (filtered by selected model + language), and the
// conditional Style-Instructions textarea.
//
// Voices/languages come straight from TTSService.MODELS — single
// source of truth. If we add Gemini 3.1 or a Vertex AI direct path
// later, this endpoint picks it up automatically.
app.get('/api/v1/tts/models', authenticateOrg, (req, res) => {
  const TTSService = require('./services/ttsService');
  const models = Object.entries(TTSService.MODELS).map(([id, m]) => ({
    id,
    label: m.label,
    description: m.description,
    supportsStyleInstructions: m.supportsStyleInstructions === true,
    // Chirp 3 HD has per-language voice maps; Gemini models share one
    // voice list across all languages. Normalize to a per-language map
    // so the editor can render uniformly.
    voicesByLanguage: m.voicesByLanguage
      ? m.voicesByLanguage
      : Object.fromEntries(m.languages.map((lc) => [lc, m.voices]))
  }));
  res.json({ models, defaultModel: TTSService.DEFAULT_MODEL });
});

// Stream a one-shot TTS preview to the UI without persisting anything to
// disk. Used by the IVR builder's "Preview voice" button so admins can
// audition a language+voice+model+style with a short sample text before
// committing to regenerate a real greeting.
app.post('/api/v1/tts/preview', authenticateOrg, async (req, res) => {
  try {
    const TTSService = require('./services/ttsService');
    const { text, language, voice, model, style_instructions } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    // Guardrail: preview text is short. Reject anything > 500 chars so this
    // endpoint can't be abused as a free unlimited TTS proxy.
    if (String(text).length > 500) {
      return res.status(400).json({ error: 'preview text must be ≤ 500 characters' });
    }
    // Style prompts are also short by design.
    if (style_instructions && String(style_instructions).length > 500) {
      return res.status(400).json({ error: 'style_instructions must be ≤ 500 characters' });
    }
    const buf = await new TTSService().generateAudio(
      String(text),
      language || 'en-IN',
      voice || 'en-IN-Chirp3-HD-Achernar',
      {
        model: model || 'chirp3-hd',
        styleInstructions: style_instructions || undefined,
        // Browser audio elements play WAV cleanly but not raw mu-law.
        // Force LINEAR16 (16 kHz WAV) so the operator hears full
        // wideband quality while auditioning a voice — even though
        // saved greetings go out as mu-law to Asterisk.
        audioEncoding: 'LINEAR16',
      }
    );
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (e) {
    console.error('POST /tts/preview error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// List IVRs for an org. Includes menu options for builder-side rendering.
app.get('/api/v1/ivrs', authenticateOrg, async (req, res) => {
  try {
    const { Ivr, IvrMenu } = require('./models');
    const ivrs = await Ivr.findAll({
      where: { org_id: req.orgId },
      include: [{ model: IvrMenu, as: 'menuOptions' }],
      order: [['created_at', 'DESC'], [{ model: IvrMenu, as: 'menuOptions' }, 'order', 'ASC']],
    });
    res.json(ivrs);
  } catch (error) {
    console.error('GET /ivrs error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/ivrs/:id', authenticateOrg, async (req, res) => {
  try {
    const { Ivr, IvrMenu } = require('./models');
    const ivr = await Ivr.findOne({
      where: { id: req.params.id, org_id: req.orgId },
      include: [{ model: IvrMenu, as: 'menuOptions' }],
    });
    if (!ivr) return res.status(404).json({ error: 'IVR not found' });
    res.json(ivr);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper: check that `extension` isn't already taken within the org (and
// doesn't collide with another tenant-reserved number like a user ext or
// queue number). Called from both POST and PUT to keep the rule in one
// place; also guards against DBs where the unique index somehow wasn't
// applied (e.g. auto-sync tables before the migration ran).
async function assertIvrExtensionFree(orgId, extension, { ignoreIvrId = null } = {}) {
  const { Ivr, User, Queue } = require('./models');

  const otherIvr = await Ivr.findOne({
    where: { org_id: orgId, extension, ...(ignoreIvrId ? { id: { [require('sequelize').Op.ne]: ignoreIvrId } } : {}) },
  });
  if (otherIvr) {
    const e = new Error(`Extension ${extension} is already used by IVR "${otherIvr.name}"`);
    e.statusCode = 409;
    throw e;
  }

  // Also reject if an existing user or queue owns the same number — saves
  // surprises when the IVR is later published and Asterisk picks whichever
  // entry it saw last.
  const clashUser = await User.findOne({ where: { org_id: orgId, extension } });
  if (clashUser) {
    const e = new Error(`Extension ${extension} is already assigned to user "${clashUser.username || clashUser.full_name || clashUser.id}"`);
    e.statusCode = 409;
    throw e;
  }
  const clashQueue = await Queue.findOne({ where: { org_id: orgId, number: extension } });
  if (clashQueue) {
    const e = new Error(`Extension ${extension} is already used by queue "${clashQueue.name}"`);
    e.statusCode = 409;
    throw e;
  }
}

// Guard against negative / non-finite numeric fields on IVR create + update.
// Asterisk will happily write `WaitExten(-1)` and `GotoIf($[… < -1]?…)`
// into the .conf if we don't stop it — not a crash, but nonsensical config.
function validateIvrNumeric(body) {
  if (body.timeout !== undefined) {
    const t = Number(body.timeout);
    if (!Number.isFinite(t) || t < 0) {
      const e = new Error('timeout must be a non-negative number');
      e.statusCode = 400;
      throw e;
    }
  }
  if (body.max_retries !== undefined) {
    const r = Number(body.max_retries);
    if (!Number.isFinite(r) || r < 0) {
      const e = new Error('max_retries must be a non-negative number');
      e.statusCode = 400;
      throw e;
    }
  }
  // timeout_action narrowed to known values so a typo doesn't generate
  // a dialplan that silently falls through to the legacy retry branch.
  if (body.timeout_action !== undefined) {
    const valid = ['retry', 'queue', 'extension', 'hangup'];
    if (!valid.includes(body.timeout_action)) {
      const e = new Error(`timeout_action must be one of: ${valid.join(', ')}`);
      e.statusCode = 400;
      throw e;
    }
    // If routing on timeout, destination is required and must be numeric.
    if ((body.timeout_action === 'queue' || body.timeout_action === 'extension')
        && (!body.timeout_destination || !/^\d+$/.test(String(body.timeout_destination).trim()))) {
      const e = new Error(`timeout_destination must be a numeric ${body.timeout_action} number when timeout_action='${body.timeout_action}'`);
      e.statusCode = 400;
      throw e;
    }
  }
}

app.post('/api/v1/ivrs', authenticateOrg, async (req, res) => {
  try {
    const { Ivr } = require('./models');
    const { name, extension, description, timeout, max_retries, enable_direct_dial,
            greeting_language, greeting_voice, timeout_action, timeout_destination } = req.body;
    if (!name || !extension) return res.status(400).json({ error: 'name and extension required' });

    validateIvrNumeric(req.body);
    await assertIvrExtensionFree(req.orgId, String(extension).trim());

    const ivr = await Ivr.create({
      org_id: req.orgId,
      name: String(name).trim(),
      extension: String(extension).trim(),
      description: description || null,
      // `??` so explicit 0 (= wait forever on WaitExten) is respected.
      timeout: timeout ?? 10,
      max_retries: max_retries ?? 3,
      enable_direct_dial: enable_direct_dial || false,
      greeting_language: greeting_language || 'en-IN',
      greeting_voice: greeting_voice || 'en-IN-Chirp3-HD-Achernar',
      // timeout_action defaults to 'retry' (preserves legacy behavior);
      // timeout_destination only meaningful for 'queue'/'extension'.
      timeout_action: timeout_action || 'retry',
      timeout_destination: timeout_destination || null,
      status: 'active',
    });
    res.status(201).json(ivr);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'An IVR with that extension already exists in this org' });
    }
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/v1/ivrs/:id', authenticateOrg, async (req, res) => {
  try {
    const { Ivr } = require('./models');
    const ivr = await Ivr.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!ivr) return res.status(404).json({ error: 'IVR not found' });

    validateIvrNumeric(req.body);

    // If the caller is changing extension, validate it against every other
    // IVR / user / queue in the org before committing.
    if (req.body.extension !== undefined && String(req.body.extension).trim() !== ivr.extension) {
      await assertIvrExtensionFree(req.orgId, String(req.body.extension).trim(), { ignoreIvrId: ivr.id });
    }

    const allowed = ['name', 'extension', 'description', 'timeout', 'max_retries',
                     'enable_direct_dial', 'invalid_prompt', 'timeout_prompt',
                     'greeting_language', 'greeting_voice',
                     // Multi-model TTS fields — operators can change
                     // the model/style separately from clicking
                     // "Regenerate greeting" so the form's Save button
                     // doesn't silently drop them.
                     'tts_model', 'style_instructions',
                     // No-input timeout routing. timeout_action is
                     // validated by validateIvrNumeric above; the
                     // destination column accepts null when action
                     // is 'retry' or 'hangup'.
                     'timeout_action', 'timeout_destination',
                     'status'];
    const updates = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    // Validate tts_model + style_instructions pairing — Gemini-only
    // prompts. Same gate as the create/regen paths.
    if (updates.tts_model !== undefined) {
      const TTSService = require('./services/ttsService');
      if (!TTSService.MODELS[updates.tts_model]) {
        return res.status(400).json({ error: `Unknown tts_model: ${updates.tts_model}. Valid: ${Object.keys(TTSService.MODELS).join(', ')}` });
      }
    }
    if (updates.style_instructions !== undefined) {
      const TTSService = require('./services/ttsService');
      const effectiveModel = updates.tts_model || ivr.tts_model;
      const modelDef = TTSService.MODELS[effectiveModel];
      if (updates.style_instructions && modelDef && !modelDef.supportsStyleInstructions) {
        return res.status(400).json({ error: `style_instructions is only supported for Gemini TTS models (effective tts_model=${effectiveModel})` });
      }
      // Length cap matches /tts/preview (500 chars).
      if (updates.style_instructions && String(updates.style_instructions).length > 500) {
        return res.status(400).json({ error: 'style_instructions must be ≤ 500 characters' });
      }
      // Normalize empty string to null so equality checks elsewhere
      // don't treat "" vs null as different and trigger no-op regens.
      if (!updates.style_instructions) updates.style_instructions = null;
    }
    await ivr.update(updates);

    // Auto-deploy + reload so the editor's "Save" makes Asterisk's
    // in-memory dialplan match the DB immediately. Without this, IVR
    // setting changes (timeout_action, timeout_destination, etc.)
    // stayed DB-only until the operator clicked "Publish" — root
    // cause of the 2026-05-16 Thangavelu IVR-timeout incident where
    // changing the no-keypress action had no observable effect.
    // Same try/catch shape as the user-status-flip auto-deploy
    // (line ~2184) — failures are warned but don't fail the save.
    try {
      await configDeploymentService.deployOrganizationConfiguration(req.orgId, req.organization.name);
      await configDeploymentService.reloadAsteriskConfiguration();
    } catch (deployErr) {
      console.warn('⚠️ Auto-deploy after IVR save:', deployErr.message);
    }
    res.json(ivr);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Serve the generated TTS greeting WAV so the UI's Play button can stream
// it. Auth via JWT in the `?token=` query (for <audio> tags) OR via the
// internal key + `?org_id=`. Scoped strictly to the IVR's own org so one
// tenant can't play another's audio.
app.get('/api/v1/ivrs/:id/greeting-audio', async (req, res) => {
  const jwt = require('jsonwebtoken');
  const tk = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  let orgId = null;
  if (tk) { try { orgId = jwt.verify(tk, process.env.JWT_SECRET).orgId; } catch {} }
  if (!orgId) {
    const ik = req.headers['x-internal-key'];
    if (ik && ik === process.env.INTERNAL_API_KEY) orgId = req.query.org_id;
  }
  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { Ivr } = require('./models');
    const fs = require('fs');
    const path = require('path');
    const ivr = await Ivr.findOne({ where: { id: req.params.id, org_id: orgId } });
    if (!ivr) return res.status(404).json({ error: 'IVR not found' });
    if (!ivr.greeting_prompt) return res.status(404).json({ error: 'No greeting generated yet' });

    const dir = process.env.ASTERISK_GREETINGS_DIR || '/var/lib/asterisk/sounds/greetings';
    // Prefer the .ulaw (post-2026-05-13 single-format default — Asterisk
    // reads it natively, browsers need it wrapped). Fall through to .wav
    // for legacy IVR greetings.
    const ulawPath = path.join(dir, `${ivr.greeting_prompt}.ulaw`);
    const wavPath = path.join(dir, `${ivr.greeting_prompt}.wav`);
    let body, contentLength;
    if (fs.existsSync(ulawPath)) {
      const raw = fs.readFileSync(ulawPath);
      // Wrap raw mu-law in a WAVE/mu-law header so the browser's
      // <audio> element can decode it. Same payload bytes, 58-byte
      // header prepended.
      body = wrapMulawAsWav(raw);
      contentLength = body.length;
    } else if (fs.existsSync(wavPath)) {
      body = fs.readFileSync(wavPath);
      contentLength = body.length;
    } else {
      return res.status(404).json({ error: 'Greeting file missing on disk' });
    }

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', contentLength);
    res.setHeader('Content-Disposition', `inline; filename="${ivr.greeting_prompt}.wav"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  } catch (error) {
    console.error('GET /ivrs/:id/greeting-audio error:', error.message);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

app.delete('/api/v1/ivrs/:id', authenticateOrg, async (req, res) => {
  try {
    const { Ivr } = require('./models');
    const ivr = await Ivr.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!ivr) return res.status(404).json({ error: 'IVR not found' });

    // Best-effort clean up the TTS wav file
    if (ivr.greeting_prompt) {
      try {
        const TTSService = require('./services/ttsService');
        await (new TTSService()).deleteGreetingAudio(ivr.greeting_prompt + '.wav');
      } catch {}
    }
    await ivr.destroy();  // cascades ivr_menus via FK
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Replace all menu options for an IVR in one request. The visual builder
// will PUT the whole tree every time the admin clicks Save — easier to
// reason about than per-option POST/PUT/DELETE.
app.put('/api/v1/ivrs/:id/menu', authenticateOrg, async (req, res) => {
  try {
    const { Ivr, IvrMenu, sequelize } = require('./models');
    const ivr = await Ivr.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!ivr) return res.status(404).json({ error: 'IVR not found' });

    const options = Array.isArray(req.body?.options) ? req.body.options : [];

    // Validate each option up front so we never half-apply.
    const validActions = ['extension', 'queue', 'ivr', 'voicemail', 'hangup', 'callback', 'ai_agent'];
    const validDigits = /^[0-9*#]$/;
    for (const o of options) {
      if (!validDigits.test(String(o.digit))) return res.status(400).json({ error: `Invalid digit: ${o.digit}` });
      if (!validActions.includes(o.action_type)) return res.status(400).json({ error: `Invalid action_type: ${o.action_type}` });
      if (o.action_type !== 'hangup' && !o.action_destination) {
        return res.status(400).json({ error: `action_destination required for action_type=${o.action_type}` });
      }
    }

    // Wrap the DELETE + re-INSERT loop in a retry-on-deadlock loop.
    // Under concurrent PUTs on the same IVR, InnoDB gap locks on the
    // (ivr_id, digit) unique index sometimes collide — one txn gets
    // ER_LOCK_DEADLOCK (1213) from MySQL, the other commits. Retrying the
    // loser 2-3× is cheap and makes the endpoint safe for builder saves
    // fired in quick succession. If all retries fail, surface 409 rather
    // than a raw 500 so the client can decide to retry / show a banner.
    const MAX_ATTEMPTS = 4;
    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await sequelize.transaction(async (t) => {
          await IvrMenu.destroy({ where: { ivr_id: ivr.id }, transaction: t });
          for (let i = 0; i < options.length; i++) {
            const o = options[i];
            await IvrMenu.create({
              ivr_id: ivr.id,
              digit: String(o.digit),
              action_type: o.action_type,
              action_destination: o.action_destination || null,
              description: o.description || null,
              order: o.order ?? i,
            }, { transaction: t });
          }
        });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        const isDeadlock =
          e?.parent?.code === 'ER_LOCK_DEADLOCK' ||
          e?.original?.code === 'ER_LOCK_DEADLOCK' ||
          /deadlock/i.test(String(e?.message || ''));
        if (!isDeadlock || attempt === MAX_ATTEMPTS) throw e;
        // Exponential backoff with jitter: 25ms, 50ms, 100ms
        await new Promise((r) => setTimeout(r, 25 * 2 ** (attempt - 1) + Math.random() * 10));
      }
    }
    if (lastErr) throw lastErr;

    const refreshed = await Ivr.findByPk(ivr.id, {
      include: [{ model: IvrMenu, as: 'menuOptions' }],
    });

    // Auto-deploy + reload so digit-option changes (entry blocks) hit
    // Asterisk's dialplan immediately. Without this, edits in the
    // builder stayed DB-only until the operator hit "Publish".
    try {
      await configDeploymentService.deployOrganizationConfiguration(req.orgId, req.organization.name);
      await configDeploymentService.reloadAsteriskConfiguration();
    } catch (deployErr) {
      console.warn('⚠️ Auto-deploy after IVR menu save:', deployErr.message);
    }
    res.json(refreshed);
  } catch (error) {
    console.error('PUT /ivrs/:id/menu error:', error.message);
    const isDeadlock =
      error?.parent?.code === 'ER_LOCK_DEADLOCK' ||
      /deadlock/i.test(String(error?.message || ''));
    if (isDeadlock) {
      return res.status(409).json({
        error: 'Menu is being edited by another request — please retry',
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// Generate or regenerate the TTS greeting for an IVR. The editor calls this
// whenever the admin clicks "Generate greeting" in the UI. Writes a .wav
// under /var/lib/asterisk/sounds/greetings/ivr_<ivrId>.wav, stores the
// filename (without extension) on ivr.greeting_prompt, and keeps the source
// text + language + voice on the row for later re-generation.
app.post('/api/v1/ivrs/:id/generate-greeting', authenticateOrg, async (req, res) => {
  try {
    const { Ivr } = require('./models');
    const TTSService = require('./services/ttsService');

    const ivr = await Ivr.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!ivr) return res.status(404).json({ error: 'IVR not found' });

    const { text, language, voice, tts_model, style_instructions } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'text is required' });

    const lang = language || ivr.greeting_language || 'en-IN';
    const vox = voice || ivr.greeting_voice || 'en-IN-Chirp3-HD-Achernar';
    const model = tts_model || ivr.tts_model || 'chirp3-hd';
    const style = style_instructions !== undefined ? style_instructions : ivr.style_instructions;

    // Validate model + style-instructions pairing (Gemini only).
    const modelDef = TTSService.MODELS[model];
    if (!modelDef) {
      return res.status(400).json({ error: `Unknown tts_model: ${model}. Valid: ${Object.keys(TTSService.MODELS).join(', ')}` });
    }
    if (style && !modelDef.supportsStyleInstructions) {
      return res.status(400).json({ error: `style_instructions is only supported for Gemini TTS models (effective tts_model=${model})` });
    }
    if (style && String(style).length > 500) {
      return res.status(400).json({ error: 'style_instructions must be ≤ 500 characters' });
    }

    const tts = new TTSService();
    // saveGreetingAudio expects an id to name the file; use an ivr-namespaced
    // id so multiple orgs' IVRs can't collide on the shared greetings dir.
    const promptKey = `ivr_${ivr.id}`;
    await tts.saveGreetingAudio(promptKey, String(text), lang, vox, {
      model,
      styleInstructions: style || undefined,
    });

    await ivr.update({
      greeting_prompt: `greeting_${promptKey}`,  // matches ttsService's filename scheme, sans .wav
      greeting_text: String(text),
      greeting_language: lang,
      greeting_voice: vox,
      tts_model: model,
      style_instructions: style || null,
    });

    // Auto-deploy + reload. Required at least the FIRST time a
    // greeting is generated for an IVR — the dialplan's `Background()`
    // line uses `welcome` as default until `greeting_prompt` is set,
    // and only a redeploy switches it over. For subsequent regens the
    // dialplan reference doesn't change (prompt name is stable per
    // IVR id) so the reload is a cheap no-op but kept for symmetry
    // with the other IVR endpoints.
    try {
      await configDeploymentService.deployOrganizationConfiguration(req.orgId, req.organization.name);
      await configDeploymentService.reloadAsteriskConfiguration();
    } catch (deployErr) {
      console.warn('⚠️ Auto-deploy after IVR greeting generation:', deployErr.message);
    }

    res.json({
      success: true,
      greeting_prompt: ivr.greeting_prompt,
      language: lang,
      voice: vox,
      tts_model: model,
      style_instructions: ivr.style_instructions,
    });
  } catch (error) {
    console.error('POST /ivrs/:id/generate-greeting error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Publish → regenerates org config (dialplan picks up the new IVR). The
// editor calls this after the admin finalises the tree.
app.post('/api/v1/ivrs/:id/publish', authenticateOrg, async (req, res) => {
  try {
    const { Ivr } = require('./models');
    const ivr = await Ivr.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!ivr) return res.status(404).json({ error: 'IVR not found' });
    await configDeploymentService.deployOrganizationConfiguration(req.orgId, req.organization.name);
    await configDeploymentService.reloadAsteriskConfiguration();
    res.json({ success: true, message: 'IVR published, dialplan regenerated' });
  } catch (error) {
    console.error('POST /ivrs/:id/publish error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════════════════════════════════
// End IVR endpoints
// ══════════════════════════════════════════════════════════════════════
// Default ticket-whatsapp config shape. Returned verbatim when an org has
// not configured the feature, and used to fill in any missing keys on a
// partially-configured org. Without this, the old
//   { enabled: false }
// shortcut was landing on editor clients that then crashed trying to
// read `.statuses.open` on the returned payload.
const DEFAULT_TICKET_WA = {
  enabled: false,
  sender_number: "",
  statuses: {
    open:        { enabled: false, template_name: "", template_language: "en", variable_mapping: {} },
    in_progress: { enabled: false, template_name: "", template_language: "en", variable_mapping: {} },
    closed:      { enabled: false, template_name: "", template_language: "en", variable_mapping: {} },
  },
};
function normalizeTicketWA(cfg) {
  if (!cfg || typeof cfg !== "object") return DEFAULT_TICKET_WA;
  return {
    enabled:       cfg.enabled ?? false,
    sender_number: cfg.sender_number ?? "",
    statuses: {
      open:        cfg.statuses?.open        ?? DEFAULT_TICKET_WA.statuses.open,
      in_progress: cfg.statuses?.in_progress ?? DEFAULT_TICKET_WA.statuses.in_progress,
      closed:      cfg.statuses?.closed      ?? DEFAULT_TICKET_WA.statuses.closed,
    },
  };
}
app.get("/api/v1/settings/ticket-whatsapp", authenticateOrg, async (req, res) => { try { const o = await Organization.findByPk(req.orgId); res.json(normalizeTicketWA(o?.settings?.ticket_whatsapp)); } catch { res.json(DEFAULT_TICKET_WA); } });
app.put("/api/v1/settings/ticket-whatsapp", authenticateOrg, async (req, res) => { try { const o = await Organization.findByPk(req.orgId); const s = o.settings || {}; s.ticket_whatsapp = req.body; await o.update({ settings: s }); res.json(normalizeTicketWA(req.body)); } catch (e) { res.status(500).json({ error: e.message }); } });

// ─── Tickets (MariaDB) ──────────────────────────────────────────────────
// Relational replacement for the Firestore `astrapbx/{orgId}/tickets`
// collection. Currently dual-writes: CDR poller fires both
// events.example.com (Firestore path) AND Ticket.upsertFromCdr.
// Editor + scheduler can read either source until the cutover PR.
//
// All routes are org-scoped via authenticateOrg → req.orgId.

/**
 * GET /api/v1/tickets
 *
 * List the org's tickets with optional filters. Also runs the lazy
 * archive sweep on every list call (no scheduler needed):
 *   - closed > 24h ago    → status='archived', archived_at=NOW()
 *   - archived > 30d ago  → DELETE permanently (storage cap)
 *
 * Query params:
 *   - status   — open | in_progress | closed | archived | all (default: open,in_progress)
 *   - priority — normal | high | urgent (optional filter)
 *   - search   — partial caller_number or caller_name match
 *   - limit    — page size (default 50, max 200)
 *   - offset   — page offset
 */
app.get("/api/v1/tickets", authenticateOrg, async (req, res) => {
  try {
    const { Ticket } = require('./models');
    // Lazy sweep before list — runs in millis on indexed columns.
    Ticket.sweepArchive(req.orgId).catch(err =>
      console.error('tickets sweep failed:', err.message)
    );

    const status = String(req.query.status || 'open,in_progress')
      .toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const priority = req.query.priority ? String(req.query.priority).toLowerCase() : null;
    const search = req.query.search ? String(req.query.search).trim() : null;

    const where = { org_id: req.orgId };
    if (!status.includes('all')) where.status = status;
    if (priority) where.priority = priority;
    if (search) {
      // Match caller_number prefix/suffix OR caller_name substring.
      // search is parameterized via Sequelize Op.like so safe.
      const { Op } = require('sequelize');
      where[Op.or] = [
        { caller_number: { [Op.like]: `%${search.replace(/\D/g, '')}%` } },
        { caller_name:   { [Op.like]: `%${search}%` } },
      ];
    }

    // Header-counts payload: `status_counts` is org-scoped, ignores
    // the caller's filter args, and EXCLUDES `archived` per UI spec.
    // Single grouped query — cheaper than four COUNTs.
    // Sort: actionable tickets (open + in_progress) first, then
    // closed, then archived. Within each group, newest call first.
    // Uses a CASE expression as the primary sort key so the operator
    // sees the work-needed pile at the top of the list regardless of
    // when those tickets were created. Operator feedback 2026-05-16.
    const _seq = require('sequelize');
    const _statusBucket = _seq.literal(
      "CASE WHEN status IN ('open','in_progress') THEN 0 " +
      "WHEN status = 'closed' THEN 1 " +
      "ELSE 2 END"
    );
    const [rows, count, statusGroups] = await Promise.all([
      Ticket.findAll({
        where,
        order: [
          [_statusBucket, 'ASC'],
          ['last_call_at', 'DESC'],
          ['created_at', 'DESC'],
        ],
        limit, offset,
      }),
      Ticket.count({ where }),
      Ticket.findAll({
        where: { org_id: req.orgId, status: ['open', 'in_progress', 'closed'] },
        attributes: [
          'status',
          [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'cnt'],
        ],
        group: ['status'],
        raw: true,
      }),
    ]);
    const status_counts = { open: 0, in_progress: 0, closed: 0 };
    for (const g of statusGroups) {
      if (status_counts[g.status] !== undefined) status_counts[g.status] = Number(g.cnt) || 0;
    }
    res.json({ data: rows, total: count, limit, offset, status_counts });
  } catch (error) {
    console.error('GET /tickets error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/tickets
 * Manual ticket creation by operator (rare — most tickets come from
 * the CDR poller). Body: { caller_number, caller_name?, notes?, priority? }
 */
app.post("/api/v1/tickets", authenticateOrg, async (req, res) => {
  try {
    const { Ticket } = require('./models');
    const { caller_number, caller_name, notes, priority } = req.body || {};
    if (!caller_number) return res.status(400).json({ error: 'caller_number required' });
    const callerKey = Ticket.normalisePhone(caller_number);
    if (!callerKey) return res.status(400).json({ error: 'caller_number invalid' });
    const { ticket, created } = await Ticket.upsertFromCdr({
      org_id: req.orgId,
      callerRaw: caller_number,
      source: 'manual',
      callerName: caller_name || null,
    });
    if (notes || (priority && created)) {
      const patch = {};
      if (notes) patch.notes = notes;
      if (priority && created) patch.priority = priority;
      await ticket.update(patch);
    }
    require('./services/ticketStream').broadcast(req.orgId, { type: 'refresh', ticket_id: ticket.id });
    res.status(created ? 201 : 200).json({ data: ticket, created });
  } catch (error) {
    console.error('POST /tickets error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/v1/tickets/:id
 * Update status / assignee / notes / tags. Closing a ticket stamps
 * closed_at so the lazy archive sweep can pick it up 24h later.
 */
/**
 * GET /api/v1/tickets/:id/events
 *
 * Append-only timeline of call attempts recorded against this
 * ticket — populated by `jobs/ticketsFromCallLogsScheduler.js`. The
 * editor calls this on expand-row to render the "called at 11:00 PM,
 * 12:00 AM, 12:15 AM" list under the parent ticket.
 *
 * Org-scoped: the ticket lookup filters by req.orgId before exposing
 * any event rows, so an operator can't list events for another org's
 * ticket even if they guess the ID.
 *
 * Returns newest-first (operators care most about the latest miss).
 * Cap at 200 events — a single ticket should never accumulate more
 * than that in practice; if it does, the UI shows the most recent
 * window and the operator can act on the count alone.
 */
app.get("/api/v1/tickets/:id/events", authenticateOrg, async (req, res) => {
  try {
    const { Ticket, TicketCallEvent } = require('./models');
    const ticket = await Ticket.findOne({
      where: { id: req.params.id, org_id: req.orgId },
      attributes: ['id'],
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const rows = await TicketCallEvent.findAll({
      where: { ticket_id: ticket.id, org_id: req.orgId },
      order: [['occurred_at', 'DESC']],
      limit: 200,
    });
    res.json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('GET /tickets/:id/events error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch("/api/v1/tickets/:id", authenticateOrg, async (req, res) => {
  try {
    const { Ticket } = require('./models');
    const t = await Ticket.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    const ALLOWED = ['status', 'priority', 'assignee_user_id', 'notes', 'tags'];
    const updates = {};
    for (const k of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) updates[k] = req.body[k];
    }
    // closed_at stamps when status transitions to 'closed'.
    // archived_at is managed by sweepArchive — operator can't set it.
    if (updates.status === 'closed' && t.status !== 'closed') updates.closed_at = new Date();
    if (updates.status && updates.status !== 'closed') updates.closed_at = null;
    await t.update(updates);
    require('./services/ticketStream').broadcast(req.orgId, { type: 'refresh', ticket_id: t.id });
    res.json({ data: t });
  } catch (error) {
    console.error('PATCH /tickets/:id error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/tickets/stream
 *
 * Server-Sent Events stream for live updates. Editor opens one
 * connection per dashboard load and receives `ticket.*` events
 * whenever the org's tickets change. Lightweight alternative to
 * Firestore's onSnapshot — no extra dependency.
 *
 * v1: emits a periodic heartbeat + a "refresh" event after any
 * write (POST/PATCH/internal upsert). Editor refetches on refresh.
 * Server doesn't push individual rows yet — keeps the protocol
 * simple; row deltas can come later if needed.
 */
const ticketStream = require('./services/ticketStream');

app.get("/api/v1/tickets/stream", (req, res) => {
  // Inline auth — EventSource can't set custom headers, so we accept
  // the org JWT via `?token=` query string (same pattern the
  // recording-playback URL uses for <audio> tags). Falls back to
  // Authorization header for non-browser clients.
  const jwt = require('jsonwebtoken');
  const tk = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  let orgId = null;
  if (tk) { try { orgId = jwt.verify(tk, process.env.JWT_SECRET).orgId; } catch {} }
  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // disable nginx proxy buffering
  res.flushHeaders?.();

  ticketStream.register(orgId, res);
  res.write(`event: open\ndata: ${JSON.stringify({ org_id: orgId })}\n\n`);

  // Heartbeat every 25s prevents idle proxies (cloudflare, nginx) from
  // closing the connection at their 30/60s defaults.
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch (e) { /* gone */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    ticketStream.unregister(orgId, res);
  });
});
// Internal endpoint — get ticket-whatsapp config by org_id (for auto-ticket WhatsApp notifications)
app.post("/api/v1/settings/ticket-whatsapp/internal", async (req, res) => {
  const ik = req.headers["x-internal-key"];
  if (!ik || ik !== process.env.INTERNAL_API_KEY) return res.status(401).json({ error: "Unauthorized" });
  try {
    const o = await Organization.findByPk(req.body.org_id);
    res.json(normalizeTicketWA(o?.settings?.ticket_whatsapp));
  } catch { res.json(DEFAULT_TICKET_WA); }
});
app.get("/api/v1/settings/msg91", authenticateOrg, async (req, res) => {
  try {
    const o = await Organization.findByPk(req.orgId);
    const s = o?.settings || {};
    // Support both flat (msg91_authkey) and nested (msg91.authkey) storage
    const authkey = s.msg91_authkey || (s.msg91 && s.msg91.authkey) || "";
    if (authkey) {
      const masked = authkey.slice(0, 6) + "..." + authkey.slice(-4);
      res.json({ configured: true, authkey_masked: masked });
    } else {
      res.json({ configured: false, authkey_masked: "" });
    }
  } catch { res.json({ configured: false, authkey_masked: "" }); }
});
app.put("/api/v1/settings/msg91", authenticateOrg, async (req, res) => {
  try {
    const o = await Organization.findByPk(req.orgId);
    const s = o.settings || {};
    s.msg91_authkey = req.body.authkey;
    await o.update({ settings: JSON.parse(JSON.stringify(s)) });
    const masked = req.body.authkey.slice(0, 6) + "..." + req.body.authkey.slice(-4);
    res.json({ configured: true, authkey_masked: masked });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Internal endpoint — returns raw authkey for server-side proxy (no org JWT needed, internal key only)
app.post("/api/v1/settings/msg91/key", async (req, res) => {
  const ik = req.headers["x-internal-key"];
  if (!ik || ik !== process.env.INTERNAL_API_KEY) return res.status(401).json({ error: "Unauthorized" });
  try {
    const o = await Organization.findByPk(req.body.org_id);
    const s = o?.settings || {};
    const authkey = s.msg91_authkey || (s.msg91 && s.msg91.authkey) || "";
    res.json({ authkey });
  } catch { res.json({ authkey: "" }); }
});

// Internal endpoint — returns the org's bot extensions (users with routing_type='ai_agent').
// Used by the auto-ticket classifier (LogsUpdate) to know which extensions to apply
// the 8-second bot-dropped check to. Replaces a hardcoded global list that
// false-positived for any org reusing extension numbers like 1003/1012/1013.
app.post("/api/v1/users/internal/bot-extensions", async (req, res) => {
  const ik = req.headers["x-internal-key"];
  if (!ik || ik !== process.env.INTERNAL_API_KEY) return res.status(401).json({ error: "Unauthorized" });
  try {
    const users = await User.findAll({
      where: { org_id: req.body.org_id, routing_type: 'ai_agent', status: 'active' },
      attributes: ['extension'],
    });
    res.json({ extensions: users.map(u => u.extension).filter(Boolean) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ============== CALL LOGS — Enterprise API ==============
// GET /api/v1/calls — paginated call logs with filtering
// Supports: limit, offset, direction, disposition, from, to, date_from, date_to, search
app.get('/api/v1/calls', authenticateOrg, async (req, res) => {
  try {
    const orgId = req.orgId;
    const org = req.organization;
    const prefix = org?.context_prefix || '';
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const { direction, disposition, from, to, date_from, date_to, search } = req.query;

    // Base match: org ownership via accountcode, peeraccount, or channel
    // prefix. DO NOT add an unscoped `dcontext = 'ai-outbound'` clause here —
    // it would show every org's ai-outbound calls to every other org (the
    // GE-leaked-to-Zauto-AI incident on 2026-04-18). ai-outbound rows are
    // still matched via t.accountcode (the workflow engine always sets it).
    const conditions = [
      "(t.accountcode = ? OR t.peeraccount = ? OR t.channel LIKE ?)",
      "(t.channel NOT LIKE 'Local/%' OR t.dstchannel LIKE 'PJSIP/%')",
      "NOT (t.disposition = 'ANSWERED' AND t.billsec = 0 AND t.dcontext != 'ai-outbound')",
      "t.dst != 's'"
    ];
    const params = [orgId, orgId, '%' + prefix + '%'];

    // Optional filters
    if (direction && direction !== 'all') {
      if (direction === 'inbound') conditions.push("t.dcontext LIKE '%incoming%'");
      else if (direction === 'outbound') conditions.push("(t.dcontext LIKE '%outbound%' OR t.dcontext = 'ai-outbound')");
      else if (direction === 'internal') conditions.push("t.dcontext LIKE '%internal%'");
    }
    if (disposition) {
      conditions.push("t.disposition = ?");
      params.push(disposition.toUpperCase());
    }
    if (from) {
      conditions.push("t.src LIKE ?");
      params.push('%' + from.replace(/\D/g, '') + '%');
    }
    if (to) {
      conditions.push("(t.dst LIKE ? OR t.dstchannel LIKE ?)");
      params.push('%' + to.replace(/\D/g, '') + '%', '%' + to.replace(/\D/g, '') + '%');
    }
    if (date_from) {
      conditions.push("t.calldate >= ?");
      params.push(date_from);
    }
    if (date_to) {
      conditions.push("t.calldate < DATE_ADD(?, INTERVAL 1 DAY)");
      params.push(date_to);
    }
    if (search) {
      conditions.push("(t.src LIKE ? OR t.dst LIKE ? OR t.clid LIKE ?)");
      const s = '%' + search + '%';
      params.push(s, s, s);
    }

    const where = "WHERE " + conditions.join(" AND ");

    // Total count (distinct by linkedid to count calls, not channel legs)
    const countResult = await sequelize.query(
      `SELECT COUNT(DISTINCT t.linkedid) as total FROM asterisk_cdr t ${where}`,
      { replacements: params, type: sequelize.QueryTypes.SELECT }
    );
    const total = countResult[0]?.total || 0;

    // Main query — dedup by linkedid.
    //
    // Tiebreaker: prefer rows where a member actually answered with
    // talk time (ANSWERED + billsec > 0), then longest duration.
    // Previously this used `ORDER BY duration DESC` which picked the
    // failed first round (75s NO ANSWER) over the successful second
    // round (45s ANSWERED) when a queue retried — showing "Missed"
    // on calls operators actually spoke on. Same fix landed for the
    // CDR poller (pollCdr) and /calls/history; this endpoint was
    // missed in earlier PRs.
    //
    // to_number JOINs queue_members + users to resolve the per-member
    // `qm<hex>` Local-channel handle back to the answering user's
    // extension. Without this JOIN the brackets in "Queue NNNN [...]"
    // leaked the raw 34-char internal token to the operator UI.
    const rows = await sequelize.query(
      `SELECT
        -- Raw CDR fields (everything Asterisk stores)
        t.id,
        t.calldate,
        t.clid,
        t.src,
        t.dst,
        t.dcontext,
        t.channel,
        t.dstchannel,
        t.lastapp,
        t.lastdata,
        t.duration,
        t.billsec,
        t.disposition,
        t.amaflags,
        t.accountcode,
        t.uniqueid,
        t.linkedid,
        t.userfield,
        t.recordingfile,
        t.peeraccount,
        t.sequence,
        CASE SUBSTRING_INDEX(t.userfield, '|', 1)
          WHEN '0' THEN 'Not Set'
          WHEN '1' THEN 'Unallocated Number'
          WHEN '16' THEN 'Normal Clearing'
          WHEN '17' THEN 'User Busy'
          WHEN '18' THEN 'No User Responding'
          WHEN '19' THEN 'No Answer'
          WHEN '21' THEN 'Call Rejected'
          WHEN '27' THEN 'Destination Out of Order'
          WHEN '31' THEN 'Normal Unspecified'
          WHEN '34' THEN 'No Circuit Available'
          WHEN '38' THEN 'Network Out of Order'
          WHEN '127' THEN 'Interworking'
          ELSE CONCAT('Cause ', SUBSTRING_INDEX(t.userfield, '|', 1))
        END as hangup_reason,
        t.queue_name,
        t.queue_wait_time,
        t.answered_agent,

        -- Enriched / derived fields
        t.calldate as started_at,
        DATE_ADD(t.calldate, INTERVAL t.duration SECOND) as ended_at,
        t.src as from_number,
        t.clid as caller_id,
        CASE
          WHEN t.lastapp = 'Queue' AND t.disposition = 'ANSWERED' AND t.dstchannel LIKE 'Local/%' AND u.extension IS NOT NULL
            THEN CONCAT('Queue ', SUBSTRING_INDEX(SUBSTRING_INDEX(t.lastdata, ',', 1), '_', -1), ' [', u.extension, ']')
          WHEN t.lastapp = 'Queue'
            THEN CONCAT('Queue ', SUBSTRING_INDEX(SUBSTRING_INDEX(t.lastdata, ',', 1), '_', -1))
          WHEN t.dst LIKE 'qm%' AND CHAR_LENGTH(t.dst) = 34 AND u.extension IS NOT NULL
            THEN u.extension
          WHEN t.dst LIKE 'qm%' AND CHAR_LENGTH(t.dst) = 34
            THEN 'queue member'
          ELSE t.dst
        END as to_number,
        t.billsec as talk_time,
        (t.duration - t.billsec) as wait_time,
        CASE
          WHEN t.dcontext = 'ai-outbound' THEN 'outbound'
          WHEN t.dcontext LIKE '%incoming%' THEN 'inbound'
          WHEN t.dcontext LIKE '%outbound%' THEN 'outbound'
          ELSE 'internal'
        END as direction,
        CASE
          WHEN t.dstchannel LIKE 'PJSIP/%'
            THEN SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(t.dstchannel, '/', -1), '-', 1), '_', -1)
          WHEN t.dstchannel LIKE 'Local/%'
            THEN SUBSTRING_INDEX(SUBSTRING_INDEX(t.dstchannel, '/', -1), '@', 1)
          ELSE NULL
        END as rang_extension,
        CASE
          WHEN t.disposition = 'ANSWERED' AND t.dstchannel LIKE 'PJSIP/%'
            THEN SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(t.dstchannel, '/', -1), '-', 1), '_', -1)
          ELSE NULL
        END as answered_by,
        CASE
          WHEN t.disposition != 'ANSWERED' THEN NULL
          WHEN t.dstchannel LIKE 'PJSIP/%' THEN 'human'
          WHEN t.dstchannel LIKE 'Local/%' THEN 'queue'
          -- Empty dstchannel = the channel was Answer()ed by the
          -- dialplan itself with no peer bridge. Two distinct cases:
          --   (a) Real AI agent. The dialplan invoked Stasis() with
          --       the ai_agent application argument. We detect this
          --       via lastapp=Stasis OR lastdata containing the
          --       ai_agent invocation pattern. The OR-on-lastdata is
          --       a defensive widening for cases where post-Stasis
          --       dialplan continuation (h-extension, hangup handler)
          --       overwrites lastapp but leaves the original Stasis
          --       args visible in lastdata.
          --   (b) anything else (Playback / Hangup / etc.) → the
          --       dialplan played a system message ("the person at
          --       extension N is not available" after a failed Dial)
          --       and nobody actually picked up.
          -- Conflating these two was the V7-hotel bug where every
          -- internal call to an unreachable extension was reported
          -- as "AI Handled" even though the org has no AI users.
          WHEN (t.dstchannel = '' OR t.dstchannel IS NULL)
               AND (t.lastapp = 'Stasis' OR t.lastdata LIKE '%,ai_agent,%')
            THEN 'prompt'
          WHEN t.dstchannel = '' OR t.dstchannel IS NULL THEN 'dialplan'
          ELSE 'other'
        END as answered_type,
        CASE
          WHEN t.lastapp = 'Queue' AND (t.queue_name IS NULL OR t.queue_name = '')
            THEN SUBSTRING_INDEX(SUBSTRING_INDEX(t.lastdata, ',', 1), '_', -1)
          ELSE t.queue_name
        END as queue_name_display,
        SUBSTRING_INDEX(t.userfield, '|', 1) as hangup_cause,
        CASE WHEN t.userfield LIKE '%|%' THEN SUBSTRING_INDEX(t.userfield, '|', -1) ELSE NULL END as hangup_source,
        CASE
          WHEN t.userfield LIKE '%|%' AND SUBSTRING_INDEX(t.userfield, '|', -1) = t.channel THEN 'caller'
          WHEN t.userfield LIKE '%|%' AND SUBSTRING_INDEX(t.userfield, '|', -1) = t.dstchannel THEN 'callee'
          WHEN t.userfield LIKE '%|%' AND SUBSTRING_INDEX(t.userfield, '|', -1) LIKE CONCAT('%', SUBSTRING_INDEX(t.channel, '-', 1), '%') THEN 'caller'
          WHEN t.userfield LIKE '%|%' AND SUBSTRING_INDEX(t.userfield, '|', -1) LIKE CONCAT('%', SUBSTRING_INDEX(t.dstchannel, '-', 1), '%') THEN 'callee'
          WHEN t.userfield LIKE '%|%' THEN 'system'
          WHEN t.disposition = 'NO ANSWER' THEN 'timeout'
          WHEN t.disposition = 'BUSY' THEN 'busy'
          WHEN t.disposition IN ('FAILED', 'CONGESTION') THEN 'system'
          WHEN t.disposition = 'ANSWERED' THEN 'normal'
          ELSE 'unknown'
        END as disconnected_by,
        CASE WHEN t.recordingfile != '' AND t.billsec > 0
          THEN CONCAT('/api/v1/calls/', t.id, '/recording')
          ELSE NULL
        END as recording_url
      FROM (
        SELECT t.*,
          ROW_NUMBER() OVER (PARTITION BY linkedid ORDER BY
            CASE WHEN disposition = 'ANSWERED' AND billsec > 0 THEN 0 ELSE 1 END,
            duration DESC, id DESC) as rn,
          CASE
            WHEN dstchannel LIKE 'Local/qm%@%' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(dstchannel, '/', -1), '@', 1)
            WHEN dst LIKE 'qm%' AND CHAR_LENGTH(dst) = 34 THEN dst
            ELSE NULL
          END as qm_token
        FROM asterisk_cdr t ${where}
      ) t
      LEFT JOIN queue_members qm_tbl ON t.qm_token IS NOT NULL AND qm_tbl.id = LOWER(CONCAT_WS('-',
        SUBSTRING(t.qm_token, 3, 8),
        SUBSTRING(t.qm_token, 11, 4),
        SUBSTRING(t.qm_token, 15, 4),
        SUBSTRING(t.qm_token, 19, 4),
        SUBSTRING(t.qm_token, 23, 12)
      ))
      LEFT JOIN users u ON qm_tbl.user_id = u.id
      WHERE rn = 1
      ORDER BY t.calldate DESC
      LIMIT ? OFFSET ?`,
      { replacements: [...params, limit, offset], type: sequelize.QueryTypes.SELECT }
    );

    res.json({
      data: rows,
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + rows.length < total,
      },
    });
  } catch (error) {
    console.error('GET /api/v1/calls error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/calls/history', authenticateOrg, async (req, res) => {
  try {
    const orgId = req.orgId;
    const { direction, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const lim = parseInt(limit);

    // Match by accountcode, peeraccount, OR channel containing org prefix
    const org = req.organization;
    const prefix = org?.context_prefix || '';
    // Same org-scoping as /api/v1/calls — the old `OR dcontext = 'ai-outbound'`
    // clause leaked every org's AI outbound calls to every other org. Removed.
    let whereClause = "WHERE (accountcode = ? OR peeraccount = ? OR channel LIKE ?) AND (channel NOT LIKE 'Local/%' OR dstchannel LIKE 'PJSIP/%') AND NOT (disposition = 'ANSWERED' AND billsec = 0 AND dcontext != 'ai-outbound') AND dst != 's'";
    const params = [orgId, orgId, '%' + prefix + '%'];

    if (direction && direction !== 'all') {
      if (direction === 'inbound') whereClause += " AND dcontext LIKE '%incoming%'";
      else if (direction === 'outbound') whereClause += " AND dcontext LIKE '%outbound%'";
      else if (direction === 'internal') whereClause += " AND dcontext LIKE '%internal%'";
    }

    const countResult = await sequelize.query(
      "SELECT COUNT(DISTINCT linkedid) as total FROM asterisk_cdr " + whereClause,
      { replacements: params, type: sequelize.QueryTypes.SELECT }
    );
    const total = countResult[0]?.total || 0;

    // Asterisk emits one CDR per channel leg, so a single call can produce
    // 2-3 rows with the same linkedid AND a queue retry can produce a
    // SECOND parent row when the first round timed out and the queue
    // re-dialed members. Use ROW_NUMBER() to keep one row per linkedid:
    //  1) prefer rows that were actually answered with talk time (so a
    //     "missed→retry→answered" call shows as Completed, not Missed),
    //  2) then prefer the longest leg, breaking final ties by id.
    // Bug fixed 2026-05-15: prod call 1778864794.938 had Round 1
    // duration=64s NO_ANSWER and Round 2 duration=36s ANSWERED. The old
    // `ORDER BY duration DESC` picked Round 1 → UI showed Missed on a
    // call the operator actually spoke on.
    //
    // The to_number CASE puts the answered member's extension digits in
    // brackets (e.g., "Queue 5002 [1009]") rather than the internal
    // `qm<hex>` channel handle. The UI's parseQueueTo + contact resolver
    // then renders "Reception Br1 → Landline" instead of leaking the
    // qm<hex> string to operators.
    const rows = await sequelize.query(
      "SELECT t.id, t.calldate as started_at, DATE_ADD(t.calldate, INTERVAL t.duration SECOND) as ended_at, " +
      "t.src as from_number, " +
      // to_number resolution priority (highest first):
      //   1. ANSWERED Queue call with Local member → "Queue NNNN [ext]"
      //   2. Any Queue call (even unanswered) → "Queue NNNN"
      //   3. dst is a bare qm<hex> (CDR row for a member-leg attempt
      //      that won the partition) → render the resolved member's
      //      extension instead of the internal handle
      //   4. else → t.dst as-is
      "CASE WHEN t.lastapp = 'Queue' AND t.disposition = 'ANSWERED' AND t.dstchannel LIKE 'Local/%' AND u.extension IS NOT NULL " +
      "THEN CONCAT('Queue ', SUBSTRING_INDEX(SUBSTRING_INDEX(t.lastdata, ',', 1), '_', -1), ' [', u.extension, ']') " +
      "WHEN t.lastapp = 'Queue' THEN CONCAT('Queue ', SUBSTRING_INDEX(SUBSTRING_INDEX(t.lastdata, ',', 1), '_', -1)) " +
      "WHEN t.dst LIKE 'qm%' AND CHAR_LENGTH(t.dst) = 34 AND u.extension IS NOT NULL THEN u.extension " +
      "WHEN t.dst LIKE 'qm%' AND CHAR_LENGTH(t.dst) = 34 THEN 'queue member' " +
      "ELSE t.dst END as to_number, " +
      "t.duration, t.billsec as talk_time, t.disposition as status, t.accountcode as org_id, t.channel as channel_id, " +
      "t.uniqueid as call_id, t.linkedid, t.recordingfile as recording_file, " +
      "CASE WHEN t.dcontext = 'ai-outbound' THEN 'outbound' WHEN t.dcontext LIKE '%incoming%' THEN 'inbound' WHEN t.dcontext LIKE '%outbound%' THEN 'outbound' ELSE 'internal' END as direction, " +
      "CASE WHEN t.recordingfile != '' AND t.billsec > 0 THEN CONCAT('/api/v1/calls/', t.id, '/recording') ELSE NULL END as recording_url " +
      "FROM (" +
      "  SELECT *, ROW_NUMBER() OVER (PARTITION BY linkedid ORDER BY " +
      "    CASE WHEN disposition = 'ANSWERED' AND billsec > 0 THEN 0 ELSE 1 END, " +
      "    duration DESC, id DESC) as rn, " +
      // qm_token extracts the 34-char `qm<32-hex>` member-handle from
      // wherever it appears on the row: either inside dstchannel as
      // `Local/qm<hex>@<ctx>...`, or as t.dst directly when the row
      // is for a Local-channel-side CDR. NULL when no qm handle is
      // present (regular non-queue calls).
      "    CASE " +
      "      WHEN dstchannel LIKE 'Local/qm%@%' " +
      "        THEN SUBSTRING_INDEX(SUBSTRING_INDEX(dstchannel, '/', -1), '@', 1) " +
      "      WHEN dst LIKE 'qm%' AND CHAR_LENGTH(dst) = 34 " +
      "        THEN dst " +
      "      ELSE NULL " +
      "    END as qm_token " +
      "  FROM asterisk_cdr " + whereClause +
      ") t " +
      // Resolve the qm<hex> token back to queue_members.id and the
      // answering user's extension. Local-channel handles always have
      // the format `qm<32-hex>` (= queue_members.id with hyphens
      // stripped, prepended with "qm"). Reassemble the UUID.
      "LEFT JOIN queue_members qm_tbl ON t.qm_token IS NOT NULL AND qm_tbl.id = LOWER(CONCAT_WS('-', " +
      "  SUBSTRING(t.qm_token, 3, 8), " +
      "  SUBSTRING(t.qm_token, 11, 4), " +
      "  SUBSTRING(t.qm_token, 15, 4), " +
      "  SUBSTRING(t.qm_token, 19, 4), " +
      "  SUBSTRING(t.qm_token, 23, 12)" +
      ")) " +
      "LEFT JOIN users u ON qm_tbl.user_id = u.id " +
      "WHERE rn = 1 " +
      "ORDER BY t.calldate DESC LIMIT ? OFFSET ?",
      { replacements: [...params, lim, offset], type: sequelize.QueryTypes.SELECT }
    );

    res.json({ items: rows, total, page: parseInt(page), pages: Math.ceil(total / lim), hasMore: offset + rows.length < total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Dashboard stats — weekly call breakdown + totals
app.get('/api/v1/calls/stats', authenticateOrg, async (req, res) => {
  try {
    const orgId = req.orgId;
    const org = req.organization;
    const prefix = org?.context_prefix || '';
    const matchClause = "(accountcode = ? OR peeraccount = ? OR channel LIKE ?) AND (channel NOT LIKE 'Local/%' OR dstchannel LIKE 'PJSIP/%') AND NOT (disposition = 'ANSWERED' AND billsec = 0 AND dcontext != 'ai-outbound')";
    const matchParams = [orgId, orgId, '%' + prefix + '%'];

    // Weekly breakdown (last 7 days, grouped by date)
    const weekly = await sequelize.query(
      "SELECT DATE(calldate) as day, " +
      "SUM(CASE WHEN dcontext LIKE '%incoming%' THEN 1 ELSE 0 END) as inbound, " +
      "SUM(CASE WHEN dcontext LIKE '%outbound%' THEN 1 ELSE 0 END) as outbound, " +
      "COUNT(DISTINCT linkedid) as total " +
      "FROM asterisk_cdr WHERE " + matchClause + " AND calldate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) " +
      "GROUP BY DATE(calldate) ORDER BY day ASC",
      { replacements: matchParams, type: sequelize.QueryTypes.SELECT }
    );

    // Totals (all time)
    const totals = await sequelize.query(
      "SELECT COUNT(DISTINCT linkedid) as total_calls, " +
      "SUM(CASE WHEN dcontext LIKE '%incoming%' THEN 1 ELSE 0 END) as inbound, " +
      "SUM(CASE WHEN dcontext LIKE '%outbound%' THEN 1 ELSE 0 END) as outbound, " +
      "SUM(CASE WHEN disposition = 'ANSWERED' AND billsec > 0 THEN 1 ELSE 0 END) as answered, " +
      "SUM(CASE WHEN disposition = 'NO ANSWER' THEN 1 ELSE 0 END) as missed, " +
      "ROUND(AVG(CASE WHEN billsec > 0 THEN billsec ELSE NULL END)) as avg_duration " +
      "FROM asterisk_cdr WHERE " + matchClause,
      { replacements: matchParams, type: sequelize.QueryTypes.SELECT }
    );

    res.json({
      weekly: weekly.map(w => ({ date: w.day, inbound: parseInt(w.inbound) || 0, outbound: parseInt(w.outbound) || 0 })),
      totals: totals[0] || { total_calls: 0, inbound: 0, outbound: 0, answered: 0, missed: 0, avg_duration: 0 },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================

// Internal endpoint: get JWT for an org (called by editor's admin-org-token)
app.post('/api/v1/auth/admin-token', async (req, res) => {
  try {
    const internalKey = req.headers['x-internal-key'];
    if (!internalKey || internalKey !== process.env.INTERNAL_API_KEY) {
      return res.status(401).json({ error: 'Invalid internal key' });
    }
    const { org_id } = req.body;
    if (!org_id) return res.status(400).json({ error: 'org_id required' });

    const org = await Organization.findByPk(org_id);
    if (!org || org.status !== 'active') {
      return res.status(404).json({ error: 'Organization not found or inactive' });
    }

    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { orgId: org.id, orgName: org.name, apiKey: org.api_key },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Email login: Firebase-authenticated user gets JWT for their org
app.post('/api/v1/auth/email-login', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });

    // Find org where contact_info.email matches
    const orgs = await Organization.findAll({ where: { status: 'active' } });
    const org = orgs.find(o => {
      const contact = o.contact_info || {};
      return contact.email && contact.email.toLowerCase() === email.toLowerCase();
    });

    if (!org) {
      return res.status(404).json({ error: 'No organization found for this email' });
    }

    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { orgId: org.id, orgName: org.name, apiKey: org.api_key },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      organization: { id: org.id, name: org.name },
      user: { email, role: 'admin' }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Get SIP password for a specific user (for QR code display)
app.get('/api/v1/users/:id/sip-credentials', authenticateOrg, async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.id, org_id: req.orgId },
      attributes: ['id', 'extension', 'asterisk_endpoint', 'sip_password']
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ sip_password: user.sip_password, endpoint: user.asterisk_endpoint, extension: user.extension });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Serve call recording audio file
app.get('/api/v1/calls/:callId/recording', async (req, res) => {
  // Auth: accept JWT from query param (for audio tags) or header
  const jwt = require('jsonwebtoken');
  const tk = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  let orgId = null;
  if (tk) { try { const d = jwt.verify(tk, process.env.JWT_SECRET); orgId = d.orgId; } catch {} }
  if (!orgId) { const ik = req.headers['x-internal-key']; if (ik && ik === process.env.INTERNAL_API_KEY) orgId = req.query.org_id; }
  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });
  req.orgId = orgId;

  // RBAC: check recording permission from user JWT
  try {
    const decoded = jwt.verify(tk, process.env.JWT_SECRET);
    if (decoded.role && !['owner', 'admin', 'manager'].includes(decoded.role)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Agents cannot access recordings. Contact your manager.' });
    }
  } catch {}

  try {
    const path = require("path");
    const fs = require("fs");
    const { execFile, spawn } = require("child_process");

    const MONITOR_DIR = "/var/spool/asterisk/monitor";
    const ALT_DIR = "/var/spool/asterisk/recording";
    const STITCH_DIR = path.join(MONITOR_DIR, "stitched");
    // Source-leg cache lives OUTSIDE monitor/ so it can't be swept to Firebase
    // by the flat rclone move in move-recordings.sh.
    const STITCH_SRC_DIR = "/var/spool/asterisk/stitch-src";
    try { fs.mkdirSync(STITCH_DIR, { recursive: true }); } catch {}
    try { fs.mkdirSync(STITCH_SRC_DIR, { recursive: true }); } catch {}

    // Resolve local path for a recordingfile, fetching from Firebase if needed.
    const resolveLocal = async (filename) => {
      let p = path.join(MONITOR_DIR, filename);
      if (fs.existsSync(p)) return p;
      p = path.join(ALT_DIR, filename);
      if (fs.existsSync(p)) return p;
      // Fetch from cloud storage via rclone into the dedicated src cache.
      // Opt-in: no default bucket (see api/scripts/move-recordings.sh).
      const cached = path.join(STITCH_SRC_DIR, filename);
      if (fs.existsSync(cached)) return cached;
      if (!GCS_BUCKET) return null;
      const rclonePath = `firebase:${GCS_BUCKET}/${GCS_BUCKET_PATH}/${filename}`;
      const ok = await new Promise((resolve) => {
        execFile("rclone", ["copyto", rclonePath, cached, "--timeout", "20s"], { timeout: 30000 }, (err) => resolve(!err));
      });
      return ok && fs.existsSync(cached) ? cached : null;
    };

    // ffprobe a local file for its real duration (seconds, float).
    const probeDuration = (p) => new Promise((resolve) => {
      execFile("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], { timeout: 10000 }, (err, stdout) => {
        if (err) return resolve(null);
        const d = parseFloat(String(stdout).trim());
        resolve(isFinite(d) ? d : null);
      });
    });

    // Stream a local audio file with HTTP Range support so the browser
    // <audio> element can seek/scrub. Browsers send `Range: bytes=N-M`
    // on the second request once they know the file length; without a
    // 206 + Content-Range the slider just resets to 0.
    const streamFileWithRange = (filePath, mimeType, downloadName, extraHeaders) => {
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;
      const headersBase = {
        "Accept-Ranges": "bytes",
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${downloadName}"`,
        ...(extraHeaders || {}),
      };
      if (range) {
        // Format: "bytes=START-END" where END is optional.
        const m = /bytes=(\d+)-(\d*)/.exec(range);
        if (m) {
          const start = parseInt(m[1], 10);
          const end = m[2] ? parseInt(m[2], 10) : fileSize - 1;
          if (start >= fileSize || end >= fileSize || start > end) {
            res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
            return res.end();
          }
          res.writeHead(206, {
            ...headersBase,
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Content-Length": end - start + 1,
          });
          return fs.createReadStream(filePath, { start, end }).pipe(res);
        }
      }
      res.writeHead(200, { ...headersBase, "Content-Length": fileSize });
      return fs.createReadStream(filePath).pipe(res);
    };

    // Look up the anchor CDR row (by id) first — this is the row the UI links to.
    let anchor = null;
    const callRec = await CallRecord.findOne({ where: { id: req.params.callId, org_id: req.orgId } });
    if (callRec && callRec.recording_file) {
      // The CallRecord model doesn't declare `asterisk_linkedid` so we
      // pull it via raw SQL. Without the linkedid we'd never find sibling
      // legs and would always serve a single recording even on multi-leg
      // calls — that masked the legitimate "give me the whole call's
      // audio" feature.
      const linkRows = await sequelize.query(
        "SELECT asterisk_linkedid FROM call_records WHERE id = ?",
        { type: sequelize.QueryTypes.SELECT, replacements: [req.params.callId] }
      );
      const linkedid = linkRows && linkRows[0] ? linkRows[0].asterisk_linkedid : null;
      anchor = {
        recordingfile: callRec.recording_file,
        linkedid: linkedid || null,
        accountcode: req.orgId,
      };
    } else {
      // P0 security: scope by accountcode so an authenticated user from
      // org A cannot stream org B's recording by passing org B's CDR id.
      // The req.orgId comes from the verified JWT (or INTERNAL_API_KEY
      // path with explicit org_id) above.
      const rows = await sequelize.query(
        "SELECT id, linkedid, accountcode, recordingfile FROM asterisk_cdr WHERE id = ? AND accountcode = ?",
        { type: sequelize.QueryTypes.SELECT, replacements: [req.params.callId, req.orgId] }
      );
      if (rows && rows[0]) anchor = rows[0];
    }
    if (!anchor || !anchor.recordingfile) return res.status(404).json({ error: "No recording" });

    // Find every leg of the same linkedid that has a recording. Order by
    // calldate, id — matches how the call progressed in real time.
    let legFiles = [];
    if (anchor.linkedid) {
      const siblings = await sequelize.query(
        "SELECT recordingfile FROM asterisk_cdr WHERE linkedid = ? AND accountcode = ? AND recordingfile IS NOT NULL AND recordingfile != '' ORDER BY calldate ASC, id ASC",
        { type: sequelize.QueryTypes.SELECT, replacements: [anchor.linkedid, anchor.accountcode || ''] }
      );
      const seen = new Set();
      for (const r of siblings) {
        if (!seen.has(r.recordingfile)) { seen.add(r.recordingfile); legFiles.push(r.recordingfile); }
      }
    }
    if (legFiles.length === 0) legFiles = [anchor.recordingfile];

    auditLog(orgId, 'recording.play', 'recording', req.params.callId, { linkedid: anchor.linkedid, legs: legFiles }, req);

    // Single-leg short circuit — serve the file with Range support.
    if (legFiles.length === 1) {
      const only = legFiles[0];
      const local = await resolveLocal(only);
      if (!local) return res.status(404).json({ error: "Recording not found on disk or storage", file: only });
      return streamFileWithRange(local, "audio/wav", only);
    }

    // Multi-leg: stitch with ffmpeg and cache by linkedid.
    const safeLinkedid = String(anchor.linkedid).replace(/[^a-zA-Z0-9._-]/g, '_');
    const stitchedPath = path.join(STITCH_DIR, `${safeLinkedid}.wav`);
    const stitchedName = `call-${safeLinkedid}.wav`;
    const stitchedRemote = GCS_BUCKET
      ? `firebase:${GCS_BUCKET}/${GCS_BUCKET_PATH}/stitched/${safeLinkedid}.wav`
      : null;

    // Fast path: serve local cached stitch if present, with Range support.
    if (fs.existsSync(stitchedPath)) {
      return streamFileWithRange(stitchedPath, "audio/wav", stitchedName, {
        "X-Recording-Legs": String(legFiles.length),
        "X-Recording-Source": "stitched-local",
      });
    }

    // Secondary: pre-built stitch already in Firebase (produced by the hourly
    // stitch-recordings cron). Stream directly via rclone cat.
    // Note: rclone cat doesn't support Range, so seek doesn't work in this
    // path. Acceptable trade-off — the next request after this populates
    // the local cache, and subsequent requests get full Range support.
    const remoteMeta = !stitchedRemote ? null : await new Promise((resolve) => {
      execFile("rclone", ["size", stitchedRemote, "--json"], { timeout: 10000 }, (err, stdout) => {
        if (err) return resolve(null);
        try { return resolve(JSON.parse(stdout)); } catch { return resolve(null); }
      });
    });
    if (remoteMeta && remoteMeta.count > 0) {
      res.setHeader("Content-Type", "audio/wav");
      if (remoteMeta.bytes) res.setHeader("Content-Length", remoteMeta.bytes);
      res.setHeader("Content-Disposition", `inline; filename="${stitchedName}"`);
      res.setHeader("X-Recording-Legs", String(legFiles.length));
      res.setHeader("X-Recording-Source", "stitched-remote");
      const rc = spawn("rclone", ["cat", stitchedRemote]);
      rc.stdout.pipe(res);
      rc.stderr.on("data", (d) => console.error("rclone err:", d.toString()));
      rc.on("error", () => { if (!res.headersSent) res.status(500).end(); });
      return;
    }

    // Fallback: resolve inputs (fetching from Firebase if needed) and stitch now.
    //
    // Multi-leg deduplication — fixes the "5-minute call recorded as 10 min
    // of the same audio twice" bug. Asterisk's MixMonitor on each leg records
    // BOTH sides of that leg via the bridge, so when a call passes through a
    // queue and an answering agent, the queue-side leg and the agent-side leg
    // contain nearly identical conversation audio. Concatenating them back-
    // to-back duplicates the conversation.
    //
    // Fix: use each leg's (mtime - duration) as its real start time and
    // (mtime) as end time. Greedy by duration DESC, keep only legs whose
    // time window does NOT overlap any already-kept leg. This naturally:
    //   • picks the inbound-side MixMonitor that covers the whole call when
    //     it exists (drops redundant agent-leg recordings)
    //   • keeps short ring-no-answer legs that precede the answered leg
    //   • keeps every leg of a real attended-transfer where one ends before
    //     the next begins
    const probedLegs = [];
    for (const f of legFiles) {
      const p = await resolveLocal(f);
      if (!p) continue;
      const dur = await probeDuration(p);
      if (!dur) continue;
      const endTime = fs.statSync(p).mtimeMs / 1000;
      probedLegs.push({ filename: f, path: p, startTime: endTime - dur, endTime, duration: dur });
    }
    if (probedLegs.length === 0) return res.status(404).json({ error: "No recording legs found on disk or storage" });

    // Greedy non-overlap selection. 1s tolerance absorbs MixMonitor open/close
    // jitter on legs that started/ended together.
    const TOL = 1.0;
    const byDurationDesc = [...probedLegs].sort((a, b) => b.duration - a.duration);
    const kept = [];
    for (const leg of byDurationDesc) {
      const overlaps = kept.some(k => leg.startTime < k.endTime - TOL && leg.endTime > k.startTime + TOL);
      if (!overlaps) kept.push(leg);
    }
    kept.sort((a, b) => a.startTime - b.startTime);
    const inputs = kept.map(k => k.path);
    const skipped = probedLegs.length - kept.length;

    if (inputs.length === 1) {
      // After dedup it's a single leg — serve it directly with Range support.
      return streamFileWithRange(inputs[0], "audio/wav", path.basename(inputs[0]), {
        "X-Recording-Legs": `${inputs.length}/${probedLegs.length}`,
        "X-Recording-Source": "dedup-single",
      });
    }

    await new Promise((resolve, reject) => {
      const args = [];
      for (const p of inputs) { args.push('-i', p); }
      const streams = inputs.map((_, i) => `[${i}:a]`).join('');
      args.push(
        '-filter_complex', `${streams}concat=n=${inputs.length}:v=0:a=1[out]`,
        '-map', '[out]',
        '-acodec', 'pcm_s16le', '-ar', '8000', '-ac', '1',
        '-y', stitchedPath
      );
      const ff = spawn('ffmpeg', args);
      let stderr = '';
      ff.stderr.on('data', d => { stderr += d.toString(); });
      ff.on('error', reject);
      ff.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg concat failed: ' + stderr.slice(-400))));
    });

    return streamFileWithRange(stitchedPath, "audio/wav", stitchedName, {
      "X-Recording-Legs": `${inputs.length}/${probedLegs.length}`,
      "X-Recording-Source": skipped > 0 ? "stitched-dedup-ondemand" : "stitched-ondemand",
    });
  } catch (error) {
    console.error('GET /api/v1/calls/:callId/recording error:', error.message);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});


// Call journey — all CDR records for a linked call.
// MUST scope by accountcode (org_id) on the primary SELECT — without it,
// any authenticated org can read any other org's call history by guessing
// a linkedid. Confirmed missing in 2026-05-16 audit (P0 cross-org leak).
app.get('/api/v1/calls/:linkedId/journey', authenticateOrg, async (req, res) => {
  try {
    const rows = await sequelize.query(
      "SELECT id, calldate, src, dst, dcontext, channel, dstchannel, lastapp, lastdata, " +
      "duration, billsec, disposition, uniqueid, linkedid, recordingfile, clid " +
      "FROM asterisk_cdr WHERE linkedid = ? AND accountcode = ? ORDER BY calldate ASC, sequence ASC",
      { replacements: [req.params.linkedId, req.orgId], type: sequelize.QueryTypes.SELECT }
    );

    // Resolve internal Asterisk handles to operator-friendly labels:
    //  - `qm<hex>` (per-member Local channel name) → user.full_name (ext NNNN)
    //  - `<queue-number>` extracted from `lastdata` → queue.name
    // Without this, the UI shows "Ring qm4398f99b…" and "Queue 5002"
    // which leaks internal plumbing to operators and is unreadable
    // during incident triage.
    const qmHexes = new Set();
    const queueNums = new Set();
    for (const r of rows) {
      if (r.channel && r.channel.startsWith('Local/qm')) {
        const tok = r.channel.split('/')[1]?.split('@')[0] || '';
        if (/^qm[a-f0-9]{32}$/.test(tok)) qmHexes.add(tok);
      }
      if (r.lastapp === 'Queue' && r.lastdata) {
        const qn = r.lastdata.split(',')[0]?.split('_').pop();
        if (qn) queueNums.add(qn);
      }
      if (r.lastapp === 'Dial' && r.lastdata) {
        const dialTok = r.lastdata.split(',')[0]?.split('/').pop()?.split('@')[0] || '';
        if (/^qm[a-f0-9]{32}$/.test(dialTok)) qmHexes.add(dialTok);
      }
    }
    const memberByQm = new Map();
    if (qmHexes.size > 0) {
      const memberIds = Array.from(qmHexes).map(qm => {
        const h = qm.slice(2);
        return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
      });
      const memberRows = await sequelize.query(
        "SELECT qm.id, u.extension, u.full_name FROM queue_members qm " +
        "JOIN users u ON qm.user_id = u.id WHERE qm.id IN (?) AND u.org_id = ?",
        { replacements: [memberIds, req.orgId], type: sequelize.QueryTypes.SELECT }
      );
      for (const m of memberRows) {
        memberByQm.set('qm' + m.id.replace(/-/g, ''), m);
      }
    }
    const queueByNum = new Map();
    if (queueNums.size > 0) {
      const queueRows = await sequelize.query(
        "SELECT number, name FROM queues WHERE org_id = ? AND number IN (?)",
        { replacements: [req.orgId, Array.from(queueNums)], type: sequelize.QueryTypes.SELECT }
      );
      for (const q of queueRows) queueByNum.set(String(q.number), q.name);
    }
    const labelForQm = (qm) => {
      const m = memberByQm.get(qm);
      if (!m) return qm;
      return `${m.full_name || 'Unknown'} (ext ${m.extension})`;
    };

    // Build journey steps
    const steps = rows.map(r => {
      let action = r.lastapp || 'Unknown';
      let target = r.dst;
      let status = r.disposition;
      let ext = '';

      if (r.channel && r.channel.startsWith('Local/')) {
        ext = r.channel.split('/')[1]?.split('@')[0] || '';
        action = 'Ring ' + (/^qm[a-f0-9]{32}$/.test(ext) ? labelForQm(ext) : ext);
      }
      if (r.lastapp === 'Queue') {
        const queueNum = (r.lastdata || '').split(',')[0]?.split('_').pop() || '';
        action = 'Queue ' + (queueByNum.get(queueNum) || queueNum);
      }
      if (r.lastapp === 'Playback') {
        action = 'Playback: ' + (r.lastdata || '').split('/').pop();
      }
      if (r.lastapp === 'Dial') {
        const dialTarget = (r.lastdata || '').split(',')[0] || '';
        ext = dialTarget.split('/').pop()?.split('@')[0] || '';
        action = 'Dial ' + (/^qm[a-f0-9]{32}$/.test(ext) ? labelForQm(ext) : ext);
      }
      if (r.lastapp === 'Stasis') {
        action = 'AI Bot';
      }

      return {
        time: r.calldate,
        action,
        from: r.src,
        to: r.dst,
        extension: ext,
        duration: r.duration,
        billsec: r.billsec,
        status: r.disposition,
        channel: r.channel,
        recording: r.recordingfile || null
      };
    }).filter(s => !(s.duration === 0 && s.billsec === 0 && s.action === 'AI Bot'));

    // Summary
    const mainRecord = rows.find(r => !r.channel.startsWith('Local/')) || rows[0];
    const answered = rows.some(r => r.disposition === 'ANSWERED' && r.billsec > 0);
    const answeredBy = rows.find(r => r.disposition === 'ANSWERED' && r.channel.startsWith('Local/'));
    const answeredRawExt = answeredBy ? (answeredBy.channel.split('/')[1]?.split('@')[0] || null) : null;
    // Resolve `qm<hex>` to the user's actual extension so the call-logs
    // "Answered by" cell can use the existing user-extension resolver.
    let answeredExt = answeredRawExt;
    if (answeredRawExt && /^qm[a-f0-9]{32}$/.test(answeredRawExt)) {
      const m = memberByQm.get(answeredRawExt);
      if (m && m.extension) answeredExt = String(m.extension);
    }

    res.json({
      linkedid: req.params.linkedId,
      caller: mainRecord?.src || 'Unknown',
      destination: mainRecord?.dst || 'Unknown',
      status: answered ? 'answered' : 'missed',
      total_duration: Math.max(...rows.map(r => r.duration)),
      answered_by: answeredExt,
      steps
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});




// Admin: regenerate the tata-did-route dispatcher from current did_numbers state.
// Used after editing routing_environment via the DID admin UI. Requires either
// admin JWT (isAdmin: true) or a valid INTERNAL_API_KEY.
app.post('/api/v1/admin/regenerate-gateway', async (req, res) => {
  try {
    const internalKey = req.headers['x-internal-key'];
    let isAuthed = false;
    if (internalKey && internalKey === process.env.INTERNAL_API_KEY) {
      isAuthed = true;
    } else {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) {
        try {
          const decoded = jwt.verify(token, JWT_SECRET);
          if (decoded.isAdmin) isAuthed = true;
        } catch (_) {}
      }
    }
    if (!isAuthed) return res.status(401).json({ error: 'Admin auth required' });

    const ConfigService = require('./services/asterisk/configDeploymentService');
    const configService = new ConfigService();
    const result = await configService.deployGatewayRouting();
    await configService.reloadAsteriskConfiguration();
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('regenerate-gateway error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============== CALLER ID RESOLUTION ==============
// resolveCallerId — single source of truth for outbound CID validation.
// Priority: 1) explicit caller_id (must be assigned to org), 2) org default
// (settings.outbound_caller_id), 3) first assigned DID. Throws with
// statusCode/code so handlers can return a clean 403/400.
async function resolveCallerId(orgId, requestedCid) {
  // Normalize incoming caller_id and match flexibly — Indian local format
  // (08065978002), intl without plus (918065978002), and E.164 (+918065978002)
  // are all equivalent. DB may store any of the three formats.
  const normalize = (v) => {
    if (!v) return null;
    const digits = String(v).replace(/\D/g, '');
    return digits || null;
  };
  const wantDigits = normalize(requestedCid);

  if (wantDigits) {
    // Build equivalent format variants so DB rows stored in any Indian format match
    const variants = new Set([wantDigits, '+' + wantDigits]);
    // Local (08...) 11 digits ↔ intl (918...) 12 digits
    if (wantDigits.length === 11 && wantDigits.startsWith('0')) {
      const intl = '91' + wantDigits.substring(1);
      variants.add(intl);
      variants.add('+' + intl);
    }
    if (wantDigits.length === 12 && wantDigits.startsWith('91')) {
      const local = '0' + wantDigits.substring(2);
      variants.add(local);
      variants.add('+' + local);
    }
    const placeholders = [...variants].map(() => '?').join(',');
    const [row] = await sequelize.query(
      `SELECT number FROM did_numbers WHERE org_id=? AND number IN (${placeholders}) AND pool_status='assigned' AND status='active' LIMIT 1`,
      { replacements: [orgId, ...variants], type: sequelize.QueryTypes.SELECT }
    );
    if (!row) {
      const err = new Error(`caller_id ${requestedCid} is not assigned to your organization`);
      err.statusCode = 403;
      err.code = 'caller_id_not_assigned';
      throw err;
    }
    return row.number;
  }

  // Org default DID (is_default=1) wins over first-by-number fallback
  const [defaultRow] = await sequelize.query(
    "SELECT number FROM did_numbers WHERE org_id=? AND pool_status='assigned' AND status='active' AND is_default=1 LIMIT 1",
    { replacements: [orgId], type: sequelize.QueryTypes.SELECT }
  );
  if (defaultRow) return defaultRow.number;

  const [first] = await sequelize.query(
    "SELECT number FROM did_numbers WHERE org_id=? AND pool_status='assigned' AND status='active' ORDER BY number ASC LIMIT 1",
    { replacements: [orgId], type: sequelize.QueryTypes.SELECT }
  );
  if (first) return first.number;

  const err = new Error('No DID assigned to this organization');
  err.statusCode = 400;
  err.code = 'no_caller_id_available';
  throw err;
}

// ============== AUDIT LOG HELPER ==============
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
}

async function auditLog(orgId, action, resource, resourceId, details = null, req = null) {
  try {
    await sequelize.query(
      `INSERT INTO audit_log (org_id, user_email, action, resource, resource_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      { replacements: [orgId, req?.userEmail || 'system', action, resource, resourceId || null, details ? JSON.stringify(details) : null, req ? getClientIp(req) : null] }
    );
  } catch (e) { console.error('audit_log write failed:', e.message); }
}

// ============== COMPLIANCE SETTINGS API ==============
app.get('/api/v1/compliance', authenticateOrg, requirePermission('compliance.read'), async (req, res) => {
  try {
    const [row] = await sequelize.query(
      'SELECT * FROM org_compliance WHERE org_id = ?',
      { replacements: [req.orgId], type: sequelize.QueryTypes.SELECT }
    );
    if (!row) {
      // Auto-create default
      await sequelize.query('INSERT IGNORE INTO org_compliance (org_id) VALUES (?)', { replacements: [req.orgId] });
      const [created] = await sequelize.query('SELECT * FROM org_compliance WHERE org_id = ?', { replacements: [req.orgId], type: sequelize.QueryTypes.SELECT });
      return res.json(created);
    }
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/v1/compliance', authenticateOrg, requireRole('admin'), async (req, res) => {
  try {
    const allowed = ['recording_enabled', 'recording_consent', 'retention_cdr_days', 'retention_recording_days', 'pii_masking', 'data_encryption'];
    const updates = [];
    const values = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(req.body[key]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    // Ensure row exists
    await sequelize.query('INSERT IGNORE INTO org_compliance (org_id) VALUES (?)', { replacements: [req.orgId] });
    await sequelize.query(`UPDATE org_compliance SET ${updates.join(', ')} WHERE org_id = ?`, { replacements: [...values, req.orgId] });

    await auditLog(req.orgId, 'compliance.update', 'compliance', req.orgId, req.body, req);

    const [row] = await sequelize.query('SELECT * FROM org_compliance WHERE org_id = ?', { replacements: [req.orgId], type: sequelize.QueryTypes.SELECT });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============== RECORDING DELETE (Right to Erasure) ==============
app.delete('/api/v1/calls/:callId/recording', authenticateOrg, requirePermission('calls.delete_recording'), async (req, res) => {
  try {
    const { callId } = req.params;
    const orgId = req.orgId;

    // Find the CDR row
    const [row] = await sequelize.query(
      'SELECT id, recordingfile, accountcode, src, dst FROM asterisk_cdr WHERE id = ? AND (accountcode = ? OR peeraccount = ?)',
      { replacements: [callId, orgId, orgId], type: sequelize.QueryTypes.SELECT }
    );
    if (!row) return res.status(404).json({ error: 'Call not found or not owned by this org' });

    const filename = row.recordingfile;
    if (!filename) return res.status(404).json({ error: 'No recording file associated with this call' });

    const fs = require('fs');
    const path = require('path');
    const deleted = { local: false, gcs: false };

    // Delete from local disk
    const localPath = path.join('/var/spool/asterisk/monitor', filename);
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
      deleted.local = true;
    }

    // Delete from cloud storage, if this install archives anywhere.
    // Skipped entirely when GCS_BUCKET is unset — there is no default bucket to
    // delete from, and guessing one would mean issuing deletes against someone
    // else's storage.
    try {
      if (!GCS_BUCKET) throw new Error('not found: GCS_BUCKET unset, nothing archived remotely');
      const { execSync } = require('child_process');
      execSync(`rclone deletefile firebase:${GCS_BUCKET}/${GCS_BUCKET_PATH}/${filename}`, { timeout: 15000 });
      deleted.gcs = true;
    } catch (e) {
      // File may not exist in GCS (not yet moved or already deleted)
      if (!e.message.includes('not found')) console.error('GCS delete error:', e.message);
    }

    // Clear recording reference in CDR
    await sequelize.query('UPDATE asterisk_cdr SET recordingfile = NULL WHERE id = ?', { replacements: [callId] });

    // Also clear in call_records if exists
    await sequelize.query('UPDATE call_records SET recording_file = NULL, recording_url = NULL WHERE call_id = ?', { replacements: [row.uniqueid || callId] }).catch(() => {});

    // Audit log
    await auditLog(orgId, 'recording.delete', 'recording', callId, {
      filename, caller: row.src, destination: row.dst, deleted_from: deleted
    }, req);

    res.json({ success: true, call_id: callId, filename, deleted_from: deleted });
  } catch (e) {
    console.error('DELETE recording error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============== AUDIT LOG API ==============
app.get('/api/v1/audit-log', authenticateOrg, async (req, res) => {
  try {
    const { action, resource, from, to, limit: lim = 50, offset: off = 0 } = req.query;
    const conditions = ['org_id = ?'];
    const params = [req.orgId];

    if (action) { conditions.push('action = ?'); params.push(action); }
    if (resource) { conditions.push('resource = ?'); params.push(resource); }
    if (from) { conditions.push('created_at >= ?'); params.push(from); }
    if (to) { conditions.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(to); }

    const where = conditions.join(' AND ');
    const limit = Math.min(Math.max(parseInt(lim) || 50, 1), 200);
    const offset = Math.max(parseInt(off) || 0, 0);

    const [{ total }] = await sequelize.query(
      `SELECT COUNT(*) as total FROM audit_log WHERE ${where}`,
      { replacements: params, type: sequelize.QueryTypes.SELECT }
    );

    const rows = await sequelize.query(
      `SELECT * FROM audit_log WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      { replacements: [...params, limit, offset], type: sequelize.QueryTypes.SELECT }
    );

    res.json({ data: rows, pagination: { total, limit, offset, has_more: offset + rows.length < total } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ============== USER MANAGEMENT + RBAC ==============

// User login via Firebase token → returns role-enriched JWT
app.post('/api/v1/auth/user-login', async (req, res) => {
  try {
    // Gate behind USE_FIREBASE flag — OSS-native deployments use
    // /api/v1/auth/login (api_key + api_secret) instead.
    if (process.env.USE_FIREBASE !== 'true') {
      return res.status(503).json({
        error: 'Firebase auth disabled on this server',
        detail: 'Set USE_FIREBASE=true with valid GOOGLE_APPLICATION_CREDENTIALS to enable Firebase mode. For OSS local mode, use POST /api/v1/auth/login with your organisation api_key + api_secret.',
      });
    }

    const { firebase_token, org_id } = req.body;
    if (!firebase_token) return res.status(400).json({ error: 'firebase_token required' });

    // Verify Firebase token
    let firebaseUser;
    try {
      const admin = require('firebase-admin');
      if (!admin.apps.length) {
        const cred = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        admin.initializeApp({ credential: admin.credential.cert(require(cred)) });
      }
      firebaseUser = await admin.auth().verifyIdToken(firebase_token);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid Firebase token', detail: e.message });
    }

    // Find user by firebase_uid or email
    const [user] = await sequelize.query(
      `SELECT u.*, o.name as org_name, o.context_prefix, o.api_key
       FROM org_users u JOIN organizations o ON u.org_id = o.id
       WHERE (u.firebase_uid = ? OR u.email = ?) AND o.status = 'active'
       ${org_id ? 'AND u.org_id = ?' : ''}
       LIMIT 1`,
      { replacements: org_id
        ? [firebaseUser.uid, firebaseUser.email, org_id]
        : [firebaseUser.uid, firebaseUser.email],
        type: sequelize.QueryTypes.SELECT }
    );

    if (!user) {
      // Check if user exists but org is pending approval
      const [pendingUser] = await sequelize.query(
        `SELECT u.*, o.name as org_name, o.status as org_status
         FROM org_users u JOIN organizations o ON u.org_id = o.id
         WHERE (u.firebase_uid = ? OR u.email = ?)
         LIMIT 1`,
        { replacements: [firebaseUser.uid, firebaseUser.email], type: sequelize.QueryTypes.SELECT }
      );
      if (pendingUser && pendingUser.org_status === 'suspended') {
        return res.status(202).json({ status: 'pending_approval', org_name: pendingUser.org_name, message: 'Your organisation is awaiting admin approval.' });
      }
      return res.status(404).json({ error: 'User not found. Contact your org admin for an invite.' });
    }
    if (user.status === 'suspended') return res.status(403).json({ error: 'Account is suspended. Contact your org admin.' });

    // Auto-activate invited users on first successful Firebase login
    if (user.status === 'invited') {
      await sequelize.query('UPDATE org_users SET status = "active" WHERE id = ?', { replacements: [user.id] });
      user.status = 'active';
    }

    // Link firebase_uid if not set yet (first login after invite)
    if (!user.firebase_uid) {
      await sequelize.query('UPDATE org_users SET firebase_uid = ?, status = "active" WHERE id = ?',
        { replacements: [firebaseUser.uid, user.id] });
    }

    // Update last_login
    await sequelize.query('UPDATE org_users SET last_login = NOW() WHERE id = ?', { replacements: [user.id] });

    // Generate role-enriched JWT
    const token = jwt.sign({
      orgId: user.org_id,
      orgName: user.org_name,
      apiKey: user.api_key,
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      permissions: getPermissions(user.role),
    }, JWT_SECRET, { expiresIn: '24h' });

    await auditLog(user.org_id, 'user.login', 'user', user.id, { email: user.email, role: user.role }, req);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        extension: user.extension,
        org_id: user.org_id,
        org_name: user.org_name,
        permissions: getPermissions(user.role),
      },
    });
  } catch (e) {
    console.error('user-login error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Admin impersonation: mint a user-shaped JWT for the org's owner so the admin
// dashboard "Enter org" flow acts as that user instead of the global admin key.
app.post('/api/v1/admin/impersonate/:orgId', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Admin token required' });

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid admin token' });
    }
    if (!decoded.isAdmin) return res.status(403).json({ error: 'Admin access required' });

    const { orgId } = req.params;
    const [target] = await sequelize.query(
      `SELECT u.*, o.name as org_name, o.context_prefix, o.api_key, o.status as org_status
       FROM org_users u JOIN organizations o ON u.org_id = o.id
       WHERE u.org_id = ? AND u.role IN ('owner', 'admin') AND u.status = 'active'
       ORDER BY FIELD(u.role, 'owner', 'admin'), u.created_at ASC
       LIMIT 1`,
      { replacements: [orgId], type: sequelize.QueryTypes.SELECT }
    );

    if (!target) return res.status(404).json({ error: 'No active owner or admin found in org' });
    if (target.org_status !== 'active') return res.status(403).json({ error: 'Organization is not active' });

    const userToken = jwt.sign({
      orgId: target.org_id,
      orgName: target.org_name,
      apiKey: target.api_key,
      userId: target.id,
      email: target.email,
      name: target.name,
      role: target.role,
      permissions: getPermissions(target.role),
      impersonating: true,
      impersonatedBy: decoded.username || 'admin',
    }, JWT_SECRET, { expiresIn: '24h' });

    await auditLog(target.org_id, 'admin.impersonate', 'user', target.id,
      { admin_username: decoded.username, target_email: target.email, target_role: target.role }, req);

    res.json({
      token: userToken,
      user: {
        id: target.id,
        email: target.email,
        name: target.name,
        role: target.role,
        extension: target.extension,
        org_id: target.org_id,
        org_name: target.org_name,
        permissions: getPermissions(target.role),
        impersonating: true,
      },
    });
  } catch (e) {
    console.error('admin/impersonate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Self-serve: request a new organisation (no auth required, Firebase token needed)
app.post('/api/v1/auth/request-org', async (req, res) => {
  try {
    // Gate behind USE_FIREBASE flag.
    if (process.env.USE_FIREBASE !== 'true') {
      return res.status(503).json({
        error: 'Firebase-based org request disabled on this server',
        detail: 'OSS-native deployments create organisations via POST /api/v1/organizations (admin-key-protected). The Firebase self-serve flow requires USE_FIREBASE=true.',
      });
    }

    const { firebase_token, org_name, contact_email, contact_phone, industry, address, company_size, expected_users, description } = req.body;
    if (!firebase_token || !org_name) return res.status(400).json({ error: 'firebase_token and org_name required' });

    // Verify Firebase token
    let firebaseUser;
    try {
      const admin = require('firebase-admin');
      if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS)) });
      }
      firebaseUser = await admin.auth().verifyIdToken(firebase_token);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid Firebase token', detail: e.message });
    }

    // Check if user already has an org
    const [existing] = await sequelize.query(
      'SELECT id FROM org_users WHERE email = ? OR firebase_uid = ? LIMIT 1',
      { replacements: [firebaseUser.email, firebaseUser.uid], type: sequelize.QueryTypes.SELECT }
    );
    if (existing) return res.status(409).json({ error: 'You already have an organisation.' });

    // Check if org name is taken
    const nameExists = await Organization.findOne({ where: { name: org_name } });
    if (nameExists) return res.status(409).json({ error: 'Organisation name already taken.' });

    // Create org as suspended (pending admin approval)
    const crypto = require('crypto');
    const apiSecret = uuidv4();
    const apiKey = `org_${uuidv4().replace(/-/g, '')}`;
    const bcrypt = require('bcrypt');
    const org = await Organization.create({
      name: org_name,
      status: 'suspended', // pending approval — admin changes to 'active'
      context_prefix: generateContextPrefix(),
      api_key: apiKey,
      api_secret: await bcrypt.hash(apiSecret, 12),
      domain: `${org_name.toLowerCase().replace(/[^a-z0-9]/g, '')}.local`,
      contact_info: {
        email: contact_email || firebaseUser.email,
        phone: contact_phone || null,
        address: address || null,
        industry: industry || null,
        company_size: company_size || null,
        expected_users: expected_users || null,
        description: description || null,
      },
    });

    // Create owner user in org_users
    await sequelize.query(
      `INSERT INTO org_users (id, org_id, email, name, role, status, firebase_uid, extension, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, 'owner', 'active', ?, '1001', NOW(), NOW())`,
      { replacements: [org.id, firebaseUser.email, firebaseUser.email.split('@')[0], firebaseUser.uid] }
    );

    res.status(201).json({
      message: 'Organisation requested! Admin will review and approve shortly.',
      org_id: org.id,
      org_name: org.name,
      status: 'pending_approval',
    });
  } catch (e) {
    console.error('request-org error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Admin: list pending org requests
app.get('/api/v1/admin/pending-orgs', async (req, res) => {
  try {
    const adminKey = req.headers['authorization']?.replace('Bearer ', '') || req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
      // Also accept gateway admin key
      const gwKey = req.headers['x-api-key'];
      if (!gwKey) return res.status(401).json({ error: 'Admin auth required' });
    }

    const pending = await Organization.findAll({
      where: { status: 'suspended' },
      order: [['created_at', 'DESC']],
    });
    res.json(pending);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: approve org request → activate + auto-provision + auto-deploy
app.post('/api/v1/admin/approve-org/:orgId', async (req, res) => {
  try {
    const adminKey = req.headers['authorization']?.replace('Bearer ', '') || req.headers['x-admin-key'];
    if (!adminKey) return res.status(401).json({ error: 'Admin auth required' });

    const org = await Organization.findByPk(req.params.orgId);
    if (!org) return res.status(404).json({ error: 'Organisation not found' });

    await org.update({ status: 'active' });

    // Pull the owner email from org_users (created during /auth/request-org) so
    // the auto-provisioned SIP user is wired to the real owner rather than a
    // blank email — matches the admin-direct-create shape.
    const [ownerRow] = await sequelize.query(
      `SELECT email, name FROM org_users WHERE org_id = ? AND role = 'owner' LIMIT 1`,
      { replacements: [org.id], type: sequelize.QueryTypes.SELECT }
    );
    const ownerEmail = ownerRow?.email || (org.contact_info?.email ?? null);
    const ownerName = ownerRow?.name || 'Owner';

    // Auto-provision extension 1001 for the owner if not exists
    const [existingUser] = await sequelize.query(
      'SELECT id FROM users WHERE org_id = ? AND extension = "1001" LIMIT 1',
      { replacements: [org.id], type: sequelize.QueryTypes.SELECT }
    );
    if (!existingUser) {
      const crypto = require('crypto');
      const sipPass = crypto.randomBytes(8).toString('hex');
      const hashedSipLoginPass = await bcrypt.hash(sipPass, 10);
      await User.create({
        org_id: org.id,
        username: `owner_${org.context_prefix.replace(/_$/, '')}`,
        email: ownerEmail,
        full_name: ownerName,
        extension: '1001',
        role: 'admin',
        status: 'active',
        password_hash: hashedSipLoginPass,
        sip_password: sipPass,
        asterisk_endpoint: `${org.context_prefix}1001`,
        recording_enabled: true,
        routing_type: 'sip',
        ring_target: 'ext',
      });
      console.log(`✅ Auto-provisioned SIP ext 1001 for org ${org.name} (owner: ${ownerEmail || 'unknown'})`);
    }

    // Auto-provision a peer2peer SIP trunk → NUC and a catchall outbound
    // route so the org can dial PSTN the moment an admin assigns them a DID.
    // Mirrors GrandEstancia's shape: trunk host = 10.10.10.2 (NUC), route
    // pattern = _X. (any extension). Idempotent via existence checks.
    let trunkId = null;
    const [existingTrunk] = await sequelize.query(
      'SELECT id FROM sip_trunks WHERE org_id = ? ORDER BY created_at ASC LIMIT 1',
      { replacements: [org.id], type: sequelize.QueryTypes.SELECT }
    );
    if (existingTrunk) {
      trunkId = existingTrunk.id;
    } else {
      const peerName = `${org.context_prefix}trunk${Date.now()}`;
      const trunk = await SipTrunk.create({
        org_id: org.id,
        name: 'Tata SIP Trunk',
        host: '10.10.10.2',
        port: 5060,
        transport: 'udp',
        trunk_type: 'peer2peer',
        asterisk_peer_name: peerName,
        max_channels: 50,
        status: 'active',
      });
      trunkId = trunk.id;
      console.log(`✅ Auto-provisioned SIP trunk ${peerName} for org ${org.name}`);
    }

    const [existingRoute] = await sequelize.query(
      'SELECT id FROM outbound_routes WHERE org_id = ? LIMIT 1',
      { replacements: [org.id], type: sequelize.QueryTypes.SELECT }
    );
    if (!existingRoute && trunkId) {
      await OutboundRoute.create({
        org_id: org.id,
        name: 'Default Outbound',
        trunk_id: trunkId,
        dial_pattern: '_X.',
        strip_digits: 0,
        route_type: 'custom',
        priority: 1,
        recording_enabled: true,
        status: 'active',
      });
      console.log(`✅ Auto-provisioned Default Outbound route for org ${org.name}`);
    }

    // Auto-deploy Asterisk config
    try {
      await configDeploymentService.deployOrganizationConfiguration(org.id, org.name);
      await configDeploymentService.reloadAsteriskConfiguration();
      console.log(`✅ Auto-deployed config for approved org ${org.name}`);
    } catch (deployErr) { console.warn('⚠️ Auto-deploy on org approve:', deployErr.message); }

    // Auto-regenerate dispatcher so any already-assigned DIDs route to the new
    // org immediately (idempotent if no DIDs assigned yet).
    try {
      await configDeploymentService.deployGatewayRouting();
      console.log(`✅ Regenerated gateway dispatcher after approving ${org.name}`);
    } catch (gwErr) { console.warn('⚠️ Gateway regen on org approve:', gwErr.message); }

    res.json({ message: `Organisation ${org.name} approved and activated`, org });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Invite a user to the org
app.post('/api/v1/org-users/invite', authenticateOrg, requireRole('admin'), async (req, res) => {
  try {
    const { email, name, role = 'agent', extension } = req.body;
    if (!email || !name) return res.status(400).json({ error: 'email and name required' });
    if (!['owner', 'admin', 'manager', 'agent'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

    // Only owners can create other owners/admins
    if (['owner', 'admin'].includes(role) && req.userRole !== 'owner' && req.userRole) {
      return res.status(403).json({ error: 'Only owners can assign owner/admin roles' });
    }

    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO org_users (id, org_id, email, name, role, extension, status)
       VALUES (?, ?, ?, ?, ?, ?, 'invited')`,
      { replacements: [id, req.orgId, email, name, role, extension || null] }
    );

    await auditLog(req.orgId, 'user.invite', 'user', id, { email, name, role }, req);

    res.status(201).json({ id, email, name, role, extension, status: 'invited', org_id: req.orgId });
  } catch (e) {
    if (e.message?.includes('Duplicate')) return res.status(409).json({ error: 'User with this email already exists in this org' });
    res.status(500).json({ error: e.message });
  }
});

// List org users
app.get('/api/v1/org-users', authenticateOrg, requireRole('manager'), async (req, res) => {
  try {
    const rows = await sequelize.query(
      'SELECT id, email, name, role, status, extension, last_login, created_at FROM org_users WHERE org_id = ? ORDER BY FIELD(role, "owner","admin","manager","agent"), name',
      { replacements: [req.orgId], type: sequelize.QueryTypes.SELECT }
    );
    res.json({ data: rows, total: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get single user
app.get('/api/v1/org-users/:userId', authenticateOrg, requireRole('agent'), async (req, res) => {
  try {
    // Agents can only view themselves
    if (req.userRole === 'agent' && req.userId !== req.params.userId) {
      return res.status(403).json({ error: 'Agents can only view their own profile' });
    }
    const [user] = await sequelize.query(
      'SELECT id, email, name, role, status, extension, last_login, created_at FROM org_users WHERE id = ? AND org_id = ?',
      { replacements: [req.params.userId, req.orgId], type: sequelize.QueryTypes.SELECT }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update user role
app.put('/api/v1/org-users/:userId/role', authenticateOrg, requireRole('admin'), async (req, res) => {
  try {
    const { role } = req.body;
    if (!role || !['owner', 'admin', 'manager', 'agent'].includes(role)) {
      return res.status(400).json({ error: 'Valid role required: owner, admin, manager, agent' });
    }

    // Only owners can assign owner/admin
    if (['owner', 'admin'].includes(role) && req.userRole !== 'owner' && req.userRole) {
      return res.status(403).json({ error: 'Only owners can assign owner/admin roles' });
    }

    // Can't change own role
    if (req.userId === req.params.userId) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }

    const [existing] = await sequelize.query(
      'SELECT id, role, email FROM org_users WHERE id = ? AND org_id = ?',
      { replacements: [req.params.userId, req.orgId], type: sequelize.QueryTypes.SELECT }
    );
    if (!existing) return res.status(404).json({ error: 'User not found' });

    await sequelize.query('UPDATE org_users SET role = ? WHERE id = ?', { replacements: [role, req.params.userId] });
    await auditLog(req.orgId, 'user.role_change', 'user', req.params.userId, { email: existing.email, from: existing.role, to: role }, req);

    res.json({ id: req.params.userId, role, previous_role: existing.role });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update user details
app.put('/api/v1/org-users/:userId', authenticateOrg, requireRole('admin'), async (req, res) => {
  try {
    const { name, extension, status } = req.body;
    const updates = [];
    const values = [];
    if (name) { updates.push('name = ?'); values.push(name); }
    if (extension !== undefined) { updates.push('extension = ?'); values.push(extension || null); }
    if (status && ['active', 'suspended'].includes(status)) { updates.push('status = ?'); values.push(status); }
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    await sequelize.query(`UPDATE org_users SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`,
      { replacements: [...values, req.params.userId, req.orgId] });

    await auditLog(req.orgId, 'user.update', 'user', req.params.userId, req.body, req);

    const [user] = await sequelize.query(
      'SELECT id, email, name, role, status, extension FROM org_users WHERE id = ? AND org_id = ?',
      { replacements: [req.params.userId, req.orgId], type: sequelize.QueryTypes.SELECT }
    );
    res.json(user || { error: 'User not found' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete user
app.delete('/api/v1/org-users/:userId', authenticateOrg, requireRole('admin'), async (req, res) => {
  try {
    // Can't delete yourself
    if (req.userId === req.params.userId) return res.status(400).json({ error: 'Cannot delete yourself' });

    const [user] = await sequelize.query(
      'SELECT id, email, role FROM org_users WHERE id = ? AND org_id = ?',
      { replacements: [req.params.userId, req.orgId], type: sequelize.QueryTypes.SELECT }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Can't delete an owner unless you're an owner
    if (user.role === 'owner' && req.userRole !== 'owner' && req.userRole) {
      return res.status(403).json({ error: 'Only owners can delete other owners' });
    }

    await sequelize.query('DELETE FROM org_users WHERE id = ? AND org_id = ?',
      { replacements: [req.params.userId, req.orgId] });

    await auditLog(req.orgId, 'user.delete', 'user', req.params.userId, { email: user.email, role: user.role }, req);

    res.json({ success: true, deleted_user: user.email });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get my profile (any authenticated user)
app.get('/api/v1/org-users/me/profile', authenticateOrg, async (req, res) => {
  try {
    if (!req.userId) return res.json({ role: 'org_admin', message: 'Using org-level auth (no user context)' });
    const [user] = await sequelize.query(
      'SELECT id, email, name, role, status, extension, last_login FROM org_users WHERE id = ? AND org_id = ?',
      { replacements: [req.userId, req.orgId], type: sequelize.QueryTypes.SELECT }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.permissions = getPermissions(user.role);
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List available roles and their permissions
app.get('/api/v1/roles', authenticateOrg, async (req, res) => {
  const roles = Object.keys(ROLE_LEVELS).map(role => ({
    role,
    level: ROLE_LEVELS[role],
    permissions: getPermissions(role),
  }));
  res.json({ roles });
});



// ============================================================
// Synced from astradial-platform (2026-05-24) — features that hadn't
// reached OSS yet. See PR for details.
// ============================================================

// Normalize spam-protection settings — strips garbage from
// untrusted JSON (PUT body or legacy DB rows) so downstream code can
// trust the shape. Mirrors astradial-platform's helper.
function normalizeSpamProtection(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const blocked = Array.isArray(v.blocked_circles)
    ? v.blocked_circles.filter((c) => typeof c === 'string' && /^[A-Z]{2,3}$/.test(c))
    : [];
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : false,
    blocked_circles: [...new Set(blocked)].sort(),
    greeting_id: typeof v.greeting_id === 'string' && v.greeting_id ? v.greeting_id : null,
  };
}

app.post("/api/v1/greetings/upload", authenticateOrg, async (req, res) => {
  try {
    const multer = require('multer');
    const fs = require('fs');
    const p = require('path');
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const { v4: uuidv4 } = require('uuid');
    const { Greeting } = require('./models');
    const execFileAsync = promisify(execFile);

    const ALLOWED_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac']);
    const tmpUpload = multer({ dest: '/tmp/', limits: { fileSize: 50 * 1024 * 1024 } });

    tmpUpload.single('audio')(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

      const ext = p.extname(req.file.originalname || '').toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ error: `Unsupported format ${ext || '(none)'} — allowed: ${[...ALLOWED_EXT].join(', ')}` });
      }

      const name = String(req.body.name || '').trim() || `Uploaded ${new Date().toISOString().slice(0, 10)}`;
      const id = uuidv4();
      // Match the TTS service's filename scheme so the dialplan
      // Playback() works the same way regardless of source. Asterisk
      // looks for greeting_<id>.{ext} and picks the codec-matching
      // file. The audio_file column stores the bare basename
      // (no extension) — same convention as TTS.
      const baseName = `greeting_${id}`;
      const greetingsDir = '/var/lib/asterisk/sounds/greetings';
      fs.mkdirSync(greetingsDir, { recursive: true });
      const destWav = p.join(greetingsDir, `${baseName}.wav`);
      const destUlaw = p.join(greetingsDir, `${baseName}.ulaw`);
      const destAlaw = p.join(greetingsDir, `${baseName}.alaw`);

      try {
        // Single ffmpeg invocation with three outputs — flags BEFORE
        // each filename. mono / 8kHz across all three. Raw mulaw/alaw
        // for codec-native playback (no container parse on file open).
        await execFileAsync('ffmpeg', [
          '-y', '-loglevel', 'error',
          '-i', req.file.path,
          '-ac', '1', '-ar', '8000', '-acodec', 'pcm_s16le', destWav,
          '-ac', '1', '-ar', '8000', '-f', 'mulaw', destUlaw,
          '-ac', '1', '-ar', '8000', '-f', 'alaw', destAlaw,
        ]);
      } catch (ffErr) {
        // Cleanup any partial outputs + the tmp upload so a failed
        // encode doesn't leave stale files behind.
        try { fs.unlinkSync(req.file.path); } catch {}
        for (const f of [destWav, destUlaw, destAlaw]) {
          try { fs.unlinkSync(f); } catch {}
        }
        const detail = (ffErr.stderr || ffErr.message || '').toString().trim().slice(-500);
        return res.status(400).json({ error: `Audio conversion failed: ${detail}` });
      }
      try { fs.unlinkSync(req.file.path); } catch {}

      const greeting = await Greeting.create({
        id, org_id: req.orgId, name,
        text: null,
        source: 'upload',
        audio_file: baseName,
        status: 'active',
      });
      console.log('Greeting uploaded:', destWav);
      res.json(greeting);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/ivrs/:id/upload-greeting', authenticateOrg, async (req, res) => {
  try {
    const multer = require('multer');
    const fs = require('fs');
    const p = require('path');
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const { Ivr } = require('./models');
    const execFileAsync = promisify(execFile);

    const ivr = await Ivr.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!ivr) return res.status(404).json({ error: 'IVR not found' });

    const ALLOWED_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac']);
    const tmpUpload = multer({ dest: '/tmp/', limits: { fileSize: 50 * 1024 * 1024 } });

    tmpUpload.single('audio')(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

      const ext = p.extname(req.file.originalname || '').toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ error: `Unsupported format ${ext || '(none)'} — allowed: ${[...ALLOWED_EXT].join(', ')}` });
      }

      const baseName = `greeting_ivr_${ivr.id}`;
      const greetingsDir = '/var/lib/asterisk/sounds/greetings';
      fs.mkdirSync(greetingsDir, { recursive: true });
      const destWav = p.join(greetingsDir, `${baseName}.wav`);
      const destUlaw = p.join(greetingsDir, `${baseName}.ulaw`);
      const destAlaw = p.join(greetingsDir, `${baseName}.alaw`);

      try {
        await execFileAsync('ffmpeg', [
          '-y', '-loglevel', 'error',
          '-i', req.file.path,
          '-ac', '1', '-ar', '8000', '-acodec', 'pcm_s16le', destWav,
          '-ac', '1', '-ar', '8000', '-f', 'mulaw', destUlaw,
          '-ac', '1', '-ar', '8000', '-f', 'alaw', destAlaw,
        ]);
      } catch (ffErr) {
        try { fs.unlinkSync(req.file.path); } catch {}
        for (const f of [destWav, destUlaw, destAlaw]) {
          try { fs.unlinkSync(f); } catch {}
        }
        const detail = (ffErr.stderr || ffErr.message || '').toString().trim().slice(-500);
        return res.status(400).json({ error: `Audio conversion failed: ${detail}` });
      }
      try { fs.unlinkSync(req.file.path); } catch {}

      await ivr.update({
        greeting_prompt: baseName,
        greeting_text: null,
      });

      // Reload dialplan — even though the file name matches the TTS
      // pattern (so the existing `Background(greetings/...)` line keeps
      // working for in-place file swaps), the first upload on an IVR
      // that had no prior greeting still needs a regen to flip the
      // Background() target from `welcome` to the new prompt.
      try {
        await configDeploymentService.deployOrganizationConfiguration(req.orgId, req.organization.name);
        await configDeploymentService.reloadAsteriskConfiguration();
      } catch (deployErr) {
        console.warn('⚠️ Auto-deploy after IVR upload-greeting:', deployErr.message);
      }

      console.log('IVR greeting uploaded:', destWav);
      res.json({
        success: true,
        greeting_prompt: ivr.greeting_prompt,
        source: 'upload',
      });
    });
  } catch (error) {
    console.error('POST /ivrs/:id/upload-greeting error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/v1/settings/spam-protection", authenticateOrg, async (req, res) => {
  try {
    const o = await Organization.findByPk(req.orgId);
    res.json(normalizeSpamProtection(o?.settings?.spam_protection));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/v1/settings/spam-protection", authenticateOrg, async (req, res) => {
  try {
    const o = await Organization.findByPk(req.orgId);
    if (!o) return res.status(404).json({ error: 'organization not found' });
    const next = normalizeSpamProtection(req.body);
    // Validate every code in blocked_circles is a real circle. Cheap
    // catch — keeps typos out of the persisted state.
    if (next.blocked_circles.length > 0) {
      const valid = await sequelize.query(
        "SELECT DISTINCT circle_code FROM mobile_prefixes WHERE circle_code IN (" + next.blocked_circles.map(() => '?').join(',') + ")",
        { replacements: next.blocked_circles, type: sequelize.QueryTypes.SELECT }
      );
      const validSet = new Set(valid.map((r) => r.circle_code));
      const unknown = next.blocked_circles.filter((c) => !validSet.has(c));
      if (unknown.length > 0) {
        return res.status(400).json({ error: 'unknown circle code(s)', unknown });
      }
    }
    // Detect whether the dialplan needs to be regenerated. The
    // enforcement branches in dialplanGenerator emit ONLY when
    // enabled && blocked_circles.length > 0, so we only redeploy
    // when crossing that threshold OR the active set changes.
    const prev = normalizeSpamProtection(o?.settings?.spam_protection);
    const wasActive = prev.enabled && prev.blocked_circles.length > 0;
    const isActive = next.enabled && next.blocked_circles.length > 0;
    const circlesChanged = prev.blocked_circles.join(',') !== next.blocked_circles.join(',');
    const greetingChanged = prev.greeting_id !== next.greeting_id;
    const needsRedeploy = (wasActive !== isActive) || (isActive && (circlesChanged || greetingChanged));

    const s = JSON.parse(JSON.stringify(o.settings || {}));
    s.spam_protection = next;
    await o.update({ settings: s });

    // Auto-deploy the dialplan so the new spam_check / spam_blocked
    // contexts (or their removal) take effect immediately. Same pattern
    // as DID/queue/user updates — see server.js:1698 for precedent.
    // Fire-and-warn — a deploy failure doesn't unsave the DB change;
    // the operator can re-save to retry the deploy.
    if (needsRedeploy) {
      try {
        await configDeploymentService.deployOrganizationConfiguration(req.orgId, req.organization.name);
        await configDeploymentService.reloadAsteriskConfiguration();
      } catch (deployErr) {
        console.warn('[spam-protection] auto-deploy after settings change failed:', deployErr.message);
      }
    }

    res.json(next);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/v1/circles", authenticateOrg, async (req, res) => {
  try {
    const rows = await sequelize.query(
      "SELECT circle_code, MIN(circle_name) AS circle_name, MIN(category) AS category, COUNT(*) AS prefix_count " +
      "FROM mobile_prefixes " +
      "GROUP BY circle_code " +
      "ORDER BY circle_code",
      { type: sequelize.QueryTypes.SELECT }
    );
    const circles = rows.map((r) => ({
      code: r.circle_code,
      name: r.circle_name,
      category: r.category,
      prefix_count: Number(r.prefix_count) || 0,
    }));
    res.json({ circles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/v1/calls/export', authenticateOrg, async (req, res) => {
  try {
    const orgId = req.orgId;
    const org = req.organization;
    const prefix = org?.context_prefix || '';
    const { direction, disposition, from, to, search } = req.query;

    // Date range: cap at 31 days (1 calendar month — covers the longest
    // month so operators can grab "Jan" or "Mar" in one go). Kept tight to
    // keep export payloads small for busy hospital orgs; if a customer
    // ever needs a wider window, raise this cap deliberately rather than
    // hand them a slow endpoint.
    const MAX_DAYS = 31;
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const defaultFrom = new Date(today); defaultFrom.setDate(defaultFrom.getDate() - 30);
    const parseDateOrNull = (s) => {
      if (!s) return null;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    let dateFrom = parseDateOrNull(req.query.date_from) || defaultFrom;
    let dateTo = parseDateOrNull(req.query.date_to) || today;
    if (dateFrom > dateTo) {
      return res.status(400).json({ error: 'date_from must be before date_to' });
    }
    const spanDays = Math.ceil((dateTo - dateFrom) / 86400000);
    if (spanDays > MAX_DAYS) {
      return res.status(400).json({
        error: 'Export range is capped at 1 month. Narrow the date filter and try again.',
        max_days: MAX_DAYS,
        requested_days: spanDays,
      });
    }
    const dateFromSql = dateFrom.toISOString().slice(0, 19).replace('T', ' ');
    const dateToSql = dateTo.toISOString().slice(0, 19).replace('T', ' ');

    // Same base predicates as /api/v1/calls so the export shows exactly
    // what the operator sees in the UI for the same filter combination.
    const conditions = [
      "(t.accountcode = ? OR t.peeraccount = ? OR t.channel LIKE ?)",
      "(t.channel NOT LIKE 'Local/%' OR t.dstchannel LIKE 'PJSIP/%')",
      "NOT (t.disposition = 'ANSWERED' AND t.billsec = 0 AND t.dcontext != 'ai-outbound')",
      "t.dst != 's'",
      "t.calldate >= ?",
      "t.calldate <= ?",
    ];
    const params = [orgId, orgId, '%' + prefix + '%', dateFromSql, dateToSql];

    if (direction && direction !== 'all') {
      if (direction === 'inbound') conditions.push("t.dcontext LIKE '%incoming%'");
      else if (direction === 'outbound') conditions.push("(t.dcontext LIKE '%outbound%' OR t.dcontext = 'ai-outbound' OR (t.dcontext LIKE '%internal' AND t.lastapp = 'Dial' AND t.lastdata LIKE '%@%trunk%'))");
      else if (direction === 'internal') conditions.push("t.dcontext LIKE '%internal%' AND NOT (t.lastapp = 'Dial' AND t.lastdata LIKE '%@%trunk%')");
    }
    if (disposition) {
      conditions.push("t.disposition = ?");
      params.push(String(disposition).toUpperCase());
    }
    if (from) {
      conditions.push("t.src LIKE ?");
      params.push('%' + String(from).replace(/\D/g, '') + '%');
    }
    if (to) {
      conditions.push("(t.dst LIKE ? OR t.dstchannel LIKE ?)");
      const digits = '%' + String(to).replace(/\D/g, '') + '%';
      params.push(digits, digits);
    }
    if (search) {
      conditions.push("(t.src LIKE ? OR t.dst LIKE ? OR t.clid LIKE ?)");
      const s = '%' + String(search) + '%';
      params.push(s, s, s);
    }

    const where = "WHERE " + conditions.join(" AND ");

    // 50k cap is well above any plausible 3-month hospital volume but
    // bounds memory if a misconfigured org somehow has millions of rows.
    const HARD_CAP = 50000;
    const rows = await sequelize.query(
      `SELECT
        t.calldate,
        t.src AS from_number,
        CASE
          WHEN t.lastapp = 'Queue' AND t.disposition = 'ANSWERED' AND t.dstchannel LIKE 'Local/%' AND u.extension IS NOT NULL
            THEN CONCAT('Queue ', SUBSTRING_INDEX(SUBSTRING_INDEX(t.lastdata, ',', 1), '_', -1), ' [', u.extension, ']')
          WHEN t.lastapp = 'Queue'
            THEN CONCAT('Queue ', SUBSTRING_INDEX(SUBSTRING_INDEX(t.lastdata, ',', 1), '_', -1))
          WHEN t.dst LIKE 'qm%' AND CHAR_LENGTH(t.dst) = 34 AND u.extension IS NOT NULL
            THEN u.extension
          WHEN t.dst LIKE 'qm%' AND CHAR_LENGTH(t.dst) = 34
            THEN 'queue member'
          ELSE t.dst
        END AS to_number,
        CASE
          WHEN t.dcontext = 'ai-outbound' THEN 'outbound'
          WHEN t.dcontext LIKE '%incoming%' THEN 'inbound'
          WHEN t.dcontext LIKE '%outbound%' THEN 'outbound'
          WHEN t.dcontext LIKE '%internal' AND t.lastapp = 'Dial' AND t.lastdata LIKE '%@%trunk%' THEN 'outbound'
          ELSE 'internal'
        END AS direction,
        t.duration,
        t.billsec AS talk_time,
        (t.duration - t.billsec) AS wait_time,
        t.disposition,
        CASE t.userfield
          WHEN 'org_cap_rejected'   THEN 'org_cap'
          WHEN 'trunk_cap_rejected' THEN 'trunk_cap'
          ELSE NULL
        END AS cap_rejected,
        CASE WHEN t.recordingfile != '' AND t.billsec > 0
          THEN CONCAT('/api/v1/calls/', t.id, '/recording')
          ELSE NULL
        END AS recording_url
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY linkedid ORDER BY
          CASE WHEN disposition = 'ANSWERED' AND billsec > 0 THEN 0 ELSE 1 END,
          duration DESC, id DESC) AS rn,
          CASE
            WHEN dstchannel LIKE 'Local/qm%@%'
              THEN SUBSTRING_INDEX(SUBSTRING_INDEX(dstchannel, '/', -1), '@', 1)
            WHEN dst LIKE 'qm%' AND CHAR_LENGTH(dst) = 34
              THEN dst
            ELSE NULL
          END AS qm_token
        FROM asterisk_cdr t ${where}
      ) t
      LEFT JOIN queue_members qm_tbl ON t.qm_token IS NOT NULL AND qm_tbl.id = LOWER(CONCAT_WS('-',
        SUBSTRING(t.qm_token, 3, 8),
        SUBSTRING(t.qm_token, 11, 4),
        SUBSTRING(t.qm_token, 15, 4),
        SUBSTRING(t.qm_token, 19, 4),
        SUBSTRING(t.qm_token, 23, 12)
      ))
      LEFT JOIN users u ON qm_tbl.user_id = u.id
      WHERE t.rn = 1
      ORDER BY t.calldate DESC
      LIMIT ${HARD_CAP}`,
      { replacements: params, type: sequelize.QueryTypes.SELECT }
    );

    // CSV escape per RFC 4180: wrap in quotes only if needed; double internal
    // quotes. NULL → empty cell. Numbers stringified plain.
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const headers = [
      'Date Time',
      'From',
      'To',
      'Direction',
      'Duration (s)',
      'Talk Time (s)',
      'Wait Time (s)',
      'Status',
      'Cap Rejected',
      'Recording URL',
    ];
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([
        // ISO 8601 for sortable timestamps in Excel + locale-independent.
        r.calldate ? new Date(r.calldate).toISOString() : '',
        r.from_number,
        r.to_number,
        r.direction,
        r.duration ?? 0,
        r.talk_time ?? 0,
        r.wait_time ?? 0,
        r.disposition,
        r.cap_rejected,
        r.recording_url,
      ].map(esc).join(','));
    }
    const csv = lines.join('\r\n') + '\r\n';

    const dateTag = new Date().toISOString().slice(0, 10);
    const orgSlug = (org?.context_prefix || 'org').replace(/[^a-zA-Z0-9_-]/g, '');
    const filename = `calls-${orgSlug}-${dateTag}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Rows', String(rows.length));
    res.setHeader('X-Export-Range-Days', String(spanDays));
    // UTF-8 BOM so Excel opens the file with correct encoding (otherwise
    // Indian phone numbers with non-ASCII city/state names in caller IDs
    // render mojibake).
    res.write('﻿');
    res.end(csv);
  } catch (error) {
    console.error('GET /api/v1/calls/export error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 404 handler - MUST BE LAST
// ========================================
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.originalUrl} not found`,
    documentation: '/api'
  });
});

// ========================================
// START SERVER
// ========================================

// Initialize database and start server
(async () => {
  try {
    // Test database connection
    await sequelize.authenticate();
    console.log('📊 Database connection established successfully.');

    // NOTE: sequelize.sync() removed (audit finding P0 #1).
    // We use sequelize-cli migrations as the source of truth for schema.
    // sync() created tables from model definitions BEFORE migrations on
    // fresh deploys, causing 1061 Duplicate-key collisions when migrations
    // tried to addIndex on indexes sync had already created (real incidents:
    // customer_tunnels in PR #126, tunnel_metrics in PR #132).
    //
    // Local dev / fresh databases should be initialized via:
    //   npx sequelize-cli db:migrate
    // (or src/scripts/setup-database.js which still uses sync({force}) for
    // throwaway dev databases).

    // Start Event Listener Service (AMI/ARI)
    try {
      await eventListenerService.start();
    } catch (error) {
      console.error('⚠️  Warning: Event Listener Service failed to start:', error.message);
      console.error('   Webhooks and events may not work properly.');
      console.error('   Check Asterisk AMI/ARI configuration and try again.');
    }

    // Start server
    app.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║         Multi-Tenant PBX API Server Started           ║
╠════════════════════════════════════════════════════════╣
║                                                        ║
║  🚀 Server:     http://${HOST}:${PORT}                    ║
║  📚 API Docs:   http://${HOST}:${PORT}/api               ║
║  💚 Health:     http://${HOST}:${PORT}/health            ║
║                                                        ║
║  🔐 Get Started:                                       ║
║     1. Create organization:                           ║
║        POST /api/v1/organizations                     ║
║     2. Use returned API key in X-API-Key header       ║
║     3. Start configuring trunks, DIDs, users, etc.    ║
║                                                        ║
║  📊 Features:                                          ║
║     ✅ Multi-tenant isolation                         ║
║     ✅ SIP trunk management                           ║
║     ✅ DID number routing                             ║
║     ✅ User & queue management                        ║
║     ✅ Call routing (queue, AI agent, extension)      ║
║     ✅ Webhook notifications                          ║
║     ✅ Call recording control                         ║
║     ✅ Live call statistics                           ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
  `);

      // WireGuard customer-tunnels status poller — captures `wg show wg1 dump`
      // every 60s and writes per-tunnel snapshots to tunnel_metrics for the UI
      // charts. Safe no-op when wg1 isn't bootstrapped (errors are logged but
      // the poller keeps trying — auto-recovers when wg1 comes up).
      try {
        const { WireguardStatusPoller } = require('./services/network/wireguardStatusPoller');
        const models = require('./models');
        const wgPoller = new WireguardStatusPoller({
          models,
          intervalMs: Number(process.env.WG_POLLER_INTERVAL_MS) || 60_000
        });
        wgPoller.start();
        // Expose for /health enrichment + graceful shutdown if needed
        app.locals.wgPoller = wgPoller;
        console.log('WireGuard status poller started (60s interval)');
      } catch (err) {
        console.error('WireGuard status poller failed to start:', err.message);
        // Don't crash — feature isn't critical for boot
      }

      // CDR poller: check asterisk_cdr for new inbound records every 30s
      // Backup for AMI CDR events which may not fire reliably
      let lastCdrId = 0;
      async function initCdrPoller() {
        try {
          const r = await sequelize.query("SELECT MAX(id) as maxid FROM asterisk_cdr", { plain: true, raw: true });
          lastCdrId = (r && r.maxid) || 0;
          console.log('CDR poller started, last ID: ' + lastCdrId);
        } catch (e) { console.error('CDR poller init failed:', e.message); }
      }
      // Local classifier — replaces the events.example.com round-trip
      // for MariaDB ticket writes. Lazy-required to avoid a circular
      // import during boot. Defined here so pollCdr's closure can see it.
      const { classifyAndUpsertTicket } = require('./services/ticketClassifier');
      async function pollCdr() {
        try {
          // Only classify CDR rows whose call has been SETTLED for at
          // least 30 seconds.
          //
          // A queue call can produce multiple parent CDR rows when
          // app_queue retries members internally (one row per attempt).
          // If pollCdr classifies the first row immediately, it sees a
          // NO_ANSWER shape and creates a "Queue Timeout" ticket — even
          // if the second attempt 5s later got answered and would have
          // produced an ANSWERED row that should win the dedup. By
          // waiting 30s past the row's notional end (`calldate + duration`),
          // every retry CDR for the same linkedid is guaranteed to be
          // in the DB, so the dedup below picks the right representative
          // on the first pass and no bogus ticket is ever created.
          //
          // Tradeoff: tickets land ~30s after the call ends instead of
          // ~immediately. Acceptable — operator workflows handle that.
          // The cross-batch auto-close in the classifier stays as a
          // belt-and-suspenders safety net for edge cases (clock skew,
          // batches spanning >30s of activity, etc.).
          const allRows = await sequelize.query(
            "SELECT id, calldate, src, dst, dcontext, channel, dstchannel, lastapp, lastdata, " +
            "duration, billsec, disposition, uniqueid, linkedid, recordingfile, accountcode, peeraccount " +
            "FROM asterisk_cdr WHERE id > ? AND channel NOT LIKE 'Local/%' " +
            "AND DATE_ADD(calldate, INTERVAL duration SECOND) < (NOW() - INTERVAL 30 SECOND) " +
            "ORDER BY id ASC LIMIT 50",
            { replacements: [lastCdrId], type: sequelize.QueryTypes.SELECT }
          );
          if (!allRows || allRows.length === 0) return;
          // Update lastCdrId to max of all fetched
          for (const r of allRows) lastCdrId = Math.max(lastCdrId, r.id);
          // Dedup: keep one record per linkedid. Prefer rows where a
          // member actually answered with talk time (ANSWERED +
          // billsec > 0); fall back to longest duration as tiebreak.
          //
          // The previous "longest duration wins" rule was a bug for
          // queue calls that retried: a 75s NO_ANSWER first round on
          // Landline would beat the 45s ANSWERED round on Raman, and
          // the classifier would create a "Queue Timeout" ticket on
          // a call the caller actually had a conversation on.
          // Reproduced 2026-05-16 on Thangavelu Hospital queue 5002.
          const byLinked = {};
          for (const r of allRows) {
            const lid = r.linkedid || r.uniqueid;
            const existing = byLinked[lid];
            if (!existing) { byLinked[lid] = r; continue; }
            const score = (row) => (row.disposition === 'ANSWERED' && row.billsec > 0) ? 1 : 0;
            const sNew = score(r);
            const sOld = score(existing);
            if (sNew > sOld) { byLinked[lid] = r; }
            else if (sNew === sOld && r.duration > existing.duration) { byLinked[lid] = r; }
          }
          const rows = Object.values(byLinked);
          // axios is already required at the top of this file (line 14) and
          // captured in closure scope here. The previous code re-required it
          // on every poll cycle (every 30s); during CI deploys the `npm ci`
          // step briefly tears down + rebuilds node_modules, and if the CDR
          // poll fired during that window, the inner require would fail with
          // "Cannot find module '.../axios/dist/node/axios.cjs'". Removed.
          const autoTicketUrl = process.env.AUTO_TICKET_URL || 'https://events.example.com';
          for (const r of rows) {
            // Determine org_id from accountcode, peeraccount, or channel prefix
            let orgId = r.accountcode || r.peeraccount || '';
            if (!orgId || orgId.length < 10) {
              // Extract org from channel name (e.g. PJSIP/org_demo_trunk... -> org_demo_)
              const ch = r.channel || '';
              const prefixMatch = ch.match(/PJSIP\/(\w+?)trunk/);
              if (prefixMatch && prefixMatch[1]) {
                // Look up org_id from context_prefix cache
                if (!pollCdr._orgCache) pollCdr._orgCache = {};
                const prefix = prefixMatch[1];
                if (!pollCdr._orgCache[prefix]) {
                  const orgRows = await sequelize.query(
                    "SELECT id FROM organizations WHERE context_prefix = ?",
                    { replacements: [prefix], plain: true, raw: true }
                  );
                  pollCdr._orgCache[prefix] = orgRows ? orgRows.id : '';
                }
                orgId = pollCdr._orgCache[prefix] || '';
              }
              if (!orgId || orgId.length < 10) continue;
            }
            // Outbound trunk leg: when Asterisk writes the auto-CDR for an
            // originate, it records the PJSIP channel with dst='s' (the trunk
            // leg has no "dialed extension" from the dialplan's POV). This row
            // looks like an inbound call (src=customer phone, dcontext=*_incoming)
            // and used to create false-positive missed_call tickets.
            //
            // Backfill the paired ai-outbound row with the REAL disposition,
            // duration and billsec (the manual row inserted at originate time
            // hard-codes disposition='ANSWERED' duration=0 billsec=0 because it
            // doesn't know the outcome yet), then skip forwarding this row to
            // the auto-ticket pipeline.
            //
            // The UPDATE is scoped by (dcontext='ai-outbound', dst=<customer>,
            // calldate within 60s of the auto row), so it only touches the
            // matching manual row for this specific call. Safe for real inbound
            // (they never have dst='s', so they don't enter this branch at all).
            if (r.dst === 's' && (r.channel || '').includes('trunk')) {
              try {
                await sequelize.query(
                  "UPDATE asterisk_cdr SET disposition = ?, duration = ?, billsec = ? " +
                  "WHERE dcontext = 'ai-outbound' AND dst = ? " +
                  "AND calldate BETWEEN DATE_SUB(?, INTERVAL 60 SECOND) AND DATE_ADD(?, INTERVAL 60 SECOND)",
                  { replacements: [r.disposition || '', r.duration || 0, r.billsec || 0, r.src || '', r.calldate, r.calldate] }
                );
                console.log('CDR poll: backfilled ai-outbound for ' + (r.src || '?') + ' → ' + (r.disposition || '?') + ' ' + (r.duration || 0) + 's');
              } catch (e) {
                console.error('CDR poll: backfill failed for row ' + r.id + ':', e.message);
              }
              continue;
            }
            // Determine direction. The original classifier relied on the
            // channel name containing "trunk", which matches per-org outbound
            // trunk endpoints (e.g. PJSIP/org_mna9x47k_trunk-...) but NOT the
            // shared tata_gateway endpoint that receives calls from the NUC
            // WireGuard tunnel on the staging cloud. Treat any CDR whose
            // dcontext ends with "_incoming" as inbound as a safety net so
            // staging's Tata-dispatch pipeline is picked up by the poller.
            let direction = 'internal';
            const ch = r.channel || '';
            const ctx = r.dcontext || '';
            if (ch.includes('trunk') && (r.src || '').length >= 7) direction = 'inbound';
            else if (ctx.includes('outbound') || (r.dst || '').length >= 7 && (r.src || '').length <= 5) direction = 'outbound';
            else if (ch.includes('trunk') || ctx.endsWith('_incoming')) direction = 'inbound';
            if (direction !== 'inbound') continue;
            // Post to auto-ticket. Send X-Astradial-Env header when running in
            // staging so LogsUpdate writes to the astrapbx_stage namespace
            // instead of polluting prod tickets. Empty header on prod is a
            // no-op — LogsUpdate defaults to the astrapbx collection.
            //
            // Flip ANSWERED → NO ANSWER for IVR/queue-abandoned inbound
            // calls (no real member bridge). Predicate lives in
            // services/cdrDispositionOverride.js so it stays in lockstep
            // with ticketClassifier.js's realPjsipBridge/realQueueBridge
            // shapes. Divergence here previously created bogus
            // "Queue Timeout" tickets on answered queue calls
            // (2026-05-16 V7 incident, org 00000001).
            const { effectiveDisposition } = require('./services/cdrDispositionOverride');
            const classifierDisposition = direction === 'inbound'
              ? effectiveDisposition(r)
              : (r.disposition || '');
            axios.post(`${autoTicketUrl}/auto-ticket/${orgId}`, {
              call_id: r.uniqueid || String(r.id),
              from_number: r.src || '',
              to_number: r.dst || '',
              direction,
              disposition: classifierDisposition,
              duration: r.billsec || 0,
              total_duration: r.duration || 0,
              channel: r.channel || '',
              destination_channel: r.dstchannel || '',
              destination_context: r.dcontext || '',
              recording_file: r.recordingfile || '',
              timestamp: r.calldate ? new Date(r.calldate).toISOString() : new Date().toISOString(),
            }, {
              headers: { 'X-Astradial-Env': process.env.ASTRADIAL_ENV || '' },
            }).catch(err => console.error('CDR poll auto-ticket failed:', err.message));

            // Dual-write to MariaDB tickets (Firestore migration).
            // Classifier runs in-process — no network hop. On a clean
            // ANSWERED bridge to a human or a bot-handled call, we
            // skip and produce no ticket. Otherwise dedup-upsert.
            // Fire-and-forget so a tickets bug never blocks the
            // Firestore POST during dual-write.
            //
            // Flag gate: orgs listed in
            // `TICKETS_FROM_CALLLOGS_ENABLED_ORG_IDS` use the new
            // call-logs-driven scheduler (jobs/ticketsFromCallLogsScheduler.js)
            // instead of this per-row classifier. Skipping here for
            // those orgs avoids double-write. Firestore POST above is
            // unaffected and continues for all orgs. The wildcard
            // '*' means "every org goes through the scheduler" — the
            // legacy classifier is then effectively retired (it still
            // exists for the case where the flag is later narrowed).
            const _clq = require('./services/callLogsTicketQuery');
            const _callLogsOrgs = _clq.parseEnabledOrgs(process.env.TICKETS_FROM_CALLLOGS_ENABLED_ORG_IDS);
            if (!_clq.isOrgEnabled(orgId, _callLogsOrgs)) {
              classifyAndUpsertTicket(r, orgId, classifierDisposition).catch(err =>
                console.error('CDR poll MariaDB ticket upsert failed:', err.message)
              );
            }
          }
        } catch (e) { console.error('CDR poll error:', e.message); }
      }
      console.log("CDR poller: initializing..."); initCdrPoller().then(() => console.log("CDR poller: init done")).catch(e => console.error("CDR poller init CATCH:", e));
      setInterval(pollCdr, 30000);

      // Daily 18:00 IST WhatsApp missed-call alert scheduler. Safe to
      // arm regardless of MSG91 env state — runOnce() refuses to send
      // (and audit-logs why) if the auth key or admin config is missing.
      try {
        require('./jobs/ticketAlertScheduler').start();
      } catch (e) {
        console.error('❌ Failed to start ticket-alert scheduler:', e.message);
      }

      // Call-logs-driven ticket scheduler. Always arms — loops idle
      // when `TICKETS_FROM_CALLLOGS_ENABLED_ORG_IDS` is empty so
      // flipping the env later + restart picks it up without code
      // changes. Per-org gating happens inside the SQL query.
      try {
        require('./jobs/ticketsFromCallLogsScheduler').start();
      } catch (e) {
        console.error('❌ Failed to start tickets-from-call-logs scheduler:', e.message);
      }

    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
})();

module.exports = app;

// Graceful shutdown handler
// Stop background services in order: pollers BEFORE sequelize.close() so the
// poller doesn't attempt a TunnelMetric.create() against a closed connection.
async function stopBackgroundServices() {
  try {
    if (app.locals.wgPoller) {
      app.locals.wgPoller.stop();
      console.log("🛑 WireGuard status poller stopped.");
    }
  } catch (e) {
    console.error("Failed to stop wg poller:", e.message);
  }
  try {
    require('./jobs/ticketAlertScheduler').stop();
  } catch (e) {
    console.error("Failed to stop ticket-alert scheduler:", e.message);
  }
  await eventListenerService.stop();
}

process.on("SIGINT", async () => {
  console.log("\n\n👋 Received SIGINT, shutting down gracefully...");
  await stopBackgroundServices();
  await sequelize.close();
  console.log("📊 Database connection closed.");
  console.log("✅ Server shut down complete.\n");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n\n👋 Received SIGTERM, shutting down gracefully...");
  await stopBackgroundServices();
  await sequelize.close();
  console.log("📊 Database connection closed.");
  console.log("✅ Server shut down complete.\n");
  process.exit(0);
});