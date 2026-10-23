process.env.STORE_BACKEND = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");

const store = require("../src/store");
const auth = require("../src/services/authService");
const sessions = require("../src/services/sessionService");
const chat = require("../src/services/chatService");
const accounts = require("../src/services/accountService");
const scenarioService = require("../src/services/scenarioService");

const SCENARIO_ID = "scn_swe_junior_behavioral";
const ANSWER = "I have experience in this role and a project I am proud of because of the result.";

let counter = 0;
async function newUser() {
  counter += 1;
  return auth.register({ email: `user${counter}@test.dev`, password: "secret1", name: `User ${counter}` });
}

async function scoredSession(userId) {
  const { session } = await sessions.startSession(userId, SCENARIO_ID);
  for (let i = 0; i < 4; i++) await sessions.submitAnswer(userId, session.id, ANSWER);
  await sessions.finishSession(userId, session.id);
  return session.id;
}

test("login without a password is a 400, not a crash", async () => {
  await newUser();
  await assert.rejects(auth.login({ email: "user1@test.dev" }), (err) => err.status === 400);
  await assert.rejects(auth.login({ email: "user1@test.dev", password: 123456 }), (err) => err.status === 400);
});

test("wrong password is a 401 and correct password works", async () => {
  await assert.rejects(auth.login({ email: "user1@test.dev", password: "wrong-one" }), (err) => err.status === 401);
  assert.ok((await auth.login({ email: "user1@test.dev", password: "secret1" })).token);
});

test("register validates email, name and password", async () => {
  await assert.rejects(auth.register({ email: "nope", password: "secret1", name: "A" }), (e) => e.status === 400);
  await assert.rejects(auth.register({ email: "a@b.dev", password: "123", name: "A" }), (e) => e.status === 400);
  await assert.rejects(auth.register({ email: "a@b.dev", password: "secret1", name: "  " }), (e) => e.status === 400);
});

