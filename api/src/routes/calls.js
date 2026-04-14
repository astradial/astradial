const express = require('express');
const router = express.Router();
const { CallRecord, Organization, User, sequelize } = require('../models');
const { Op } = require('sequelize');
const AsteriskManager = require('../services/asterisk/asteriskManager');
const eventListenerService = require('../services/eventListenerService');
const ari = require('ari-client');

// Helper function to get ARI client from event listener service
const getARIClient = () => {
  return eventListenerService.ariClient;
};

/**
 * POST /calls/click-to-call
 * Initiate a call between two parties
 */
router.post('/click-to-call', async (req, res) => {
  try {
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    const {
      from,
      to,
      to_type = 'extension',
      caller_id,
      timeout = 30,
      context,
      variables = {}
    } = req.body;

    // Validate required fields
    if (!from || !to) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['from', 'to']
      });
    }

    // Get organization for context prefix
    const org = await Organization.findByPk(orgId);
    if (!org) {
      return res.status(404).json({
        error: 'Organization not found'
      });
    }

    // Determine destination based on to_type
    let destination;
    let destinationContext = context || `${org.context_prefix}internal`;

    switch (to_type) {
      case 'extension':
        destination = to;
        destinationContext = `${org.context_prefix}internal`;
        break;
      case 'queue':
        destination = to;
        destinationContext = `${org.context_prefix}queue`;
        break;
      case 'ivr':
        destination = to;
        destinationContext = `${org.context_prefix}ivr`;
        break;
      case 'external':
        destination = to;
        destinationContext = `${org.context_prefix}outbound`;
        break;
      case 'ai_agent':
        destination = to;
        destinationContext = `${org.context_prefix}ai`;
        break;
      default:
        destination = to;
    }

    // Create AMI manager instance
    const ami = new AsteriskManager();

    try {
      await ami.connect();

      // Originate call using AMI
      const originateResult = await ami.originate({
        channel: `PJSIP/${from}`,
        exten: destination,
        context: destinationContext,
        callerid: caller_id || from,
        timeout: timeout * 1000,
        variables: {
          ORG_ID: orgId,
          CALL_TYPE: 'click-to-call',
          TO_TYPE: to_type,
          ...variables
        },
        async: true
      });

      await ami.disconnect();

      res.json({
        success: true,
        message: 'Call initiated successfully',
        call: {
          from,
          to,
          to_type,
          caller_id: caller_id || from,
          destination,
          context: destinationContext,
          timeout,
          response: originateResult
        }
      });

    } catch (amiError) {
      await ami.disconnect();
      throw amiError;
    }

  } catch (error) {
    console.error('Error initiating click-to-call:', error);
    res.status(500).json({
      error: 'Failed to initiate click-to-call',
      details: error.message
    });
  }
});

/**
 * POST /calls/:channelId/transfer
 * Transfer an active call to another destination
 */
router.post('/:channelId/transfer', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { destination, type = 'blind', context } = req.body;
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    if (!destination) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'destination is required'
      });
    }

    // Get organization for context
    const org = await Organization.findByPk(orgId);
    if (!org) {
      return res.status(404).json({
        error: 'Organization not found'
      });
    }

    const transferContext = context || `${org.context_prefix}internal`;

    // Use ARI client for call control
    const ari = getARIClient();

    if (!ari.isConnected) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Call control service not available'
      });
    }

    // Perform transfer
    const success = await ari.transferChannel(channelId, destination, transferContext);

    if (success) {
      res.json({
        success: true,
        message: 'Call transferred successfully',
        transfer: {
          channel_id: channelId,
          destination,
          context: transferContext,
          type
        }
      });
    } else {
      res.status(500).json({
        error: 'Failed to transfer call',
        message: 'Transfer operation failed'
      });
    }

  } catch (error) {
    console.error('Error transferring call:', error);
    res.status(500).json({
      error: 'Failed to transfer call',
      message: error.message
    });
  }
});

/**
 * POST /calls/:channelId/hangup
 * Hang up an active call
 */
