/**
 * Workflow Runner — executes workflow nodes in topological order.
 * Handles branching (conditions), retries, and step logging.
 */

const { pool } = require('./db');
const { executors } = require('./executors');
const { v4: uuidv4 } = require('uuid');

/**
 * Execute a workflow given its definition and trigger data
 */
async function executeWorkflow(workflow, triggerData, executionId) {
  const nodes = workflow.nodes || [];
  const edges = workflow.edges || [];

  if (nodes.length === 0) {
    await updateExecution(executionId, 'completed', [], null);
    return { success: true, steps: [] };
  }

  // Build adjacency list
  const children = {};
  for (const edge of edges) {
    if (!children[edge.source]) children[edge.source] = [];
    children[edge.source].push({ target: edge.target, label: edge.label || '' });
  }

  // Find root nodes (no incoming edges)
  const targets = new Set(edges.map((e) => e.target));
  const roots = nodes.filter((n) => !targets.has(n.id));
  if (roots.length === 0 && nodes.length > 0) roots.push(nodes[0]);

  const stepResults = {};
  const stepLogs = [];

  // Build execution context
  const context = {
    trigger: triggerData,
    step: stepResults,
    org_id: workflow.org_id,
  };

  // If this is a scheduled execution for a specific node, only execute that node
  const scheduledNodeId = triggerData._scheduled_node_id;
  if (scheduledNodeId) {
    const node = nodes.find(n => n.id === scheduledNodeId);
    if (!node) {
      await updateExecution(executionId, 'failed', [], `Scheduled node ${scheduledNodeId} not found`);
      return { success: false, error: 'Scheduled node not found' };
    }
    const stepLog = {
      node_id: node.id, node_type: node.type, node_label: node.data?.label || node.type,
      started_at: new Date().toISOString(), input: node.data?.config || {},
      output: null, status: 'running', error: null,
    };
    try {
      const executor = executors[node.type];
      if (!executor) throw new Error(`No executor for type: ${node.type}`);
      const result = await executor({ config: node.data?.config || {}, context, orgId: workflow.org_id });
      stepLog.output = result.data || result;
      stepLog.status = result.success ? 'completed' : 'failed';
      stepLog.error = result.error || null;
      stepLog.completed_at = new Date().toISOString();
    } catch (err) {
      stepLog.status = 'failed';
      stepLog.error = err.message;
    }
    const success = stepLog.status === 'completed';
    await updateExecution(executionId, success ? 'completed' : 'failed', [stepLog], success ? null : stepLog.error);
    return { success, steps: [stepLog] };
  }

  // Execute nodes in BFS order
  const queue = [...roots.map((n) => n.id)];
  const visited = new Set();

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = nodes.find((n) => n.id === nodeId);
    if (!node) continue;

    // Skip scheduled nodes during immediate execution (they run via scheduled jobs)
    const isScheduledNode = node.data?.config?.timing === 'scheduled';
    const isScheduledExecution = triggerData._scheduled_node_id === node.id;
    if (isScheduledNode && !isScheduledExecution) {
      stepLogs.push({
        node_id: node.id, node_type: node.type, node_label: node.data?.label || node.type,
        started_at: new Date().toISOString(), input: node.data?.config || {},
        output: null, status: 'deferred', error: null,
      });
      // Still enqueue children so later nodes in the graph are visited
      const nextEdges = children[nodeId] || [];
      for (const edge of nextEdges) { queue.push(edge.target); }
      continue;
    }

    const stepLog = {
      node_id: node.id,
      node_type: node.type,
      node_label: node.data?.label || node.type,
      started_at: new Date().toISOString(),
      input: node.data?.config || {},
      output: null,
      status: 'running',
      error: null,
    };

    try {
      const executor = executors[node.type];
      if (!executor) {
        // Trigger/unknown nodes: skip execution but still enqueue children
        stepLog.status = 'skipped';
        stepLog.error = node.type === 'trigger' ? null : `Unknown action type: ${node.type}`;
        stepLogs.push(stepLog);
        const nextEdges = children[nodeId] || [];
        for (const edge of nextEdges) { queue.push(edge.target); }
        continue;
      }

      // Execute the step with retries
      let result;
      let retries = 0;
      const maxRetries = node.data?.config?.retries || 3;

      while (retries <= maxRetries) {
        try {
          result = await executor({
            config: node.data?.config || {},
            context,
            orgId: workflow.org_id,
            triggerData,
          });

          if (result.retry && retries < maxRetries) {
            retries++;
            console.log(`[Runner] Step ${node.id} retry ${retries}/${maxRetries}`);
            await new Promise((r) => setTimeout(r, retries * 2000)); // exponential backoff
            continue;
          }
          break;
        } catch (err) {
          if (retries < maxRetries) {
            retries++;
            await new Promise((r) => setTimeout(r, retries * 2000));
            continue;
          }
          result = { success: false, error: err.message };
          break;
        }
      }

      stepLog.output = result.data || null;
      stepLog.status = result.success ? 'completed' : 'failed';
      stepLog.error = result.error || null;
      stepLog.completed_at = new Date().toISOString();
      stepResults[node.id] = result;

      // Update context with step results
      context.step[node.id] = result.data;

    } catch (err) {
      stepLog.status = 'failed';
      stepLog.error = err.message;
      stepLog.completed_at = new Date().toISOString();
    }

    stepLogs.push(stepLog);

    // Determine next nodes
    const nextEdges = children[nodeId] || [];
    for (const edge of nextEdges) {
      // For condition nodes, check the branch
      if (node.type === 'condition' && stepResults[nodeId]?.data?.branch) {
        const branch = stepResults[nodeId].data.branch;
        if (edge.label === branch || edge.label === '') {
          queue.push(edge.target);
        }
      } else {
        queue.push(edge.target);
      }
    }

    // If step failed and no error handler, stop execution
    if (stepLog.status === 'failed' && !node.data?.config?.continue_on_error) {
      console.log(`[Runner] Workflow ${workflow.id} stopped at step ${nodeId}: ${stepLog.error}`);
      break;
    }
  }

  const allSuccess = stepLogs.every((s) => s.status === 'completed' || s.status === 'skipped');
  await updateExecution(executionId, allSuccess ? 'completed' : 'failed', stepLogs, allSuccess ? null : 'One or more steps failed');

  return { success: allSuccess, steps: stepLogs };
}

async function updateExecution(executionId, status, steps, error) {
  await pool.query(
    'UPDATE workflow_executions SET status = $1, steps = $2, error = $3, completed_at = NOW() WHERE id = $4',
    [status, JSON.stringify(steps), error, executionId]
  );
}

module.exports = { executeWorkflow };
