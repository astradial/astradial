module.exports = (sequelize) => {
  const { DataTypes } = require('sequelize');

  const Ivr = sequelize.define('Ivr', {
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
      type: DataTypes.STRING,
      allowNull: false
    },
    extension: {
      type: DataTypes.STRING(10),
      allowNull: false,
      comment: 'IVR extension number for dialplan routing'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    greeting_prompt: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Audio file for greeting message'
    },
    timeout: {
      type: DataTypes.INTEGER,
      defaultValue: 10,
      comment: 'Timeout in seconds for digit input'
    },
    max_retries: {
      type: DataTypes.INTEGER,
      defaultValue: 3,
      comment: 'Maximum retries for invalid input'
    },
    invalid_prompt: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Audio file for invalid input message'
    },
    timeout_prompt: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Audio file for timeout message'
    },
    enable_direct_dial: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Allow direct extension dialing from IVR'
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active'
    }
  }, {
    tableName: 'ivrs',
    timestamps: true,
    underscored: true
  });

  return Ivr;
};
