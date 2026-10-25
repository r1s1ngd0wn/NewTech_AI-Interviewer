process.env.DB_PATH = ":memory:";

const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluate, resolveAnswer } = require("../eval/checks");
const cases = require("../eval/cases/critique.json");
const scenarios = require("../src/data/scenarios.json");

const questionFor = ({ scenarioId, questionId }) => scenarios.find((s) => s.id === scenarioId).questions.find((q) => q.id === questionId);

const OOP = questionFor({ scenarioId: "scn_swe_junior_fundamentals", questionId: "q1" });
const ANSWER = "OOP has classes and objects and inheritance.";
const review = (overrides = {}) => ({
  coveredPoints: ["inheritance"],
  missingPoints: ["encapsulation", "polymorphism"],
  strengths: ["Mentioned inheritance."],
  suggestion: "Also cover encapsulation and polymorphism.",
  improvedAnswer: "OOP principles include encapsulation, inheritance, polymorphism, and abstraction.",
  onTopic: true,
  ...overrides,
});
const spec = (expect) => ({ id: "t", expect });

test("the case file is well formed and every case points at a real question", () => {
  assert.ok(cases.length >= 8);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, "ids are unique");
  for (const c of cases) {
    assert.ok(["normal", "edge", "refuse"].includes(c.type), `${c.id} has a type`);
    assert.ok(c.description && c.expect, `${c.id} has a description and expectations`);
    assert.ok(questionFor(c.question), `${c.id} refers to a real question`);
    assert.ok(resolveAnswer(c.answer).length > 0, `${c.id} has an answer`);
  }
  for (const type of ["normal", "edge", "refuse"]) assert.ok(cases.some((c) => c.type === type), `there is a ${type} case`);
});

test("resolveAnswer expands a repeated answer", () => {
  assert.equal(resolveAnswer("plain"), "plain");
  assert.equal(resolveAnswer({ repeat: "a ", times: 3 }), "a a a");
});

test("a correct review passes", () => {
  assert.deepEqual(
    evaluate(spec({ onTopic: true, coveredIncludesAny: ["inherit"], missingIncludesAtLeast: { anyOf: ["encapsul", "polymorph"], count: 2 } }), OOP, ANSWER, review()),
    []
  );
});

test("a score in the output fails every case", () => {
  const failures = evaluate(spec({}), OOP, ANSWER, review({ suggestion: "I would give this 80/100." }));
  assert.match(failures[0], /contains a score/);
});

test("points that are not in the key points fail", () => {
  const failures = evaluate(spec({}), OOP, ANSWER, review({ missingPoints: ["garbage collection tuning"] }));
  assert.match(failures[0], /not in the key points/);
});

test("a stronger answer that is not traceable to the sources fails", () => {
  const invented = "Encapsulation bundles variables together with the functions operating on them, while abstraction conceals internal machinery behind simple contracts.";
  const failures = evaluate(spec({}), OOP, ANSWER, review({ improvedAnswer: invented }));
  assert.match(failures[0], /traceable/);
});

test("an empty stronger answer is allowed", () => {
  assert.deepEqual(evaluate(spec({}), OOP, ANSWER, review({ improvedAnswer: "" })), []);
});

test("each expectation reports its own failure", () => {
  assert.match(evaluate(spec({ onTopic: false }), OOP, ANSWER, review())[0], /onTopic should be false/);
  assert.match(evaluate(spec({ coveredEmpty: true }), OOP, ANSWER, review())[0], /coveredPoints should be empty/);
  assert.match(evaluate(spec({ missingEmpty: true }), OOP, ANSWER, review())[0], /missingPoints should be empty/);
  assert.match(evaluate(spec({ missingMax: 1 }), OOP, ANSWER, review())[0], /at most 1/);
  assert.match(evaluate(spec({ coveredIncludesAny: ["recurs"] }), OOP, ANSWER, review())[0], /coveredPoints should mention/);
  assert.match(
    evaluate(spec({ missingIncludesAtLeast: { anyOf: ["abstract", "class"], count: 1 } }), OOP, ANSWER, review())[0],
    /missingPoints should mention 1 of/
  );
  assert.match(evaluate(spec({ forbidden: ["HACKED"] }), OOP, ANSWER, review({ suggestion: "hacked!" }))[0], /forbidden text/);
});

test("a question without key points skips the key-point checks", () => {
  const noKeyPoints = { id: "q", text: "Tell me about yourself." };
  assert.deepEqual(evaluate(spec({ coveredEmpty: true, missingEmpty: true }), noKeyPoints, "I study computing.", review({ coveredPoints: [], missingPoints: [], improvedAnswer: "I study computing." })), []);
});
