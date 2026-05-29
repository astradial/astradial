#!/usr/bin/env node
/**
 * Pre-emptive multi-leg call stitcher.
 *
 * Scans asterisk_cdr for recent linkedids that have 2+ legs with
 * recordingfile populated, and produces a single concatenated WAV per
 * linkedid in /var/spool/asterisk/monitor/stitched/<linkedid>.wav.
 *
 * Runs hourly via move-recordings.sh BEFORE the rclone sync, so the
 * stitched file lands in Firebase on the same cron tick as the legs.
 *
 * Idempotent: skips any linkedid whose stitched file is newer than all
 * its source legs.
 */

'use strict';

require('dotenv').config({ path: '/app/.env' });

const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const { Sequelize } = require('sequelize');

const MONITOR_DIR = '/var/spool/asterisk/monitor';
const ALT_DIR = '/var/spool/asterisk/recording';
const STITCH_DIR = path.join(MONITOR_DIR, 'stitched');
// Source-leg cache outside monitor/ so move-recordings.sh can't sweep it.
const STITCH_SRC_DIR = '/var/spool/asterisk/stitch-src';

// Look back far enough to catch calls whose legs may have already been moved
// to Firebase by a prior cron run. 25h covers a full missed cycle.
const LOOKBACK_HOURS = 25;

const sequelize = new Sequelize(
  process.env.DB_NAME || 'pbx_api_db',
  process.env.DB_USER || 'root',
  process.env.DB_PASSWORD || '',
  { host: process.env.DB_HOST || 'localhost', dialect: 'mysql', logging: false }
);

try { fs.mkdirSync(STITCH_DIR, { recursive: true }); } catch {}
try { fs.mkdirSync(STITCH_SRC_DIR, { recursive: true }); } catch {}

function log(...args) {
  console.log('[stitch-recordings]', ...args);
}

async function resolveLocal(filename) {
  let p = path.join(MONITOR_DIR, filename);
  if (fs.existsSync(p)) return p;
  p = path.join(ALT_DIR, filename);
  if (fs.existsSync(p)) return p;
  // Fetch from Firebase
  const cached = path.join(STITCH_SRC_DIR, filename);
  if (fs.existsSync(cached)) return cached;
  const remote = `firebase:misssellerai.firebasestorage.app/astra_pbx/recordings/${filename}`;
  const ok = await new Promise((resolve) => {
    execFile('rclone', ['copyto', remote, cached, '--timeout', '20s'], { timeout: 30000 }, (err) => resolve(!err));
  });
  return ok && fs.existsSync(cached) ? cached : null;
}

function probeDuration(p) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], { timeout: 10000 }, (err, stdout) => {
      if (err) return resolve(null);
      const d = parseFloat(String(stdout).trim());
      resolve(isFinite(d) ? d : null);
    });
  });
}

// Drop legs that temporally overlap a longer leg. MixMonitor on each
// leg records both sides of that leg's bridge, so when a queue leg and
// an answering-agent leg both span the talk window, they contain nearly
// identical conversation audio — concatenating them duplicates the
// conversation. Greedy by duration DESC keeps the maximal non-overlapping
// cover. See troubleshooting Error 59 for full context.
async function dedupOverlappingLegs(localPaths) {
  const probed = [];
  for (const p of localPaths) {
    const dur = await probeDuration(p);
    if (!dur) continue;
    const endTime = fs.statSync(p).mtimeMs / 1000;
    probed.push({ path: p, startTime: endTime - dur, endTime, duration: dur });
  }
  if (probed.length === 0) return [];
  const TOL = 1.0;
  const byDurationDesc = [...probed].sort((a, b) => b.duration - a.duration);
  const kept = [];
  for (const leg of byDurationDesc) {
    const overlaps = kept.some(k => leg.startTime < k.endTime - TOL && leg.endTime > k.startTime + TOL);
    if (!overlaps) kept.push(leg);
  }
  kept.sort((a, b) => a.startTime - b.startTime);
  return kept.map(k => k.path);
}

function ffmpegConcat(inputs, output) {
  return new Promise((resolve, reject) => {
    const args = [];
    for (const p of inputs) args.push('-i', p);
    const streams = inputs.map((_, i) => `[${i}:a]`).join('');
    args.push(
      '-filter_complex', `${streams}concat=n=${inputs.length}:v=0:a=1[out]`,
      '-map', '[out]',
      '-acodec', 'pcm_s16le', '-ar', '8000', '-ac', '1',
      '-y', output
    );
    const ff = spawn('ffmpeg', args);
    let stderr = '';
    ff.stderr.on('data', d => { stderr += d.toString(); });
    ff.on('error', reject);
    ff.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg concat failed: ' + stderr.slice(-400))));
  });
}

async function main() {
  const rows = await sequelize.query(
    `SELECT linkedid, accountcode, GROUP_CONCAT(recordingfile ORDER BY calldate, id SEPARATOR '\\n') AS files,
            MAX(calldate) AS last_leg
     FROM asterisk_cdr
     WHERE calldate > DATE_SUB(NOW(), INTERVAL ? HOUR)
       AND recordingfile IS NOT NULL AND recordingfile != ''
     GROUP BY linkedid, accountcode
     HAVING COUNT(DISTINCT recordingfile) >= 2`,
    { type: sequelize.QueryTypes.SELECT, replacements: [LOOKBACK_HOURS] }
  );

  log(`Found ${rows.length} multi-leg calls in last ${LOOKBACK_HOURS}h`);
  let stitched = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    const linkedid = row.linkedid;
    if (!linkedid) { skipped++; continue; }
    const safe = String(linkedid).replace(/[^a-zA-Z0-9._-]/g, '_');
    const out = path.join(STITCH_DIR, `${safe}.wav`);

    const files = Array.from(new Set(String(row.files).split('\n').filter(Boolean)));
    try {
      const resolved = [];
      for (const f of files) {
        const local = await resolveLocal(f);
        if (local) resolved.push(local);
      }
      if (resolved.length < 2) { skipped++; continue; }

      // Drop legs that overlap a longer leg (anti-duplication). After
      // dedup, the call may reduce to a single leg — in that case the
      // primary recording is good as-is, no stitching needed.
      const inputs = await dedupOverlappingLegs(resolved);
      if (inputs.length < 2) { skipped++; continue; }

      // Skip if stitched file already up-to-date.
      if (fs.existsSync(out)) {
        const stitchMtime = fs.statSync(out).mtimeMs;
        const fresh = inputs.every(p => {
          try { return fs.statSync(p).mtimeMs <= stitchMtime; } catch { return false; }
        });
        if (fresh) { skipped++; continue; }
      }

      await ffmpegConcat(inputs, out);
      stitched++;
      log(`stitched ${linkedid} (${inputs.length}/${resolved.length} legs, ${resolved.length - inputs.length} overlapping dropped)`);
    } catch (e) {
      failed++;
      log(`FAILED ${linkedid}: ${e.message}`);
    }
  }

  log(`Done. stitched=${stitched} skipped=${skipped} failed=${failed}`);
  await sequelize.close();
  process.exit(0);
}

main().catch(e => { log('FATAL', e.message); process.exit(1); });
