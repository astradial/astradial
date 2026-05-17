// CDR Sync — watches Asterisk CDR CSV and POSTs to LogsUpdate + inserts to MySQL
const fs = require("fs");
const { Sequelize } = require("sequelize");

const CSV_PATH = "/var/log/asterisk/cdr-csv/Master.csv";
const LOGSUPDATE_URL = process.env.LOGSUPDATE_URL || "https://events.example.com";
const POLL_INTERVAL = 10000;

require("dotenv").config();
const sequelize = new Sequelize(process.env.DB_NAME || "pbx_api_db", process.env.DB_USER || "root", process.env.DB_PASSWORD || "", {
  host: process.env.DB_HOST || "localhost", dialect: "mariadb", logging: false
});

let lastLine = 0;

function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { fields.push(current); current = ""; continue; }
    current += ch;
  }
  fields.push(current);
  return fields;
}

async function init() {
  try {
    const content = fs.readFileSync(CSV_PATH, "utf8");
    lastLine = content.split("\n").filter(l => l.trim()).length;
    console.log(`CDR sync started — ${lastLine} existing lines, polling every ${POLL_INTERVAL / 1000}s`);
  } catch (e) {
    console.error("Failed to read CSV:", e.message);
  }
}

async function processNewLines() {
  try {
    const content = fs.readFileSync(CSV_PATH, "utf8");
    const lines = content.split("\n").filter(l => l.trim());
    if (lines.length <= lastLine) return;

    const newLines = lines.slice(lastLine);
    lastLine = lines.length;

    for (const line of newLines) {
      const f = parseCSVLine(line);
      if (f.length < 16) continue;

      // Asterisk Master.csv field layout:
      //   0 accountcode | 1 src | 2 dst | 3 dcontext | 4 clid | 5 channel
      //   6 dstchannel | 7 lastapp | 8 lastdata | 9 start | 10 answer
      //   11 end | 12 duration | 13 billsec | 14 disposition | 15 amaflags
      //   16 uniqueid | 17 userfield (we repurpose for recordingfile)
      // dcontext (f[3]) is the strongest signal for direction — see below.
      const accountcode = f[0], src = f[1], dst = f[2], dcontext = f[3], clid = f[4];
      const channel = f[5], dstchannel = f[6];
      const start = f[9], answer = f[10], end = f[11];
      const duration = f[12], billsec = f[13], disposition = f[14];
      const uniqueid = f[16] || "";
      const recordingfile = f[17] || "";

      // Skip Local channels (internal routing legs)
      if (channel.startsWith("Local/")) continue;

      // Determine org
      let orgId = accountcode;
      if (!orgId || orgId.length < 10) {
        try {
          const cleanDst = dst.replace(/^\+/, "");
          const [rows] = await sequelize.query(
            "SELECT org_id FROM did_numbers WHERE number = ? LIMIT 1",
            { replacements: [cleanDst] }
          );
          if (rows.length > 0) orgId = rows[0].org_id;
        } catch (e) { /* skip */ }
      }
      if (!orgId || orgId.length < 10) continue;

      // Direction. Previously this only matched channels whose name
      // contained the literal substring "trunk" — but Tata's PJSIP
      // endpoint is named `tata_gateway`, so every Tata-inbound call
      // fell through to `direction='internal'`, which the
      // auto-ticket classifier silently skips. No tickets created.
      // Fix uses dcontext as the primary signal: Asterisk routes all
      // inbound calls through `*_incoming` / `*_incoming_sub` /
      // `tata-inbound` contexts, none of which apply to internal or
      // outbound calls. Channel-name match remains as a fallback for
      // CDRs where dcontext is missing.
      let direction = "internal";
      const srcDigits = src.replace(/\D/g, "");
      const dstDigits = dst.replace(/\D/g, "");
      const ctx = String(dcontext || "");
      const ch = String(channel || "");
      const dch = String(dstchannel || "");
      if (ctx.includes("incoming") || ctx.includes("inbound")) {
        direction = "inbound";
      } else if (ctx.includes("outbound") || dch.includes("trunk") || dch.includes("gateway")) {
        direction = "outbound";
      } else if ((ch.includes("trunk") || ch.includes("gateway")) && srcDigits.length >= 7) {
        // Channel-name fallback: trunk/gateway PJSIP coming in with an
        // external caller-id is an inbound call. Covers CDRs where
        // dcontext didn't get populated (rare).
        direction = "inbound";
      } else if (srcDigits.length <= 5 && dstDigits.length >= 7) {
        direction = "outbound";
      }

      const statusMap = { ANSWERED: "completed", "NO ANSWER": "no_answer", BUSY: "busy", FAILED: "failed", CONGESTION: "failed" };
      const status = statusMap[disposition] || "failed";
      const dur = parseInt(billsec) || 0;
      const totalDur = parseInt(duration) || 0;

      // Insert to MySQL (skip duplicates)
      try {
        await sequelize.query(
          `INSERT INTO call_records (id, org_id, call_id, channel_id, from_number, to_number, caller_id_name, direction, status, duration, started_at, answered_at, ended_at, recording_file, recording_url, variables, createdAt, updatedAt)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', NOW(), NOW())`,
          { replacements: [orgId, uniqueid, channel, src, dst, clid, direction, status, dur, start || null, answer || null, end || null, recordingfile || null, recordingfile ? "pending" : null] }
        );
      } catch (e) {
        if (!e.message.includes("Duplicate") && !e.message.includes("ER_DUP")) {
          console.error("DB insert:", e.message.substring(0, 100));
        }
        // Already exists — skip
        continue;
      }

      // POST to LogsUpdate for Firebase.
      //
      // The upstream auto-ticket classifier maps disposition → ticket
      // creation: NO ANSWER inbound → missed_call (or queue_timeout
      // when context is a queue), ANSWERED inbound → "human answered,
      // skip". But for an inbound call that hits an IVR or queue and
      // is never bridged to a real member (caller hung up while
      // listening to the greeting or in queue), Asterisk still records
      // ANSWERED because the channel was Answer()ed for the IVR
      // greeting. From the customer's perspective these ARE missed
      // calls — they should get tickets.
      //
      // Detect this case (no member bridged) and POST disposition as
      // "NO ANSWER" so the classifier's existing missed-call rule
      // fires. Signals:
      //   - direction = inbound
      //   - disposition = ANSWERED (Answer() ran for greeting/queue)
      //   - dstchannel empty OR doesn't look like a member channel
      //     (PJSIP/<endpoint>-… for softphones, or a Local/Dial leg)
      // Local DB row keeps the original disposition so call logs
      // accurately reflect what happened.
      let classifierDisposition = disposition;
      if (direction === "inbound" && disposition === "ANSWERED") {
        const bridged = dch && dch.trim() && !dch.startsWith("Local/qm");
        // Local/qm<...> targets are the per-queue helper context
        // (PR #180): they're set as dstchannel but the underlying
        // Dial may have failed without bridging. Use lastapp as a
        // tiebreaker — if the call ended while WaitExten / Background
        // / Playback / Queue was the last app, no human picked up.
        const lastappStr = String(f[7] || "").toLowerCase();
        const stillInGreeting = ["waitexten", "background", "playback", "queue"].includes(lastappStr);
        if (!bridged || stillInGreeting) {
          classifierDisposition = "NO ANSWER";
        }
      }
      try {
        const payload = JSON.stringify({
          call_id: uniqueid, phone_number: src, source: src, destination: dst,
          caller_id_name: clid, direction,
          disposition: classifierDisposition,
          duration: dur, total_duration: totalDur,
          recording_url: "", recording_file: recordingfile,
          channel, unique_id: uniqueid, answered_by: dst,
          time: start || new Date().toISOString(),
        });
        const res = await fetch(`${LOGSUPDATE_URL}/astrapbx-log/${orgId}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: payload
        });
        const body = await res.text();
        console.log(`📤 ${src} -> ${dst} (${disposition}, ${dur}s, ${direction}) -> LogsUpdate: ${res.status}`);
      } catch (e) {
        console.error("LogsUpdate:", e.message);
      }
    }
  } catch (e) {
    console.error("Poll error:", e.message);
  }
}

init().then(() => {
  setInterval(processNewLines, POLL_INTERVAL);
});
