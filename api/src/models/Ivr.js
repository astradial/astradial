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
      comment: 'Audio file for greeting message (relative filename under greetings dir, no .wav extension)'
    },
    greeting_text: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Source text used to generate greeting_prompt via TTS; kept for re-generation'
    },
    greeting_language: {
      type: DataTypes.STRING(10),
      defaultValue: 'en-IN',
      comment: 'BCP-47 language code passed to Google TTS (en-IN, hi-IN, ta-IN, te-IN, kn-IN, ml-IN, …)'
    },
    greeting_voice: {
      type: DataTypes.STRING(50),
      defaultValue: 'en-IN-Chirp3-HD-Achernar',
      comment: 'Specific Google TTS voice name matching greeting_language. Chirp 3 HD voices preferred; legacy Wavenet/Standard names remain valid in Google API.'
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
    // What to do when WaitExten times out with no keypress.
    // 'retry'     — replay the greeting until max_retries hits, then hangup (legacy default)
    // 'queue'     — Goto org's queue context, dialling timeout_destination as queue number
    // 'extension' — Goto org's internal context, dialling timeout_destination as extension
    // 'hangup'    — play timeout_prompt (or pm-invalid-option) and hang up immediately
    timeout_action: {
      type: DataTypes.ENUM('retry', 'queue', 'extension', 'hangup'),
      allowNull: false,
      defaultValue: 'retry',
      comment: 'On WaitExten timeout: retry (legacy), queue, extension, or hangup'
    },
    timeout_destination: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Destination number when timeout_action is queue or extension'
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
