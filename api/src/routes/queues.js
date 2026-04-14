const express = require('express');
const router = express.Router();
const { Queue, QueueMember, User, Organization } = require('../models');
const QueueService = require('../services/asterisk/queueService');
const ConfigDeploymentService = require('../services/asterisk/configDeploymentService');

const queueService = new QueueService();

/**
 * GET /queues
 * List all queues for the authenticated organization
 */
router.get('/', async (req, res) => {
  try {
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    const queues = await Queue.findAll({
      where: { org_id: orgId },
      include: [
        {
          model: QueueMember,
          as: 'members',
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'username', 'full_name', 'extension', 'status']
            }
          ]
        }
      ],
      order: [['created_at', 'DESC']]
    });

    res.json({
      queues,
      count: queues.length
    });

  } catch (error) {
    console.error('Error fetching queues:', error);
    res.status(500).json({
      error: 'Failed to fetch queues',
      message: error.message
    });
  }
});

/**
 * POST /queues
 * Create a new queue
 */
router.post('/', async (req, res) => {
  try {
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    const {
      name,
      number,
      strategy = 'ringall',
      timeout = 15,
      max_wait_time = 300,
      music_on_hold = 'default',
      ring_sound = 'ring',
      recording_enabled = false,
      wrap_up_time = 0,
      announce_frequency = 30,
      announce_holdtime = false,
      announce_position = 'yes',
      announce_position_limit = 5,
      join_empty = false,
      leave_when_empty = true,
      ring_inuse = false,
      retry = 5,
      service_level = 60,
      weight = 0,
      autopause = 'no',
      autopausedelay = 0,
      autopausebusy = false,
      autopauseunavail = false,
      max_callers = 0,
      periodic_announce = null,
      periodic_announce_frequency = 60,
      min_announce_frequency = 15,
      relative_periodic_announce = false,
      announce_round_seconds = 0,
      queue_youarenext = 'queue-youarenext',
      queue_thereare = 'queue-thereare',
      queue_callswaiting = 'queue-callswaiting',
      queue_holdtime = 'queue-holdtime',
      queue_minutes = 'queue-minutes',
      queue_seconds = 'queue-seconds',
      queue_thankyou = 'queue-thankyou',
      queue_reporthold = 'queue-reporthold',
      reportholdtime = true,
      memberdelay = 0,
      timeoutpriority = 'app',
      status = 'active'
    } = req.body;

    // Validate required fields
    if (!name || !number) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Name and number are required'
      });
    }

    // Get organization for context prefix
    const org = await Organization.findByPk(orgId);
    if (!org) {
      return res.status(404).json({
        error: 'Organization not found'
      });
    }

    // Generate Asterisk queue name
    const asterisk_queue_name = `${org.context_prefix}queue_${number}`;

    // Check for duplicate queue number in organization
    const existingQueue = await Queue.findOne({
      where: { org_id: orgId, number }
    });

    if (existingQueue) {
      return res.status(409).json({
        error: 'Conflict',
        message: `Queue with number ${number} already exists in this organization`
      });
    }

    // Create queue
    const queue = await Queue.create({
      org_id: orgId,
      name,
      number,
      asterisk_queue_name,
      strategy,
      timeout,
      max_wait_time,
      music_on_hold,
      ring_sound,
      recording_enabled,
      wrap_up_time,
      announce_frequency,
      announce_holdtime,
      announce_position,
      announce_position_limit,
      join_empty,
      leave_when_empty,
      ring_inuse,
      retry,
      service_level,
      weight,
      autopause,
      autopausedelay,
      autopausebusy,
      autopauseunavail,
      max_callers,
      periodic_announce,
      periodic_announce_frequency,
      min_announce_frequency,
      relative_periodic_announce,
      announce_round_seconds,
      queue_youarenext,
      queue_thereare,
      queue_callswaiting,
      queue_holdtime,
      queue_minutes,
      queue_seconds,
      queue_thankyou,
      queue_reporthold,
      reportholdtime,
      memberdelay,
      timeoutpriority,
      status
    });

    // Deploy configuration
    try {
      const configService = new ConfigDeploymentService();
      await configService.deployOrganizationConfiguration(orgId, org.name);
      console.log(`✅ Queue configuration deployed for ${name}`);
    } catch (deployError) {
      console.error('⚠️ Queue created but deployment failed:', deployError.message);
      // Don't fail the request if deployment fails
    }

    res.status(201).json({
      queue,
      message: 'Queue created successfully'
    });

  } catch (error) {
    console.error('Error creating queue:', error);
    res.status(500).json({
      error: 'Failed to create queue',
      message: error.message
    });
  }
});

