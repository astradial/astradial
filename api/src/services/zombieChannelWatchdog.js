'use strict';

/**
 * Periodically scans Asterisk for stuck channels and surfaces an alert
 * when the Error 60 (wedged PJSIP reload) signature is detected. See
 * internal-docs/docs/operations/troubleshooting.md#error-60 for the
 * full incident history.
 *
 * Two zombie patterns this catches:
 *   1. Channels stuck in `h@*__hangup` exten for >5 min. Hangup handlers
 *      should finish in milliseconds — anything >5 min is wedged. The
 *      watchdog tries `channel request hangup`; if the underlying reload
 *      mutex is fine this usually frees the channel.
 *   2. Channels in `Down` state for >2 min. Asterisk's reaper normally
 *      cleans these in seconds.
 *
 * Plus an Error 60 signature check:
 *   - After attempting hangups, if MOST stuck channels are still stuck
 *     → the reload mutex is wedged (PR #255's serialization prevents
 *     concurrent reloads but a single reload can still wedge inside
 *     res_pjsip). The only recovery is SIGKILL + Asterisk restart, which
 *     the watchdog does NOT do automatically — operator authorization
 *     required per CLAUDE.md Rule 3.
 *
 * Alert delivery: structured pm2 log + GitHub issue creation. The issue
 * is @-mentioned to GH_OPS_MENTION so GitHub Mobile push fires. Issues
 * are deduped via a label (one open issue at a time); subsequent ticks
 * add comments instead of spawning duplicates. Auto-closes when the
 * watchdog sees no zombies for 2 consecutive ticks.
 *
 * Env vars (all optional except the first):
 *   GITHUB_OPS_TOKEN     — PAT with repo scope. Without this, watchdog
 *                          only logs to pm2 (no issue creation).
 *   GH_OPS_OWNER         — defaults to 'astradial'
 *   GH_OPS_REPO          — defaults to 'astradial-platform'
 *   GH_OPS_MENTION       — handle to @-ping. Defaults to '@harisuryaa'.
 *   ZOMBIE_WATCH_INTERVAL_MIN — defaults to 15. Set to 0 to disable.
 */

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const HANGUP_HANDLER_MAX_AGE_S = 5 * 60;
const DOWN_STATE_MAX_AGE_S = 2 * 60;
const STARTUP_GRACE_S = 90; // skip first 90s after Asterisk start
const ALERT_LABEL = 'auto-zombie-alert';

// State persisted across ticks. Used to detect "stable recovery"
// (consecutive zombie-free ticks) before auto-closing an issue.
let consecutiveCleanTicks = 0;
let openIssueNumber = null;
let lastAlertTickAt = 0;

async function runCli(cmd) {
  try {
    // 8s timeout — most asterisk CLI commands return in ms. If they
    // hang, the watchdog can't help anyway.
    const { stdout } = await execAsync(`asterisk -rx "${cmd}"`, { timeout: 8000 });
    return stdout;
  } catch (e) {
    return null;
  }
}

function parseChannelsConcise(text) {
  // `core show channels concise` — pipe-delimited, one line per channel.
  // Fields: name!context!exten!priority!state!app!appdata!callerid!
  //         accountcode!peeraccount!amaflags!duration_s!bridge_id!uniqueid
  if (!text) return [];
  return text
    .split('\n')
    .filter((l) => l.includes('!'))
    .map((l) => {
      const f = l.split('!');
      return {
        name: f[0] || '',
        context: f[1] || '',
        exten: f[2] || '',
        state: f[4] || '',
        app: f[5] || '',
        duration_s: parseInt(f[11], 10) || 0,
      };
    });
}

function classifyZombies(channels) {
  const stuckHangup = channels.filter(
    (c) => /__hangup$/.test(c.context) && c.exten === 'h' && c.duration_s > HANGUP_HANDLER_MAX_AGE_S
  );
  const stuckDown = channels.filter((c) => c.state === 'Down' && c.duration_s > DOWN_STATE_MAX_AGE_S);
  return { stuckHangup, stuckDown };
}

function formatChannelLine(c) {
  const m = Math.floor(c.duration_s / 60);
  const s = c.duration_s % 60;
  return `  • ${c.name.padEnd(60)} state=${c.state.padEnd(6)} exten=${c.exten.padEnd(2)} age=${m}m${String(s).padStart(2, '0')}s`;
}