router.post('/:channelId/hangup', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { reason = 'normal' } = req.body;
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    // Use ARI client for call control
    const ari = getARIClient();

    if (!ari.isConnected) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Call control service not available'
      });
    }

    // Perform hangup
    const success = await ari.hangupChannel(channelId, reason);

    if (success) {
      res.json({
        success: true,
        message: 'Call hung up successfully',
        hangup: {
          channel_id: channelId,
          reason
        }
      });
    } else {
      res.status(500).json({
        error: 'Failed to hang up call',
        message: 'Hangup operation failed'
      });
    }

  } catch (error) {
    console.error('Error hanging up call:', error);
    res.status(500).json({
      error: 'Failed to hang up call',
      message: error.message
    });
  }
});

/**
 * POST /calls/:channelId/hold
 * Put a call on hold
 */
router.post('/:channelId/hold', async (req, res) => {
  try {
    const { channelId } = req.params;
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    const ari = getARIClient();

    if (!ari.isConnected) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Call control service not available'
      });
    }

    const success = await ari.holdChannel(channelId);

    if (success) {
      res.json({
        success: true,
        message: 'Call put on hold successfully',
        channel_id: channelId
      });
    } else {
      res.status(500).json({
        error: 'Failed to hold call'
      });
    }

  } catch (error) {
    console.error('Error holding call:', error);
    res.status(500).json({
      error: 'Failed to hold call',
      message: error.message
    });
  }
});

/**
 * POST /calls/:channelId/unhold
 * Remove a call from hold
 */
router.post('/:channelId/unhold', async (req, res) => {
  try {
    const { channelId } = req.params;
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    const ari = getARIClient();

    if (!ari.isConnected) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Call control service not available'
      });
    }

    const success = await ari.unholdChannel(channelId);

    if (success) {
      res.json({
        success: true,
        message: 'Call removed from hold successfully',
        channel_id: channelId
      });
    } else {
      res.status(500).json({
        error: 'Failed to unhold call'
      });
    }

  } catch (error) {
    console.error('Error unholding call:', error);
    res.status(500).json({
      error: 'Failed to unhold call',
      message: error.message
    });
  }
});

/**
 * GET /calls/channels
 * Get all active channels from Asterisk with their channel IDs
 * This is what you need for transfer and hangup operations
 */
router.get('/channels', async (req, res) => {
  try {
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    const ariClient = getARIClient();

    if (!ariClient || !ariClient.isConnected) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Call control service not available'
      });
    }

    // Get all channels from Asterisk
    try {
      const channels = await ariClient.client.channels.list();

      // Filter channels by organization (if possible via channel variables)
      const channelDetails = await Promise.all(
        channels.map(async (channel) => {
          try {
            // Try to get ORG_ID variable from channel
            const orgIdVar = await ariClient.client.channels.getChannelVar({
              channelId: channel.id,
              variable: 'ORG_ID'
            }).catch(() => ({ value: null }));

            return {
              channel_id: channel.id,
              channel_name: channel.name,
              state: channel.state,
              caller_number: channel.caller?.number || 'Unknown',
              caller_name: channel.caller?.name || '',
              connected_number: channel.connected?.number || '',
              connected_name: channel.connected?.name || '',
              accountcode: channel.accountcode || '',
              creationtime: channel.creationtime,
              org_id: orgIdVar.value,
              dialplan: {
                context: channel.dialplan?.context || '',
                exten: channel.dialplan?.exten || '',
                priority: channel.dialplan?.priority || 0
              }
            };
          } catch (err) {
            return {
              channel_id: channel.id,
              channel_name: channel.name,
              state: channel.state,
              caller_number: channel.caller?.number || 'Unknown',
              org_id: null
            };
          }
        })
      );

      // Filter to only show this org's channels
      const orgChannels = channelDetails.filter(ch => ch.org_id === orgId || ch.org_id === null);

      res.json({
        channels: orgChannels,
        count: orgChannels.length,
        total_channels: channels.length
      });

    } catch (ariError) {
      console.error('Error fetching channels from Asterisk:', ariError);
      res.status(500).json({
        error: 'Failed to fetch active channels',
        message: ariError.message
      });
    }

  } catch (error) {
    console.error('Error getting active channels:', error);
    res.status(500).json({
      error: 'Failed to get active channels',
      message: error.message
    });
  }
});

/**
 * GET /calls/live
 * Get all live/active calls for the organization from memory
 */
