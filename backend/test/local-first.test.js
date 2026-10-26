process.env.STORE_BACKEND = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

const { providers } = require("../src/services/llmProviders");
const llm = require("../src/services/llmService");
const health = require("../src/services/aiHealth");
const { toOpenAiMessages, toOpenAiTools } = require("../src/services/localToolClient");

function withEnv(t, values) {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  t.after(() => { process.env = saved; });
}

const sse = (events) => Readable.from([Buffer.from(events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join(""))]);
const streamResponse = (events) => ({ ok: true, status: 200, body: sse(events), json: async () => null });
const jsonResponse = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const isLocal = (url) => String(url).startsWith("http://localhost:1234");
const geminiText = (text) => jsonResponse({ candidates: [{ content: { role: "model", parts: [{ text }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } });
const localText = (text) => jsonResponse({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 3, completion_tokens: 2 } });
const down = () => { throw new TypeError("fetch failed"); };

test("providers: Gemma first with Gemini behind it, and the old single-provider settings still work", (t) => {
  withEnv(t, { GEMINI_API_KEY: "k", LLM_PROVIDER: "local,gemini" });
  assert.deepEqual(providers(), ["local", "gemini"]);
  process.env.LLM_PROVIDER = " Gemini , LOCAL ";
  assert.deepEqual(providers(), ["gemini", "local"]);
  process.env.LLM_PROVIDER = "local";
  assert.deepEqual(providers(), ["local"]);
  process.env.LLM_PROVIDER = "";
  assert.deepEqual(providers(), ["gemini"]);
  process.env.LLM_PROVIDER = "none";
  assert.deepEqual(providers(), []);
  process.env.LLM_PROVIDER = "local,none";
  assert.deepEqual(providers(), []);
  process.env.LLM_PROVIDER = "local,local,mystery";
  assert.deepEqual(providers(), ["local"]);
});

test("providers: Gemini needs a key to count, local does not", (t) => {
  withEnv(t, { GEMINI_API_KEY: "", LLM_PROVIDER: "local,gemini" });
  assert.deepEqual(providers(), ["local"]);
  process.env.LLM_PROVIDER = "gemini";
  assert.deepEqual(providers(), []);
  process.env.LLM_PROVIDER = "";
  assert.deepEqual(providers(), []);
});

test("health: a local-first setup without a Gemini key is configured, not 'unconfigured'", (t) => {
  withEnv(t, { GEMINI_API_KEY: "", LLM_PROVIDER: "local" });
  assert.notEqual(health.status().state, "unconfigured");
  process.env.LLM_PROVIDER = "none";
  assert.equal(health.status().state, "unconfigured");
});

test("health: an observation made under one provider setup is not reported under another", (t) => {
  withEnv(t, { GEMINI_API_KEY: "k", LLM_PROVIDER: "gemini" });
  health.recordFailure({ upstreamStatus: 429 });
  assert.equal(health.status().reason, "quota");
  process.env.LLM_PROVIDER = "local,gemini";
  assert.equal(health.status().state, "unknown");
});

test("generate: falls back to Gemini when the local server is down, and says nothing else changed", async (t) => {
  withEnv(t, { GEMINI_API_KEY: "k", LLM_PROVIDER: "local,gemini", LOCAL_LLM_MODEL: "gemma-4" });
  const urls = [];
  t.mock.method(global, "fetch", async (url) => { urls.push(String(url)); return isLocal(url) ? down() : geminiText("from gemini"); });
  assert.equal(await llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] }), "from gemini");
  assert.equal(urls.length, 2);
  assert.ok(isLocal(urls[0]));
});

test("generate: Gemma answers and Gemini is never called when the local server is up", async (t) => {
  withEnv(t, { GEMINI_API_KEY: "k", LLM_PROVIDER: "local,gemini", LOCAL_LLM_MODEL: "gemma-4" });
  const urls = [];
  t.mock.method(global, "fetch", async (url) => { urls.push(String(url)); return localText("from gemma"); });
  assert.equal(await llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] }), "from gemma");
  assert.equal(urls.length, 1);
});

test("generate: when both providers fail the caller sees the last error", async (t) => {
  withEnv(t, { GEMINI_API_KEY: "k", LLM_PROVIDER: "local,gemini", LOCAL_LLM_MODEL: "gemma-4" });
  t.mock.method(global, "fetch", async (url) => (isLocal(url) ? down() : jsonResponse({ error: { message: "quota" } }, 429)));
  await assert.rejects(llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] }), { upstreamStatus: 429 });
});

test("generate: with no usable provider the error says the LLM is not configured or disabled", async (t) => {
  withEnv(t, { GEMINI_API_KEY: "", LLM_PROVIDER: "gemini" });
  await assert.rejects(llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] }), { code: "not_configured", message: /disabled/ });
});

