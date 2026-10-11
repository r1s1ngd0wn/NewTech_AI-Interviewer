const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const SPEAK_ENDPOINT = "https://api.groq.com/openai/v1/audio/speech";
const MODEL = "whisper-large-v3-turbo";
const TTS_MODEL = "canopylabs/orpheus-v1-english";
const TIMEOUT_MS = 30000;

function status() {
  const enabled = Boolean((process.env.GROQ_API_KEY || "").trim());
  return { enabled, asrEnabled: enabled, ttsEnabled: enabled, provider: "groq", model: MODEL, ttsModel: TTS_MODEL };
}

async function groqRequest(url, body) {
  const apiKey = (process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) throw Object.assign(new Error("Cloud speech is not configured. Set GROQ_API_KEY in backend/.env."), { status: 503 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (data.error?.code === "model_terms_required") {
        throw Object.assign(new Error("Accept the Orpheus model terms in Groq Console before using cloud text-to-speech."), { status: 403 });
      }
      if (response.status === 429) {
        throw Object.assign(new Error("Groq speech quota reached. Try again later or type your answer."), { status: 429 });
      }
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error("Groq rejected the speech API key. Check GROQ_API_KEY in backend/.env."), { status: 502 });
      }
      throw Object.assign(new Error("Groq speech service could not process this request. Try again."), { status: 502 });
    }
    return response;
  } catch (error) {
    if (error.name === "AbortError") {
      throw Object.assign(new Error("Groq speech request timed out. Try again."), { status: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function filenameFor(mimeType) {
  const mime = mimeType.split(";")[0].trim().toLowerCase();
  const extensions = {
    "audio/webm": "webm",
    "audio/mp4": "mp4",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/flac": "flac",
  };
  const extension = extensions[mime];
  if (!extension) throw Object.assign(new Error("Unsupported audio format."), { status: 415 });
  return { mime, name: `answer.${extension}` };
}

async function transcribe(audio, mimeType) {
  if (!Buffer.isBuffer(audio) || audio.length === 0) {
    throw Object.assign(new Error("No audio was received."), { status: 400 });
  }
  const { mime, name } = filenameFor(mimeType || "");
  const form = new FormData();
  form.append("file", new Blob([audio], { type: mime }), name);
  form.append("model", MODEL);
  form.append("language", "en");
  form.append("response_format", "json");
  form.append("temperature", "0");

  try {
    const response = await groqRequest(ENDPOINT, form);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error("Groq could not transcribe this recording. Try again or type your answer."), { status: 502 });
    }
    const text = typeof data.text === "string" ? data.text.trim() : "";
    if (!text) throw Object.assign(new Error("No speech was detected. Try recording again or type your answer."), { status: 422 });
    return { text };
  } catch (error) {
    throw error;
  }
}

async function synthesize(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw Object.assign(new Error("Text is required for speech synthesis."), { status: 400 });
  }
  if (text.length > 200) {
    throw Object.assign(new Error("Cloud voice supports prompts up to 200 characters."), { status: 413 });
  }
  const response = await groqRequest(SPEAK_ENDPOINT, JSON.stringify({
    model: TTS_MODEL,
    input: text,
    voice: "hannah",
    response_format: "wav",
  }));
  return { audio: Buffer.from(await response.arrayBuffer()), contentType: "audio/wav" };
}

module.exports = { status, transcribe, synthesize };
