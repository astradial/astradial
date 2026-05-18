const { DataTypes } = require('sequelize');

// WireGuard base64 key validator: 43 chars + '=' padding (32 bytes base64-encoded)
// Same format applies to PublicKey and PresharedKey.
const WG_KEY_REGEX = /^[A-Za-z0-9+/]{43}=$/;

// CIDR /30 validator anchored to the 10.20.0.0/16 customer pool.
const CUSTOMER_CIDR_REGEX = /^10\.20\.\d{1,3}\.\d{1,3}\/30$/;

// IPv4 validator (loose) for tunnel endpoint IPs.
const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

// IPv4 CIDR validator (loose form-check only — semantic checks live in
// customer-tunnels-helpers.assertValidCustomerLanCidr).
const IPV4_CIDR_REGEX = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

module.exports = (sequelize) => {
  const CustomerTunnel = sequelize.define('CustomerTunnel', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'organizations',
        key: 'id'
      }
    },
    name: {
      type: DataTypes.STRING(64),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [2, 64],
        is: {
          args: /^[a-zA-Z0-9_-]+$/,
          msg: 'Tunnel name may contain only letters, digits, hyphen, and underscore'
        }
      }
    },
    tunnel_subnet: {
      type: DataTypes.STRING(18),
      allowNull: false,
      unique: true,
      validate: {
        is: {
          args: CUSTOMER_CIDR_REGEX,
          msg: 'tunnel_subnet must be a /30 inside 10.20.0.0/16 (e.g. 10.20.7.0/30)'
        }
      }
    },
    cloud_tunnel_ip: {
      type: DataTypes.STRING(15),
      allowNull: false,
      validate: { is: IPV4_REGEX }
    },
    customer_tunnel_ip: {
      type: DataTypes.STRING(15),
      allowNull: false,
      validate: { is: IPV4_REGEX }
    },
    // Optional customer-side LAN CIDR (e.g., 192.168.0.0/24). When set, the
    // wireguardGenerator includes it in the server-side AllowedIPs so that
    // packets from the customer's LAN traverse the tunnel without requiring
    // per-device SNAT on the customer router.
    //
    // Semantic validation (private range, no infra-range overlap, no other-
    // customer overlap) lives in customer-tunnels-helpers, not here — the
    // model only enforces a loose form-check. NULL means "no LAN — only the
    // tunnel-side /32 is allowed" which matches pre-feature behavior.
    customer_lan_cidr: {
      type: DataTypes.STRING(18),
      allowNull: true,
      validate: {
        is: {
          args: IPV4_CIDR_REGEX,
          msg: 'customer_lan_cidr must be an IPv4 CIDR like "192.168.0.0/24"'
        }
      }
    },
    customer_pubkey: {
      type: DataTypes.STRING(64),
      allowNull: false,
      validate: {
        is: {
          args: WG_KEY_REGEX,
          msg: 'customer_pubkey must be a 44-character base64-encoded WireGuard public key'
        }
      }
    },
    preshared_key: {
      type: DataTypes.STRING(64),
      allowNull: false,
      validate: {
        is: {
          args: WG_KEY_REGEX,
          msg: 'preshared_key must be a 44-character base64-encoded WireGuard pre-shared key'
        }
      }
    },
    persistent_keepalive: {
      type: DataTypes.INTEGER,
      defaultValue: 25,
      validate: { min: 0, max: 65535 }
    },
    listen_port: {
      type: DataTypes.INTEGER,
      defaultValue: 51821,
      validate: { min: 1024, max: 65535 }
    },
    interface_name: {
      type: DataTypes.STRING(16),
      defaultValue: 'wg1'
    },
    status: {
      type: DataTypes.ENUM('active', 'disabled', 'revoked'),
      defaultValue: 'active',
      allowNull: false
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    created_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true
    }
  }, {
    tableName: 'customer_tunnels',
    timestamps: true,
    underscored: true,
    indexes: [
      // NOTE: no explicit index on org_id — the FK to organizations auto-creates
      // an index named `customer_tunnels_org_id` on MariaDB 11.x. An explicit
      // addIndex(['org_id']) here would collide with that auto-created index
      // (1061 Duplicate key name) if sequelize.sync({force:true}) is ever run.
      { fields: ['status'] },
      {
        fields: ['org_id', 'name'],
        unique: true,
        name: 'customer_tunnels_org_name_unique'
      }
    ],
    defaultScope: {
      // By default, hide the pre-shared key from generic queries.
      // Use .scope('withSecrets') or attribute selection explicitly when needed.
      attributes: { exclude: ['preshared_key'] }
    },
    scopes: {
      // Sequelize 6 quirk: `include: ['preshared_key']` here would ADD the
      // column on top of the default `SELECT *`, which already contains it —
      // mariadb driver then rejects the result with
      // `Error in results, duplicate field name preshared_key`.
      // Clearing the exclude list instead gives us all columns including
      // preshared_key, with no duplicates.
      withSecrets: {
        attributes: { exclude: [] }
      }
    }
  });

  // NOTE: toWireguardPeerBlock + toCustomerSidePeerBlock methods removed
  // as dead code (audit finding P2 #9). The pure renderers in
  // wireguardGenerator.js are the single source of truth for [Peer] block
  // generation. Adding instance-level rendering methods here would create
  // two divergent implementations.

  return CustomerTunnel;
};