test("generateJson: invalid JSON from Gemma is retried once, then Gemini answers", async (t) => {
  withEnv(t, { GEMINI_API_KEY: "k", LLM_PROVIDER: "local,gemini", LOCAL_LLM_MODEL: "gemma-4" });
  let local = 0;
  t.mock.method(global, "fetch", async (url) => {
    if (isLocal(url)) { local++; return localText("not json at all"); }
    return geminiText('{"ok":true}');
  });
  const value = await llm.generateJson({ system: "s", messages: [{ role: "user", text: "q" }], validate: (json) => json });
  assert.deepEqual(value, { ok: true });
  assert.equal(local, 2);
});

test("generateJson: the scripted fallback is used only after every provider failed", async (t) => {
  withEnv(t, { GEMINI_API_KEY: "k", LLM_PROVIDER: "local,gemini", LOCAL_LLM_MODEL: "gemma-4" });
  const urls = [];
  t.mock.method(global, "fetch", async (url) => { urls.push(String(url)); return isLocal(url) ? down() : geminiText('{"from":"gemini"}'); });
  const fallback = () => ({ from: "script" });
  assert.deepEqual(await llm.generateJson({ system: "s", messages: [{ role: "user", text: "q" }], validate: (j) => j, fallback }), { from: "gemini" });
  t.mock.method(global, "fetch", async () => down());
  assert.deepEqual(await llm.generateJson({ system: "s", messages: [{ role: "user", text: "q" }], validate: (j) => j, fallback }), { from: "script" });
});

test("generateJson: with nothing configured the scripted fallback still applies", async (t) => {
  withEnv(t, { GEMINI_API_KEY: "", LLM_PROVIDER: "none" });
  assert.deepEqual(await llm.generateJson({ system: "s", messages: [], fallback: { from: "script" } }), { from: "script" });
});

test("a cancelled request is not retried on the next provider", async (t) => {
  withEnv(t, { GEMINI_API_KEY: "k", LLM_PROVIDER: "local,gemini", LOCAL_LLM_MODEL: "gemma-4" });
  const controller = new AbortController();
  const urls = [];
  t.mock.method(global, "fetch", async (url) => { urls.push(String(url)); controller.abort(); throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
  await assert.rejects(llm.generateWithTools({ system: "s", contents: [{ role: "user", parts: [{ text: "x" }] }], tools: [], signal: controller.signal }));
  assert.equal(urls.length, 1);
});

test("stream: a local failure before any text falls back to Gemini; after text it does not", async (t) => {
  withEnv(t, { GEMINI_API_KEY: "k", LLM_PROVIDER: "local,gemini", LOCAL_LLM_MODEL: "gemma-4" });
  const gemini = () => streamResponse([{ candidates: [{ content: { parts: [{ text: "gemini says hi" }] } }] }]);
  t.mock.method(global, "fetch", async (url) => (isLocal(url) ? down() : gemini()));
  let out = "";
  for await (const piece of llm.generateStream({ system: "s", messages: [{ role: "user", text: "hi" }] })) out += piece;
  assert.equal(out, "gemini says hi");

  const calls = [];
  t.mock.method(global, "fetch", async (url) => {
    calls.push(String(url));
    if (!isLocal(url)) return gemini();
    return streamResponse([{ choices: [{ delta: { content: "half an" } }] }, "not-json-but-skipped", { error: { code: 500 } }]);
  });
  let partial = "";
  await assert.rejects(async () => { for await (const piece of llm.generateStream({ system: "s", messages: [{ role: "user", text: "hi" }] })) partial += piece; });
  assert.equal(partial, "half an");
  assert.equal(calls.length, 1);
});

test("tools: Gemma's tool call comes back in the shape agent.js expects, with the call id kept", async (t) => {
  withEnv(t, { GEMINI_API_KEY: "", LLM_PROVIDER: "local", LOCAL_LLM_MODEL: "gemma-4" });
  let request;
  t.mock.method(global, "fetch", async (url, init) => {
    request = { url: String(url), body: JSON.parse(init.body) };
    return streamResponse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_9", function: { name: "search_knowl", arguments: '{"que' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "edge", arguments: 'ry":"postgres"}' } }] } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 11, completion_tokens: 4 } },
      "[DONE]",
    ]);
  });
  const declarations = [{ name: "search_knowledge", description: "d", parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] } }];
  const result = await llm.generateWithTools({ system: "sys", contents: [{ role: "user", parts: [{ text: "which project?" }] }], tools: declarations, meta: { capability: "coach" } });
  assert.deepEqual(result.calls, [{ id: "call_9", name: "search_knowledge", args: { query: "postgres" } }]);
  assert.deepEqual(result.content, { role: "model", parts: [{ functionCall: { id: "call_9", name: "search_knowledge", args: { query: "postgres" } } }] });
  assert.equal(request.url, "http://localhost:1234/v1/chat/completions");
  assert.equal(request.body.tools[0].function.parameters.type, "object");
  assert.equal(request.body.tools[0].function.parameters.properties.query.type, "string");
  assert.equal(request.body.stream, true);
});