/**
 * GET /queues/:queueId
 * Get queue details
 */
router.get('/:queueId', async (req, res) => {
  try {
    const { queueId } = req.params;
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    const queue = await Queue.findOne({
      where: { id: queueId, org_id: orgId },
      include: [
        {
          model: QueueMember,
          as: 'members',
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'username', 'full_name', 'extension', 'email', 'status']
            }
          ]
        }
      ]
    });

    if (!queue) {
      return res.status(404).json({
        error: 'Queue not found'
      });
    }

    res.json(queue);

  } catch (error) {
    console.error('Error fetching queue:', error);
    res.status(500).json({
      error: 'Failed to fetch queue',
      message: error.message
    });
  }
});

/**
 * PUT /queues/:queueId
 * Update queue
 */
router.put('/:queueId', async (req, res) => {
  try {
    const { queueId } = req.params;
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    const queue = await Queue.findOne({
      where: { id: queueId, org_id: orgId }
    });

    if (!queue) {
      return res.status(404).json({
        error: 'Queue not found'
      });
    }

    // Update allowed fields
    const allowedFields = [
      'name', 'number', 'strategy', 'timeout', 'max_wait_time', 'music_on_hold',
      'ring_sound', 'recording_enabled', 'wrap_up_time', 'announce_frequency',
      'announce_holdtime', 'announce_position', 'announce_position_limit',
      'join_empty', 'leave_when_empty', 'ring_inuse', 'retry', 'service_level',
      'weight', 'autopause', 'autopausedelay', 'autopausebusy', 'autopauseunavail',
      'max_callers', 'periodic_announce', 'periodic_announce_frequency',
      'min_announce_frequency', 'relative_periodic_announce', 'announce_round_seconds',
      'queue_youarenext', 'queue_thereare', 'queue_callswaiting', 'queue_holdtime',
      'queue_minutes', 'queue_seconds', 'queue_thankyou', 'queue_reporthold',
      'reportholdtime', 'memberdelay', 'timeoutpriority', 'status'
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    // If number is being changed, check for conflicts
    if (updates.number && updates.number !== queue.number) {
      const existingQueue = await Queue.findOne({
        where: { org_id: orgId, number: updates.number }
      });

      if (existingQueue) {
        return res.status(409).json({
          error: 'Conflict',
          message: `Queue with number ${updates.number} already exists in this organization`
        });
      }

      // Update asterisk_queue_name if number changes
      const org = await Organization.findByPk(orgId);
      updates.asterisk_queue_name = `${org.context_prefix}queue_${updates.number}`;
    }

    await queue.update(updates);

    // Deploy configuration
    try {
      const org = await Organization.findByPk(orgId);
      const configService = new ConfigDeploymentService();
      await configService.deployOrganizationConfiguration(orgId, org.name);
      console.log(`✅ Queue configuration deployed for ${queue.name}`);
    } catch (deployError) {
      console.error('⚠️ Queue updated but deployment failed:', deployError.message);
    }

    res.json({
      queue,
      message: 'Queue updated successfully'
    });

  } catch (error) {
    console.error('Error updating queue:', error);
    res.status(500).json({
      error: 'Failed to update queue',
      message: error.message
    });
  }
});

/**
 * DELETE /queues/:queueId
 * Delete queue
 */
router.delete('/:queueId', async (req, res) => {
  try {
    const { queueId } = req.params;
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    const queue = await Queue.findOne({
      where: { id: queueId, org_id: orgId }
    });

    if (!queue) {
      return res.status(404).json({
        error: 'Queue not found'
      });
    }

    await queue.destroy();

    // Deploy configuration
    try {
      const org = await Organization.findByPk(orgId);
      const configService = new ConfigDeploymentService();
      await configService.deployOrganizationConfiguration(orgId, org.name);
      console.log(`✅ Queue configuration deployed after deleting ${queue.name}`);
    } catch (deployError) {
      console.error('⚠️ Queue deleted but deployment failed:', deployError.message);
    }

    res.status(204).send();

  } catch (error) {
    console.error('Error deleting queue:', error);
    res.status(500).json({
      error: 'Failed to delete queue',
      message: error.message
    });
  }
});

/**
 * POST /queues/:queueId/members
 * Add member to queue
 */
router.post('/:queueId/members', async (req, res) => {
  try {
    const { queueId } = req.params;
    const { user_id, penalty = 0, paused = false } = req.body;
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    if (!user_id) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'user_id is required'
      });
    }

    // Verify queue exists and belongs to org
    const queue = await Queue.findOne({
      where: { id: queueId, org_id: orgId }
    });

    if (!queue) {
      return res.status(404).json({
        error: 'Queue not found'
      });
    }

    // Verify user exists and belongs to org
    const user = await User.findOne({
      where: { id: user_id, org_id: orgId }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Use QueueService to add member (handles AMI and deployment)
    try {
      const member = await queueService.addQueueMember(queueId, user_id, {
        penalty,
        paused,
        ring_inuse: false
      });

      res.status(201).json({
        success: true,
        message: 'Queue member added successfully',
        queue_member: member,
        configuration_deployed: true
      });

    } catch (serviceError) {
      if (serviceError.message.includes('already a member')) {
        return res.status(409).json({
          error: 'Conflict',
          message: serviceError.message
        });
      }
      throw serviceError;
    }

  } catch (error) {
    console.error('Error adding queue member:', error);
    res.status(500).json({
      error: 'Failed to add queue member',
      message: error.message
    });
  }
});

