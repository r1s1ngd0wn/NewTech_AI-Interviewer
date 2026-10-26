// Cloud speech-to-text for interview answers, through Groq's hosted Whisper model.
//
// The browser's own speech recognition mishears accented English, so when GROQ_API_KEY is set the
// page records the answer, sends the audio here, and gets the text back for the user to check and
// edit. Without a key nothing changes: the page keeps using the browser's recogniser. Audio is
// forwarded once and never stored. Each request is logged like every other AI call (capability
// "speech"), without the audio or the text.

const { trackAiRequest } = require("./aiTelemetry");

const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = "whisper-large-v3-turbo";
const TIMEOUT_MS = 30000;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const EXTENSIONS = {
  "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/flac": "flac",
};

const fail = (message, status) => Object.assign(new Error(message), { status });
const apiKey = () => (process.env.GROQ_API_KEY || "").trim();

function status() {
  return { enabled: Boolean(apiKey()), asrEnabled: Boolean(apiKey()), provider: "groq", model: MODEL, maxBytes: MAX_AUDIO_BYTES };
}

function describe(mimeType) {
  const mime = String(mimeType || "").split(";")[0].trim().toLowerCase();
  const extension = EXTENSIONS[mime];
  if (!extension) throw fail("Unsupported audio format. Type your answer instead.", 415);
  return { mime, name: `answer.${extension}` };
}

async function transcribe(audio, mimeType) {
  if (!apiKey()) throw fail("Cloud speech is not configured. Set GROQ_API_KEY in backend/.env.", 503);
  if (!Buffer.isBuffer(audio) || audio.length === 0) throw fail("No audio was received.", 400);
  if (audio.length > MAX_AUDIO_BYTES) throw fail("The recording is too long. Record a shorter answer or type it.", 413);
  const { mime, name } = describe(mimeType);
  const form = new FormData();
  form.append("file", new Blob([audio], { type: mime }), name);
  form.append("model", MODEL);
  form.append("language", (process.env.GROQ_SPEECH_LANGUAGE || "en").trim() || "en");
  form.append("response_format", "json");
  form.append("temperature", "0");

  return trackAiRequest({ capability: "speech", provider: "groq", model: MODEL, operation: "transcribe" }, async (note) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${apiKey()}` }, body: form, signal: controller.signal });
      note({ provider_status: response.status });
      if (!response.ok) {
        if (response.status === 429) throw fail("Groq speech quota reached. Try again in a moment or type your answer.", 429);
        if (response.status === 401 || response.status === 403) throw fail("Groq rejected the API key. Check GROQ_API_KEY in backend/.env.", 502);
        throw fail("Groq could not transcribe this recording. Try again or type your answer.", 502);
      }
      const data = await response.json().catch(() => ({}));
      const text = typeof data.text === "string" ? data.text.trim() : "";
      if (!text) throw fail("No speech was detected. Try recording again or type your answer.", 422);
      return { text };
    } catch (error) {
      if (error.name === "AbortError") throw fail("The speech service took too long. Try again or type your answer.", 504);
      if (!error.status) throw fail("Could not reach the speech service. Type your answer instead.", 502);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  });
}

module.exports = { status, transcribe, MODEL, MAX_AUDIO_BYTES };
