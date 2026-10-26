process.env.STORE_BACKEND = "memory";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const speech = require("../src/services/speechService");
const health = require("../src/services/aiHealth");
const { app } = require("../src/server");

function withEnv(t, values) {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  t.after(() => { process.env = saved; });
}
const groqOk = (text) => async () => ({ ok: true, status: 200, json: async () => ({ text }) });
const groqError = (status) => async () => ({ ok: false, status, json: async () => ({ error: { message: "x" } }) });

test("status: speech is only enabled when a Groq key is set, and never reveals the key", (t) => {
  withEnv(t, { GROQ_API_KEY: undefined });
  assert.equal(speech.status().enabled, false);
  process.env.GROQ_API_KEY = "gsk_not_a_real_key";
  const status = speech.status();
  assert.equal(status.enabled, true);
  assert.equal(status.model, "whisper-large-v3-turbo");
  assert.ok(!JSON.stringify(status).includes("gsk_not_a_real_key"));
});

test("transcribe: sends the audio to Groq Whisper with the key in a header, English, and no temperature randomness", async (t) => {
  withEnv(t, { GROQ_API_KEY: "gsk_not_a_real_key", GROQ_SPEECH_LANGUAGE: undefined });
  let request;
  t.mock.method(global, "fetch", async (url, init) => { request = { url, init }; return groqOk("  I led the project.  ")(); });
  assert.deepEqual(await speech.transcribe(Buffer.from("audio"), "audio/webm;codecs=opus"), { text: "I led the project." });
  assert.equal(request.url, "https://api.groq.com/openai/v1/audio/transcriptions");
  assert.ok(!request.url.includes("gsk_"));
  assert.equal(request.init.headers.Authorization, "Bearer gsk_not_a_real_key");
  const form = request.init.body;
  assert.equal(form.get("model"), "whisper-large-v3-turbo");
  assert.equal(form.get("language"), "en");
  assert.equal(form.get("temperature"), "0");
  assert.equal(form.get("file").name, "answer.webm");
});

test("transcribe: the language can be changed with GROQ_SPEECH_LANGUAGE", async (t) => {
  withEnv(t, { GROQ_API_KEY: "gsk_not_a_real_key", GROQ_SPEECH_LANGUAGE: "vi" });
  let language;
  t.mock.method(global, "fetch", async (url, init) => { language = init.body.get("language"); return groqOk("xin chao")(); });
  await speech.transcribe(Buffer.from("audio"), "audio/mp4");
  assert.equal(language, "vi");
});

test("transcribe: bad input is rejected before anything is sent to Groq", async (t) => {
  withEnv(t, { GROQ_API_KEY: "gsk_not_a_real_key" });
  let calls = 0;
  t.mock.method(global, "fetch", async () => { calls++; return groqOk("x")(); });
  await assert.rejects(speech.transcribe(Buffer.alloc(0), "audio/webm"), { status: 400 });
  await assert.rejects(speech.transcribe(Buffer.from("x"), "video/mp4"), { status: 415 });
  await assert.rejects(speech.transcribe(Buffer.from("x"), undefined), { status: 415 });
  await assert.rejects(speech.transcribe(Buffer.alloc(speech.MAX_AUDIO_BYTES + 1), "audio/webm"), { status: 413 });
  assert.equal(calls, 0);
});

test("transcribe: without a key the setup error is clear and nothing is sent", async (t) => {
  withEnv(t, { GROQ_API_KEY: undefined });
  let calls = 0;
  t.mock.method(global, "fetch", async () => { calls++; });
  await assert.rejects(speech.transcribe(Buffer.from("x"), "audio/webm"), { status: 503, message: /GROQ_API_KEY/ });
  assert.equal(calls, 0);
});

test("transcribe: Groq failures become short messages the page can show, and the key never leaks into them", async (t) => {
  withEnv(t, { GROQ_API_KEY: "gsk_not_a_real_key" });
  let behaviour;
  t.mock.method(global, "fetch", async (...args) => behaviour(...args));
  const rejects = (expected) => assert.rejects(speech.transcribe(Buffer.from("x"), "audio/webm"), (error) => {
    assert.equal(error.status, expected.status); assert.match(error.message, expected.message); assert.ok(!error.message.includes("gsk_")); return true;
  });
  behaviour = groqError(429); await rejects({ status: 429, message: /quota/ });
  behaviour = groqError(401); await rejects({ status: 502, message: /rejected the API key/ });
  behaviour = groqError(500); await rejects({ status: 502, message: /could not transcribe/ });
  behaviour = async () => { throw new TypeError("fetch failed"); }; await rejects({ status: 502, message: /Could not reach/ });
  behaviour = groqOk("   "); await rejects({ status: 422, message: /No speech/ });
});

test("transcribe: a Groq outage does not mark the text AI as unavailable in the health banner", async (t) => {
  withEnv(t, { GROQ_API_KEY: "gsk_not_a_real_key", GEMINI_API_KEY: "k", LLM_PROVIDER: "gemini" });
  health.recordSuccess();
  t.mock.method(global, "fetch", groqError(500));
  await assert.rejects(speech.transcribe(Buffer.from("x"), "audio/webm"));
  assert.equal(health.status().state, "available");
});

test("HTTP: login is required, only audio is accepted, and the page can read the status", async (t) => {
  withEnv(t, { GROQ_API_KEY: "gsk_not_a_real_key" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const registered = await fetch(`${base}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Speech", email: "speech@test.dev", password: "secret1" }) });
  const { token } = await registered.json();
  const auth = { Authorization: `Bearer ${token}` };

  assert.equal((await fetch(`${base}/speech/status`)).status, 401);
  assert.equal((await fetch(`${base}/speech/transcribe`, { method: "POST", headers: { "Content-Type": "audio/webm" }, body: Buffer.from("x") })).status, 401);
  const status = await (await fetch(`${base}/speech/status`, { headers: auth })).json();
  assert.equal(status.enabled, true);

  const notAudio = await fetch(`${base}/speech/transcribe`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ a: 1 }) });
  assert.equal(notAudio.status, 415);

  const real = global.fetch;
  t.mock.method(global, "fetch", async (url, init) => String(url).includes("api.groq.com") ? groqOk("My answer.")() : real(url, init));
  const ok = await fetch(`${base}/speech/transcribe`, { method: "POST", headers: { ...auth, "Content-Type": "audio/webm;codecs=opus" }, body: Buffer.from("audio bytes") });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { text: "My answer." });
});
