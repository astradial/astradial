const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const CampaignBot = sequelize.define("CampaignBot", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" } },
    name: { type: DataTypes.STRING(200), allowNull: false },
    language: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "en" },
    keywords: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    max_words: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 3 },
    call_timeout: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 8 },
    intro_audio_path: { type: DataTypes.STRING(500), allowNull: true },
    webhook_url: { type: DataTypes.STRING(500), allowNull: true },
  }, {
    tableName: "campaign_bots",
    timestamps: true,
    underscored: true,
  });
  return CampaignBot;
};
