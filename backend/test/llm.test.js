process.env.STORE_BACKEND = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");

const llm = require("../src/services/llmService");
const auth = require("../src/services/authService");
const sessions = require("../src/services/sessionService");
const chat = require("../src/services/chatService");
const scenarios = require("../src/data/scenarios.json");

const SCENARIO_ID = "scn_swe_junior_behavioral";
const ANSWER = "I have experience in this role and a project I am proud of because of the result.";
const realFetch = global.fetch;

let calls;
function stubGemini(handler) {
  calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined });
    return handler(calls[calls.length - 1]);
  };
}
function geminiOk(text) {
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
}
function enable() {
  process.env.GEMINI_API_KEY = "test-key-not-real";
  process.env.GEMINI_MODEL = "test-model";
}
function disable() {
  for (const name of ["GEMINI_API_KEY", "GEMINI_MODEL", "LLM_PROVIDER", "LOCAL_LLM_URL", "LOCAL_LLM_MODEL", "LOCAL_LLM_API_KEY"]) {
    delete process.env[name];
  }
  global.fetch = realFetch;
}
function enableLocal(extra = {}) {
  process.env.LLM_PROVIDER = "local";
  Object.assign(process.env, extra);
}
function localOk(content) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { role: "assistant", content } }] }) };
}

let counter = 0;
async function scoredSession(scenarioId = SCENARIO_ID) {
  counter += 1;
  const { user } = await auth.register({ email: `llm${counter}@test.dev`, password: "secret1", name: "LLM Tester" });
  const { session } = await sessions.startSession(user.id, scenarioId);
  const total = scenarios.find((s) => s.id === scenarioId).questions.length;
  for (let i = 0; i < total; i++) await sessions.submitAnswer(user.id, session.id, ANSWER);
  await sessions.finishSession(user.id, session.id);
  return { userId: user.id, sessionId: session.id };
}

test.afterEach(disable);

test("the LLM is off without a key", () => {
  assert.equal(llm.isEnabled(), false);
  assert.deepEqual(llm.status(), { enabled: false });
});

test("generate() sends the key in a header, never in the URL, and parses the answer", async () => {
  enable();
  stubGemini(() => geminiOk("  Hello there.  "));
  const text = await llm.generate({ system: "be brief", messages: [{ role: "user", text: "hi" }] });
  assert.equal(text, "Hello there.");
  assert.equal(calls[0].init.headers["x-goog-api-key"], "test-key-not-real");
  assert.equal(calls[0].url.includes("test-key-not-real"), false);
  assert.ok(calls[0].url.includes("/test-model:generateContent"));
  assert.equal(calls[0].body.systemInstruction.parts[0].text, "be brief");
});

test("conversation is sent as alternating turns that start with the user", async () => {
  enable();
  stubGemini(() => geminiOk("ok"));
  await llm.generate({
    system: "s",
    messages: [
      { role: "assistant", text: "welcome" },
      { role: "user", text: "one" },
      { role: "user", text: "two" },
      { role: "assistant", text: "reply" },
      { role: "user", text: "three" },
    ],
  });
  const roles = calls[0].body.contents.map((c) => c.role);
  assert.deepEqual(roles, ["user", "model", "user"]);
  assert.equal(calls[0].body.contents[0].parts[0].text, "one\ntwo");
});

test("upstream errors become readable messages without leaking the key", async () => {
  enable();
  stubGemini(() => ({ ok: false, status: 400, json: async () => ({ error: { message: "API key not valid." } }) }));
  await assert.rejects(
    llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] }),
    (err) => /400/.test(err.message) && /API key not valid/.test(err.message) && !err.message.includes("test-key-not-real")
  );
});

test("empty and blocked answers are errors", async () => {
  enable();
  stubGemini(() => ({ ok: true, status: 200, json: async () => ({ candidates: [] }) }));
  await assert.rejects(llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] }), /empty/);
  stubGemini(() => ({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: "SAFETY" } }) }));
  await assert.rejects(llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] }), /blocked/);
});

