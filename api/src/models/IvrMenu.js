module.exports = (sequelize) => {
  const { DataTypes } = require('sequelize');

  const IvrMenu = sequelize.define('IvrMenu', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    ivr_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'ivrs',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    digit: {
      type: DataTypes.STRING(1),
      allowNull: false,
      comment: 'DTMF digit (0-9, *, #)'
    },
    action_type: {
      type: DataTypes.ENUM('extension', 'queue', 'ivr', 'voicemail', 'hangup', 'callback'),
      allowNull: false,
      comment: 'Type of action to perform'
    },
    action_destination: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Destination based on action_type (extension number, queue UUID, etc.)'
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Description of what this option does'
    },
    order: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Display order for menu options'
    }
  }, {
    tableName: 'ivr_menus',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['ivr_id', 'digit']
      }
    ]
  });

  return IvrMenu;
};
