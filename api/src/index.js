#!/usr/bin/env node

/**
 * PBX API Development Server
 * Advanced telephony system with REST API and call control features
 */

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Basic health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'PBX API Development',
    version: '1.0.0',
    uptime: process.uptime()
  });
});

// Basic API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'PBX API Development',
    version: '1.0.0',
    description: 'Advanced telephony system with REST API and call control features',
    endpoints: {
      health: '/health',
      status: '/api/status',
      calls: '/api/calls',
      documentation: '/docs'
    }
  });
});

// API status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    pbx: {
      connected: false,
      status: 'Not configured'
    },
    services: {
      api: true,
      telephony: false
    },
    activeCalls: 0,
    timestamp: new Date().toISOString()
  });
});

// Placeholder for call management routes
app.get('/api/calls', (req, res) => {
  res.json({
    success: true,
    calls: [],
    count: 0,
    message: 'Call management system ready for implementation'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.originalUrl} not found`,
    availableEndpoints: ['/health', '/api', '/api/status', '/api/calls']
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 PBX API Development Server started successfully!`);
  console.log(`📍 Server running on: http://localhost:${PORT}`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log(`📋 API info: http://localhost:${PORT}/api`);
  console.log(`📊 Status: http://localhost:${PORT}/api/status`);
  console.log(`\n📖 Ready for PBX API development!\n`);
});

module.exports = app;