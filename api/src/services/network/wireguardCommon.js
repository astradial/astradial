/**
 * Shared constants + validators used across the customer-tunnels services.
 *
 * Extracted from wireguardApplier and wireguardStatusService where the
 * same regex was duplicated (audit finding P2 #8). Single source of truth
 * for "what is a safe WireGuard interface name".
 */

'use strict';

// Linux IFNAMSIZ is 16 (including trailing NUL). The valid charset for
// interface names is conservative — letters, digits, hyphen, underscore.
// This regex gates every place we interpolate the name into a shell command
// (defense in depth against command injection if a future code path ever
// accepts the interface name from user input).
const INTERFACE_NAME_REGEX = /^[a-zA-Z0-9_-]{1,15}$/;

/**
 * Validate that an interface name is shell-safe and within IFNAMSIZ limits.
 * Throws if invalid. Caller MUST run this before any interpolation into a
 * shell command (`wg show`, `wg syncconf`, etc.).
 *
 * @param {string} name
 */
function assertValidInterfaceName(name) {
  if (typeof name !== 'string' || !INTERFACE_NAME_REGEX.test(name)) {
    throw new Error(
      `Invalid WireGuard interface name: ${JSON.stringify(name)}. ` +
      `Expected 1-15 chars matching ${INTERFACE_NAME_REGEX}.`
    );
  }
}

module.exports = {
  INTERFACE_NAME_REGEX,
  assertValidInterfaceName
};
