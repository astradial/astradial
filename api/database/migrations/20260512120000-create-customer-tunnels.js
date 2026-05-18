'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('customer_tunnels', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      org_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'organizations',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Owning organisation; tunnel deleted if org is deleted'
      },
      name: {
        type: Sequelize.STRING(64),
        allowNull: false,
        comment: 'Operator-friendly tunnel name (e.g. astradial-v7)'
      },
      tunnel_subnet: {
        type: Sequelize.STRING(18),
        allowNull: false,
        unique: true,
        comment: 'CIDR allocated from 10.20.0.0/16 pool, /30 per customer'
      },
      cloud_tunnel_ip: {
        type: Sequelize.STRING(15),
        allowNull: false,
        comment: 'Cloud-side tunnel IP (first usable in /30, e.g. 10.20.7.1)'
      },
      customer_tunnel_ip: {
        type: Sequelize.STRING(15),
        allowNull: false,
        comment: 'Customer-side tunnel IP (second usable in /30, e.g. 10.20.7.2)'
      },
      customer_pubkey: {
        type: Sequelize.STRING(64),
        allowNull: false,
        comment: 'Customer router WireGuard public key (base64, 44 chars)'
      },
      preshared_key: {
        type: Sequelize.STRING(64),
        allowNull: false,
        comment: 'WireGuard pre-shared key for added perfect-forward-secrecy (base64)'
      },
      persistent_keepalive: {
        type: Sequelize.INTEGER,
        defaultValue: 25,
        allowNull: false,
        comment: 'Seconds between WG keepalive packets'
      },
      listen_port: {
        type: Sequelize.INTEGER,
        defaultValue: 51821,
        allowNull: false,
        comment: 'Cloud-side UDP listen port (51821 for wg1, isolated from wg0 internal infra)'
      },
      interface_name: {
        type: Sequelize.STRING(16),
        defaultValue: 'wg1',
        allowNull: false,
        comment: 'Cloud-side WG interface (wg1 = customer tunnels, wg0 = internal infra)'
      },
      status: {
        type: Sequelize.ENUM('active', 'disabled', 'revoked'),
        defaultValue: 'active',
        allowNull: false,
        comment: 'active = peer in wg1.conf; disabled = peer removed but DB row kept; revoked = soft-deleted, subnet reserved 30d'
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Operator notes (e.g. "V7 BSNL+Rail multi-WAN tunnel")'
      },
      created_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'org_users.id of the operator who created this tunnel (audit trail)'
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
        allowNull: false
      },
      updated_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
        allowNull: false
      }
    });

    // NOTE: do NOT add an explicit index on org_id here.
    // MariaDB 11.x auto-creates an index named `customer_tunnels_org_id` for the FK,
    // which collides with the name Sequelize would generate for `addIndex(['org_id'])`.
    // The FK-side index is sufficient for our query patterns (filter by org_id).
    await queryInterface.addIndex('customer_tunnels', ['status']);
    await queryInterface.addIndex('customer_tunnels', ['org_id', 'name'], {
      unique: true,
      name: 'customer_tunnels_org_name_unique'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('customer_tunnels');
    // Drop the ENUM type explicitly for clean rollback (Postgres-style safety;
    // harmless on MariaDB which inlines ENUMs in the column definition).
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_customer_tunnels_status";');
    }
  }
};
