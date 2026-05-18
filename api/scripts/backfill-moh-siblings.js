#!/usr/bin/env node
/**
 * Backfill .ulaw + .alaw siblings for existing MOH WAVs.
 *
 * Before this PR, the MOH upload handler only wrote .wav (pcm_s16le).
 * Asterisk had to transcode WAV → channel codec on every PSTN call,
 * which caused audible mid-playback artifacts on a-law trunks (the
 * customer complaint). The fix on the upload path writes .ulaw + .alaw
 * siblings going forward; this script does the same for files that
 * are already on disk so existing customers don't have to re-upload.
 *
 * Idempotent: skips any .wav that already has BOTH siblings.
 * Read-only on .wav source files — only writes new files.
 *
 * Usage on prod VPS:
 *   cd /app && node scripts/backfill-moh-siblings.js
 *
 * Optional MOH_DIR env var overrides the default scan root.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const ROOT = process.env.MOH_DIR || '/var/lib/asterisk/moh';

async function backfillOne(wavPath) {
  const dir = path.dirname(wavPath);
  const base = path.basename(wavPath, '.wav');
  const ulawPath = path.join(dir, `${base}.ulaw`);
  const alawPath = path.join(dir, `${base}.alaw`);

  const needUlaw = !fs.existsSync(ulawPath);
  const needAlaw = !fs.existsSync(alawPath);
  if (!needUlaw && !needAlaw) {
    return { wavPath, skipped: true };
  }

  const args = ['-y', '-loglevel', 'error', '-i', wavPath];
  if (needUlaw) args.push('-ac', '1', '-ar', '8000', '-f', 'mulaw', ulawPath);
  if (needAlaw) args.push('-ac', '1', '-ar', '8000', '-f', 'alaw', alawPath);

  await execFileAsync('ffmpeg', args);
  return { wavPath, wrote: { ulaw: needUlaw, alaw: needAlaw } };
}

function findWavs(root) {
  const out = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && full.endsWith('.wav')) out.push(full);
    }
  }
  walk(root);
  return out;
}

async function main() {
  if (!fs.existsSync(ROOT)) {
    console.error(`MOH root not found: ${ROOT}`);
    process.exit(1);
  }
  const wavs = findWavs(ROOT);
  console.log(`Scanning ${ROOT} — found ${wavs.length} .wav file(s)`);
  let skipped = 0;
  let converted = 0;
  let failed = 0;
  for (const w of wavs) {
    try {
      const r = await backfillOne(w);
      if (r.skipped) { skipped++; continue; }
      converted++;
      console.log(`✓ ${w}  →  ${[r.wrote.ulaw && '.ulaw', r.wrote.alaw && '.alaw'].filter(Boolean).join(' + ')}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${w}: ${(e.stderr || e.message || '').toString().trim().slice(-200)}`);
    }
  }
  console.log(`\nDone — converted=${converted} skipped=${skipped} failed=${failed} total=${wavs.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
