#!/usr/bin/env node
/**
 * One-shot operator script — replace Asterisk's stock English system
 * prompts (recorded by Allison Smith circa 2005, audibly dated) with
 * fresh renders from our TTS service. Operators report the stock
 * prompts sound "like the 90s" next to modern Chirp 3 HD voices on
 * the same call leg, which makes the platform feel inconsistent.
 *
 * What it does:
 *
 *   1. For each curated `(name, text)` pair below, synthesise the
 *      phrase via TTSService.saveGreetingAudio() — which goes through
 *      the same Chirp 3 HD / Gemini pipeline as a regular greeting
 *      and writes a raw `.ulaw` (8 kHz mu-law, no header) to
 *      `/var/lib/asterisk/sounds/<lang>/<name>.ulaw`.
 *
 *   2. The new `.ulaw` files sit ALONGSIDE Asterisk's stock
 *      `<name>.gsm` / `<name>.wav`. We never delete the originals.
 *      Asterisk's Playback() finds the .ulaw FIRST for any G.711
 *      mu-law channel (the common PSTN/softphone case) → caller
 *      hears the new voice with zero transcoding. Wideband channels
 *      that prefer the .wav for higher quality still get Allison
 *      Smith — that's a tiny minority on V7-style PSTN-heavy installs
 *      and we can revisit if it matters.
 *
 *   3. Rollback is `rm /var/lib/asterisk/sounds/<lang>/<name>.ulaw`
 *      for any prompt that needs reverting. Asterisk falls back to
 *      the stock .gsm/.wav automatically.
 *
 * Defaults to DRY RUN. Pass `--apply` to actually call Google + write
 * files. Idempotent: re-running --apply is a no-op-ish — the same
 * text + voice produces the same audio (modulo Google's TTS
 * non-determinism, which is negligible for short phrases).
 *
 * Usage:
 *
 *   cd /app
 *   node scripts/regen-system-prompts.js                                  # preview
 *   node scripts/regen-system-prompts.js --apply                          # commit (en-IN, Chirp 3 HD Achernar)
 *   node scripts/regen-system-prompts.js --apply --voice en-IN-Chirp3-HD-Algenib   # male voice
 *   node scripts/regen-system-prompts.js --apply --language hi-IN --voice hi-IN-Chirp3-HD-Achernar
 *   node scripts/regen-system-prompts.js --apply --only the-person-at-exten,is-not-available  # one or two
 *
 * Curated list: extracted from every `Playback(...)` call in
 * `dialplanGenerator.js` minus tones (`beep`), demo prompts, and
 * generic single-word labels (`system`) that won't make sense as a
 * standalone playback. Add new entries when the dialplan grows.
 */

'use strict';

const path = require('path');
// Load .env early so the Google TTS client picks up
// GOOGLE_APPLICATION_CREDENTIALS. The TTSService module itself
// doesn't load dotenv, and we're running outside the API process
// where server.js would normally bootstrap it.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const fs = require('fs').promises;
const fsSync = require('fs');