test("tools: streamed text reaches onToken without reasoning, and a tool call stops further text", async (t) => {
  withEnv(t, { GEMINI_API_KEY: "", LLM_PROVIDER: "local", LOCAL_LLM_MODEL: "gemma-4" });
  t.mock.method(global, "fetch", async () => streamResponse([
    { choices: [{ delta: { content: "<think>plan</think>Your weakest " } }] },
    { choices: [{ delta: { content: "area is Relevance." } }] },
    "[DONE]",
  ]));
  const seen = [];
  const result = await llm.generateWithTools({ system: "s", contents: [{ role: "user", parts: [{ text: "x" }] }], tools: [], onToken: (text) => seen.push(text) });
  assert.equal(seen.join(""), "Your weakest area is Relevance.");
  assert.equal(result.text, "Your weakest area is Relevance.");
  assert.deepEqual(result.calls, []);
});

test("tools: an empty reply, bad tool arguments and a refused connection are all errors", async (t) => {
  withEnv(t, { GEMINI_API_KEY: "", LLM_PROVIDER: "local", LOCAL_LLM_MODEL: "gemma-4" });
  const ask = () => llm.generateWithTools({ system: "s", contents: [{ role: "user", parts: [{ text: "x" }] }], tools: [] });
  t.mock.method(global, "fetch", async () => streamResponse(["[DONE]"]));
  await assert.rejects(ask(), { code: "empty_response" });
  t.mock.method(global, "fetch", async () => streamResponse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "list_sessions", arguments: "{oops" } }] } }] }]));
  await assert.rejects(ask(), { code: "invalid_json" });
  t.mock.method(global, "fetch", async () => down());
  await assert.rejects(ask(), { code: "unreachable" });
  t.mock.method(global, "fetch", async () => jsonResponse({}, 500));
  await assert.rejects(ask(), { upstreamStatus: 500 });
});

test("tools: Gemma first, Gemini behind it, and no fallback once text has reached the user", async (t) => {
  withEnv(t, { GEMINI_API_KEY: "k", LLM_PROVIDER: "local,gemini", LOCAL_LLM_MODEL: "gemma-4" });
  const contents = [{ role: "user", parts: [{ text: "x" }] }];
  t.mock.method(global, "fetch", async (url) => (isLocal(url) ? down() : geminiText("gemini answer")));
  assert.equal((await llm.generateWithTools({ system: "s", contents, tools: [] })).text, "gemini answer");

  const urls = [];
  t.mock.method(global, "fetch", async (url) => {
    urls.push(String(url));
    return isLocal(url) ? streamResponse([{ choices: [{ delta: { content: "partial" } }] }, { error: { code: 500 } }]) : geminiText("late");
  });
  const seen = [];
  await assert.rejects(llm.generateWithTools({ system: "s", contents, tools: [], onToken: (text) => seen.push(text) }));
  assert.deepEqual(seen, ["partial"]);
  assert.equal(urls.length, 1);
});

test("conversion: tool results are paired with their calls by id, or by name when the id is missing", () => {
  const messages = toOpenAiMessages("sys", [
    { role: "user", parts: [{ text: "plan please" }] },
    { role: "model", parts: [{ functionCall: { id: "c1", name: "search_scenarios", args: { role: "x" } } }, { functionCall: { name: "list_sessions", args: {} } }] },
    { role: "user", parts: [
      { functionResponse: { name: "list_sessions", response: { data: [] } } },
      { functionResponse: { id: "c1", name: "search_scenarios", response: { data: ["s"] } } },
    ] },
  ]);
  assert.equal(messages[0].role, "system");
  const assistant = messages.find((m) => m.role === "assistant");
  assert.equal(assistant.tool_calls.length, 2);
  assert.deepEqual(JSON.parse(assistant.tool_calls[0].function.arguments), { role: "x" });
  const tools = messages.filter((m) => m.role === "tool");
  const generated = assistant.tool_calls[1].id;
  assert.deepEqual(tools.map((m) => m.tool_call_id), [generated, "c1"]);
});

test("conversion: schema types are lower-cased all the way down", () => {
  const [tool] = toOpenAiTools([{ name: "n", description: "d", parameters: { type: "OBJECT", properties: { items: { type: "ARRAY", items: { type: "OBJECT", properties: { d: { type: "STRING", enum: ["a"] } } } } } } }]);
  assert.equal(tool.type, "function");
  assert.equal(tool.function.parameters.properties.items.items.properties.d.type, "string");
  assert.deepEqual(tool.function.parameters.properties.items.items.properties.d.enum, ["a"]);
});
