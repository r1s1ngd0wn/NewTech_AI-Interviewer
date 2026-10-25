process.env.STORE_BACKEND = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");

const scenarios = require("../src/data/scenarios.json");
const auth = require("../src/services/authService");
const sessions = require("../src/services/sessionService");
const scenarioService = require("../src/services/scenarioService");

const SENIORITIES = ["Junior", "Mid-level", "Senior"];

test("scenario and question ids are unique", () => {
  const ids = scenarios.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of scenarios) {
    const qids = s.questions.map((q) => q.id);
    assert.equal(new Set(qids).size, qids.length, `${s.id} has duplicate question ids`);
  }
});

test("every scenario has the fields the app filters and displays", () => {
  for (const s of scenarios) {
    for (const field of ["id", "title", "industry", "seniority", "questionType", "persona"]) {
      assert.ok(typeof s[field] === "string" && s[field].trim(), `${s.id} is missing ${field}`);
    }
    assert.ok(SENIORITIES.includes(s.seniority), `${s.id} has unknown seniority ${s.seniority}`);
    assert.ok(s.questions.length >= 4, `${s.id} needs at least 4 questions`);
  }
});

test("every question has usable relevance keywords", () => {
  for (const s of scenarios) {
    for (const q of s.questions) {
      assert.ok(q.text.trim().length > 10, `${s.id}/${q.id} has no question text`);
      assert.ok(q.keywords.length >= 4, `${s.id}/${q.id} needs at least 4 keywords`);
      assert.equal(new Set(q.keywords).size, q.keywords.length, `${s.id}/${q.id} repeats a keyword`);
      for (const k of q.keywords) {
        assert.equal(k, k.toLowerCase(), `${s.id}/${q.id} keyword "${k}" must be lowercase`);
        assert.ok(k.trim().length >= 3, `${s.id}/${q.id} keyword "${k}" is too short and would match inside other words`);
      }
    }
  }
});

test("no question text repeats across scenarios", () => {
  const texts = scenarios.flatMap((s) => s.questions.map((q) => q.text));
  assert.equal(new Set(texts).size, texts.length);
});

test("filters expose every seniority and the new question types", () => {
  const options = scenarioService.getFilterOptions();
  assert.deepEqual(options.seniorities.slice().sort(), SENIORITIES.slice().sort());
  assert.ok(options.questionTypes.includes("System Design"));
});

test("every scenario can be played through and scored", async () => {
  const { user } = await auth.register({ email: "player@test.dev", password: "secret1", name: "Player" });
  const answer =
    "I would start with the requirements, then design the data model, first handle the common case, and finally measure the result to check performance and reliability.";
  for (const s of scenarios) {
    const { session } = await sessions.startSession(user.id, s.id);
    for (let i = 0; i < s.questions.length; i++) await sessions.submitAnswer(user.id, session.id, answer);
    const feedback = await sessions.finishSession(user.id, session.id);
    assert.equal(feedback.questionsAnswered, s.questions.length, s.id);
    assert.equal(feedback.criteria.length, 4, s.id);
    assert.ok(feedback.overallScore >= 0 && feedback.overallScore <= 100, s.id);
  }
});