async function getAsteriskUptimeSec() {
  const out = await runCli('core show uptime seconds');
  if (!out) return Infinity; // assume safe to run if we can't tell
  const m = out.match(/System:\s+(\d+)/);
  return m ? parseInt(m[1], 10) : Infinity;
}

// ─── GitHub issue plumbing ─────────────────────────────────────────────

function ghCfg() {
  return {
    token: process.env.GITHUB_OPS_TOKEN || '',
    owner: process.env.GH_OPS_OWNER || 'astradial',
    repo: process.env.GH_OPS_REPO || 'astradial-platform',
    mention: process.env.GH_OPS_MENTION || '@harisuryaa',
  };
}

async function ghApi(path, opts = {}) {
  const { token } = ghCfg();
  if (!token) return null;
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'astrapbx-zombie-watchdog',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`[zombie-watchdog] GitHub API ${res.status} on ${path}: ${body.slice(0, 200)}`);
    return null;
  }
  return res.json();
}

async function findOpenAlertIssue() {
  const { owner, repo } = ghCfg();
  const data = await ghApi(
    `/search/issues?q=repo:${owner}/${repo}+label:${encodeURIComponent(ALERT_LABEL)}+state:open`
  );
  if (!data || !Array.isArray(data.items) || data.items.length === 0) return null;
  return data.items[0].number;
}

