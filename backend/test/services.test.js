process.env.DB_PATH = ":memory:";

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
function newUser() {
  counter += 1;
  return auth.register({ email: `user${counter}@test.dev`, password: "secret1", name: `User ${counter}` });
}

function scoredSession(userId) {
  const { session } = sessions.startSession(userId, SCENARIO_ID);
  for (let i = 0; i < 4; i++) sessions.submitAnswer(userId, session.id, ANSWER);
  sessions.finishSession(userId, session.id);
  return session.id;
}

test("login without a password is a 400, not a crash", () => {
  newUser();
  assert.throws(() => auth.login({ email: "user1@test.dev" }), (err) => err.status === 400);
  assert.throws(() => auth.login({ email: "user1@test.dev", password: 123456 }), (err) => err.status === 400);
});

test("wrong password is a 401 and correct password works", () => {
  assert.throws(() => auth.login({ email: "user1@test.dev", password: "wrong-one" }), (err) => err.status === 401);
  assert.ok(auth.login({ email: "user1@test.dev", password: "secret1" }).token);
});

test("register validates email, name and password", () => {
  assert.throws(() => auth.register({ email: "nope", password: "secret1", name: "A" }), (e) => e.status === 400);
  assert.throws(() => auth.register({ email: "a@b.dev", password: "123", name: "A" }), (e) => e.status === 400);
  assert.throws(() => auth.register({ email: "a@b.dev", password: "secret1", name: "  " }), (e) => e.status === 400);
});

test("expired tokens are rejected and removed; revoked tokens stop working", () => {
  const { token } = newUser();
  assert.ok(auth.getUserFromToken(token));
  const record = store.tokens.get(token);
  store.tokens.set(token, { ...record, expiresAt: Date.now() - 1 });
  assert.equal(auth.getUserFromToken(token), null);
  assert.equal(store.tokens.has(token), false);

  const second = newUser();
  auth.revokeToken(second.token);
  assert.equal(auth.getUserFromToken(second.token), null);
});

test("profile completes only when industry, role and level are all set", () => {
  const { user } = newUser();
  let updated = auth.updateProfile(user.id, { targetIndustry: "Technology", experienceLevel: "Junior" });
  assert.equal(updated.profile.onboardingComplete, false);
  updated = auth.updateProfile(user.id, { targetRole: "Frontend Developer" });
  assert.equal(updated.profile.onboardingComplete, true);
  assert.throws(() => auth.updateProfile(user.id, { name: "" }), (e) => e.status === 400);
});

test("public scenario hides questions and scoring keywords", () => {
  const pub = scenarioService.getPublicScenario(SCENARIO_ID);
  assert.equal(pub.questions, undefined);
  assert.equal(JSON.stringify(pub).includes("keywords"), false);
  assert.ok(pub.questionCount > 0);
});

test("reopening a scenario before answering reuses the untouched session", () => {
  const { user } = newUser();
  const a = sessions.startSession(user.id, SCENARIO_ID);
  const b = sessions.startSession(user.id, SCENARIO_ID);
  assert.equal(a.session.id, b.session.id);
  sessions.submitAnswer(user.id, a.session.id, ANSWER);
  const c = sessions.startSession(user.id, SCENARIO_ID);
  assert.notEqual(c.session.id, a.session.id);
});

test("answers longer than the limit are rejected", () => {
  const { user } = newUser();
  const { session } = sessions.startSession(user.id, SCENARIO_ID);
  assert.throws(() => sessions.submitAnswer(user.id, session.id, "x".repeat(4001)), (e) => e.status === 400);
  assert.throws(() => sessions.submitAnswer(user.id, session.id, 42), (e) => e.status === 400);
});

test("ending early scores only the answered questions", () => {
  const { user } = newUser();
  const { session } = sessions.startSession(user.id, SCENARIO_ID);
  sessions.submitAnswer(user.id, session.id, ANSWER);
  const feedback = sessions.finishSession(user.id, session.id);
  assert.equal(feedback.questionsAnswered, 1);
  assert.equal(feedback.questionsTotal, 4);
});

test("deleting a session also deletes its chat", async () => {
  const { user } = newUser();
  const sessionId = scoredSession(user.id);
  await chat.postMessage(user.id, sessionId, "what should I improve?");
  assert.equal(store.sessionChats.has(sessionId), true);
  sessions.deleteSession(user.id, sessionId);
  assert.equal(store.sessionChats.has(sessionId), false);
  assert.equal(store.feedbacks.has(sessionId), false);
});

test("chat replies to plural keywords and caps message length", async () => {
  const { user } = newUser();
  const sessionId = scoredSession(user.id);
  const reply = (await chat.postMessage(user.id, sessionId, "tell me about my strengths")).at(-1);
  assert.match(reply.text, /strongest|solid/);
  assert.equal(reply.source, "scripted");
  await assert.rejects(chat.postMessage(user.id, sessionId, "x".repeat(501)), (e) => e.status === 400);
  await assert.rejects(chat.postMessage(user.id, sessionId, "   "), (e) => e.status === 400);
});

test("stale unfinished sessions are purged but scored ones are kept", () => {
  const { user } = newUser();
  const scoredId = scoredSession(user.id);
  const { session } = sessions.startSession(user.id, "scn_swe_midlevel_technical");
  const stored = store.sessions.get(session.id);
  stored.startedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  store.sessions.set(session.id, stored);

  assert.ok(sessions.purgeStaleSessions() >= 1);
  assert.equal(store.sessions.has(session.id), false);
  assert.equal(store.sessions.has(scoredId), true);
});

test("account deletion removes the user, sessions, chats and tokens", async () => {
  const { user, token } = newUser();
  const sessionId = scoredSession(user.id);
  await chat.postMessage(user.id, sessionId, "hello");
  const exported = accounts.exportData(user.id);
  assert.equal(exported.sessions.length, 1);
  assert.equal(exported.user.passwordHash, undefined);

  accounts.deleteAccount(user.id);
  assert.equal(store.users.has(user.id), false);
  assert.equal(store.usersByEmail.has(user.email), false);
  assert.equal(store.sessions.has(sessionId), false);
  assert.equal(store.sessionChats.has(sessionId), false);
  assert.equal(store.tokens.has(token), false);
});

test("the input mode is stored per answer and only 'voice' counts as spoken", () => {
  const { user } = newUser();
  const { session } = sessions.startSession(user.id, SCENARIO_ID);
  sessions.submitAnswer(user.id, session.id, ANSWER, "voice");
  sessions.submitAnswer(user.id, session.id, ANSWER, "text");
  sessions.submitAnswer(user.id, session.id, ANSWER);
  sessions.submitAnswer(user.id, session.id, ANSWER, "something else");
  const stored = store.sessions.get(session.id);
  assert.deepEqual(stored.turns.map((t) => t.inputMode), ["voice", "text", "text", "text"]);

  const feedback = sessions.finishSession(user.id, session.id);
  assert.equal(feedback.spokenAnswers, 1);
  assert.equal(feedback.typedAnswers, 3);
});
