#!/usr/bin/env node

/**
 * Multi-Tenant PBX API Server
 * Complete implementation with all requested features
 */

const express = require('express');
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

// Scalar API Reference UI
const { apiReference } = require("@scalar/express-api-reference");
app.use("/reference", apiReference({ spec: { content: swaggerDocument } }));

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

  // Also accept internal key (for server-to-server calls)
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
    // Internal key without org_id — allow for admin/cross-org operations
    req.orgId = null;
    req.organization = null;
    req.isInternalAdmin = true;
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
app.get('/api/v1/server-info', (req, res) => {
  const os = require('os');
  const nets = os.networkInterfaces();
  let lanIp = null;
  for (const iface of Object.values(nets)) {
    for (const cfg of iface) {
      if (cfg.family === 'IPv4' && !cfg.internal && !cfg.address.startsWith('172.')) {
        lanIp = cfg.address;
        break;
      }
    }
    if (lanIp) break;
  }
  res.json({
    sip_host: process.env.SIP_HOST || lanIp || 'localhost',
    sip_port: parseInt(process.env.SIP_PORT) || 5060,
    hostname: os.hostname(),
  });
});

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

    // Validate organization name format (allow spaces, letters, numbers, hyphens)
    const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

    if (!namePattern.test(name)) {
      return res.status(400).json({
        error: 'Invalid organization name',
        message: 'Organization name must start and end with alphanumeric characters.'
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
        recording_enabled: false,
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

    // Auto-provision: create first extension (1001) for the owner
    try {
      const crypto = require('crypto');
      const sipPass = crypto.randomBytes(8).toString('hex');
      await User.create({
        org_id: organization.id,
        username: 'owner',
        email: contact_info?.email || '',
        full_name: 'Owner',
        extension: '1001',
        role: 'admin',
        status: 'active',
        password: sipPass,
        sip_password: sipPass,
        recording_enabled: false,
        routing_type: 'sip',
      });
      console.log(`✅ Auto-provisioned extension 1001 for org ${organization.name}`);

      // Auto-deploy Asterisk config for the new org
      await configDeploymentService.deployOrganizationConfiguration(organization.id, organization.name);
      await configDeploymentService.reloadAsteriskConfiguration();
      console.log(`✅ Auto-deployed config for new org ${organization.name}`);
    } catch (provErr) {
      console.warn('⚠️ Auto-provision failed (non-fatal):', provErr.message);
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
      const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

      if (!namePattern.test(name)) {
        return res.status(400).json({
          error: 'Invalid organization name',
          message: 'Organization name must start and end with alphanumeric characters.'
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

    const organizations = await Organization.findAll({
      attributes: ['id', 'name', 'context_prefix', 'api_key', 'createdAt']
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

// ========================================
// SIP TRUNK MANAGEMENT
// ========================================

app.get('/api/v1/trunks', authenticateOrg, async (req, res) => {
  try {
    const trunks = await SipTrunk.findAll({
      where: { org_id: req.orgId }
    });
    res.json(trunks);
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

    const trunk = await SipTrunk.create({
      org_id: req.orgId,
      name,
      host: trunk_type === 'inbound' ? null : host, // No host for inbound - dynamic registration
      port: trunk_type === 'inbound' ? null : port,
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
    const { number, trunk_id, description, routing_type, routing_destination, recording_enabled = false } = req.body;

    if (!number) {
      return res.status(400).json({ error: 'Number is required' });
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
      status: 'active',
      pool_status: 'assigned',
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
    const { extension, username, password, full_name, email, role = 'agent' } = req.body;

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
      recording_enabled: req.organization.recording_enabled
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

    const allowedFields = ['username', 'email', 'full_name', 'role', 'status', 'recording_enabled'];
    const updateData = {};

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

    await user.update(updateData);

    // Return updated user without sensitive fields
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
          attributes: ['id', 'full_name', 'extension']
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
          attributes: ['id', 'full_name', 'extension']
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
      recording_enabled = false
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
    const { user_id, user_ids, penalty = 0 } = req.body;
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
        const member = await QueueMember.create({
          queue_id: req.params.id,
          user_id: uid,
          penalty,
          paused: false
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
      recording_enabled: recording_enabled || false,
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
  try {
    // Create AMI connection
    const AsteriskManager = require('./services/asterisk/asteriskManager');
    const asteriskManager = new AsteriskManager();

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

        // Process this channel if it has the required data
        if (currentChannel.Channel) {
          const matchesOrg = currentChannel.Channel?.includes(orgPrefix) ||
                            currentChannel.CallerIDNum?.includes(orgPrefix) ||
                            currentChannel.ConnectedLineNum?.includes(orgPrefix) ||
                            currentChannel.Context?.includes(orgPrefix);

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
                // In queue: show queue number from ApplicationData (e.g. "org_mnd5khym__5001,ct,45")
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
              const extMatch = chName.match(/PJSIP\/\w+_(\d{4})-/);
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

    res.json({
      count: dedupedCalls.length,
      calls: dedupedCalls
    });

  } catch (error) {
    console.error('Error fetching live calls from AMI:', error);

    // Try to disconnect if still connected
    try {
      const AsteriskManager = require('./services/asterisk/asteriskManager');
      const asteriskManager = new AsteriskManager();
      await asteriskManager.disconnect();
    } catch (disconnectError) {
      // Ignore disconnect errors
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
        callerid: caller_id || from,
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
          caller_id: caller_id || from,
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
        callerid: caller_id || 'AI Agent',
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
          { replacements: [caller_id || '08065978002', to, channel, orgId, 'ai_' + Date.now(), 'ai_' + Date.now(), recName] }
        );
      } catch (e) { console.error('CDR insert for AI call failed:', e.message); }

      res.json({
        success: true,
        message: 'Call to AI agent initiated successfully',
        call: {
          to,
          endpoint,
          caller_id: caller_id || 'AI Agent',
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
    const id = uuidv4();
    const greeting = await Greeting.create({ id, org_id: req.orgId, ...req.body });
    res.json(greeting);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
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

    // Base match: org ownership via accountcode, peeraccount, or channel prefix
    const conditions = [
      "(t.accountcode = ? OR t.peeraccount = ? OR t.channel LIKE ? OR t.dcontext = 'ai-outbound')",
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

    // Main query — dedup by linkedid (keep longest duration leg)
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
          WHEN t.lastapp = 'Queue' AND t.disposition = 'ANSWERED' AND t.dstchannel LIKE 'Local/%'
            THEN CONCAT('Queue ', SUBSTRING_INDEX(SUBSTRING_INDEX(t.lastdata, ',', 1), '_', -1),
              ' [', SUBSTRING_INDEX(SUBSTRING_INDEX(t.dstchannel, '/', -1), '@', 1), ']')
          WHEN t.lastapp = 'Queue'
            THEN CONCAT('Queue ', SUBSTRING_INDEX(SUBSTRING_INDEX(t.lastdata, ',', 1), '_', -1))
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
          WHEN t.dstchannel = '' OR t.dstchannel IS NULL THEN 'prompt'
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
      FROM asterisk_cdr t
      INNER JOIN (
        SELECT linkedid, MAX(duration) as maxdur
        FROM asterisk_cdr t ${where}
        GROUP BY linkedid
      ) g ON t.linkedid = g.linkedid AND t.duration = g.maxdur
      ${where}
      ORDER BY t.calldate DESC
      LIMIT ? OFFSET ?`,
      { replacements: [...params, ...params, limit, offset], type: sequelize.QueryTypes.SELECT }
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
    let whereClause = "WHERE (accountcode = ? OR peeraccount = ? OR channel LIKE ? OR dcontext = 'ai-outbound') AND (channel NOT LIKE 'Local/%' OR dstchannel LIKE 'PJSIP/%') AND NOT (disposition = 'ANSWERED' AND billsec = 0 AND dcontext != 'ai-outbound') AND dst != 's'";
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

    const rows = await sequelize.query(
      "SELECT t.id, t.calldate as started_at, DATE_ADD(t.calldate, INTERVAL t.duration SECOND) as ended_at, " +
      "t.src as from_number, " +
      "CASE WHEN t.lastapp = 'Queue' AND t.disposition = 'ANSWERED' AND t.dstchannel LIKE 'Local/%' " +
      "THEN CONCAT('Queue ', SUBSTRING_INDEX(SUBSTRING_INDEX(t.lastdata, ',', 1), '_', -1), ' [', SUBSTRING_INDEX(SUBSTRING_INDEX(t.dstchannel, '/', -1), '@', 1), ']') " +
      "WHEN t.lastapp = 'Queue' THEN CONCAT('Queue ', SUBSTRING_INDEX(SUBSTRING_INDEX(t.lastdata, ',', 1), '_', -1)) " +
      "ELSE t.dst END as to_number, " +
      "t.duration, t.billsec as talk_time, t.disposition as status, t.accountcode as org_id, t.channel as channel_id, " +
      "t.uniqueid as call_id, t.linkedid, t.recordingfile as recording_file, " +
      "CASE WHEN t.dcontext = 'ai-outbound' THEN 'outbound' WHEN t.dcontext LIKE '%incoming%' THEN 'inbound' WHEN t.dcontext LIKE '%outbound%' THEN 'outbound' ELSE 'internal' END as direction, " +
      "CASE WHEN t.recordingfile != '' AND t.billsec > 0 THEN CONCAT('/api/v1/calls/', t.id, '/recording') ELSE NULL END as recording_url " +
      "FROM asterisk_cdr t INNER JOIN (" +
      "  SELECT linkedid, MAX(duration) as maxdur FROM asterisk_cdr " + whereClause + " GROUP BY linkedid" +
      ") g ON t.linkedid = g.linkedid AND t.duration = g.maxdur " +
      whereClause + " ORDER BY t.calldate DESC LIMIT ? OFFSET ?",
      { replacements: [...params, ...params, lim, offset], type: sequelize.QueryTypes.SELECT }
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
// Link an existing org_users entry (with null org_id) to an org
app.post('/api/v1/auth/link-admin-org', async (req, res) => {
  try {
    const internalKey = req.headers['x-internal-key'];
    if (!internalKey || internalKey !== process.env.INTERNAL_API_KEY) {
      return res.status(401).json({ error: 'Invalid internal key' });
    }
    const { email, org_id } = req.body;
    if (!email || !org_id) return res.status(400).json({ error: 'email and org_id required' });

    await sequelize.query(
      'UPDATE org_users SET org_id = ?, role = "owner", extension = "1001" WHERE email = ? AND org_id IS NULL',
      { replacements: [org_id, email] }
    );
    res.json({ message: 'Linked' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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

    const token = jwt.sign({
      orgId: org.id,
      orgName: org.name,
      apiKey: org.api_key,
      userId: 'admin',
      email: 'admin',
      name: 'Admin',
      role: 'owner',
      permissions: getPermissions('owner'),
    }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, org_name: org.name });
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
    // Check call_records first, then asterisk_cdr
    let recordingFile = null;
    const call = await CallRecord.findOne({ where: { id: req.params.callId, org_id: req.orgId } });
    if (call && call.recording_file) {
      recordingFile = call.recording_file;
    } else {
      // Try asterisk_cdr table
      const cdrRows = await sequelize.query(
        "SELECT recordingfile FROM asterisk_cdr WHERE id = ?", { type: sequelize.QueryTypes.SELECT,
        replacements: [req.params.callId] }
      );
      if (cdrRows && cdrRows[0] && cdrRows[0].recordingfile) {
        recordingFile = cdrRows[0].recordingfile;
      }
    }
    if (!recordingFile) return res.status(404).json({ error: "No recording" });

    // Audit: log recording access
    auditLog(orgId, 'recording.play', 'recording', req.params.callId, { filename: recordingFile }, req);

    const path = require("path");
    const fs = require("fs");
    let filePath = path.join("/var/spool/asterisk/monitor", recordingFile);
    // Also check ARI recording directory
    if (!fs.existsSync(filePath)) filePath = path.join("/var/spool/asterisk/recording", recordingFile);

    // Try local disk first (recent recordings not yet synced)
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Content-Disposition", "inline; filename=\"" + recordingFile + "\"");
      return fs.createReadStream(filePath).pipe(res);
    }

    // Fall back to Firebase Storage via rclone (rclone moves files there hourly)
    const { execFile } = require("child_process");
    const rclonePath = `firebase:misssellerai.firebasestorage.app/astra_pbx/recordings/${recordingFile}`;

    // Check file exists in storage first
    const checkProc = await new Promise((resolve) => {
      execFile("rclone", ["size", rclonePath, "--json"], { timeout: 10000 }, (err, stdout) => {
        if (err) return resolve(null);
        try { return resolve(JSON.parse(stdout)); } catch { return resolve(null); }
      });
    });
    if (!checkProc || checkProc.count === 0) {
      return res.status(404).json({ error: "Recording not found on disk or storage", file: recordingFile });
    }

    res.setHeader("Content-Type", "audio/wav");
    if (checkProc.bytes) res.setHeader("Content-Length", checkProc.bytes);
    res.setHeader("Content-Disposition", "inline; filename=\"" + recordingFile + "\"");
    const rclone = require("child_process").spawn("rclone", ["cat", rclonePath]);
    rclone.stdout.pipe(res);
    rclone.stderr.on("data", (d) => console.error("rclone err:", d.toString()));
    rclone.on("error", () => res.status(500).end());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Call journey — all CDR records for a linked call
app.get('/api/v1/calls/:linkedId/journey', authenticateOrg, async (req, res) => {
  try {
    const rows = await sequelize.query(
      "SELECT id, calldate, src, dst, dcontext, channel, dstchannel, lastapp, lastdata, " +
      "duration, billsec, disposition, uniqueid, linkedid, recordingfile, clid " +
      "FROM asterisk_cdr WHERE linkedid = ? ORDER BY calldate ASC, sequence ASC",
      { replacements: [req.params.linkedId], type: sequelize.QueryTypes.SELECT }
    );

    // Build journey steps
    const steps = rows.map(r => {
      let action = r.lastapp || 'Unknown';
      let target = r.dst;
      let status = r.disposition;
      let ext = '';

      if (r.channel && r.channel.startsWith('Local/')) {
        ext = r.channel.split('/')[1]?.split('@')[0] || '';
        action = 'Ring ' + ext;
      }
      if (r.lastapp === 'Queue') {
        const queueName = (r.lastdata || '').split(',')[0]?.split('_').pop() || '';
        action = 'Queue ' + queueName;
      }
      if (r.lastapp === 'Playback') {
        action = 'Playback: ' + (r.lastdata || '').split('/').pop();
      }
      if (r.lastapp === 'Dial') {
        const dialTarget = (r.lastdata || '').split(',')[0] || '';
        ext = dialTarget.split('/').pop()?.split('@')[0] || '';
        action = 'Dial ' + ext;
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
    const answeredExt = answeredBy ? answeredBy.channel.split('/')[1]?.split('@')[0] : null;

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

    // Delete from Firebase Storage (GCS via rclone)
    try {
      const { execSync } = require('child_process');
      const bucket = process.env.GCS_BUCKET || 'misssellerai.firebasestorage.app';
      execSync(`rclone deletefile firebase:${bucket}/astra_pbx/recordings/${filename}`, { timeout: 15000 });
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

// Register a new user (built-in auth — no Firebase)
app.post('/api/v1/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    // Check if email already exists
    const [existing] = await sequelize.query(
      'SELECT id FROM org_users WHERE email = ? LIMIT 1',
      { replacements: [email], type: sequelize.QueryTypes.SELECT }
    );
    if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

    // Hash password and store (user without org yet — org created via request-org)
    const passwordHash = await bcrypt.hash(password, 12);
    await sequelize.query(
      `INSERT INTO org_users (id, org_id, email, name, role, status, password_hash, created_at, updated_at)
       VALUES (UUID(), NULL, ?, ?, 'owner', 'active', ?, NOW(), NOW())`,
      { replacements: [email, name || email.split('@')[0], passwordHash] }
    );

    res.status(201).json({ message: 'Account created. You can now sign in.' });
  } catch (e) {
    console.error('register error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// User login with email + password → returns role-enriched JWT
app.post('/api/v1/auth/user-login', async (req, res) => {
  try {
    const { email, password, firebase_token, org_id } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    // Find user by email
    const [user] = await sequelize.query(
      `SELECT u.*, o.name as org_name, o.context_prefix, o.api_key
       FROM org_users u LEFT JOIN organizations o ON u.org_id = o.id
       WHERE u.email = ?
       ${org_id ? 'AND u.org_id = ?' : ''}
       LIMIT 1`,
      { replacements: org_id ? [email, org_id] : [email],
        type: sequelize.QueryTypes.SELECT }
    );

    if (!user) return res.status(404).json({ error: 'No account found with this email.' });

    // Verify password
    if (!user.password_hash) return res.status(401).json({ error: 'Password not set. Contact your admin.' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid password.' });

    // Check if user has no org yet (registered but hasn't requested org)
    if (!user.org_id) {
      return res.status(404).json({ error: 'no_org', message: 'Account exists but no organisation. Create one to continue.' });
    }

    // Check org status
    const [org] = await sequelize.query(
      'SELECT status, name FROM organizations WHERE id = ?',
      { replacements: [user.org_id], type: sequelize.QueryTypes.SELECT }
    );
    if (!org) return res.status(404).json({ error: 'Organisation not found.' });
    if (org.status === 'suspended') {
      return res.status(202).json({ status: 'pending_approval', org_name: org.name, message: 'Your organisation is awaiting admin approval.' });
    }
    if (org.status !== 'active') return res.status(403).json({ error: 'Organisation is not active.' });

    if (user.status === 'suspended') return res.status(403).json({ error: 'Account is suspended. Contact your org admin.' });

    // Auto-activate invited users on first login
    if (user.status === 'invited') {
      await sequelize.query('UPDATE org_users SET status = "active" WHERE id = ?', { replacements: [user.id] });
      user.status = 'active';
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

// Self-serve: request a new organisation (requires email — user must be registered)
app.post('/api/v1/auth/request-org', async (req, res) => {
  try {
    const { email, org_name, contact_phone, industry, address, company_size, expected_users, description } = req.body;
    if (!email || !org_name) return res.status(400).json({ error: 'email and org_name required' });

    // Find the registered user
    const [existingUser] = await sequelize.query(
      'SELECT id, email, org_id FROM org_users WHERE email = ? LIMIT 1',
      { replacements: [email], type: sequelize.QueryTypes.SELECT }
    );
    if (!existingUser) return res.status(404).json({ error: 'Register an account first.' });
    if (existingUser.org_id) return res.status(409).json({ error: 'You already have an organisation.' });

    // Check if org name is taken
    const nameExists = await Organization.findOne({ where: { name: org_name } });
    if (nameExists) return res.status(409).json({ error: 'Organisation name already taken.' });

    // Create org as suspended (pending admin approval)
    const apiSecret = uuidv4();
    const org = await Organization.create({
      name: org_name,
      status: 'suspended',
      api_secret: await bcrypt.hash(apiSecret, 12),
      contact_info: {
        email: email,
        phone: contact_phone || null,
        address: address || null,
        industry: industry || null,
        company_size: company_size || null,
        expected_users: expected_users || null,
        description: description || null,
      },
    });

    // Link user to the new org as owner
    await sequelize.query(
      'UPDATE org_users SET org_id = ?, role = "owner", extension = "1001" WHERE id = ?',
      { replacements: [org.id, existingUser.id] }
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

    // Auto-provision extension 1001 for the owner if not exists
    const [existingUser] = await sequelize.query(
      'SELECT id FROM users WHERE org_id = ? AND extension = "1001" LIMIT 1',
      { replacements: [org.id], type: sequelize.QueryTypes.SELECT }
    );
    if (!existingUser) {
      const crypto = require('crypto');
      const sipPass = crypto.randomBytes(8).toString('hex');
      await User.create({
        org_id: org.id, username: 'owner', email: '',
        full_name: 'Owner', extension: '1001', role: 'admin', status: 'active',
        password: sipPass, sip_password: sipPass, recording_enabled: false, routing_type: 'sip',
      });
    }

    // Auto-deploy Asterisk config
    try {
      await configDeploymentService.deployOrganizationConfiguration(org.id, org.name);
      await configDeploymentService.reloadAsteriskConfiguration();
    } catch (deployErr) { console.warn('⚠️ Auto-deploy on org approve:', deployErr.message); }

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

    // Sync database models
    await sequelize.sync();
    console.log('📊 Database models synchronized.');

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
      async function pollCdr() {
        try {
          // Get new records, dedup by linkedid (pick longest duration per call)
          const allRows = await sequelize.query(
            "SELECT id, calldate, src, dst, dcontext, channel, dstchannel, lastapp, lastdata, " +
            "duration, billsec, disposition, uniqueid, linkedid, recordingfile, accountcode, peeraccount " +
            "FROM asterisk_cdr WHERE id > ? AND channel NOT LIKE 'Local/%' ORDER BY id ASC LIMIT 50",
            { replacements: [lastCdrId], type: sequelize.QueryTypes.SELECT }
          );
          if (!allRows || allRows.length === 0) return;
          // Update lastCdrId to max of all fetched
          for (const r of allRows) lastCdrId = Math.max(lastCdrId, r.id);
          // Dedup: keep one record per linkedid (longest duration)
          const byLinked = {};
          for (const r of allRows) {
            const lid = r.linkedid || r.uniqueid;
            if (!byLinked[lid] || r.duration > byLinked[lid].duration) byLinked[lid] = r;
          }
          const rows = Object.values(byLinked);
          const axios = require('axios');
          const autoTicketUrl = process.env.AUTO_TICKET_URL || 'https://events.astradial.com';
          for (const r of rows) {
            // Determine org_id from accountcode, peeraccount, or channel prefix
            let orgId = r.accountcode || r.peeraccount || '';
            if (!orgId || orgId.length < 10) {
              // Extract org from channel name (e.g. PJSIP/org_mnd5khym_trunk... -> org_mnd5khym_)
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
            axios.post(`${autoTicketUrl}/auto-ticket/${orgId}`, {
              call_id: r.uniqueid || String(r.id),
              from_number: r.src || '',
              to_number: r.dst || '',
              direction,
              disposition: r.disposition || '',
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
          }
        } catch (e) { console.error('CDR poll error:', e.message); }
      }
      console.log("CDR poller: initializing..."); initCdrPoller().then(() => console.log("CDR poller: init done")).catch(e => console.error("CDR poller init CATCH:", e));
      setInterval(pollCdr, 30000);

    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
})();

module.exports = app;

// Graceful shutdown handler
process.on("SIGINT", async () => {
  console.log("\n\n👋 Received SIGINT, shutting down gracefully...");
  await eventListenerService.stop();
  await sequelize.close();
  console.log("📊 Database connection closed.");
  console.log("✅ Server shut down complete.\n");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n\n👋 Received SIGTERM, shutting down gracefully...");
  await eventListenerService.stop();
  await sequelize.close();
  console.log("📊 Database connection closed.");
  console.log("✅ Server shut down complete.\n");
  process.exit(0);
});
