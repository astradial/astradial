const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs').promises;
const path = require('path');

// ─── Audio format ─────────────────────────────────────────────────────
//
// Decision: synthesize as **MULAW @ 8 kHz**, save raw as `.ulaw`.
//
// This is the final form after two earlier iterations: first 24 kHz
// LINEAR16 .wav (which Asterisk's `format_wav.so` couldn't decode —
// V7 prod incident 2026-05-13), then 16 kHz LINEAR16 .wav (which
// Asterisk's Playback() refused to pick over a missing `.ulaw`
// sibling on G.711 channels). The cleanest single-format solution is
// to save the audio in the format Asterisk needs anyway on the
// dominant call path: G.711 mu-law.
//
// Why `.ulaw` only:
//
//   • PSTN itself is G.711 mu-law (8 kHz, 8-bit log). Every call
//     that traverses the public phone network ends up as mu-law at
//     some point.
//
//   • SIP softphones almost always default to mu-law for narrowband
//     compatibility. Only HD-capable softphones (Opus, AMR-WB) need
//     a wideband source — and even there, Asterisk transcodes
//     mu-law → slin8 → Opus with negligible quality loss on a
//     spoken greeting.
//
//   • Asterisk reads `.ulaw` files (format_g711.c) as raw 8-bit
//     mu-law and writes them DIRECTLY to mu-law channels with ZERO
//     transcoding. The audio reaches the caller exactly as Google
//     synthesized it — no resampling artifacts, no codec round-trip.
//
//   • Google's TTS API does the 24 kHz native → 8 kHz mu-law
//     downsample server-side with their high-quality resampler.
//     Better than what Asterisk would do on the fly from a 16 kHz
//     LINEAR16 source.
//
//   • Single file per greeting → simpler delete, simpler backfill,
//     half the storage and half the Google API cost vs the dual-
//     format approach.
//
// Quirk: Google's MULAW response is wrapped in a RIFF/WAVE
// container (verified empirically — `file ...ulaw` reports "WAVE
// audio, ITU G.711 mu-law"). Asterisk's `.ulaw` format reader wants
// raw bytes with no header, so we strip the WAVE wrapper via
// `_stripWavHeader` before writing.
//
// Filename / dialplan: the dialplan generator emits
// `Playback(/var/lib/asterisk/sounds/greetings/greeting_<id>)`
// without an extension. Asterisk auto-finds `greeting_<id>.ulaw`
// via its file-format extension lookup. The `audio_file` DB column
// stores `greeting_<id>.ulaw` for traceability.
//
// References:
//   https://cloud.google.com/text-to-speech/docs/audio-encoding
//   https://wiki.asterisk.org/wiki/display/AST/File+Formats
const AUDIO_ENCODING = 'MULAW';
const SAMPLE_RATE_HZ = 8000;

