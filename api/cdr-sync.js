// CDR Sync — watches Asterisk CDR CSV and POSTs to LogsUpdate + inserts to MySQL
const fs = require("fs");
const { Sequelize } = require("sequelize");

const CSV_PATH = "/var/log/asterisk/cdr-csv/Master.csv";
const LOGSUPDATE_URL = process.env.LOGSUPDATE_URL || "https://events.astradial.com";
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

      const accountcode = f[0], src = f[1], dst = f[2], clid = f[4];
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

      // Direction
      let direction = "internal";
      const srcDigits = src.replace(/\D/g, "");
      const dstDigits = dst.replace(/\D/g, "");
      if (channel.includes("trunk") && srcDigits.length >= 7) direction = "inbound";
      else if (srcDigits.length <= 5 && dstDigits.length >= 7) direction = "outbound";
      else if ((dstchannel || "").includes("trunk")) direction = "outbound";

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

      // POST to LogsUpdate for Firebase
      try {
        const payload = JSON.stringify({
          call_id: uniqueid, phone_number: src, source: src, destination: dst,
          caller_id_name: clid, direction, disposition,
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
