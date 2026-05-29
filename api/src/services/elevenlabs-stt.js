"use strict";

const EventEmitter = require("events");

const EL_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const CHUNK_DURATION_MS = 2000;
const SAMPLE_RATE = 8000;
const BYTES_PER_SAMPLE = 2;
const CHUNK_BYTES = (SAMPLE_RATE * BYTES_PER_SAMPLE * CHUNK_DURATION_MS) / 1000;

class ElevenLabsSTT extends EventEmitter {
  constructor({ apiKey, language = "en" }) {
    super();
    this.apiKey = apiKey;
    this.language = language;
    this.buffer = Buffer.alloc(0);
    this.active = false;
    this.transcribing = false;
  }

  start() {
    this.active = true;
    this.buffer = Buffer.alloc(0);
  }

  sendAudio(pcm16Buffer8k) {
    if (!this.active) return;
    this.buffer = Buffer.concat([this.buffer, pcm16Buffer8k]);
    if (this.buffer.length >= CHUNK_BYTES && !this.transcribing) {
      this._processChunk();
    }
  }

  async flush() {
    if (this.buffer.length > 640 && this.active) {
      await this._processChunk();
    }
  }

  async _processChunk() {
    if (this.transcribing) return;
    this.transcribing = true;
    const chunk = this.buffer.slice(0, Math.min(this.buffer.length, CHUNK_BYTES * 2));
    this.buffer = this.buffer.slice(chunk.length);

    try {
      const wav = this._pcmToWav(chunk, SAMPLE_RATE);
      const formData = new FormData();
      formData.append("file", new Blob([wav], { type: "audio/wav" }), "chunk.wav");
      formData.append("model_id", "scribe_v1");
      formData.append("language_code", this.language);

      const r = await fetch(EL_STT_URL, {
        method: "POST",
        headers: { "xi-api-key": this.apiKey },
        body: formData,
      });

      if (r.ok) {
        const data = await r.json();
        if (data.text && data.text.trim()) {
          this.emit("transcript", { text: data.text.trim(), is_final: true });
        }
      } else {
        this.emit("error", new Error(`STT HTTP ${r.status}`));
      }
    } catch (err) {
      this.emit("error", err);
    }
    this.transcribing = false;

    if (this.buffer.length >= CHUNK_BYTES && this.active) {
      this._processChunk();
    }
  }

  _pcmToWav(pcmData, sampleRate) {
    const dataSize = pcmData.length;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, pcmData]);
  }

  close() {
    this.active = false;
    this.buffer = Buffer.alloc(0);
  }
}

module.exports = { ElevenLabsSTT };