async function createAlertIssue(title, body) {
  const { owner, repo, mention } = ghCfg();
  const data = await ghApi(`/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({
      title,
      body: `${mention}\n\n${body}`,
      labels: [ALERT_LABEL],
    }),
  });
  return data ? data.number : null;
}

async function commentOnAlertIssue(number, body) {
  const { owner, repo } = ghCfg();
  await ghApi(`/repos/${owner}/${repo}/issues/${number}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

async function closeAlertIssue(number, body) {
  const { owner, repo } = ghCfg();
  await commentOnAlertIssue(number, body);
  await ghApi(`/repos/${owner}/${repo}/issues/${number}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'closed' }),
  });
}

// ─── Phone alert via AMI Originate ────────────────────────────────────
//
// Calls the on-call operator's mobile when an Error 60 wedge is confirmed.
// GitHub Mobile push doesn't work for self-mentions (the token's owner is
// the same as the @-mention target — GitHub suppresses your-own-action
// notifications), so this is the primary urgent-alert path. The GitHub
// issue still gets created in parallel for the diagnostic detail.
//
// Reuses Asterisk's own AMI to originate the call. This is reliable even
// during an Error 60 wedge — the wedge is internal to res_pjsip's reload
// path; AMI Originate of a new call works regardless.
//
// Env vars (all required for phone alerts; missing any → silently skipped):
//   OPS_ALERT_PHONE      — destination mobile (e.g. '9876543210' or '+919876543210')
//   OPS_ALERT_CALLER_ID  — what shows on the operator's phone (e.g. '08065080700' = pilot DID)
//   OPS_ALERT_TRUNK      — Asterisk PJSIP endpoint name of the outbound trunk to dial through
//   AMI_USER / AMI_SECRET — credentials for AMI socket (already in .env)

const ALERT_SOUNDS = 'ascending-2tone&beep&beep&ascending-2tone&beep&beep';

async function dialOpsAlert() {
  const phone = process.env.OPS_ALERT_PHONE || '';
  const callerId = process.env.OPS_ALERT_CALLER_ID || '';
  const trunk = process.env.OPS_ALERT_TRUNK || '';
  const amiUser = process.env.AMI_USER || '';
  const amiSecret = process.env.AMI_SECRET || '';

  if (!phone || !trunk || !amiUser || !amiSecret) {
    console.warn('[zombie-watchdog] phone-alert skipped — set OPS_ALERT_PHONE + OPS_ALERT_TRUNK + AMI_USER + AMI_SECRET in .env');
    return false;
  }

  const dest = phone.replace(/^\+/, '').replace(/^0+/, '');

  const net = require('net');
  return new Promise((resolve) => {
    const sock = net.connect(5038, '127.0.0.1');
    let buf = '';
    let sent = false;
    const finish = (ok, reason) => {
      try { sock.destroy(); } catch {}
      if (!ok) console.warn(`[zombie-watchdog] phone-alert failed: ${reason || 'unknown'}`);
      resolve(ok);
    };
    sock.on('data', (d) => {
      buf += d.toString();
      if (!sent && buf.includes('Authentication accepted')) {
        sent = true;
        const lines = [
          'Action: Originate',
          `Channel: PJSIP/${dest}@${trunk}`,
          'Application: Playback',
          `Data: ${ALERT_SOUNDS}`,
          ...(callerId ? [`CallerID: ${callerId}`] : []),
          'Timeout: 30000',
          'Async: yes',
          'ActionID: zombie-watchdog-phone-alert',
          '',
          '',
        ].join('\r\n');
        sock.write(lines);
        // Give AMI time to ACK the originate before disconnect
        setTimeout(() => finish(true), 1500);
      }
    });
    sock.write(
      ['Action: Login', `Username: ${amiUser}`, `Secret: ${amiSecret}`, '', ''].join('\r\n')
    );
    sock.on('error', (e) => finish(false, e.message));
    setTimeout(() => sent ? finish(true) : finish(false, 'timeout before AMI auth'), 5000);
  });
}

// ─── Tick ─────────────────────────────────────────────────────────────

async function tick() {
  const tickAt = new Date().toISOString();

  // Skip during startup grace — channels are legitimately in transient
  // states for the first ~minute after Asterisk restart.
  const uptime = await getAsteriskUptimeSec();
  if (uptime < STARTUP_GRACE_S) {
    return;
  }

  const channelsRaw = await runCli('core show channels concise');
  if (channelsRaw === null) {
    console.warn(`[zombie-watchdog ${tickAt}] could not read channels (CLI/AMI unreachable?)`);
    return;
  }

  const channels = parseChannelsConcise(channelsRaw);
  const { stuckHangup, stuckDown } = classifyZombies(channels);
  const zombies = [...stuckHangup, ...stuckDown];

  if (zombies.length === 0) {
    // Clean tick. Auto-close any open alert after 2 consecutive clean ticks
    // (avoids flapping on flaky checks).
    consecutiveCleanTicks++;
    if (consecutiveCleanTicks >= 2 && openIssueNumber === null) {
      // Look one more time for an issue we don't know about (e.g. service
      // restart lost in-memory state). If found, close it.
      const found = await findOpenAlertIssue();
      if (found) openIssueNumber = found;
    }
    if (consecutiveCleanTicks >= 2 && openIssueNumber !== null) {
      await closeAlertIssue(
        openIssueNumber,
        `Auto-closed by zombie-watchdog at ${tickAt}: 2 consecutive clean ticks (no stuck channels). If the recovery procedure was applied, this is expected.`
      );
      console.log(`[zombie-watchdog ${tickAt}] auto-closed alert issue #${openIssueNumber}`);
      openIssueNumber = null;
    }
    return;
  }

  consecutiveCleanTicks = 0;

  console.warn(`[zombie-watchdog ${tickAt}] ${zombies.length} stuck channel(s) detected; attempting hangup`);
  for (const z of zombies) console.warn(formatChannelLine(z));

  for (const z of zombies) {
    await runCli(`channel request hangup ${z.name}`);
  }

  // Wait briefly for hangup to take effect, then re-evaluate.
  await new Promise((r) => setTimeout(r, 3000));
  const afterRaw = await runCli('core show channels concise');
  const after = parseChannelsConcise(afterRaw || '');
  const { stuckHangup: stillStuckHangup } = classifyZombies(after);

  // Error 60 signature: most/all stuck channels survived the hangup
  // attempts → the reload mutex is wedged and `channel request hangup`
  // is a no-op. Alert.
  const wedgedSuspected =
    stillStuckHangup.length >= Math.max(1, Math.floor(stuckHangup.length * 0.66));

  if (!wedgedSuspected) {
    // Hangups worked. Quiet log + no GitHub alert.
    console.log(`[zombie-watchdog ${tickAt}] hangups cleared ${zombies.length - stillStuckHangup.length}/${zombies.length} channels`);
    return;
  }

  const alertBody = [
    `**Error 60 (wedged PJSIP reload) suspected** on prod Asterisk.`,
    '',
    `Detected by the zombie-channel watchdog at ${tickAt}.`,
    '',
    `## What the watchdog saw`,
    '',
    `- ${stuckHangup.length} channel(s) stuck in \`h@*__hangup\` exten for >5 minutes`,
    `- ${stuckDown.length} channel(s) in \`Down\` state for >2 minutes`,
    `- After \`channel request hangup\`, ${stillStuckHangup.length} of ${stuckHangup.length} hangup-exten zombies remained → \`channel request hangup\` is a no-op (reload mutex wedged).`,
    '',
    `## Stuck channels`,
    '',
    '```',
    ...zombies.map(formatChannelLine),
    '```',
    '',
    `## Recovery procedure (operator action required)`,
    '',
    '```bash',
    'ssh root@89.116.31.109',
    'PID=$(pgrep -x asterisk)',
    'kill -9 $PID',
    'sleep 3',
    'rm -f /var/run/asterisk/*',
    '/usr/sbin/asterisk',
    'sleep 10',
    'asterisk -rx "core show uptime"',
    'asterisk -rx "pjsip show aor tata_gateway" | grep -i avail',
    '```',
    '',
    `Expect ~30-60s of "first call after restart" period while PJSIP endpoints re-register and AORs re-qualify. The watchdog will auto-close this issue once 2 consecutive ticks come back clean.`,
    '',
    `See [internal-docs Error 60](../astradial/internal-docs/blob/main/docs/operations/troubleshooting.md#error-60-pjsip-reload-deadlock) for the full failure-mode + history.`,
  ].join('\n');

  // Throttle GitHub interactions — at most one create + one comment per
  // 5 minutes regardless of tick frequency.
  const now = Date.now();
  const sinceLastAlert = now - lastAlertTickAt;
  if (sinceLastAlert < 5 * 60 * 1000) {
    console.warn(`[zombie-watchdog ${tickAt}] *** ERROR 60 SUSPECTED *** (alert throttled — last sent ${Math.floor(sinceLastAlert/1000)}s ago)`);
    return;
  }
  lastAlertTickAt = now;

  console.error(`[zombie-watchdog ${tickAt}] *** ERROR 60 SUSPECTED *** — see GitHub alert issue`);

  // Urgent: dial the on-call mobile FIRST so the operator gets a phone
  // ring even if GitHub-issue creation hits a network/API hiccup. The
  // call is async — we don't block on it. GitHub issue contains the full
  // recovery procedure; the phone call is just "something's wrong, look
  // at the logs/repo".
  dialOpsAlert().catch((e) => console.warn('[zombie-watchdog] dialOpsAlert threw:', e.message));

  if (openIssueNumber === null) {
    openIssueNumber = await findOpenAlertIssue();
  }
  if (openIssueNumber !== null) {
    await commentOnAlertIssue(openIssueNumber, `**Tick ${tickAt}** — still wedged. ${stillStuckHangup.length} channel(s) stuck in hangup handler after \`channel request hangup\` attempt.`);
  } else {
    const num = await createAlertIssue(
      'PROD Asterisk: PJSIP reload wedged — Error 60 recovery needed',
      alertBody
    );
    if (num) {
      openIssueNumber = num;
      console.log(`[zombie-watchdog ${tickAt}] opened alert issue #${num}`);
    }
  }
}

function start() {
  const minutes = parseFloat(process.env.ZOMBIE_WATCH_INTERVAL_MIN || '15');
  if (!minutes || minutes <= 0) {
    console.log('[zombie-watchdog] disabled (ZOMBIE_WATCH_INTERVAL_MIN=0)');
    return;
  }
  const ms = minutes * 60 * 1000;
  // Tick once 60s after boot (let the app fully start) then every interval.
  setTimeout(() => {
    tick().catch((e) => console.error('[zombie-watchdog] tick error:', e.message));
    setInterval(() => tick().catch((e) => console.error('[zombie-watchdog] tick error:', e.message)), ms);
  }, 60 * 1000);
  console.log(`[zombie-watchdog] started, tick every ${minutes} min (first run in 60s)`);
}

module.exports = { start, tick, classifyZombies, parseChannelsConcise };
