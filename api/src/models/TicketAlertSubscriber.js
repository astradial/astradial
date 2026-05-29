const { DataTypes } = require('sequelize');

// 10-digit Indian mobile validator. Leading digit must be 6-9 per TRAI
// numbering plan; allows admin to typo-catch obviously-broken numbers
// (e.g. starts with 0 or 1) before they hit MSG91.
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

module.exports = (sequelize) => {
  const TicketAlertSubscriber = sequelize.define('TicketAlertSubscriber', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'organizations', key: 'id' },
    },
    country_code: {
      type: DataTypes.STRING(4),
      allowNull: false,
      defaultValue: '91',
      validate: {
        is: {
          args: /^[1-9]\d{0,3}$/,
          msg: 'country_code must be a 1-4 digit number with no leading zero',
        },
      },
    },
    phone: {
      type: DataTypes.STRING(15),
      allowNull: false,
      validate: {
        is: {
          args: INDIAN_MOBILE_REGEX,
          msg: 'phone must be a 10-digit Indian mobile starting 6-9, no country code prefix',
        },
      },
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 120],
      },
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
    },
  }, {
    tableName: 'ticket_alert_subscribers',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      // Composite unique matches the migration's named unique index.
      // No standalone index on org_id — MariaDB FK auto-creates one and
      // re-declaring it would 1061 on sync.
      {
        unique: true,
        fields: ['org_id', 'country_code', 'phone'],
        name: 'ux_ticket_alert_subscribers_org_phone',
      },
    ],
  });

  // Convenience getter for the MSG91 `to` list — concatenates country
  // code and phone into E.164-without-plus form, e.g. '919812345678'.
  TicketAlertSubscriber.prototype.fullNumber = function () {
    return `${this.country_code}${this.phone}`;
  };

  return TicketAlertSubscriber;
};
