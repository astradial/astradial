"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("campaign_bots", {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      org_id: {
        type: Sequelize.UUID, allowNull: false,
        references: { model: "organizations", key: "id" },
        onDelete: "CASCADE",
      },
      name: { type: Sequelize.STRING(200), allowNull: false },
      language: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "en" },
      keywords: { type: Sequelize.JSON, allowNull: false, defaultValue: [] },
      max_words: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 3 },
      call_timeout: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 8 },
      intro_audio_path: { type: Sequelize.STRING(500), allowNull: true },
      webhook_url: { type: Sequelize.STRING(500), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex("campaign_bots", ["org_id"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("campaign_bots");
  },
};
