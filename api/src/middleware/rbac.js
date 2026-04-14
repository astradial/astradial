/**
 * RBAC (Role-Based Access Control) middleware for multi-tenant orgs.
 *
 * Roles: owner > admin > manager > agent
 * Each role inherits all permissions of the roles below it.
 *
 * Usage in routes:
 *   app.get('/api/v1/calls', authenticateOrg, requireRole('agent'), handler)
 *   app.delete('/api/v1/calls/:id/recording', authenticateOrg, requireRole('admin'), handler)
 */

// Permission matrix — what each role can do
const PERMISSIONS = {
  // Organization
  'org.settings.read':       ['owner', 'admin'],
  'org.settings.write':      ['owner', 'admin'],
  'org.api_keys':            ['owner'],
  'org.billing':             ['owner', 'admin'],

  // Users
  'users.create':            ['owner', 'admin'],
  'users.delete':            ['owner', 'admin'],
  'users.assign_role':       ['owner', 'admin'],
  'users.list':              ['owner', 'admin', 'manager'],
  'users.view_self':         ['owner', 'admin', 'manager', 'agent'],

  // DIDs / Trunks / Queues
  'config.write':            ['owner', 'admin'],
  'config.deploy':           ['owner', 'admin'],
  'config.read':             ['owner', 'admin', 'manager', 'agent'],

  // Calls
  'calls.view_all':          ['owner', 'admin', 'manager'],
  'calls.view_own':          ['owner', 'admin', 'manager', 'agent'],
  'calls.listen_recording':  ['owner', 'admin', 'manager'],
  'calls.download_recording':['owner', 'admin'],
  'calls.delete_recording':  ['owner', 'admin'],
  'calls.click_to_call':     ['owner', 'admin', 'manager', 'agent'],

  // Tickets
  'tickets.view':            ['owner', 'admin', 'manager', 'agent'],
  'tickets.create':          ['owner', 'admin', 'manager', 'agent'],
  'tickets.update':          ['owner', 'admin', 'manager', 'agent'],
  'tickets.delete':          ['owner', 'admin', 'manager'],

  // Workflows / Bots
  'workflows.write':         ['owner', 'admin'],
  'workflows.read':          ['owner', 'admin', 'manager'],
  'bots.manage':             ['owner', 'admin'],

  // Compliance
  'compliance.write':        ['owner', 'admin'],
  'compliance.read':         ['owner', 'admin', 'manager'],
  'audit_log.read':          ['owner', 'admin', 'manager'],
  'data.export':             ['owner', 'admin'],
  'data.erasure':            ['owner', 'admin'],

  // CRM
  'crm.read':                ['owner', 'admin', 'manager', 'agent'],
  'crm.write':               ['owner', 'admin', 'manager'],
  'crm.delete':              ['owner', 'admin'],
  'crm.customize':           ['owner', 'admin'],
  'crm.assign':              ['owner', 'admin', 'manager'],
};

/**
 * Get all permissions for a given role.
 */
function getPermissions(role) {
  const perms = [];
  for (const [perm, roles] of Object.entries(PERMISSIONS)) {
    if (roles.includes(role)) perms.push(perm);
  }
  return perms;
}

/**
 * Check if a role has a specific permission.
 */
function hasPermission(role, permission) {
  const roles = PERMISSIONS[permission];
  return roles ? roles.includes(role) : false;
}

/**
 * Middleware: require minimum role level.
 * Role hierarchy: owner > admin > manager > agent
 */
const ROLE_LEVELS = { owner: 4, admin: 3, manager: 2, agent: 1 };

function requireRole(minRole) {
  const minLevel = ROLE_LEVELS[minRole] || 0;
  return (req, res, next) => {
    // If no user context (org-level JWT or internal key), allow
    // This preserves backward compatibility with existing api_key auth
    if (!req.userRole) return next();

    const userLevel = ROLE_LEVELS[req.userRole] || 0;
    if (userLevel >= minLevel) return next();

    return res.status(403).json({
      error: 'Forbidden',
      message: `Role '${req.userRole}' does not have permission. Requires '${minRole}' or higher.`,
      your_role: req.userRole,
      required_role: minRole,
    });
  };
}

/**
 * Middleware: require specific permission.
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.userRole) return next(); // backward compat
    if (hasPermission(req.userRole, permission)) return next();

    return res.status(403).json({
      error: 'Forbidden',
      message: `Permission '${permission}' denied for role '${req.userRole}'.`,
      your_role: req.userRole,
      required_permission: permission,
    });
  };
}

module.exports = {
  PERMISSIONS,
  ROLE_LEVELS,
  getPermissions,
  hasPermission,
  requireRole,
  requirePermission,
};