test("concurrent registration cannot replace another account's email mapping", async () => {
  const email = `race${++counter}@test.dev`;
  const results = await Promise.allSettled([
    auth.register({ email, password: "secret1", name: "First" }),
    auth.register({ email, password: "secret1", name: "Second" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.status, 409);
  const winner = results.find((result) => result.status === "fulfilled").value.user;
  assert.equal(await store.usersByEmail.get(email), winner.id);
});

test("expired tokens are rejected and removed; revoked tokens stop working", async () => {
  const { token } = await newUser();
  assert.ok(await auth.getUserFromToken(token));
  const record = await store.tokens.get(token);
  await store.tokens.set(token, { ...record, expiresAt: Date.now() - 1 });
  assert.equal(await auth.getUserFromToken(token), null);
  assert.equal(await store.tokens.has(token), false);

  const second = await newUser();
  await auth.revokeToken(second.token);
  assert.equal(await auth.getUserFromToken(second.token), null);
});

test("profile completes only when industry, role and level are all set", async () => {
  const { user } = await newUser();
  let updated = await auth.updateProfile(user.id, { targetIndustry: "Technology", experienceLevel: "Junior" });
  assert.equal(updated.profile.onboardingComplete, false);
  updated = await auth.updateProfile(user.id, { targetRole: "Frontend Developer" });
  assert.equal(updated.profile.onboardingComplete, true);
  await assert.rejects(auth.updateProfile(user.id, { name: "" }), (e) => e.status === 400);
});

test("public scenario hides questions and scoring keywords", () => {
  const pub = scenarioService.getPublicScenario(SCENARIO_ID);
  assert.equal(pub.questions, undefined);
  assert.equal(JSON.stringify(pub).includes("keywords"), false);
  assert.ok(pub.questionCount > 0);
});

test("reopening a scenario before answering reuses the untouched session", async () => {
  const { user } = await newUser();
  const a = await sessions.startSession(user.id, SCENARIO_ID);
  const b = await sessions.startSession(user.id, SCENARIO_ID);
  assert.equal(a.session.id, b.session.id);
  await sessions.submitAnswer(user.id, a.session.id, ANSWER);
  const c = await sessions.startSession(user.id, SCENARIO_ID);
  assert.notEqual(c.session.id, a.session.id);
});

test("answers longer than the limit are rejected", async () => {
  const { user } = await newUser();
  const { session } = await sessions.startSession(user.id, SCENARIO_ID);
  await assert.rejects(sessions.submitAnswer(user.id, session.id, "x".repeat(4001)), (e) => e.status === 400);
  await assert.rejects(sessions.submitAnswer(user.id, session.id, 42), (e) => e.status === 400);
});

test("ending early scores only the answered questions", async () => {
  const { user } = await newUser();
  const { session } = await sessions.startSession(user.id, SCENARIO_ID);
  await sessions.submitAnswer(user.id, session.id, ANSWER);
  const feedback = await sessions.finishSession(user.id, session.id);
  assert.equal(feedback.questionsAnswered, 1);
  assert.equal(feedback.questionsTotal, 4);
});

test("deleting a session also deletes its chat", async () => {
  const { user } = await newUser();
  const sessionId = await scoredSession(user.id);
  await chat.postMessage(user.id, sessionId, "what should I improve?");
  assert.equal(await store.sessionChats.has(sessionId), true);
  await sessions.deleteSession(user.id, sessionId);
  assert.equal(await store.sessionChats.has(sessionId), false);
  assert.equal(await store.feedbacks.has(sessionId), false);
});

test("chat replies to plural keywords and caps message length", async () => {
  const { user } = await newUser();
  const sessionId = await scoredSession(user.id);
  const reply = (await chat.postMessage(user.id, sessionId, "tell me about my strengths")).at(-1);
  assert.match(reply.text, /strongest|solid/);
  assert.equal(reply.source, "scripted");
  await assert.rejects(chat.postMessage(user.id, sessionId, "x".repeat(501)), (e) => e.status === 400);
  await assert.rejects(chat.postMessage(user.id, sessionId, "   "), (e) => e.status === 400);
});

test("stale unfinished sessions are purged but scored ones are kept", async () => {
  const { user } = await newUser();
  const scoredId = await scoredSession(user.id);
  const { session } = await sessions.startSession(user.id, "scn_swe_midlevel_technical");
  const stored = await store.sessions.get(session.id);
  stored.startedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  await store.sessions.set(session.id, stored);

  assert.ok((await sessions.purgeStaleSessions()) >= 1);
  assert.equal(await store.sessions.has(session.id), false);
  assert.equal(await store.sessions.has(scoredId), true);
});

test("account deletion removes the user, sessions, chats and tokens", async () => {
  const { user, token } = await newUser();
  const sessionId = await scoredSession(user.id);
  await chat.postMessage(user.id, sessionId, "hello");
  const exported = await accounts.exportData(user.id);
  assert.equal(exported.sessions.length, 1);
  assert.deepEqual(exported.sessions[0].documents, []);
  assert.equal(exported.user.passwordHash, undefined);

  await accounts.deleteAccount(user.id);
  assert.equal(await store.users.has(user.id), false);
  assert.equal(await store.usersByEmail.has(user.email), false);
  assert.equal(await store.sessions.has(sessionId), false);
  assert.equal(await store.sessionChats.has(sessionId), false);
  assert.equal(await store.tokens.has(token), false);
});

test("the input mode is stored per answer and only 'voice' counts as spoken", async () => {
  const { user } = await newUser();
  const { session } = await sessions.startSession(user.id, SCENARIO_ID);
  await sessions.submitAnswer(user.id, session.id, ANSWER, "voice");
  await sessions.submitAnswer(user.id, session.id, ANSWER, "text");
  await sessions.submitAnswer(user.id, session.id, ANSWER);
  await sessions.submitAnswer(user.id, session.id, ANSWER, "something else");
  const stored = await store.sessions.get(session.id);
  assert.deepEqual(stored.turns.map((t) => t.inputMode), ["voice", "text", "text", "text"]);

  const feedback = await sessions.finishSession(user.id, session.id);
  assert.equal(feedback.spokenAnswers, 1);
  assert.equal(feedback.typedAnswers, 3);
});
