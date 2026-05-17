const { DataTypes } = require('sequelize');

// MSG91 template namespace UUID with underscore separators (their format,
// not standard UUID-with-hyphens). Validating shape catches paste errors
// before the bulk API rejects them.
const MSG91_NAMESPACE_REGEX = /^[a-f0-9]{8}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{12}$/i;

// E.164-without-plus, MSG91's `integrated_number` shape. 8-15 digits to
// accommodate any region without locking to one.
const E164_NO_PLUS_REGEX = /^\d{8,15}$/;

module.exports = (sequelize) => {
  const AdminWhatsappConfig = sequelize.define('AdminWhatsappConfig', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    is_singleton: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    integrated_number: {
      type: DataTypes.STRING(20),
      allowNull: true,
      validate: {
        isValid(value) {
          if (value == null || value === '') return;
          if (!E164_NO_PLUS_REGEX.test(value)) {
            throw new Error('integrated_number must be 8-15 digits, no + or spaces');
          }
        },
      },
    },
    namespace: {
      type: DataTypes.STRING(64),
      allowNull: true,
      validate: {
        isValid(value) {
          if (value == null || value === '') return;
          if (!MSG91_NAMESPACE_REGEX.test(value)) {
            throw new Error('namespace must match MSG91 underscore-UUID format, e.g. ab7728b6_9e3c_4160_b51e_958e57f151e0');
          }
        },
      },
    },
    selected_template_name: {
      type: DataTypes.STRING(120),
      allowNull: true,
      validate: {
        isValid(value) {
          if (value == null || value === '') return;
          if (!/^[a-z0-9_]{1,120}$/i.test(value)) {
            throw new Error('selected_template_name must match MSG91 template name rules (letters, digits, underscore)');
          }
        },
      },
    },
    template_language: {
      type: DataTypes.STRING(8),
      allowNull: false,
      defaultValue: 'en',
    },
    updated_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
    },
  }, {
    tableName: 'admin_whatsapp_config',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  // Fetch-or-create-singleton convenience. Caller never has to think
  // about which row id to use.
  AdminWhatsappConfig.getSingleton = async function () {
    let row = await this.findOne({ where: { is_singleton: true } });
    if (!row) {
      row = await this.create({ is_singleton: true });
    }
    return row;
  };

  // Returns true only when every field the MSG91 bulk endpoint requires
  // is populated. The scheduler refuses to send until this is true.
  AdminWhatsappConfig.prototype.isReadyForSend = function () {
    return Boolean(
      this.integrated_number &&
      this.namespace &&
      this.selected_template_name
    );
  };

  return AdminWhatsappConfig;
};
