'use strict';

/**
 * Sticky-agent routing on did_numbers.
 *
 * When sticky_agent_enabled=true on a DID, incoming calls are routed
 * first to the agent who last spoke to (or called) the caller, before
 * falling through to the org's normal queue routing. Defaults preserve
 * current behavior: every existing DID gets sticky_agent_enabled=false
 * on this migration, so the dialplan generator emits byte-identical
 * output for orgs that don't opt in.
 *
 * Columns:
 *   sticky_agent_enabled         — master toggle for this DID.
 *   sticky_match_inbound         — count answered inbound calls as affinity.
 *   sticky_match_outbound        — count outbound calls as affinity.
 *   sticky_window_hours          — affinity lookback window (default 7 days).
 *   sticky_ring_timeout_seconds  — how long sticky agent rings before queue fallback.
 *
 * Why two direction flags: the cold-call use-case wants outbound-only
 * (agent dialed customer, customer calls back), but hospital/sales
 * scenarios also want inbound (customer's previous agent answers
 * again). The flags let each org pick.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('did_numbers', 'sticky_agent_enabled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Route incoming calls to the agent who last spoke to / called this caller, before falling back to queue.',
    });
    await queryInterface.addColumn('did_numbers', 'sticky_match_inbound', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Include answered inbound calls when computing the sticky-agent affinity.',
    });
    await queryInterface.addColumn('did_numbers', 'sticky_match_outbound', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Include outbound calls when computing the sticky-agent affinity.',
    });
    await queryInterface.addColumn('did_numbers', 'sticky_window_hours', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 168,
      comment: 'Affinity lookback window in hours (default 7 days). Bounded 1-720 at the API.',
    });
    await queryInterface.addColumn('did_numbers', 'sticky_ring_timeout_seconds', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 20,
      comment: 'How long to ring the sticky agent before falling back to queue. Bounded 5-60 at the API.',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('did_numbers', 'sticky_ring_timeout_seconds');
    await queryInterface.removeColumn('did_numbers', 'sticky_window_hours');
    await queryInterface.removeColumn('did_numbers', 'sticky_match_outbound');
    await queryInterface.removeColumn('did_numbers', 'sticky_match_inbound');
    await queryInterface.removeColumn('did_numbers', 'sticky_agent_enabled');
  },
};
