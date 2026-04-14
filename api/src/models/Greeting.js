const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Greeting = sequelize.define('Greeting', {
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
    text: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    language: {
      type: DataTypes.STRING(10),
      defaultValue: 'en-IN'
    },
    voice: {
      type: DataTypes.STRING(50),
      defaultValue: 'en-IN-Wavenet-D'
    },
    audio_file: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Generated audio filename in /var/lib/asterisk/sounds/greetings/'
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active'
    }
  }, {
    tableName: 'greetings',
    timestamps: true,
    underscored: true
  });

  return Greeting;
};
