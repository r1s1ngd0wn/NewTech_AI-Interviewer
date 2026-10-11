const test = require("node:test");
const assert = require("node:assert/strict");

const speech = require("../src/services/speechService");

const originalFetch = global.fetch;
const originalKey = process.env.GROQ_API_KEY;

test.afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalKey;
});

test("transcribes English audio through Groq without exposing the key in the URL", async () => {
  process.env.GROQ_API_KEY = "test-key-not-real";
  let request;
  global.fetch = async (url, init) => {
    request = { url, init };
    return { ok: true, status: 200, json: async () => ({ text: "I led the project." }) };
  };

  const result = await speech.transcribe(Buffer.from("audio"), "audio/webm;codecs=opus");

  assert.deepEqual(result, { text: "I led the project." });
  assert.equal(request.url, "https://api.groq.com/openai/v1/audio/transcriptions");
  assert.equal(request.init.headers.Authorization, "Bearer test-key-not-real");
  const form = request.init.body;
  assert.equal(form.get("model"), "whisper-large-v3-turbo");
  assert.equal(form.get("language"), "en");
  assert.equal(form.get("file").name, "answer.webm");
});

test("transcription reports a clear setup error when no Groq key is configured", async () => {
  delete process.env.GROQ_API_KEY;
  await assert.rejects(
    speech.transcribe(Buffer.from("audio"), "audio/webm"),
    /Set GROQ_API_KEY in backend\/\.env/
  );
});

test("transcription translates Groq quota failures into a useful message", async () => {
  process.env.GROQ_API_KEY = "test-key-not-real";
  global.fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { message: "Rate limit reached" } }),
  });

  await assert.rejects(speech.transcribe(Buffer.from("audio"), "audio/webm"), /Groq speech quota reached/);
});

test("synthesizes short English interviewer prompts with Groq Orpheus", async () => {
  process.env.GROQ_API_KEY = "test-key-not-real";
  let request;
  global.fetch = async (url, init) => {
    request = { url, init };
    return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from([82, 73, 70, 70]).buffer };
  };

  const result = await speech.synthesize("Tell me about a project you led.");

  assert.equal(request.url, "https://api.groq.com/openai/v1/audio/speech");
  assert.equal(request.init.headers.Authorization, "Bearer test-key-not-real");
  assert.deepEqual(JSON.parse(request.init.body), {
    model: "canopylabs/orpheus-v1-english",
    input: "Tell me about a project you led.",
    voice: "hannah",
    response_format: "wav",
  });
  assert.deepEqual([...new Uint8Array(result.audio)], [82, 73, 70, 70]);
});

test("rejects TTS prompts above Groq Orpheus's 200 character limit", async () => {
  process.env.GROQ_API_KEY = "test-key-not-real";
  await assert.rejects(speech.synthesize("x".repeat(201)), /up to 200 characters/);
});

test("explains when Groq requires accepting Orpheus terms", async () => {
  process.env.GROQ_API_KEY = "test-key-not-real";
  global.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { code: "model_terms_required" } }),
  });

  await assert.rejects(speech.synthesize("Tell me about your experience."), /Accept the Orpheus model terms/);
});
