'use strict';

// Backfill: any pre-existing `campaigns` row inserted before the model's
// stats defaultValue landed may carry a NULL stats column. Coalesce them
// to the zero-shape so the dashboard funnel and MiniFunnel don't crash on
// `stats.total ?? 0` paths.
//
// Idempotent — the UPDATE is a no-op once everything is populated, so it
// stays safe across re-runs.

module.exports = {
  async up(queryInterface) {
    const zero = JSON.stringify({
      total: 0,
      contacted: 0,
      engaged: 0,
      interested: 0,
      qualified: 0,
    });
    try {
      await queryInterface.sequelize.query(
        `UPDATE campaigns SET stats = :stats WHERE stats IS NULL`,
        { replacements: { stats: zero } }
      );
    } catch (e) {
      console.log(`      (backfill campaign stats skipped: ${e.message.slice(0, 80)})`);
    }
  },

  async down() {
    // No-op — restoring NULL stats would re-introduce the bug.
  },
};
