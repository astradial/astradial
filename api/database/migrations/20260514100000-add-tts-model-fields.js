'use strict';

/**
 * Add TTS-model selector + style-instructions fields to `greetings` and
 * `ivrs`. Two columns each:
 *
 *   tts_model         STRING(40)  default 'chirp3-hd'
 *   style_instructions TEXT       nullable
 *
 * `tts_model` selects which Google TTS voice family the audio is
 * generated with. Valid values today (resolved server-side by the
 * TTSService.MODELS map):
 *
 *   chirp3-hd      — Google Chirp 3 HD voices (default, fastest, no
 *                    style control, ~$30 / 1M chars)
 *   gemini-flash   — Gemini 2.5 Flash TTS, supports style prompts
 *                    (~$10 / 1M chars)
 *   gemini-pro     — Gemini 2.5 Pro TTS, supports style prompts,
 *                    highest quality (~$30 / 1M chars)
 *
 * `style_instructions` is only honored by Gemini models (Chirp 3 HD has
 * no prompt input). It's a short natural-language nudge like "Speak in
 * a warm hotel-reception tone" that biases the model's prosody and
 * tone. We store it as TEXT so it's not capped at ~255 chars — the
 * model accepts up to a few hundred words.
 *
 * Default 'chirp3-hd' matches the current default voice in the
 * application code (en-IN-Chirp3-HD-Achernar) — any existing greeting
 * without a tts_model is implicitly Chirp 3 HD.
 *
 * NOTE: NO new index on tts_model — these fields are read alongside
 * the row, never WHERE'd against. MariaDB 11 FK gotcha doesn't apply
 * here either (no FKs).
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('greetings', 'tts_model', {
      type: Sequelize.STRING(40),
      allowNull: false,
      defaultValue: 'chirp3-hd',
      comment: 'TTS model family: chirp3-hd | gemini-flash | gemini-pro. Resolved server-side.'
    });
    await queryInterface.addColumn('greetings', 'style_instructions', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'Natural-language style prompt for Gemini TTS models. Ignored for chirp3-hd.'
    });

    await queryInterface.addColumn('ivrs', 'tts_model', {
      type: Sequelize.STRING(40),
      allowNull: false,
      defaultValue: 'chirp3-hd',
      comment: 'TTS model family for the IVR greeting. Resolved server-side.'
    });
    await queryInterface.addColumn('ivrs', 'style_instructions', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'Natural-language style prompt for Gemini TTS models. Ignored for chirp3-hd.'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ivrs', 'style_instructions');
    await queryInterface.removeColumn('ivrs', 'tts_model');
    await queryInterface.removeColumn('greetings', 'style_instructions');
    await queryInterface.removeColumn('greetings', 'tts_model');
  }
};
