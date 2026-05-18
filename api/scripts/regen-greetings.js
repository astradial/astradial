#!/usr/bin/env node
/**
 * One-shot operator script — re-synthesize every greeting whose stored
 * voice belongs to a legacy Google TTS model family (Wavenet,
 * Standard, Neural2). Each greeting gets re-rendered with the new
 * default Chirp 3 HD voice equivalent — same gender, same language,
 * same text — and the row's `voice` + `tts_model` fields are updated
 * to match.
 *
 * Touches BOTH tables that store TTS audio metadata:
 *
 *   • `greetings`  (queue greetings, dept greetings)
 *   • `ivrs`       (IVR menu greetings — column names are prefixed
 *                  `greeting_*` since one IVR row owns one greeting)
 *
 * Defaults to DRY-RUN. Pass `--apply` to actually call Google TTS
 * + write files + update the DB. Dry-run prints the planned changes
 * so the operator can sanity-check before committing.
 *
 * Idempotent: re-running after a successful apply is a no-op because
 * the voice names will already be Chirp 3 HD.
 *
 *   cd /app
 *   node scripts/regen-greetings.js           # preview (dry run)
 *   node scripts/regen-greetings.js --apply   # do the work
 *
 * NOTE: this script does NOT regenerate greetings that were created
 * with a Chirp 3 HD voice already — those are already on the
 * new model. Same goes for Gemini-generated greetings.
 *
 * Why we run this manually (not as part of deploy auto-migrate): each
 * regeneration is a billed Google TTS call, so a "regen everything on
 * every deploy" loop would be a footgun. Operators run this once,
 * after the Chirp 3 HD upgrade lands.
 */

'use strict';

const path = require('path');

// Curated Chirp 3 HD pool we'll remap into. Genders verified live
// against Google's listVoices() — see the validation block at the
// top of main(). Per-gender lists let us round-robin if we want to
// vary voices, but for now we just pick the first.
const CHIRP3_HD_BY_GENDER = {
  FEMALE: ['Achernar', 'Aoede'],
  MALE: ['Achird', 'Algenib'],
};

// Map of legacy-voice-name → its gender per Google's listVoices.
// Filled at script start so we don't hard-code letter conventions
// (Wavenet voice letters do NOT have a uniform gender meaning
// across Indian locales — e.g. en-IN-Wavenet-C is MALE while
// ta-IN-Wavenet-C is FEMALE). Looking up the actual gender from
// Google is the only correct path.
let LEGACY_VOICE_GENDER = new Map();

// Legacy → Chirp 3 HD mapping. Returns null if the voice is already
// Chirp 3 HD (no remap needed) or if it's an unknown shape / language.
function remapVoice(voiceName) {
  if (!voiceName) return null;
  if (voiceName.includes('Chirp3-HD')) return null;   // already upgraded
  // Parse `<lang>-<family>-<letter>` shapes
  const m = voiceName.match(/^([a-z]{2}-[A-Z]{2})-(Wavenet|Standard|Neural2|Studio)-([A-Z])$/);
  if (!m) return null;
  const [, lang, family, letter] = m;
  const gender = LEGACY_VOICE_GENDER.get(voiceName);
  if (!gender) return null;  // Google doesn't know this voice — skip
  const pool = CHIRP3_HD_BY_GENDER[gender];
  if (!pool || !pool.length) return null;
  const celestial = pool[0];
  return { newVoice: `${lang}-Chirp3-HD-${celestial}`, family, lang, letter, gender };
}