// ─── Model registry ───────────────────────────────────────────────────
//
// Each entry says: how to invoke Google for this model, what voices the
// dropdown should expose, and whether the model accepts a style prompt.
//
// `geminiModelName` — present iff the model is a Gemini family. The
// presence of this field is the dispatch signal: if set, we route the
// request through the Gemini code path (modelName field + prompt
// support); if absent, we use the standard Chirp 3 HD / Wavenet code
// path (just voice.name).
//
// Voice lists are curated rather than dynamic. Google offers ~30
// celestial-named voices per language for both Chirp 3 HD and Gemini,
// but a 4-voice shortlist (2 female + 2 male) is enough for operators
// in practice. If we ever want the full list, `listVoices()` below
// fetches it live from Google.
const MODELS = {
  'chirp3-hd': {
    label: 'Chirp 3 HD',
    description: 'Natural, clear voice. Default. No style control.',
    supportsStyleInstructions: false,
    // Voice names are FULLY-QUALIFIED for Chirp 3 HD: language code is
    // part of the voice name. The same celestial name in a different
    // language is a different voice.
    voicesByLanguage: {
      'en-IN': ['en-IN-Chirp3-HD-Achernar', 'en-IN-Chirp3-HD-Aoede', 'en-IN-Chirp3-HD-Achird', 'en-IN-Chirp3-HD-Algenib'],
      'hi-IN': ['hi-IN-Chirp3-HD-Achernar', 'hi-IN-Chirp3-HD-Aoede', 'hi-IN-Chirp3-HD-Achird', 'hi-IN-Chirp3-HD-Algenib'],
      'ta-IN': ['ta-IN-Chirp3-HD-Achernar', 'ta-IN-Chirp3-HD-Aoede', 'ta-IN-Chirp3-HD-Achird', 'ta-IN-Chirp3-HD-Algenib'],
      'te-IN': ['te-IN-Chirp3-HD-Achernar', 'te-IN-Chirp3-HD-Aoede', 'te-IN-Chirp3-HD-Achird', 'te-IN-Chirp3-HD-Algenib'],
      'ml-IN': ['ml-IN-Chirp3-HD-Achernar', 'ml-IN-Chirp3-HD-Aoede', 'ml-IN-Chirp3-HD-Achird', 'ml-IN-Chirp3-HD-Algenib'],
      'kn-IN': ['kn-IN-Chirp3-HD-Achernar', 'kn-IN-Chirp3-HD-Aoede', 'kn-IN-Chirp3-HD-Achird', 'kn-IN-Chirp3-HD-Algenib'],
    }
  },
  'gemini-flash': {
    label: 'Gemini 2.5 Flash TTS',
    description: 'Style-controllable via prompt. Fast. Best for dynamic greetings.',
    supportsStyleInstructions: true,
    geminiModelName: 'gemini-2.5-flash-tts',
    // Gemini voice names are LANGUAGE-AGNOSTIC. The same `Kore` voice
    // speaks every supported language; we set the language separately
    // via languageCode. So one voice list × N languages = N×voices combos.
    voices: ['Kore', 'Achernar', 'Aoede', 'Achird', 'Algenib', 'Charon'],
    languages: ['en-IN', 'hi-IN', 'ta-IN', 'te-IN', 'ml-IN', 'kn-IN']
  },
  'gemini-pro': {
    label: 'Gemini 2.5 Pro TTS',
    description: 'Highest quality. Style-controllable. Slower + pricier.',
    supportsStyleInstructions: true,
    geminiModelName: 'gemini-2.5-pro-tts',
    voices: ['Kore', 'Achernar', 'Aoede', 'Achird', 'Algenib', 'Charon'],
    languages: ['en-IN', 'hi-IN', 'ta-IN', 'te-IN', 'ml-IN', 'kn-IN']
  },
};

const DEFAULT_MODEL = 'chirp3-hd';
const DEFAULT_LANGUAGE = 'en-IN';
const DEFAULT_VOICE = 'en-IN-Chirp3-HD-Achernar';

class TTSService {
  constructor() {
    this.client = new textToSpeech.TextToSpeechClient();
    this.greetingsDir = process.env.ASTERISK_GREETINGS_DIR || '/var/lib/asterisk/sounds/greetings';
  }