router.get('/live', async (req, res) => {
  try {
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    const ariClient = getARIClient();

    if (!ariClient || !ariClient.isConnected) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Call control service not available'
      });
    }

    const activeCalls = ariClient.getActiveCallsForOrg(orgId);

    res.json({
      calls: activeCalls,
      count: activeCalls.length
    });

  } catch (error) {
    console.error('Error getting live calls:', error);
    res.status(500).json({
      error: 'Failed to get live calls',
      message: error.message
    });
  }
});

/**
 * GET /calls/count
 * Get call count and statistics
 */
router.get('/count', async (req, res) => {
  try {
    const orgId = req.user?.org_id;
    const { status, from, to } = req.query;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    const where = { org_id: orgId };

    if (status) {
      where.status = status;
    }

    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = new Date(from);
      if (to) where.created_at[Op.lte] = new Date(to);
    }

    const count = await CallRecord.count({ where });

    const stats = await CallRecord.findAll({
      where: { org_id: orgId },
      attributes: [
        [sequelize.fn('COUNT', sequelize.col('id')), 'total_calls'],
        [sequelize.fn('COUNT', sequelize.literal("CASE WHEN status = 'answered' THEN 1 END")), 'answered_calls'],
        [sequelize.fn('COUNT', sequelize.literal("CASE WHEN status = 'busy' OR status = 'failed' THEN 1 END")), 'missed_calls'],
        [sequelize.fn('AVG', sequelize.col('duration')), 'avg_duration']
      ],
      raw: true
    });

    res.json({
      count,
      statistics: stats[0] || {}
    });

  } catch (error) {
    console.error('Error getting call count:', error);
    res.status(500).json({
      error: 'Failed to get call count',
      message: error.message
    });
  }
});

/**
 * POST /calls/originate-to-ai
 * Originate a call to a remote party and connect to AI agent Stasis app when answered
 */
router.post('/originate-to-ai', async (req, res) => {
  try {
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
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
      // Internal extension — direct PJSIP
      channel = `PJSIP/${to}`;
      endpoint = `PJSIP/${to}`;
    } else {
      // External number — dial directly via PJSIP trunk (NOT Local channel)
      // Local channels go through dialplan which bypasses Stasis
      const { SipTrunk } = require('../models');
      const trunk = await SipTrunk.findOne({ where: { org_id: orgId } });

      if (!trunk?.asterisk_peer_name) {
        console.error(`🤖 [originate-to-ai] No trunk found for org ${orgId}`);
        return res.status(400).json({ error: 'No SIP trunk configured for this org' });
      }
      channel = `PJSIP/${to}@${trunk.asterisk_peer_name}`;
      endpoint = to;
    }

    console.log(`🤖 [originate-to-ai] to=${to} channel=${channel} wss_url=${wss_url ? 'yes' : 'no'}`);

    // Create AMI manager instance
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

      // Add WSS URL if provided
      if (wss_url) {
        channelVars.WSS_URL = wss_url;
      }

      // Originate call directly into Stasis application
      // AMI Stasis data format: app_name,arg1,arg2 — ariClient checks args[0]==='ai_agent' && args[1]
      const stasisData = wss_url ? `pbx_api,${ai_agent_app},${wss_url}` : `pbx_api,${ai_agent_app}`;
      console.log(`🤖 [originate-to-ai] stasisData=${stasisData}`);
      console.log(`🤖 [originate-to-ai] channelVars=${JSON.stringify(Object.keys(channelVars))}`);

      const originateResult = await ami.originate({
        channel: channel,
        application: 'Stasis',
        data: stasisData,
        callerid: caller_id || 'AI Agent',
        timeout: timeout * 1000,
        variables: channelVars,
        async: true
      });
      console.log(`🤖 [originate-to-ai] originate result: ${JSON.stringify(originateResult?.response || 'ok')}`);

      await ami.disconnect();

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

/**
 * GET /calls
 * Get call history
 */
router.get('/', async (req, res) => {
  try {
    const orgId = req.user?.org_id;
    const { limit = 50, offset = 0, status, direction } = req.query;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    const where = { org_id: orgId };

    if (status) where.status = status;
    if (direction) where.direction = direction;

    const calls = await CallRecord.findAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']]
    });

    const total = await CallRecord.count({ where });

    res.json({
      calls,
      count: calls.length,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('Error fetching calls:', error);
    res.status(500).json({
      error: 'Failed to fetch calls',
      message: error.message
    });
  }
});

module.exports = router;