test("chat uses Gemini when enabled and grounds the prompt in the transcript and final scores", async () => {
  const { userId, sessionId } = await scoredSession();
  enable();
  stubGemini(() => geminiOk("Your relevance was the weakest area."));
  const reply = (await chat.postMessage(userId, sessionId, "what went wrong?")).at(-1);

  assert.equal(reply.text, "Your relevance was the weakest area.");
  assert.equal(reply.source, "gemini");
  const prompt = calls[0].body.systemInstruction.parts[0].text;
  assert.ok(prompt.includes(ANSWER), "transcript answers are in the prompt");
  assert.ok(prompt.includes(scenarios[0].questions[0].text), "question text is in the prompt");
  assert.match(prompt, /RUBRIC RESULT \(final\)/);
  assert.match(prompt, /Overall: \d+\/100/);
  for (const q of scenarios[0].questions) {
    assert.equal(prompt.includes(JSON.stringify(q.keywords)), false, "the relevance answer key must not reach the model");
    assert.equal(prompt.includes(q.keywords.join(", ")), false, "the relevance answer key must not reach the model");
  }
});

test("chat falls back to scripted answers and says why when Gemini fails", async () => {
  const { userId, sessionId } = await scoredSession();
  enable();
  stubGemini(() => ({ ok: false, status: 429, json: async () => ({ error: { message: "quota exceeded" } }) }));
  const reply = (await chat.postMessage(userId, sessionId, "tell me about my strengths")).at(-1);

  assert.equal(reply.source, "scripted");
  assert.match(reply.fallbackReason, /429/);
  assert.match(reply.text, /strongest|solid/);
});

test("interviewer reaction comes from Gemini but the next question stays from the scenario", async () => {
  counter += 1;
  const { user } = await auth.register({ email: `llm${counter}@test.dev`, password: "secret1", name: "R" });
  const { session } = await sessions.startSession(user.id, SCENARIO_ID);
  enable();
  stubGemini(() => geminiOk("Thanks, that background is a good fit for the team."));
  const { next } = await sessions.answerTurn(user.id, session.id, ANSWER);

  assert.equal(next.reaction, "Thanks, that background is a good fit for the team.");
  assert.equal(next.reactionSource, "gemini");
  assert.equal(next.text, scenarios[0].questions[1].text);
});

test("a generated reaction that asks a question is rejected in favour of the scripted one", async () => {
  counter += 1;
  const { user } = await auth.register({ email: `llm${counter}@test.dev`, password: "secret1", name: "R" });
  const { session } = await sessions.startSession(user.id, SCENARIO_ID);
  enable();
  stubGemini(() => geminiOk("Interesting. Can you tell me more about that?"));
  const { next } = await sessions.answerTurn(user.id, session.id, ANSWER);

  assert.equal(next.reactionSource, "scripted");
  assert.equal(next.reaction.includes("?"), false);
  assert.equal(next.text, scenarios[0].questions[1].text);
});

test("answerTurn behaves exactly like submitAnswer when the LLM is off", async () => {
  counter += 1;
  const { user } = await auth.register({ email: `llm${counter}@test.dev`, password: "secret1", name: "R" });
  const { session } = await sessions.startSession(user.id, SCENARIO_ID);
  let fetched = false;
  global.fetch = async () => {
    fetched = true;
    throw new Error("should not be called");
  };
  const { next } = await sessions.answerTurn(user.id, session.id, ANSWER);
  assert.equal(fetched, false);
  assert.equal(next.reactionSource, "scripted");
});

const WEB = scenarios.find((s) => s.id === "scn_swe_junior_web");

test("the prompt carries each question's key points and forbids outside knowledge", async () => {
  const { userId, sessionId } = await scoredSession(WEB.id);
  enable();
  stubGemini(() => geminiOk("You covered the URL point but not the request body."));
  await chat.postMessage(userId, sessionId, "what did I miss on question 1?");

  const prompt = calls[0].body.systemInstruction.parts[0].text;
  for (const q of WEB.questions) {
    assert.ok(prompt.includes(`Key points from the question bank: ${q.referenceAnswer}`), q.id);
  }
  assert.match(prompt, /Do not add technical facts, definitions or examples from your own knowledge/);
  assert.match(prompt, /outside the question bank material/);
});

