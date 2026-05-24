/**
 * Platform-user (RBAC) record. Distinct from the SIP-extension `User`
 * model — these are the humans who log into the dashboard via email +
 * password (or Firebase, depending on mode). One per org per email.
 *
 * Adds `password_hash` over what astradial-platform ships, because OSS
 * supports local email/password sign-in when USE_FIREBASE=false. The
 * platform's `org_users` table doesn't have this column (Firebase
 * handles credentials there); OSS adds it via migration on upgrade and
 * via this model on fresh-install sync().
 *
 * `org_id` is nullable so a freshly-signed-up user can exist before an
 * organisation is created or assigned — used to support the "no org
 * yet, request one" flow that platform implements with Firebase.
 */

module.exports = (sequelize) => {
  const { DataTypes } = require('sequelize');

  const OrgUser = sequelize.define('OrgUser', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    org_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: { isEmail: true },
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM('owner', 'admin', 'manager', 'agent'),
      allowNull: false,
      defaultValue: 'agent',
    },
    status: {
      type: DataTypes.ENUM('active', 'suspended', 'invited'),
      defaultValue: 'invited',
    },
    password_hash: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    firebase_uid: {
      type: DataTypes.STRING(128),
      allowNull: true,
    },
    extension: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    last_login: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  }, {
    tableName: 'org_users',
    timestamps: true,
    underscored: true,
    indexes: [
      { unique: true, fields: ['org_id', 'email'], name: 'uk_org_email' },
      { fields: ['firebase_uid'], name: 'idx_firebase_uid' },
      { fields: ['org_id', 'role'], name: 'idx_org_role' },
    ],
  });

  return OrgUser;
};
