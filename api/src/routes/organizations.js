const express = require('express');
const router = express.Router();
const { Organization, User, SipTrunk, Queue } = require('../models');
const ConfigDeploymentService = require('../services/asterisk/configDeploymentService');
const AsteriskManager = require('../services/asterisk/asteriskManager');
const fs = require('fs').promises;
const path = require('path');

/**
 * POST /organizations/:orgId/regenerate
 * Regenerate all Asterisk configurations for an organization
 */
router.post('/:orgId/regenerate', async (req, res) => {
  try {
    const { orgId } = req.params;

    console.log(`Regenerating configurations for organization: ${orgId}`);

    // Fetch organization with all related data
    const organization = await Organization.findByPk(orgId, {
      include: [
        {
          model: User,
          as: 'users',
          required: false
        },
        {
          model: SipTrunk,
          as: 'trunks',
          required: false
        },
        {
          model: Queue,
          as: 'queues',
          required: false
        }
      ]
    });

    if (!organization) {
      return res.status(404).json({
        error: 'Organization not found',
        orgId
      });
    }

    console.log(`Found organization: ${organization.name}`);
    console.log(`Users: ${organization.users?.length || 0}`);
    console.log(`Trunks: ${organization.trunks?.length || 0}`);
    console.log(`Queues: ${organization.queues?.length || 0}`);

    // Initialize generators
    const configDeploymentService = new ConfigDeploymentService();

    // Add asterisk_endpoint to users for proper configuration
    const processedUsers = organization.users?.map(user => ({
      ...user.toJSON(),
      asterisk_endpoint: `${organization.context_prefix}${user.extension}`,
      full_name: user.first_name && user.last_name ? `${user.first_name} ${user.last_name}` : user.username
    })) || [];

    const processedOrg = {
      ...organization.toJSON(),
      users: processedUsers
    };

    console.log('Deploying organization configuration...');

    // Deploy all configurations using the unified service
    const result = await configDeploymentService.deployOrganizationConfiguration(
      organization.id,
      organization.name
    );

    console.log('Configuration deployment completed:', result.message);

    // Initialize Asterisk Manager and reload configurations
    const asteriskManager = new AsteriskManager();

    console.log('Reloading Asterisk configurations...');

    try {
      await asteriskManager.connect();

      // Reload PJSIP, dialplan, and queue modules
      await asteriskManager.reloadModule('res_pjsip.so');
      await asteriskManager.reloadDialplan();
      await asteriskManager.reloadQueues();

      await asteriskManager.disconnect();
      console.log('Asterisk configurations reloaded successfully');
    } catch (asteriskError) {
      console.error('Error reloading Asterisk configurations:', asteriskError.message);
      // Continue even if Asterisk reload fails
    }

    // Update organization's last_config_update timestamp
    await organization.update({
      last_config_update: new Date()
    });

    res.json({
      message: 'Organization configurations regenerated successfully',
      orgId,
      organization: organization.name,
      timestamp: new Date().toISOString(),
      files_generated: {
        pjsip: result.pjsipFile,
        dialplan: result.dialplanFile,
        queues: result.queueFile
      },
      counts: {
        users: processedUsers.length,
        trunks: organization.trunks?.length || 0,
        queues: organization.queues?.length || 0
      }
    });

  } catch (error) {
    console.error('Error regenerating organization configurations:', error);
    res.status(500).json({
      error: 'Failed to regenerate configurations',
      message: error.message,
      orgId: req.params.orgId
    });
  }
});

/**
 * GET /organizations
 * Get all organizations
 */
router.get('/', async (req, res) => {
  try {
    const organizations = await Organization.findAll({
      include: [
        { model: User, as: 'users' },
        { model: SipTrunk, as: 'trunks' },
        { model: Queue, as: 'queues' }
      ]
    });

    res.json({
      organizations,
      count: organizations.length
    });
  } catch (error) {
    console.error('Error fetching organizations:', error);
    res.status(500).json({
      error: 'Failed to fetch organizations',
      message: error.message
    });
  }
});

/**
 * GET /organizations/:orgId
 * Get organization by ID
 */
router.get('/:orgId', async (req, res) => {
  try {
    const { orgId } = req.params;

    const organization = await Organization.findByPk(orgId, {
      include: [
        { model: User, as: 'users' },
        { model: SipTrunk, as: 'trunks' },
        { model: Queue, as: 'queues' }
      ]
    });

    if (!organization) {
      return res.status(404).json({
        error: 'Organization not found',
        orgId
      });
    }

    res.json(organization);
  } catch (error) {
    console.error('Error fetching organization:', error);
    res.status(500).json({
      error: 'Failed to fetch organization',
      message: error.message
    });
  }
});

module.exports = router;