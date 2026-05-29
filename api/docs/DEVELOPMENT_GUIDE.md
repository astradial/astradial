# Development Guide - PBX API

## Table of Contents
1. [Getting Started](#getting-started)
2. [Development Environment](#development-environment)
3. [Project Structure](#project-structure)
4. [Database Setup](#database-setup)
5. [API Development](#api-development)
6. [Testing](#testing)
7. [Debugging](#debugging)
8. [Best Practices](#best-practices)
9. [Common Tasks](#common-tasks)
10. [Troubleshooting](#troubleshooting)

## Getting Started

### Prerequisites
- Node.js v14+ (v16+ recommended)
- MySQL/MariaDB 10.3+
- Asterisk PBX 16+ with AMI enabled
- Git
- npm or yarn package manager

### Initial Setup

1. **Clone the Repository**
```bash
git clone git@github.com:abusayed200four/asterisk-api.git
cd PBX-API-Development
```

2. **Install Dependencies**
```bash
npm install
```

3. **Environment Configuration**
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your configuration
nano .env
```

4. **Required Environment Variables**
```env
# Server Configuration
PORT=3000
HOST=0.0.0.0

# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_NAME=pbx_api
DB_USER=pbx_user
DB_PASSWORD=your_secure_password
DB_DIALECT=mysql

# Asterisk AMI Configuration
AMI_HOST=localhost
AMI_PORT=5038
AMI_USERNAME=pbx_ami_user
AMI_PASSWORD=YOUR_AMI_SECRET

# JWT Configuration
JWT_SECRET=your_jwt_secret_here_change_in_production

# Admin Credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=secure_admin_password

# Optional: Redis Cache
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

5. **Database Setup**
```bash
# Create database
mysql -u root -p -e "CREATE DATABASE pbx_api;"

# Run migrations
npx sequelize-cli db:migrate

# Run seeders (optional - for test data)
npx sequelize-cli db:seed:all
```

## Development Environment

### Required Software

#### Asterisk Configuration
1. **Install Asterisk**
```bash
# Ubuntu/Debian
sudo apt-get install asterisk

# CentOS/RHEL
sudo yum install asterisk
```

2. **Enable AMI** - Edit `/etc/asterisk/manager.conf`:
```ini
[general]
enabled = yes
port = 5038
bindaddr = 127.0.0.1

[pbx_ami_user]
secret = YOUR_AMI_SECRET
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.0/255.255.255.0
read = all
write = all
```

3. **Reload Asterisk**
```bash
sudo asterisk -rx "manager reload"
```

### VS Code Setup

#### Recommended Extensions
- ESLint
- Prettier
- REST Client
- Docker
- GitLens
- Thunder Client (API testing)

#### Launch Configuration (`.vscode/launch.json`)
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Server",
      "program": "${workspaceFolder}/src/server.js",
      "envFile": "${workspaceFolder}/.env",
      "console": "integratedTerminal"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Run Tests",
      "program": "${workspaceFolder}/test-api-script.js",
      "console": "integratedTerminal"
    }
  ]
}
```

## Project Structure

```
PBX-API-Development/
├── src/
│   ├── server.js              # Main application entry point
│   ├── models/                # Sequelize data models
│   │   ├── index.js          # Model loader and associations
│   │   ├── Organization.js   # Organization model
│   │   ├── User.js           # User model
│   │   ├── SipTrunk.js       # SIP trunk model
│   │   ├── DidNumber.js      # DID number model
│   │   ├── Queue.js          # Queue model
│   │   ├── QueueMember.js    # Queue member model
│   │   ├── Webhook.js        # Webhook model
│   │   └── CallRecord.js     # Call record model
│   ├── routes/                # API route definitions
│   │   ├── organizations.js  # Organization routes
│   │   ├── users.js          # User routes
│   │   ├── trunks.js         # Trunk routes
│   │   ├── queues.js         # Queue routes
│   │   └── webhooks.js       # Webhook routes
│   ├── services/              # Business logic services
│   │   ├── asterisk/         # Asterisk-related services
│   │   │   ├── asteriskManager.js           # AMI connection manager
│   │   │   ├── configDeploymentService.js   # Deploy configs to Asterisk
│   │   │   └── configVerificationService.js # Verify configurations
│   │   ├── dialplanService.js    # Dialplan generation
│   │   ├── queueService.js       # Queue management
│   │   └── sipTrunkService.js    # Trunk management
│   ├── middleware/            # Express middleware
│   │   ├── auth.js           # Authentication middleware
│   │   ├── validation.js     # Request validation
│   │   └── errorHandler.js   # Error handling
│   └── utils/                 # Utility functions
│       ├── logger.js         # Logging utility
│       ├── validators.js     # Data validators
│       └── helpers.js        # Helper functions
├── config/                    # Configuration files
│   ├── database.js           # Database configuration
│   └── asterisk.js           # Asterisk configuration
├── database/                  # Database files
│   ├── migrations/           # Sequelize migrations
│   └── seeders/              # Sequelize seeders
├── docs/                      # Documentation
│   ├── API_SPECIFICATION.yaml # OpenAPI/Swagger spec
│   └── ARCHITECTURE.md       # Architecture documentation
├── tests/                     # Test files
├── .env                       # Environment variables
├── .sequelizerc              # Sequelize configuration
├── package.json              # NPM dependencies
└── README.md                 # Project readme
```

## Database Setup

### Schema Design

#### Key Tables
1. **organizations** - Multi-tenant organizations
2. **users** - Users with extensions
3. **sip_trunks** - External SIP connections
4. **did_numbers** - Phone numbers
5. **queues** - Call queues
6. **queue_members** - Queue assignments
7. **webhooks** - Event notifications
8. **call_records** - Call history/CDR

### Migrations

#### Creating a New Migration
```bash
npx sequelize-cli migration:generate --name add-field-to-users
```

#### Migration Template
```javascript
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('users', 'new_field', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('users', 'new_field');
  }
};
```

#### Running Migrations
```bash
# Run pending migrations
npx sequelize-cli db:migrate

# Undo last migration
npx sequelize-cli db:migrate:undo

# Undo all migrations
npx sequelize-cli db:migrate:undo:all
```

## API Development

### Adding a New Endpoint

#### 1. Define the Route (`/src/routes/newResource.js`)
```javascript
const express = require('express');
const router = express.Router();
const { authenticateOrg } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

// GET /api/v1/resources
router.get('/', authenticateOrg, async (req, res) => {
  try {
    // Implementation
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/v1/resources
router.post('/', authenticateOrg, validate('createResource'), async (req, res) => {
  try {
    // Implementation
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
```

#### 2. Create the Model (`/src/models/NewResource.js`)
```javascript
module.exports = (sequelize, DataTypes) => {
  const NewResource = sequelize.define('NewResource', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'organizations',
        key: 'id'
      }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [2, 255]
      }
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active'
    }
  }, {
    tableName: 'new_resources',
    timestamps: true,
    underscored: true
  });

  NewResource.associate = function(models) {
    NewResource.belongsTo(models.Organization, {
      foreignKey: 'org_id',
      as: 'organization'
    });
  };

  return NewResource;
};
```

#### 3. Mount the Route (`/src/server.js`)
```javascript
const newResourceRoutes = require('./routes/newResource');
app.use('/api/v1/resources', newResourceRoutes);
```

### Request Validation

#### Using express-validator
```javascript
const { body, validationResult } = require('express-validator');

const createResourceValidation = [
  body('name')
    .isString()
    .isLength({ min: 2, max: 255 })
    .withMessage('Name must be between 2 and 255 characters'),
  body('type')
    .isIn(['type1', 'type2'])
    .withMessage('Invalid type'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ errors: errors.array() });
    }
    next();
  }
];
```

### Error Handling

#### Custom Error Class
```javascript
class ApiError extends Error {
  constructor(statusCode, message, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Usage
throw new ApiError(404, 'Resource not found');
```

## Testing

### Test Scripts

#### 1. Service Testing (`test-services.js`)
```javascript
const { SipTrunkService } = require('./src/services');

async function testSipTrunkService() {
  const service = new SipTrunkService();

  // Test trunk creation
  const trunk = await service.create({
    org_id: 'test-org-id',
    name: 'Test Trunk',
    host: 'sip.example.com'
  });

  console.log('✅ Trunk created:', trunk.id);

  // Test trunk configuration generation
  const config = await service.generateConfiguration(trunk);
  console.log('✅ Configuration generated');
}
```

#### 2. API Testing (`test-api-script.js`)
```javascript
const axios = require('axios');
const BASE_URL = 'http://localhost:3000/api/v1';

async function testAPI() {
  // Test organization creation
  const orgResponse = await axios.post(`${BASE_URL}/organizations`, {
    name: 'Test-Org',
    admin_username: process.env.ADMIN_USERNAME,
    admin_password: process.env.ADMIN_PASSWORD
  });

  const apiKey = orgResponse.data.api_key;
  console.log('✅ Organization created');

  // Test authenticated endpoints
  const headers = { 'X-API-Key': apiKey };

  const users = await axios.get(`${BASE_URL}/users`, { headers });
  console.log('✅ Users fetched:', users.data.length);
}
```

### Running Tests
```bash
# Run service tests
node test-services.js

# Run API tests
node test-api-script.js

# Run integration tests
node test-real-integration.js

# Run specific test
node test-api-config-deployment.js
```

## Debugging

### Enable Debug Mode
```bash
# Set DEBUG environment variable
DEBUG=* npm start

# Or specific namespaces
DEBUG=express:* npm start
DEBUG=sequelize:* npm start
```

### Common Debug Points

#### 1. Database Queries
```javascript
// Enable Sequelize logging
const sequelize = new Sequelize({
  // ... config
  logging: console.log // or custom logger
});
```

#### 2. AMI Connection
```javascript
// In asteriskManager.js
this.ami.on('managerevent', (event) => {
  console.log('AMI Event:', event);
});
```

#### 3. API Requests
```javascript
// Morgan middleware for request logging
app.use(morgan('dev'));
```

### Using Node Inspector
```bash
# Start with inspector
node --inspect src/server.js

# Or with break on start
node --inspect-brk src/server.js
```

## Best Practices

### Code Style

#### 1. Async/Await Pattern
```javascript
// Good ✅
async function getUser(id) {
  try {
    const user = await User.findByPk(id);
    if (!user) {
      throw new ApiError(404, 'User not found');
    }
    return user;
  } catch (error) {
    throw error;
  }
}

// Avoid ❌
function getUser(id, callback) {
  User.findByPk(id)
    .then(user => callback(null, user))
    .catch(err => callback(err));
}
```

#### 2. Error Handling
```javascript
// Good ✅
router.get('/:id', async (req, res, next) => {
  try {
    const resource = await service.findById(req.params.id);
    res.json(resource);
  } catch (error) {
    next(error); // Pass to error handler
  }
});
```

#### 3. Input Validation
```javascript
// Always validate input
const { body, param, query } = require('express-validator');

router.post('/', [
  body('email').isEmail().normalizeEmail(),
  body('phone').isMobilePhone(),
  body('name').trim().isLength({ min: 2, max: 255 })
], async (req, res) => {
  // Handle request
});
```

### Security

#### 1. SQL Injection Prevention
```javascript
// Good ✅ - Use parameterized queries
const users = await sequelize.query(
  'SELECT * FROM users WHERE org_id = :orgId',
  {
    replacements: { orgId: req.orgId },
    type: QueryTypes.SELECT
  }
);

// Avoid ❌ - String concatenation
const users = await sequelize.query(
  `SELECT * FROM users WHERE org_id = '${req.orgId}'`
);
```

#### 2. Authentication Check
```javascript
// Always verify organization ownership
const resource = await Resource.findOne({
  where: {
    id: req.params.id,
    org_id: req.orgId // From auth middleware
  }
});

if (!resource) {
  return res.status(404).json({ error: 'Resource not found' });
}
```

### Performance

#### 1. Database Queries
```javascript
// Good ✅ - Eager loading
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

// Avoid ❌ - N+1 queries
const queues = await Queue.findAll();
for (const queue of queues) {
  queue.members = await QueueMember.findAll({ where: { queue_id: queue.id }});
}
```

#### 2. Pagination
```javascript
// Always paginate large datasets
const page = parseInt(req.query.page) || 1;
const limit = Math.min(parseInt(req.query.limit) || 20, 100);
const offset = (page - 1) * limit;

const { count, rows } = await User.findAndCountAll({
  where: { org_id: req.orgId },
  limit,
  offset,
  order: [['created_at', 'DESC']]
});

res.json({
  data: rows,
  pagination: {
    page,
    limit,
    total: count,
    pages: Math.ceil(count / limit)
  }
});
```

## Common Tasks

### Creating a Test Organization
```javascript
async function createTestOrganization() {
  const axios = require('axios');

  const response = await axios.post('http://localhost:3000/api/v1/organizations', {
    name: 'TestOrg',
    admin_username: process.env.ADMIN_USERNAME,
    admin_password: process.env.ADMIN_PASSWORD
  });

  console.log('Organization created:');
  console.log('API Key:', response.data.api_key);
  console.log('API Secret:', response.data.api_secret);

  return response.data;
}
```

### Deploying Configuration to Asterisk
```javascript
async function deployConfiguration(orgId, apiKey) {
  const axios = require('axios');

  const response = await axios.post(
    'http://localhost:3000/api/v1/config/deploy',
    { reload: true },
    { headers: { 'X-API-Key': apiKey } }
  );

  console.log('Deployment result:', response.data);
}
```

### Monitoring Active Calls
```javascript
async function monitorCalls(apiKey) {
  const axios = require('axios');

  const response = await axios.get(
    'http://localhost:3000/api/v1/calls/live',
    { headers: { 'X-API-Key': apiKey } }
  );

  console.log('Active calls:', response.data.count);
  response.data.calls.forEach(call => {
    console.log(`- ${call.from} -> ${call.to} (${call.duration}s)`);
  });
}
```

## Troubleshooting

### Common Issues

#### 1. Database Connection Error
```bash
# Check MySQL is running
sudo systemctl status mysql

# Test connection
mysql -u pbx_user -p -h localhost pbx_api

# Check credentials in .env
cat .env | grep DB_
```

#### 2. AMI Connection Failed
```bash
# Check Asterisk is running
sudo asterisk -rx "core show version"

# Test AMI connection
telnet localhost 5038

# Check AMI config
sudo cat /etc/asterisk/manager.conf

# Reload AMI
sudo asterisk -rx "manager reload"
```

#### 3. Port Already in Use
```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or use different port
PORT=3001 npm start
```

#### 4. Migration Errors
```bash
# Check migration status
npx sequelize-cli db:migrate:status

# Reset database (CAUTION: deletes all data)
npx sequelize-cli db:drop
npx sequelize-cli db:create
npx sequelize-cli db:migrate
```

### Debug Logging

#### Enable Verbose Logging
```javascript
// In .env
LOG_LEVEL=debug

// In code
if (process.env.LOG_LEVEL === 'debug') {
  console.log('Debug:', data);
}
```

#### Asterisk CLI Debugging
```bash
# Connect to Asterisk CLI
sudo asterisk -rvvv

# Enable SIP debugging
sip set debug on

# Enable PJSIP debugging
pjsip set logger on

# Watch specific context
dialplan show testorg@
```

### Performance Issues

#### 1. Slow Queries
```javascript
// Add query logging
const startTime = Date.now();
const result = await complexQuery();
console.log(`Query took ${Date.now() - startTime}ms`);
```

#### 2. Memory Leaks
```bash
# Monitor memory usage
node --expose-gc --trace-gc src/server.js

# Use heap snapshots
node --inspect src/server.js
# Then use Chrome DevTools Memory Profiler
```

## Contributing

### Code Review Checklist
- [ ] Code follows project style guide
- [ ] All tests pass
- [ ] New features have tests
- [ ] Documentation is updated
- [ ] No sensitive data in commits
- [ ] Database migrations are included
- [ ] API documentation is updated
- [ ] Error handling is comprehensive
- [ ] Input validation is present
- [ ] Performance impact considered

### Commit Guidelines
```bash
# Format: <type>(<scope>): <subject>

# Examples:
git commit -m "feat(users): add role-based access control"
git commit -m "fix(ami): handle connection timeout"
git commit -m "docs(api): update endpoint documentation"
git commit -m "test(queues): add queue member tests"
git commit -m "refactor(auth): simplify JWT validation"
```

## Additional Resources

### Documentation
- [Asterisk Documentation](https://wiki.asterisk.org)
- [Sequelize Documentation](https://sequelize.org)
- [Express.js Guide](https://expressjs.com)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)

### Tools
- [Postman](https://www.postman.com) - API testing
- [ngrok](https://ngrok.com) - Expose local server
- [PM2](https://pm2.keymetrics.io) - Process management
- [Redis](https://redis.io) - Caching layer

### Community
- GitHub Issues - Bug reports and features
- Stack Overflow - Technical questions
- Asterisk Forums - PBX-specific help

## License

This project is licensed under the MIT License. See LICENSE file for details.