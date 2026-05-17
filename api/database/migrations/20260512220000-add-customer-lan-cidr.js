'use strict';

/**
 * Add customer_lan_cidr to customer_tunnels.
 *
 * Why: WireGuard cryptokey routing on the cloud (wg1) only accepts packets
 * whose inner source IP matches the peer's AllowedIPs. With this column set
 * to e.g. 192.168.0.0/24, the applier expands the peer's AllowedIPs to
 * include the customer's LAN — letting their phones/PBX traverse the
 * tunnel without per-device SNAT on the customer side.
 *
 * Nullable: existing tunnels (V7) continue working as before until an
 * operator fills the field via the UI.
 *
 * VARCHAR(18) accommodates the largest IPv4 CIDR form (e.g., "255.255.255.255/32"
 * is 18 chars).
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('customer_tunnels', 'customer_lan_cidr', {
      type: Sequelize.STRING(18),
      allowNull: true,
      after: 'customer_tunnel_ip',
      comment: 'Optional customer-side LAN CIDR (e.g., 192.168.0.0/24) — added to server-side AllowedIPs so traffic from the customer LAN can traverse the tunnel.'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('customer_tunnels', 'customer_lan_cidr');
  }
};
