"use strict";

const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const { execFileSync } = require("child_process");
const { ElevenLabsSTT } = require("./elevenlabs-stt");

const FRAME_DURATION_MS = 20;
const SAMPLE_RATE = 8000;
const BYTES_PER_FRAME = (SAMPLE_RATE * 2 * FRAME_DURATION_MS) / 1000;

class CampaignBotServer {
  constructor({ port = 8765, models }) {
    this.port = port;
    this.models = models;
    this.httpServer = null;
    this.wss = null;
  }

  start() {
    this.httpServer = http.createServer((_, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("campaign-bot-server");
    });
    this.wss = new WebSocket.WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (ws, req) => this._handleConnection(ws, req));
    this.httpServer.listen(this.port, () => {
      console.log("✓ Campaign bot WebSocket server on port " + this.port);
    });
  }

  stop() {
    if (this.wss) { try { this.wss.close(); } catch (_) {} }
    if (this.httpServer) { try { this.httpServer.close(); } catch (_) {} }
  }

  async _handleConnection(ws, req) {
    const urlPath = req.url || "";
    const match = urlPath.match(/\/bot\/([^/?]+)/);
    const botId = match ? match[1] : null;

    const state = {
      botId,
      bot: null,
      botReady: false,
      callMetadata: null,
      stt: null,
      transcript: "",
      startTime: Date.now(),
      audioPlaybackDone: false,
      timeoutTimer: null,
      stopped: false,
      keywords: [],
      pendingMessages: [],
    };

    // Register message handler FIRST so no messages are lost during DB lookup
    ws.on("message", (data, isBinary) => {
      if (state.stopped) return;
      if (!state.botReady) {
        state.pendingMessages.push({ data, isBinary });
        return;
      }
      this._processMessage(ws, state, data, isBinary);
    });

    ws.on("close", () => {
      if (!state.stopped) this._cleanup(ws, state, "hangup");
    });

    ws.on("error", () => {
      if (!state.stopped) this._cleanup(ws, state, "error");
    });

    // Load bot from DB
    if (!botId) {
      console.error("[bot-server] no bot_id in URL");
      ws.close();
      return;
    }

    try {
      const { CampaignBot } = this.models;
      state.bot = await CampaignBot.findByPk(botId, { raw: true });
      if (!state.bot) {
        console.error("[bot-server] bot " + botId + " not found");
        ws.close();
        return;
      }
      console.log("[bot-server] connected: bot=" + state.bot.name);
    } catch (err) {
      console.error("[bot-server] DB error: " + err.message);
      ws.close();
      return;
    }

    state.botReady = true;

    // Process any messages that arrived during DB lookup
    for (const pm of state.pendingMessages) {
      this._processMessage(ws, state, pm.data, pm.isBinary);
    }
    state.pendingMessages = [];
  }

  _processMessage(ws, state, data, isBinary) {
    if (state.stopped) return;

    if (isBinary) {
      this._handleAudio(ws, state, data);
      return;
    }

    try {
      const raw = data.toString();
      const msg = JSON.parse(raw);
      console.log("[bot-server] event: " + msg.event);

      if (msg.event === "connected") {
        // Already handled in _handleConnection
      } else if (msg.event === "start") {
        this._onStart(ws, state, msg.start || {});
      } else if (msg.event === "stop") {
        this._cleanup(ws, state, "caller_stop");
      }
    } catch (err) {
      console.error("[bot-server] message error: " + err.message);
    }
  }

  _onStart(ws, state, startData) {
    const params = startData.customParameters || {};
    state.callMetadata = {
      orgId: params.ORG_ID || params.org_id || "",
      campaignId: params.CAMPAIGN_ID || "",
      campaignLeadId: params.CAMPAIGN_LEAD_ID || "",
      callSid: startData.callSid || "",
      from: startData.from || "",
      to: startData.to || "",
    };

    // Merge bot keywords + campaign interest keywords
    state.keywords = [...(state.bot.keywords || [])];
    try {
      const ik = params.INTEREST_KEYWORDS;
      if (ik) {
        const parsed = JSON.parse(ik);
        if (Array.isArray(parsed)) state.keywords.push(...parsed);
      }
    } catch (_) {}
    state.keywords = [...new Set(state.keywords.map(function(k) { return k.toLowerCase(); }))];

    console.log("[bot-server] start: call=" + state.callMetadata.callSid + " keywords=[" + state.keywords.join(",") + "]");

    // Play intro audio if available
    if (state.bot.intro_audio_path && fs.existsSync(state.bot.intro_audio_path)) {
      this._playIntroAudio(ws, state).then(function() {
        state.audioPlaybackDone = true;
        this._startListening(ws, state);
      }.bind(this));
    } else {
      state.audioPlaybackDone = true;
      this._startListening(ws, state);
    }
  }

  _startListening(ws, state) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (apiKey) {
      state.stt = new ElevenLabsSTT({ apiKey: apiKey, language: state.bot.language || "en" });
      state.stt.start();
      state.stt.on("transcript", function(t) { this._onTranscript(ws, state, t); }.bind(this));
      state.stt.on("error", function(e) { console.error("[bot-server] STT error: " + e.message); });
      console.log("[bot-server] STT started, listening...");
    } else {
      console.warn("[bot-server] ELEVENLABS_API_KEY not set, STT disabled");
    }

    // Start timeout timer
    var timeout = (state.bot.call_timeout || 8) * 1000;
    state.timeoutTimer = setTimeout(function() {
      if (!state.stopped) {
        console.log("[bot-server] timeout after " + timeout + "ms");
        this._cleanup(ws, state, "timeout");
      }
    }.bind(this), timeout);
  }

  async _playIntroAudio(ws, state) {
    try {
      var pcmData = execFileSync("ffmpeg", [
        "-i", state.bot.intro_audio_path,
        "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", "1",
        "-loglevel", "error", "pipe:1",
      ], { maxBuffer: 10 * 1024 * 1024 });

      console.log("[bot-server] playing intro: " + pcmData.length + " bytes");

      var totalFrames = Math.ceil(pcmData.length / BYTES_PER_FRAME);
      for (var i = 0; i < totalFrames; i++) {
        if (state.stopped || ws.readyState !== WebSocket.OPEN) break;
        var start = i * BYTES_PER_FRAME;
        var end = Math.min(start + BYTES_PER_FRAME, pcmData.length);
        ws.send(pcmData.slice(start, end));
        await new Promise(function(r) { setTimeout(r, FRAME_DURATION_MS); });
      }
      console.log("[bot-server] intro done");
    } catch (err) {
      console.error("[bot-server] audio error: " + err.message);
    }
  }

  _handleAudio(ws, state, data) {
    if (!state.audioPlaybackDone || !state.stt) return;
    if (!state._audioCount) state._audioCount = 0;
    state._audioCount++;
    if (state._audioCount % 50 === 1) console.log("[bot-server] audio frames: " + state._audioCount + " size=" + data.length);
    state.stt.sendAudio(Buffer.from(data));
  }

  _onTranscript(ws, state, t) {
    if (state.stopped || !t.text) return;
    state.transcript += (state.transcript ? " " : "") + t.text;
    console.log("[bot-server] transcript: " + JSON.stringify(t.text));

    // Reset timeout
    if (state.timeoutTimer) {
      clearTimeout(state.timeoutTimer);
      var timeout = (state.bot.call_timeout || 8) * 1000;
      state.timeoutTimer = setTimeout(function() {
        if (!state.stopped) this._cleanup(ws, state, "timeout");
      }.bind(this), timeout);
    }

    // Check word count
    var words = t.text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean);
    if (words.length > (state.bot.max_words || 3)) return;

    // Keyword detection
    var textLower = t.text.toLowerCase().replace(/[^\w\s]/g, "");
    for (var ki = 0; ki < state.keywords.length; ki++) {
      if (textLower.includes(state.keywords[ki])) {
        console.log("[bot-server] keyword detected: " + JSON.stringify(state.keywords[ki]) + " in " + JSON.stringify(t.text));
        this._cleanup(ws, state, "keyword_detected", state.keywords[ki]);
        return;
      }
    }
  }

  async _cleanup(ws, state, reason, detectedKeyword) {
    if (state.stopped) return;
    state.stopped = true;
    detectedKeyword = detectedKeyword || null;

    if (state.timeoutTimer) clearTimeout(state.timeoutTimer);
    if (state.stt) {
      state.stt.flush().catch(function() {});
      state.stt.close();
    }

    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: "stop" }));
      }
    } catch (_) {}

    var duration = Math.floor((Date.now() - state.startTime) / 1000);
    console.log("[bot-server] ended: reason=" + reason + " duration=" + duration + "s keyword=" + (detectedKeyword || "none") + " transcript=" + JSON.stringify(state.transcript));

    if (state.callMetadata && state.callMetadata.campaignLeadId) {
      await this._postCallResult(state, reason, detectedKeyword, duration);
    }

    try { ws.close(); } catch (_) {}
  }

  async _postCallResult(state, reason, detectedKeyword, duration) {
    var port = process.env.PORT || 3000;
    var url = "http://localhost:" + port + "/api/v1/webhooks/campaigns/call-result";
    var payload = {
      org_id: state.callMetadata.orgId,
      campaign_id: state.callMetadata.campaignId,
      campaign_lead_id: state.callMetadata.campaignLeadId,
      transcript: state.transcript,
      duration_seconds: duration,
      status: reason === "keyword_detected" ? "completed" : reason,
      detected_keyword: detectedKeyword || null,
    };

    try {
      var internalKey = process.env.INTERNAL_API_KEY || "internal-dev-key";
      var r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Key": internalKey,
        },
        body: JSON.stringify(payload),
      });
      console.log("[bot-server] webhook posted: " + r.status);
    } catch (err) {
      console.error("[bot-server] webhook failed: " + err.message);
    }
  }
}

module.exports = { CampaignBotServer };