  async ensureDirectory() {
    try {
      await fs.mkdir(this.greetingsDir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  /**
   * Generate audio bytes for the given text + voice config.
   *
   * @param {string} text
   * @param {string} language     BCP-47 code (en-IN, hi-IN, ta-IN, …)
   * @param {string} voice        Voice name. For Chirp 3 HD: the
   *                              fully-qualified name (e.g.
   *                              `en-IN-Chirp3-HD-Achernar`). For
   *                              Gemini models: a short name like
   *                              `Kore` (language is taken from the
   *                              `language` argument).
   * @param {object} opts
   * @param {string} opts.model              'chirp3-hd' | 'gemini-flash' | 'gemini-pro'
   * @param {string} opts.styleInstructions  Natural-language style
   *                                         prompt for Gemini models.
   *                                         Ignored if the model
   *                                         doesn't support prompts.
   * @param {string} opts.audioEncoding      'LINEAR16' (default — 16 kHz
   *                                         WAV with RIFF header) or
   *                                         'MULAW' (raw 8 kHz mu-law,
   *                                         no header — what Asterisk's
   *                                         `.ulaw` format expects).
   *                                         Sample rate is implicit from
   *                                         the encoding choice.
   */
  async generateAudio(text, language = DEFAULT_LANGUAGE, voice = DEFAULT_VOICE, opts = {}) {
    const modelKey = opts.model || DEFAULT_MODEL;
    const modelDef = MODELS[modelKey];
    if (!modelDef) {
      throw new Error(`Unknown TTS model: ${modelKey}. Valid: ${Object.keys(MODELS).join(', ')}`);
    }

    // Audio format selection. Default is MULAW @ 8 kHz (matches
    // Asterisk's G.711 mu-law no-transcode path — see the audio-format
    // comment block at the top of this file for the full rationale).
    // Callers can override with `opts.audioEncoding: 'LINEAR16'` to
    // get a 16 kHz WAV — used by the `/tts/preview` browser endpoint
    // since browsers can't play raw mu-law without a WAV container.
    const enc = (opts.audioEncoding || AUDIO_ENCODING).toUpperCase();
    const audioConfig = enc === 'LINEAR16'
      ? { audioEncoding: 'LINEAR16', sampleRateHertz: 16000 }
      : { audioEncoding: 'MULAW', sampleRateHertz: 8000 };

    let request;
    if (modelDef.geminiModelName) {
      // Gemini code path: voice name is bare (no lang prefix), model
      // identifier goes in `voice.modelName`, optional style prompt
      // goes in `input.prompt.promptText`.
      request = {
        input: { text },
        voice: {
          languageCode: language,
          name: voice,
          modelName: modelDef.geminiModelName
        },
        audioConfig
      };
      if (modelDef.supportsStyleInstructions && opts.styleInstructions && String(opts.styleInstructions).trim()) {
        request.input.prompt = { promptText: String(opts.styleInstructions).trim() };
      }
    } else {
      // Standard code path (Chirp 3 HD, legacy Wavenet/Studio/etc).
      request = {
        input: { text },
        voice: {
          languageCode: language,
          name: voice
        },
        audioConfig
      };
    }

    const [response] = await this.client.synthesizeSpeech(request);
    return response.audioContent;
  }

  async saveGreetingAudio(greetingId, text, language, voice, opts = {}) {
    await this.ensureDirectory();

    // One Google API call, TWO files on disk:
    //
    //   greeting_<id>.ulaw  — raw 8 kHz mu-law (for G.711 mu-law
    //                         channels, the American/SIP-softphone
    //                         default)
    //   greeting_<id>.alaw  — raw 8 kHz a-law (for G.711 a-law
    //                         channels, the European/Indian-PSTN
    //                         default — Tata trunk inbound)
    //
    // Google's MULAW response is wrapped in a RIFF/WAVE container,
    // and `format_g711.c` needs RAW bytes for both `.ulaw` and
    // `.alaw`. We strip the WAVE header to get raw mu-law, then
    // locally convert mu-law → a-law (deterministic byte-table
    // conversion, ~1 ms — no second Google API call needed).
    //
    // Without the .alaw sibling, an inbound call from a Tata-style
    // a-law trunk hits the greeting → Asterisk's Playback() looks
    // for .alaw first → not found → tries .wav → not present
    // (we don't write one) → silent failure. This was the V7
    // queue 5001 silent-greeting bug on 2026-05-13.
    const wrapped = await this.generateAudio(text, language, voice, opts);
    const rawMulaw = TTSService._stripWavHeader(wrapped);
    const rawAlaw = TTSService._mulawToAlaw(rawMulaw);

    const ulawName = `greeting_${greetingId}.ulaw`;
    const alawName = `greeting_${greetingId}.alaw`;
    await fs.writeFile(path.join(this.greetingsDir, ulawName), rawMulaw);
    await fs.writeFile(path.join(this.greetingsDir, alawName), rawAlaw);
    console.log(`✅ TTS audio saved: ${ulawName} + ${alawName} (${rawMulaw.length} bytes mu-law / ${rawAlaw.length} bytes a-law, model=${opts.model || DEFAULT_MODEL}, voice=${voice}, lang=${language})`);

    // Canonical `audio_file` value is the .ulaw name (the .alaw
    // sibling is derivable by extension swap). The dialplan
    // generator emits Playback() without an extension so Asterisk
    // auto-finds whichever codec matches the channel.
    return ulawName;
  }

  async deleteGreetingAudio(filename) {
    if (!filename) return;
    // Defensive: handle legacy `.wav` names that may still be stored
    // in the `audio_file` column from earlier iterations, AND remove
    // any orphan siblings (`.wav` from the dual-format iteration,
    // `.alaw` from the current ulaw+alaw write).
    const base = filename.replace(/\.(wav|ulaw|alaw)$/, '');
    const candidates = [
      path.join(this.greetingsDir, `${base}.ulaw`),
      path.join(this.greetingsDir, `${base}.alaw`),
      path.join(this.greetingsDir, `${base}.wav`),
    ];
    for (const f of candidates) {
      try {
        await fs.unlink(f);
        console.log(`🗑️  TTS audio deleted: ${f}`);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`⚠️  Failed to delete audio file: ${f}`, err.message);
        }
      }
    }
  }

  // Module-scoped voice cache. Google's voice inventory rarely
  // changes; the editor hits /tts/voices on every page open. 1h TTL.
  static _voiceCache = { fetchedAt: 0, voices: null };
  static _VOICE_CACHE_TTL_MS = 60 * 60 * 1000;

  /**
   * Fetch the canonical list of Google TTS voices, optionally filtered
   * to a set of language codes. Returns enriched entries with a derived
   * `model` field so callers can group by Chirp3-HD / WaveNet / etc.
   * Note: this hits the STANDARD TTS listVoices endpoint, which does
   * NOT return Gemini TTS voice names — those are language-agnostic
   * and tracked in the MODELS table above.
   */
  async listVoices({ languageCodes, force } = {}) {
    const now = Date.now();
    const cached = TTSService._voiceCache;
    let all;
    if (!force && cached.voices && (now - cached.fetchedAt) < TTSService._VOICE_CACHE_TTL_MS) {
      all = cached.voices;
    } else {
      const [resp] = await this.client.listVoices({});
      all = (resp.voices || []).map((v) => ({
        name: v.name,
        languageCodes: v.languageCodes,
        ssmlGender: v.ssmlGender,
        naturalSampleRateHertz: v.naturalSampleRateHertz,
        model: TTSService._deriveModel(v.name)
      }));
      TTSService._voiceCache = { fetchedAt: now, voices: all };
    }
    if (!Array.isArray(languageCodes) || languageCodes.length === 0) return all;
    const wanted = new Set(languageCodes);
    return all.filter((v) => v.languageCodes.some((lc) => wanted.has(lc)));
  }

  /**
   * Strip the RIFF/WAVE header from a WAV-wrapped audio buffer,
   * returning the raw payload bytes. Used to convert Google's
   * MULAW response (which is delivered inside a WAV container) into
   * the headerless raw mu-law byte stream that Asterisk's `.ulaw`
   * file format expects.
   *
   * If the buffer doesn't contain a `data` chunk marker we return
   * the buffer untouched — defensive against Google changing the
   * response shape in a future API revision.
   */
  static _stripWavHeader(buf) {
    if (!Buffer.isBuffer(buf)) return buf;
    const marker = Buffer.from('data', 'ascii');
    const idx = buf.indexOf(marker);
    if (idx < 0) return buf;
    // Skip the 'data' (4 bytes) + chunk size (4 bytes LE), then the
    // rest is raw audio samples.
    return buf.subarray(idx + 8);
  }

  /**
   * Convert raw 8 kHz mu-law bytes to raw 8 kHz a-law bytes.
   *
   * Implements the ITU-T G.711 mu-law → a-law byte translation
   * (lossless within G.711 quantization). Pure JS, no ffmpeg
   * subprocess — saves ~200 ms per greeting save.
   *
   * Table generated from the standard G.711 mu-law-to-linear and
   * linear-to-a-law tables; equivalent to `sox -t ul - -t al -`
   * or `ffmpeg -f mulaw -c:a pcm_alaw`. Verified byte-for-byte
   * against ffmpeg output on the system-prompts regen run.
   */
  static _mulawToAlaw(mulawBuf) {
    if (!TTSService._mulawToAlawTable) {
      // Build once and cache: decode each mu-law byte to 16-bit
      // linear PCM, then encode that sample to a-law.
      const ulawToLinear = (u) => {
        u = ~u & 0xff;
        const sign = u & 0x80;
        const exponent = (u >> 4) & 0x07;
        const mantissa = u & 0x0f;
        let sample = ((mantissa << 3) + 0x84) << exponent;
        sample -= 0x84;
        return sign ? -sample : sample;
      };
      const linearToAlaw = (pcm) => {
        // ITU-T G.711 a-law convention: in the *compressed* byte
        // before the 0x55 even-bit XOR, the sign bit is 1 for
        // POSITIVE samples and 0 for negative (opposite of mu-law).
        // After XOR 0x55 the sign bit isn't flipped (0x55 is even-
        // bit only), so on the wire bit-7 = 1 still means positive.
        const sign = pcm >= 0 ? 0x80 : 0x00;
        let abs = pcm < 0 ? -pcm : pcm;
        if (abs > 32635) abs = 32635;
        let exponent;
        if (abs >= 256) {
          exponent = 7;
          for (let mask = 0x4000; (abs & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
        } else {
          exponent = 0;
        }
        const mantissa = exponent === 0
          ? (abs >> 4) & 0x0f
          : (abs >> (exponent + 3)) & 0x0f;
        return (sign | (exponent << 4) | mantissa) ^ 0x55;
      };
      const table = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) table[i] = linearToAlaw(ulawToLinear(i));
      TTSService._mulawToAlawTable = table;
    }
    const table = TTSService._mulawToAlawTable;
    const out = Buffer.alloc(mulawBuf.length);
    for (let i = 0; i < mulawBuf.length; i++) out[i] = table[mulawBuf[i]];
    return out;
  }

  static _deriveModel(voiceName) {
    if (!voiceName) return 'Other';
    if (voiceName.includes('Chirp3-HD')) return 'Chirp3-HD';
    if (voiceName.includes('Chirp3')) return 'Chirp3';
    if (voiceName.includes('Studio')) return 'Studio';
    if (voiceName.includes('Neural2')) return 'Neural2';
    if (voiceName.includes('Wavenet')) return 'Wavenet';
    if (voiceName.includes('Standard')) return 'Standard';
    return 'Other';
  }
}

TTSService.MODELS = MODELS;
TTSService.DEFAULT_MODEL = DEFAULT_MODEL;
TTSService.DEFAULT_LANGUAGE = DEFAULT_LANGUAGE;
TTSService.DEFAULT_VOICE = DEFAULT_VOICE;
// audioEncoding + sampleRateHertz are deliberately NOT exposed as a
// per-greeting option — they're fixed at 24 kHz LINEAR16, decided
// once for the whole platform after looking at how Asterisk's
// `format_wav.c` resamples on the fly. Operators just pick a model +
// voice; the audio config is correct for every call leg.

module.exports = TTSService;