/**
 * DELETE /queues/:queueId/members
 * Remove member from queue
 */
router.delete('/:queueId/members', async (req, res) => {
  try {
    const { queueId } = req.params;
    const { userId } = req.query;
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    if (!userId) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'userId query parameter is required'
      });
    }

    // Verify queue exists and belongs to org
    const queue = await Queue.findOne({
      where: { id: queueId, org_id: orgId }
    });

    if (!queue) {
      return res.status(404).json({
        error: 'Queue not found'
      });
    }

    // Use QueueService to remove member (handles AMI and deployment)
    await queueService.removeQueueMember(queueId, userId);

    res.status(204).send();

  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Queue member not found'
      });
    }

    console.error('Error removing queue member:', error);
    res.status(500).json({
      error: 'Failed to remove queue member',
      message: error.message
    });
  }
});

/**
 * POST /queues/:queueId/members/:userId/pause
 * Pause a queue member
 */
router.post('/:queueId/members/:userId/pause', async (req, res) => {
  try {
    const { queueId, userId } = req.params;
    const { reason = 'Manual pause' } = req.body;
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    // Verify queue exists and belongs to org
    const queue = await Queue.findOne({
      where: { id: queueId, org_id: orgId }
    });

    if (!queue) {
      return res.status(404).json({
        error: 'Queue not found'
      });
    }

    const member = await queueService.pauseQueueMember(queueId, userId, reason);

    res.json({
      success: true,
      message: 'Queue member paused successfully',
      queue_member: member
    });

  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Queue member not found'
      });
    }

    console.error('Error pausing queue member:', error);
    res.status(500).json({
      error: 'Failed to pause queue member',
      message: error.message
    });
  }
});

/**
 * POST /queues/:queueId/members/:userId/unpause
 * Unpause a queue member
 */
router.post('/:queueId/members/:userId/unpause', async (req, res) => {
  try {
    const { queueId, userId } = req.params;
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    // Verify queue exists and belongs to org
    const queue = await Queue.findOne({
      where: { id: queueId, org_id: orgId }
    });

    if (!queue) {
      return res.status(404).json({
        error: 'Queue not found'
      });
    }

    const member = await queueService.unpauseQueueMember(queueId, userId);

    res.json({
      success: true,
      message: 'Queue member unpaused successfully',
      queue_member: member
    });

  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Queue member not found'
      });
    }

    console.error('Error unpausing queue member:', error);
    res.status(500).json({
      error: 'Failed to unpause queue member',
      message: error.message
    });
  }
});

/**
 * GET /queues/:queueId/status
 * Get real-time queue status from Asterisk
 */
router.get('/:queueId/status', async (req, res) => {
  try {
    const { queueId } = req.params;
    const orgId = req.user?.org_id;

    if (!orgId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization ID not found in token'
      });
    }

    // Verify queue exists and belongs to org
    const queue = await Queue.findOne({
      where: { id: queueId, org_id: orgId }
    });

    if (!queue) {
      return res.status(404).json({
        error: 'Queue not found'
      });
    }

    const status = await queueService.getQueueStatus(queueId);

    res.json(status);

  } catch (error) {
    console.error('Error getting queue status:', error);
    res.status(500).json({
      error: 'Failed to get queue status',
      message: error.message
    });
  }
});

module.exports = router;
