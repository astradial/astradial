'use strict';

/**
 * Greetings get a `source` column to distinguish TTS-generated from
 * operator-uploaded audio, and `text` is loosened to allow NULL.
 *
 * Why: until now every greeting had an audio file generated from a
 * required text input (Google Chirp / Gemini TTS). We're adding an
 * upload path — operator hands us an mp3/wav/m4a/aac, ffmpeg
 * transcodes to mono 8kHz wav/ulaw/alaw, and stores it under the
 * same /var/lib/asterisk/sounds/greetings/ tree. Uploaded greetings
 * have no text, so the NOT NULL on `text` becomes wrong. The new
 * `source` column lets the UI render the right badge and lets the
 * update path skip text-regen for uploaded rows.
 *
 * Defaults: every existing row gets `source='tts'` — no behaviour
 * change for orgs already using TTS greetings. Only future inserts
 * with `source='upload'` will have NULL text.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('greetings', 'source', {
      type: Sequelize.STRING(10),
      allowNull: false,
      defaultValue: 'tts',
      comment: "Origin of audio_file: 'tts' = generated from text via Google TTS, 'upload' = ffmpeg-transcoded operator upload.",
    });
    await queryInterface.changeColumn('greetings', 'text', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Down: tighten text back to NOT NULL only after backfilling any
    // existing NULL rows with a placeholder. Without the backfill the
    // ALTER would fail on uploaded rows.
    await queryInterface.sequelize.query(
      `UPDATE greetings SET text = '(uploaded audio)' WHERE text IS NULL`
    );
    await queryInterface.changeColumn('greetings', 'text', {
      type: Sequelize.TEXT,
      allowNull: false,
    });
    await queryInterface.removeColumn('greetings', 'source');
  },
};