test("questions without key points are marked so the model does not improvise", async () => {
  const { userId, sessionId } = await scoredSession();
  enable();
  stubGemini(() => geminiOk("ok"));
  await chat.postMessage(userId, sessionId, "hi");
  assert.match(calls[0].body.systemInstruction.parts[0].text, /Key points from the question bank: \(none for this question\)/);
});

test("quotes are checked against the transcript, question and key points", () => {
  const context = { session: { turns: [{ questionId: WEB.questions[0].id, answerText: "GET reads data and POST sends data in the body." }] }, scenario: WEB, feedback: { criteria: [], strengths: [], improvements: [] } };
  const sources = chat.quotableText(context);
  assert.deepEqual(chat.findUngroundedQuotes('You said "POST sends data in the body" which is right.', sources), []);
  assert.deepEqual(chat.findUngroundedQuotes('You said "GET is always faster than POST" which is wrong.', sources), ["GET is always faster than POST"]);
  assert.deepEqual(chat.findUngroundedQuotes('The bank mentions "retrieve data and include parameters in the URL".', sources), []);
  assert.deepEqual(chat.findUngroundedQuotes('Short quotes like "data" are ignored.', sources), []);
  assert.deepEqual(chat.findUngroundedQuotes('You said "GET reads data ... in the body".', sources), []);
});

test("a reply with an invented quote is retried once with the problem pointed out", async () => {
  const { userId, sessionId } = await scoredSession(WEB.id);
  enable();
  let n = 0;
  stubGemini(() => geminiOk(++n === 1 ? 'You said "I always use PUT for everything" which is risky.' : "You gave a short answer with no examples."));
  const reply = (await chat.postMessage(userId, sessionId, "how was my answer?")).at(-1);

  assert.equal(calls.length, 2);
  assert.equal(reply.source, "gemini");
  assert.equal(reply.text, "You gave a short answer with no examples.");
  const correction = calls[1].body.contents.at(-1).parts[0].text;
  assert.ok(correction.includes("I always use PUT for everything"));
});

test("a model that keeps inventing quotes is replaced by the data-only scripted answer", async () => {
  const { userId, sessionId } = await scoredSession(WEB.id);
  enable();
  stubGemini(() => geminiOk('You said "I deployed it on a spaceship yesterday" earlier.'));
  const reply = (await chat.postMessage(userId, sessionId, "what did I miss on question 1?")).at(-1);

  assert.equal(calls.length, 2);
  assert.equal(reply.source, "scripted");
  assert.match(reply.fallbackReason, /quoted text that is not in your transcript/);
  assert.ok(reply.text.includes(WEB.questions[0].referenceAnswer));
});

test("the scripted answer to 'what did I miss' is the question bank's key points", async () => {
  const { userId, sessionId } = await scoredSession(WEB.id);
  const one = (await chat.postMessage(userId, sessionId, "what did I miss on the second question")).at(-1).text;
  assert.ok(one.includes(WEB.questions[1].referenceAnswer));
  assert.equal(one.includes(WEB.questions[0].referenceAnswer), false);
  const all = (await chat.postMessage(userId, sessionId, "what should I have said?")).at(-1).text;
  for (const q of WEB.questions) assert.ok(all.includes(q.referenceAnswer));
});

test("scenarios without key points say so instead of guessing", async () => {
  const { userId, sessionId } = await scoredSession();
  const reply = (await chat.postMessage(userId, sessionId, "what did I miss?")).at(-1).text;
  assert.match(reply, /no reference answer/);
});

test("thinking is switched off by default and can be left to the model", async () => {
  enable();
  stubGemini(() => geminiOk("ok"));
  await llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] });
  assert.deepEqual(calls[0].body.generationConfig.thinkingConfig, { thinkingBudget: 0 });

  process.env.GEMINI_THINKING_BUDGET = "default";
  stubGemini(() => geminiOk("ok"));
  await llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] });
  assert.equal("thinkingConfig" in calls[0].body.generationConfig, false);
  delete process.env.GEMINI_THINKING_BUDGET;
});