// The prompt phrasing aims to match the SEMANTIC role each file
// plays in Asterisk's dialplan vocabulary, not Allison Smith's exact
// wording (which is dated). Each `text` is what the caller actually
// hears in our Astradial-customer call flow.
const PROMPTS = [
  // ─── User reachability — most-played pair ───
  { name: 'the-person-at-exten', text: 'The person at extension' },
  { name: 'the-person-at-extension', text: 'The person at extension' },
  { name: 'is-not-available', text: 'is not available right now. Please try again later.' },

  // ─── Recording consent (org_compliance: announcement / explicit_opt_in / opt_out) ───
  { name: 'this-call-may-be-recorded', text: 'This call may be recorded for quality and training.' },
  { name: 'press-1-to-consent', text: 'To consent to recording, press 1.' },
  { name: 'press-2-to-opt-out', text: 'To opt out of recording, press 2.' },

  // ─── Queue + agent availability ───
  { name: 'all-agents-busy', text: 'All of our agents are currently busy. Please hold.' },
  { name: 'all-circuits-busy-now', text: 'All lines are busy right now. Please try again in a few minutes.' },
  { name: 'queue-no-agents-available', text: 'No agents are available to take your call right now.' },
  { name: 'queue-periodic-announce', text: 'Thank you for holding. An agent will be with you shortly.' },
  { name: 'pls-try-call-later', text: 'Please try your call again later.' },

  // ─── Routing errors ───
  { name: 'number-not-in-service', text: 'The number you have dialled is not in service.' },
  { name: 'cannot-complete-as-dialed', text: 'Your call cannot be completed as dialled.' },
  { name: 'invalid', text: 'Invalid entry.' },
  { name: 'pm-invalid-option', text: 'That is not a valid option. Please try again.' },

  // ─── Call lifecycle ───
  { name: 'goodbye', text: 'Goodbye.' },
  { name: 'thank-you', text: 'Thank you.' },
  { name: 'connection', text: 'Connecting your call.' },

  // ─── State-change confirmations (set / activated / deactivated etc.) ───
  { name: 'activated', text: 'Activated.' },
  { name: 'de-activated', text: 'Deactivated.' },
  { name: 'is-set-to', text: 'is set to' },
  { name: 'is-successful', text: 'is successful.' },
  { name: 'is-operational', text: 'is operational.' },
  { name: 'not-yet-set', text: 'is not yet set.' },
  { name: 'callback-activated', text: 'Callback activated.' },
  { name: 'do-not-disturb', text: 'Do not disturb.' },
  { name: 'speed-dial', text: 'Speed dial.' },
  { name: 'call-fwd-on', text: 'Call forwarding is on.' },
  { name: 'call-fwd-off', text: 'Call forwarding is off.' },

  // ─── Time / date / extension info (used when reading state back to caller) ───
  { name: 'the-time-is', text: 'The time is' },
  { name: 'today-is', text: 'Today is' },
  { name: 'todays-date-is', text: "Today's date is" },
  { name: 'your-extension-is', text: 'Your extension is' },

  // ─── Conference ───
  { name: 'conf-enteringno', text: 'Entering conference number' },

  // ─── Digits 0–9 (used by SayDigits when reading extension numbers) ───
  // SayDigits reads number-by-number, NOT as a single number — so "1009"
  // plays as digits/1 + digits/0 + digits/0 + digits/9, not as
  // "one thousand and nine". Only 0–9 needed; tens/hundreds/teens are
  // for SayNumber which our dialplan doesn't use today.
  //
  // Asterisk's `SayDigits()` opens `<sounds>/<lang>/digits/<N>` (no
  // extension), so dropping `.ulaw` files into the `digits/` subdir
  // overrides the stock Allison Smith digit recordings.
  //
  // Without these, a call to "the person at extension 1009 is not
  // available" plays the framing phrases in Chirp 3 HD Achernar and
  // the middle "one zero zero nine" in stock Allison Smith — jarring
  // voice mismatch. With these, the whole sentence is one voice.
  { name: 'digits/0', text: 'zero' },
  { name: 'digits/1', text: 'one' },
  { name: 'digits/2', text: 'two' },
  { name: 'digits/3', text: 'three' },
  { name: 'digits/4', text: 'four' },
  { name: 'digits/5', text: 'five' },
  { name: 'digits/6', text: 'six' },
  { name: 'digits/7', text: 'seven' },
  { name: 'digits/8', text: 'eight' },
  { name: 'digits/9', text: 'nine' },
];

// Asterisk's standard sounds tree. We write into the language
// subdirectory matching the BCP-47 prefix (en-IN → "en", hi-IN → "hi").
// The override-via-extension trick (`Playback` finds `.ulaw` before
// the stock `.gsm`) works regardless of which sub-dir holds the .ulaw.
function targetDirForLanguage(lang) {
  const subdir = lang.split('-')[0].toLowerCase();
  return process.env.ASTERISK_SOUNDS_DIR
    ? path.join(process.env.ASTERISK_SOUNDS_DIR, subdir)
    : `/var/lib/asterisk/sounds/${subdir}`;
}

function parseArgs() {
  const a = process.argv.slice(2);
  const apply = a.includes('--apply');
  const get = (flag) => {
    const i = a.indexOf(flag);
    if (i < 0) return null;
    const v = a[i + 1];
    if (!v || v.startsWith('--')) {
      console.error(`✗ ${flag} requires a value`);
      process.exit(2);
    }
    return v;
  };
  return {
    apply,
    language: get('--language') || 'en-IN',
    voice: get('--voice') || 'en-IN-Chirp3-HD-Achernar',
    model: get('--model') || 'chirp3-hd',
    only: (get('--only') || '').split(',').filter(Boolean),
  };
}

