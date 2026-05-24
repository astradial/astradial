'use strict';

// Marks max_concurrent_calls and max_sends_per_minute as deprecated via column
// comments. Columns are RETAINED so existing rows stay intact; workers now read
// org.settings.campaign_max_concurrent_calls / campaign_max_whatsapp_per_minute.
module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'mariadb' || dialect === 'mysql') {
      await queryInterface.sequelize.query(`
        ALTER TABLE campaigns
          MODIFY COLUMN max_concurrent_calls SMALLINT NULL DEFAULT 10
            COMMENT 'DEPRECATED Phase D: use org.settings.campaign_max_concurrent_calls',
          MODIFY COLUMN max_sends_per_minute SMALLINT NULL
            COMMENT 'DEPRECATED Phase D: use org.settings.campaign_max_whatsapp_per_minute'
      `);
    } else if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        COMMENT ON COLUMN campaigns.max_concurrent_calls IS 'DEPRECATED Phase D: use org.settings.campaign_max_concurrent_calls';
        COMMENT ON COLUMN campaigns.max_sends_per_minute IS 'DEPRECATED Phase D: use org.settings.campaign_max_whatsapp_per_minute'
      `);
    }
  },

  async down() {
    // Column comments are informational only — no meaningful rollback needed.
  },
};
