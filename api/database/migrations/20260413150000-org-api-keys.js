'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('org_api_keys', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      org_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
      name: { type: Sequelize.STRING, allowNull: false, comment: 'Human-readable label e.g. CRM Integration' },
      api_key: { type: Sequelize.STRING, allowNull: false, unique: true, comment: 'The key used in X-API-Key header' },
      api_secret_hash: { type: Sequelize.STRING, allowNull: false, comment: 'bcrypt hash of the secret' },
      permissions: {
        type: Sequelize.JSON,
        defaultValue: ['calls.read', 'calls.write', 'calls.click_to_call'],
        comment: 'Scoped permissions for this key',
      },
      status: { type: Sequelize.ENUM('active', 'revoked'), defaultValue: 'active' },
      last_used_at: { type: Sequelize.DATE, allowNull: true },
      created_by: { type: Sequelize.STRING, allowNull: true, comment: 'Email of user who created the key' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('org_api_keys', ['org_id']);
    await queryInterface.addIndex('org_api_keys', ['api_key'], { unique: true });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('org_api_keys');
  },
};