async function main() {
  const { apply, language, voice, model, only } = parseArgs();

  console.log(apply ? '⚠️  APPLY mode — calling Google TTS + writing files' : 'ℹ️  DRY RUN (pass --apply to actually regenerate)');
  console.log(`language=${language}  voice=${voice}  model=${model}`);
  const targetDir = targetDirForLanguage(language);
  console.log(`Writing to: ${targetDir}/<name>.ulaw`);
  if (only.length) console.log(`Scoped to: ${only.join(', ')}`);
  console.log('');

  // Defensive: voice's lang prefix should match `--language`.
  // Chirp 3 HD voice names start with the language code; Gemini voice
  // names are bare ('Kore', 'Achernar') and language-agnostic.
  if (voice.match(/^[a-z]{2}-[A-Z]{2}-/)) {
    const voiceLang = voice.slice(0, 5);
    if (voiceLang !== language) {
      console.error(`✗ voice ${voice} doesn't match --language ${language}`);
      console.error(`  Either change --voice to a ${language} voice, or use a Gemini bare-name voice.`);
      process.exit(2);
    }
  }

  if (apply) {
    try {
      await fs.mkdir(targetDir, { recursive: true, mode: 0o755 });
    } catch (e) {
      console.error(`✗ Cannot create target dir ${targetDir}: ${e.message}`);
      process.exit(1);
    }
  }

  const apiRoot = path.resolve(__dirname, '..');
  const TTSService = require(path.join(apiRoot, 'src', 'services', 'ttsService'));
  const tts = new TTSService();

  // Reuse a private temp dir for synthesis output, then move the
  // .ulaw to the system sounds dir. The TTSService.saveGreetingAudio
  // is hard-wired to `${greetingsDir}/greeting_${id}.ulaw`, so we
  // synthesise as a "greeting" with a temp id, then move + rename.
  // Defensive: don't pollute the real greetings dir if something
  // mid-flight crashes.

  let done = 0, skipped = 0, failed = 0;
  for (const p of PROMPTS) {
    if (only.length && !only.includes(p.name)) {
      skipped++;
      continue;
    }
    const destPath = path.join(targetDir, `${p.name}.ulaw`);
    console.log(`  [${apply ? 'regen' : 'plan'}] ${p.name}.ulaw  ←  "${p.text.length > 60 ? p.text.slice(0,60)+'…' : p.text}"`);

    if (!apply) continue;

    try {
      // Synthesise via our standard TTS pipeline. This writes a
      // greeting-named file we then move to the sounds dir.
      // Some prompts (e.g. `digits/3`) live in a subdir of the
      // language dir — ensure it exists before the move.
      await fs.mkdir(path.dirname(destPath), { recursive: true, mode: 0o755 });
      // `saveGreetingAudio` won't accept '/' in the id (it would
      // produce greeting_digits/3.ulaw), so pre-strip the slash for
      // the temp synth file then move into place.
      const tmpId = `__sysprompt_${p.name.replace(/\//g, '__')}_${Date.now()}`;
      const tmpFilename = await tts.saveGreetingAudio(tmpId, p.text, language, voice, { model });
      const tmpPath = path.join(tts.greetingsDir, tmpFilename);
      // Move + rename in one step. fs.rename is atomic within a
      // single filesystem (typical case on a Linux box).
      await fs.rename(tmpPath, destPath);

      // ─── ALSO write a `.alaw` sibling ───────────────────────────
      // Indian PSTN trunks (Tata, BSNL) negotiate G.711 **a-law**,
      // not mu-law, for inbound calls — European E1 convention vs
      // American T1. Asterisk's Playback() on an a-law channel
      // looks for `.alaw` first; without this sibling it falls
      // through to the stock `.gsm` and plays Allison Smith
      // regardless of how many .ulaw files we produced. So convert
      // each .ulaw → .alaw locally (no second Google call needed —
      // mu-law ↔ a-law is a deterministic byte-table conversion of
      // identical audio quality).
      try {
        const alawPath = destPath.replace(/\.ulaw$/, '.alaw');
        await convertMulawToAlaw(destPath, alawPath);
      } catch (alawErr) {
        // Don't fail the whole prompt if the .alaw conversion
        // hiccups — the .ulaw alone still helps ulaw channels.
        console.error(`    ⚠️  .alaw sibling failed (ulaw written OK): ${alawErr.message}`);
      }
      done++;
    } catch (err) {
      failed++;
      console.error(`    ✗ FAILED: ${err.message}`);
    }
  }

  console.log('');
  console.log(`Summary: regenerated=${done}  skipped=${skipped}  failed=${failed}  apply=${apply}`);
  if (!apply) {
    console.log('Re-run with --apply to commit. Each prompt is one billed Google TTS call.');
    console.log('After --apply, dial a number that hits one of the new prompts to verify the new voice plays.');
  }
}

/**
 * Convert a raw mu-law file to a raw a-law file via local ffmpeg.
 * Both formats are 8-bit logarithmic PCM at 8 kHz mono — same
 * payload shape, different compression curve. mu-law (American)
 * compresses peak quieter than a-law (European); the difference
 * is < 1 dB and inaudible on telephony-grade speech.
 *
 * We invoke ffmpeg as a child process rather than re-asking Google
 * for ALAW because (a) it saves a billed API call, and (b) the
 * source-of-truth `.ulaw` already represents the operator-chosen
 * voice + style — re-synth could yield a slightly different take.
 */
function convertMulawToAlaw(ulawPath, alawPath) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const ff = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'mulaw', '-ar', '8000', '-ac', '1', '-i', ulawPath,
      '-ar', '8000', '-ac', '1', '-c:a', 'pcm_alaw', '-f', 'alaw',
      alawPath
    ]);
    let stderr = '';
    ff.stderr.on('data', (d) => { stderr += d.toString(); });
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.trim()}`));
    });
    ff.on('error', reject);
  });
}

main().catch((err) => {
  console.error('✗ Script failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
