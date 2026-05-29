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
      defaultValue: 'en-IN-Chirp3-HD-Achernar'
    },
    tts_model: {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: 'chirp3-hd',
      comment: 'TTS model family: chirp3-hd | gemini-flash | gemini-pro'
    },
    style_instructions: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Natural-language style prompt — Gemini models only'
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