async function main() {
  const APPLY = process.argv.includes('--apply');
  // Optional `--org-id <uuid>` to scope the regeneration to a single
  // organization. Without it the script walks every org on the box.
  const orgIdIdx = process.argv.indexOf('--org-id');
  const ORG_ID_FILTER = orgIdIdx >= 0 ? process.argv[orgIdIdx + 1] : null;
  // Defensive: if someone forgot the value (e.g. `--org-id --apply`),
  // we'd silently take "--apply" as the org id and quietly match
  // nothing. Reject up front.
  if (orgIdIdx >= 0 && (!ORG_ID_FILTER || ORG_ID_FILTER.startsWith('--'))) {
    console.error('✗ --org-id requires a UUID value');
    process.exit(2);
  }
  console.log(APPLY ? '⚠️  APPLY mode — actually regenerating audio' : 'ℹ️  DRY RUN (pass --apply to actually regenerate)');
  if (ORG_ID_FILTER) console.log(`Scoped to org_id=${ORG_ID_FILTER}`);
  console.log('');

  const apiRoot = path.resolve(__dirname, '..');
  const sequelize = require(path.join(apiRoot, 'src', 'config', 'database'));
  const { Greeting, Ivr } = require(path.join(apiRoot, 'src', 'models'));
  const TTSService = require(path.join(apiRoot, 'src', 'services', 'ttsService'));
  const tts = new TTSService();

  // Populate the legacy-voice → gender map from Google's actual
  // listVoices. This is the authoritative source — letter conventions
  // (A/B/C/D) don't have a uniform gender meaning across locales.
  //
  // We call the Google client directly rather than going through
  // `tts.listVoices()` so the script can run on any deployed version
  // of the API — including older deploys where the helper doesn't
  // exist yet. The Google client is always available since this
  // script lives in the same Node environment as the API itself.
  console.log('Fetching live voice inventory from Google to map letter→gender …');
  try {
    const textToSpeech = require('@google-cloud/text-to-speech');
    const googleClient = new textToSpeech.TextToSpeechClient();
    const [resp] = await googleClient.listVoices({});
    for (const v of (resp.voices || [])) {
      if (!v.name || !v.ssmlGender) continue;
      LEGACY_VOICE_GENDER.set(v.name, v.ssmlGender);
    }
    console.log(`  ✓ Loaded gender for ${LEGACY_VOICE_GENDER.size} voices.`);
  } catch (e) {
    console.error(`  ✗ Could not fetch voice list: ${e.message}`);
    console.error('  Cannot safely map legacy voices to Chirp 3 HD equivalents — aborting.');
    process.exit(1);
  }
  console.log('');

  let regenerated = 0;
  let skipped = 0;
  let failed = 0;

  // ─── Greetings table ────────────────────────────────────────────
  const greetings = await Greeting.findAll({
    where: ORG_ID_FILTER ? { org_id: ORG_ID_FILTER } : {},
    attributes: ['id', 'org_id', 'name', 'text', 'language', 'voice', 'audio_file', 'tts_model'],
    order: [['created_at', 'ASC']]
  });
  console.log(`Found ${greetings.length} rows in greetings.`);
  for (const g of greetings) {
    const remap = remapVoice(g.voice);
    if (!remap) {
      skipped++;
      console.log(`  [skip] ${g.id.slice(0,8)}  voice=${g.voice}  reason=already-Chirp3-HD-or-unknown`);
      continue;
    }
    if (!g.text || !g.text.trim()) {
      skipped++;
      console.log(`  [skip] ${g.id.slice(0,8)}  voice=${g.voice}  reason=empty-text`);
      continue;
    }
    console.log(`  [regen] ${g.id.slice(0,8)}  ${g.voice} → ${remap.newVoice} [${remap.gender}]  org=${g.org_id.slice(0,8)} name="${g.name}"`);
    if (!APPLY) continue;
    try {
      await tts.saveGreetingAudio(g.id, g.text, g.language, remap.newVoice, { model: 'chirp3-hd' });
      await g.update({ voice: remap.newVoice, tts_model: 'chirp3-hd' });
      regenerated++;
    } catch (err) {
      failed++;
      console.error(`    ✗ FAILED: ${err.message}`);
    }
  }

  // ─── IVRs table ─────────────────────────────────────────────────
  const ivrs = await Ivr.findAll({
    where: ORG_ID_FILTER ? { org_id: ORG_ID_FILTER } : {},
    attributes: ['id', 'org_id', 'name', 'greeting_text', 'greeting_language', 'greeting_voice', 'greeting_prompt', 'tts_model'],
    order: [['created_at', 'ASC']]
  });
  console.log(`\nFound ${ivrs.length} rows in ivrs.`);
  for (const ivr of ivrs) {
    const remap = remapVoice(ivr.greeting_voice);
    if (!remap) {
      skipped++;
      console.log(`  [skip] ${ivr.id.slice(0,8)}  voice=${ivr.greeting_voice}  reason=already-Chirp3-HD-or-unknown`);
      continue;
    }
    if (!ivr.greeting_text || !ivr.greeting_text.trim()) {
      skipped++;
      console.log(`  [skip] ${ivr.id.slice(0,8)}  voice=${ivr.greeting_voice}  reason=empty-greeting-text`);
      continue;
    }
    console.log(`  [regen] ${ivr.id.slice(0,8)}  ${ivr.greeting_voice} → ${remap.newVoice} [${remap.gender}]  org=${ivr.org_id.slice(0,8)} name="${ivr.name}"`);
    if (!APPLY) continue;
    try {
      // IVR greeting files use the `ivr_<ivrId>` greetingId prefix per
      // server.js POST /ivrs/:id/generate-greeting.
      const promptKey = `ivr_${ivr.id}`;
      await tts.saveGreetingAudio(promptKey, ivr.greeting_text, ivr.greeting_language, remap.newVoice, { model: 'chirp3-hd' });
      await ivr.update({
        greeting_voice: remap.newVoice,
        greeting_prompt: `greeting_${promptKey}`,
        tts_model: 'chirp3-hd'
      });
      regenerated++;
    } catch (err) {
      failed++;
      console.error(`    ✗ FAILED: ${err.message}`);
    }
  }

  console.log('');
  console.log(`Summary: regenerated=${regenerated}  skipped=${skipped}  failed=${failed}  apply=${APPLY}`);
  if (!APPLY && (regenerated + failed) === 0 && skipped > 0) {
    console.log('Nothing planned to change. Re-run with --apply to commit.');
  }

  await sequelize.close();
}

main().catch((err) => {
  console.error('✗ Script failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