test("a model that rejects the thinking setting is retried without it", async () => {
  enable();
  let n = 0;
  stubGemini(() =>
    ++n === 1
      ? { ok: false, status: 400, json: async () => ({ error: { message: "Budget 0 is invalid. This model only works in thinking mode." } }) }
      : geminiOk("fine")
  );
  const text = await llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] });
  assert.equal(text, "fine");
  assert.equal(calls.length, 2);
  assert.equal("thinkingConfig" in calls[1].body.generationConfig, false);
});

test("other 400 errors are not retried", async () => {
  enable();
  stubGemini(() => ({ ok: false, status: 400, json: async () => ({ error: { message: "API key not valid." } }) }));
  await assert.rejects(llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] }), /400/);
  assert.equal(calls.length, 1);
});

test("LLM_REACTIONS=off keeps the interviewer scripted without any model call", async () => {
  counter += 1;
  const { user } = await auth.register({ email: `llm${counter}@test.dev`, password: "secret1", name: "R" });
  const { session } = await sessions.startSession(user.id, SCENARIO_ID);
  enable();
  process.env.LLM_REACTIONS = "off";
  process.env.LLM_CRITIQUE = "off";
  stubGemini(() => geminiOk("should not be used"));
  try {
    const { next } = await sessions.answerTurn(user.id, session.id, ANSWER);
    assert.equal(calls.length, 0);
    assert.equal(next.reactionSource, "scripted");
  } finally {
    delete process.env.LLM_REACTIONS;
    delete process.env.LLM_CRITIQUE;
  }
});

test("thought-flagged parts are never shown", async () => {
  enable();
  stubGemini(() => ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: "internal reasoning", thought: true }, { text: "Visible answer." }] } }] }),
  }));
  assert.equal(await llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] }), "Visible answer.");
});

test("LLM_PROVIDER=local selects the local server and beats a Gemini key", () => {
  enable();
  enableLocal({ LOCAL_LLM_MODEL: "gemma-4" });
  assert.deepEqual(llm.status(), { enabled: true, provider: "local", model: "gemma-4", local: true });
  process.env.LLM_PROVIDER = "none";
  assert.equal(llm.isEnabled(), false);
});

test("local: posts an OpenAI-style chat request with the system prompt first and no auth by default", async () => {
  enableLocal({ LOCAL_LLM_MODEL: "gemma-4" });
  stubGemini(() => localOk("  Hello from the local model.  "));
  const text = await llm.generate({
    system: "be brief",
    messages: [
      { role: "assistant", text: "welcome" },
      { role: "user", text: "hi" },
    ],
  });
  assert.equal(text, "Hello from the local model.");
  assert.equal(calls[0].url, "http://localhost:1234/v1/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.deepEqual(calls[0].body.messages, [
    { role: "system", content: "be brief" },
    { role: "user", content: "hi" },
  ]);
  assert.equal(calls[0].body.model, "gemma-4");
  assert.equal(calls[0].body.stream, false);
});

test("local: URL and optional key come from the environment", async () => {
  enableLocal({ LOCAL_LLM_MODEL: "m", LOCAL_LLM_URL: "http://localhost:11434/v1/", LOCAL_LLM_API_KEY: "local-secret" });
  stubGemini(() => localOk("ok"));
  await llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] });
  assert.equal(calls[0].url, "http://localhost:11434/v1/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, "Bearer local-secret");
});

test("local: with no model configured it uses the first non-embedding model on the server", async () => {
  enableLocal({ LOCAL_LLM_URL: "http://localhost:4321/v1" });
  stubGemini((call) =>
    call.url.endsWith("/models")
      ? { ok: true, status: 200, json: async () => ({ data: [{ id: "text-embedding-nomic-embed-text-v1.5" }, { id: "gemma-4" }] }) }
      : localOk("hi")
  );
  await llm.generate({ system: "s", messages: [{ role: "user", text: "hello" }] });
  assert.equal(calls.at(-1).body.model, "gemma-4");
});

test("local: inline reasoning is removed from the answer", async () => {
  enableLocal({ LOCAL_LLM_MODEL: "gemma-4" });
  stubGemini(() => localOk("<think>plan the reply carefully</think>You covered the URL point."));
  assert.equal(await llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] }), "You covered the URL point.");
});

