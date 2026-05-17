const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const TunnelMetric = sequelize.define('TunnelMetric', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tunnel_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'customer_tunnels', key: 'id' }
    },
    snapshot_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    latest_handshake_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    endpoint_ip: {
      type: DataTypes.STRING(45),
      allowNull: true
    },
    endpoint_port: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: { min: 0, max: 65535 }
    },
    bytes_received: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 }
    },
    bytes_sent: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 }
    },
    peer_count_total: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 }
    }
  }, {
    tableName: 'tunnel_metrics',
    timestamps: true,
    underscored: true,
    // NOTE: do NOT define indexes here. The migration owns index creation.
    // If both the migration and the model define the same indexes,
    // sequelize.sync() (called on astrapbx startup) creates the table +
    // indexes from the model BEFORE the migration runs, and the migration's
    // addIndex calls fail with 1061 Duplicate key name.
    //
    // Same pattern as CustomerTunnel post-fix in PR #126. Migration is the
    // single source of truth for indexes; sync() only handles tables.
    indexes: []
  });

  return TunnelMetric;
};
