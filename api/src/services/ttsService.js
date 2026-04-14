const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs').promises;
const path = require('path');

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

  async generateAudio(text, language = 'en-IN', voice = 'en-IN-Wavenet-D') {
    const request = {
      input: { text },
      voice: {
        languageCode: language,
        name: voice
      },
      audioConfig: {
        audioEncoding: 'LINEAR16',
        sampleRateHertz: 8000
      }
    };

    const [response] = await this.client.synthesizeSpeech(request);
    return response.audioContent;
  }

  async saveGreetingAudio(greetingId, text, language, voice) {
    await this.ensureDirectory();

    const audioContent = await this.generateAudio(text, language, voice);
    const filename = `greeting_${greetingId}.wav`;
    const filepath = path.join(this.greetingsDir, filename);

    await fs.writeFile(filepath, audioContent);
    console.log(`✅ TTS audio saved: ${filepath}`);

    return filename;
  }

  async deleteGreetingAudio(filename) {
    if (!filename) return;
    const filepath = path.join(this.greetingsDir, filename);
    try {
      await fs.unlink(filepath);
      console.log(`🗑️  TTS audio deleted: ${filepath}`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`⚠️  Failed to delete audio file: ${filepath}`, err.message);
      }
    }
  }
}

module.exports = TTSService;
