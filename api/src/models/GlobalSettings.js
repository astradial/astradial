const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const GlobalSettings = sequelize.define('GlobalSettings', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },

    // PJSIP Transport Configuration
    pjsip_transport: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        udp: {
          enabled: true,
          bind: '0.0.0.0:5060',
          external_media_address: null,
          external_signaling_address: null,
          local_net: ['192.168.0.0/16', '172.16.0.0/12', '10.0.0.0/8']
        },
        tcp: {
          enabled: false,
          bind: '0.0.0.0:5060'
        },
        tls: {
          enabled: false,
          bind: '0.0.0.0:5061',
          cert_file: null,
          privkey_file: null,
          cipher: 'ALL',
          method: 'tlsv1_2'
        },
        wss: {
          enabled: false,
          bind: '0.0.0.0:8089',
          cert_file: null,
          privkey_file: null
        }
      },
      comment: 'PJSIP transport layer configuration for signaling'
    },

    // RTP/Media Configuration
    rtp_config: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        rtp_start: 10000,
        rtp_end: 20000,
        rtcp_mux: false,
        ice_support: false,
        stun_server: null,
        turn_server: null
      },
      comment: 'RTP and media configuration'
    },

    // Global SIP Settings
    sip_global: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        user_agent: 'PBX-API-System',
        default_expiry: 3600,
        min_expiry: 60,
        max_expiry: 7200,
        mwi_disable_initial_unsolicited: false,
        ignore_uri_user_options: false,
        send_rpid: true
      },
      comment: 'Global SIP configuration settings'
    },

    // Codec Configuration
    codecs: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        allow: ['ulaw', 'alaw', 'g722', 'gsm', 'opus'],
        disallow: 'all'
      },
      comment: 'Global codec preferences'
    },

    // System Global Settings
    system: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        max_calls: 100,
        max_channels_per_org: 50,
        default_language: 'en',
        enable_call_recording: true,
        recording_format: 'wav',
        timezone: 'UTC'
      },
      comment: 'System-wide settings'
    },

    // AMI Configuration
    ami_config: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        enabled: true,
        bind_address: '127.0.0.1',
        port: 5038,
        webenabled: false,
        timestampevents: true
      },
      comment: 'Asterisk Manager Interface settings'
    },

    // Security Settings
    security: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        enable_acl: true,
        permitted_networks: ['127.0.0.1/32'],
        failed_auth_ban_threshold: 5,
        failed_auth_ban_duration: 3600,
        enable_tls_verification: true
      },
      comment: 'Security and ACL settings'
    },

    // Voicemail Global Settings
    voicemail: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        enabled: true,
        max_msg_duration: 180,
        min_msg_duration: 2,
        max_messages: 100,
        email_notifications: false,
        attach_audio: false
      },
      comment: 'Voicemail system settings'
    },

    // Logging Configuration
    logging: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        console_level: 'notice',
        syslog_level: 'warning',
        cdr_enabled: true,
        cel_enabled: true,
        queue_log_enabled: true
      },
      comment: 'Logging and monitoring settings'
    },

    // Feature Flags
    features: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        enable_call_parking: true,
        enable_call_pickup: true,
        enable_call_transfer: true,
        enable_call_waiting: true,
        enable_caller_id: true,
        enable_do_not_disturb: true
      },
      comment: 'Feature enable/disable flags'
    },

    // Custom Configuration
    custom_config: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Custom key-value configuration for extensions'
    },

    // Metadata
    last_deployed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Last time settings were deployed to Asterisk'
    },

    deployed_by: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'User/system that last deployed settings'
    },

    version: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      comment: 'Settings version for tracking changes'
    }

  }, {
    tableName: 'global_settings',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['last_deployed_at']
      }
    ]
  });

  return GlobalSettings;
};
