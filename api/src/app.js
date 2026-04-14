const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

// Load environment variables
dotenv.config();

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// Swagger configuration
const swaggerDocument = yaml.load(
  fs.readFileSync(path.join(__dirname, '../docs/API_SPECIFICATION.yaml'), 'utf8')
);

// API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Import routes
const organizationRoutes = require('./routes/organizations');
const trunkRoutes = require('./routes/trunks');
const didRoutes = require('./routes/dids');
const userRoutes = require('./routes/users');
const queueRoutes = require('./routes/queues');
const routingRoutes = require('./routes/routing');
const webhookRoutes = require('./routes/webhooks');
const callRoutes = require('./routes/calls');

// API Routes
const apiPrefix = process.env.API_PREFIX || '/api/v1';

app.use(`${apiPrefix}/organizations`, organizationRoutes);
app.use(`${apiPrefix}/trunks`, trunkRoutes);
app.use(`${apiPrefix}/dids`, didRoutes);
app.use(`${apiPrefix}/users`, userRoutes);
app.use(`${apiPrefix}/queues`, queueRoutes);
app.use(`${apiPrefix}/routing`, routingRoutes);
app.use(`${apiPrefix}/webhooks`, webhookRoutes);
app.use(`${apiPrefix}/calls`, callRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Multi-Tenant PBX API',
    version: '1.0.0',
    documentation: '/api-docs',
    endpoints: {
      organizations: `${apiPrefix}/organizations`,
      trunks: `${apiPrefix}/trunks`,
      dids: `${apiPrefix}/dids`,
      users: `${apiPrefix}/users`,
      queues: `${apiPrefix}/queues`,
      routing: `${apiPrefix}/routing`,
      webhooks: `${apiPrefix}/webhooks`,
      calls: `${apiPrefix}/calls`
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);

  // Handle Sequelize validation errors
  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: err.errors.map(e => e.message).join(', ')
    });
  }

  // Handle Sequelize unique constraint errors
  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({
      error: 'Conflict',
      message: 'Resource already exists'
    });
  }

  // Default error
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.originalUrl} not found`,
    documentation: '/api-docs'
  });
});

module.exports = app;