test("local: a stopped server gives a message that says what to do", async () => {
  enableLocal({ LOCAL_LLM_MODEL: "gemma-4" });
  global.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] }),
    /could not reach the local model server at http:\/\/localhost:1234\/v1 \(is the LM Studio server running\?\)/
  );
});

test("local: server errors and empty answers are errors", async () => {
  enableLocal({ LOCAL_LLM_MODEL: "gemma-4" });
  stubGemini(() => ({ ok: false, status: 400, json: async () => ({ error: { message: "context length exceeded" } }) }));
  await assert.rejects(llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] }), /returned 400: context length exceeded/);
  stubGemini(() => localOk("<think>only thinking</think>"));
  await assert.rejects(llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] }), /empty answer/);
});

test("local: chat replies are marked as coming from the local model", async () => {
  const { userId, sessionId } = await scoredSession();
  enableLocal({ LOCAL_LLM_MODEL: "gemma-4" });
  stubGemini(() => localOk("Your relevance was the weakest area."));
  const reply = (await chat.postMessage(userId, sessionId, "what went wrong?")).at(-1);
  assert.equal(reply.source, "local");
  assert.equal(reply.text, "Your relevance was the weakest area.");
});

test("em and en dashes in model output become plain hyphens", async () => {
  enableLocal({ LOCAL_LLM_MODEL: "gemma-4" });
  stubGemini(() => localOk("Aim for 45\u201360 seconds \u2014 it helps."));
  assert.equal(await llm.generate({ system: "s", messages: [{ role: "user", text: "hi" }] }), "Aim for 45-60 seconds - it helps.");
});

test("the chat prompt tells the model why fluency is zero when answers were typed", async () => {
  const { userId, sessionId } = await scoredSession();
  enable();
  stubGemini(() => geminiOk("ok"));
  await chat.postMessage(userId, sessionId, "why is my fluency so low?");
  const prompt = calls[0].body.systemInstruction.parts[0].text;
  assert.match(prompt, /Answer input: 0 spoken, 4 typed/);
  assert.match(prompt, /every typed answer scored 0/);
});

test("SSE parser handles events split across network chunks", async () => {
  async function* bytes() {
    for (const piece of ["data: {\"a\":1}\r", "\n\r", "\ndata: [DONE]\n\n"]) yield Buffer.from(piece);
  }
  const events = [];
  for await (const event of llm.parseSse(bytes())) events.push(event);
  assert.deepEqual(events, ['{"a":1}', "[DONE]"]);
});

test("Gemini streaming uses the same thinking budget as non-streaming generation", async () => {
  enable();
  stubGemini(() => ({ ok: true, status: 200, body: (async function* () {
    yield Buffer.from('data: {"candidates":[{"content":{"parts":[{"text":"OK"}]}}]}\n\n');
  })() }));
  const tokens = [];
  for await (const token of llm.generateStream({ system: "brief", messages: [{ role: "user", text: "hi" }] })) {
    tokens.push(token);
  }
  assert.equal(tokens.join(""), "OK");
  assert.deepEqual(calls[0].body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
});

test("local model streams visible tokens without inline reasoning", async () => {
  enableLocal({ LOCAL_LLM_MODEL: "gemma-4" });
  stubGemini(() => ({
    ok: true, status: 200,
    body: (async function* () {
      for (const piece of [
        'data: {"choices":[{"delta":{"content":"<thi"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"nk>private</think>Hello "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"there"}}]}\n\n',
        "data: [DONE]\n\n",
      ]) yield Buffer.from(piece);
    })(),
  }));
  const tokens = [];
  for await (const token of llm.generateStream({ system: "s", messages: [{ role: "user", text: "hi" }] })) tokens.push(token);
  assert.equal(tokens.join(""), "Hello there");
  assert.equal(calls[0].body.stream, true);
});

test("scripted chat also completes through the streaming service", async () => {
  const { userId, sessionId } = await scoredSession();
  const events = [];
  const messages = await chat.streamMessage(userId, sessionId, "hello", (event) => events.push(event));
  assert.equal(events[0].type, "token");
  assert.equal(messages.at(-1).source, "scripted");
  assert.equal(events[0].text, messages.at(-1).text);
});
