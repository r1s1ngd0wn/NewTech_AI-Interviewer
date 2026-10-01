const test = require("node:test");
const assert = require("node:assert/strict");

const { countFillers, fillerRatio } = require("../src/utils/text");
const { scoreTurn, scoreSession } = require("../src/services/scoringService");
const scenarios = require("../src/data/scenarios.json");

const scenario = scenarios[0];
const question = scenario.questions[0];

function criterion(result, id) {
  return result.perCriterion.find((c) => c.criterionId === id);
}

test("filler words are matched as whole words only", () => {
  const clean =
    "I wrote the documentation for the number of columns in our summary report over many months.";
  assert.equal(countFillers(clean), 0);
  assert.equal(fillerRatio(clean), 0);
});

test("real fillers are counted, including multi-word ones", () => {
  assert.equal(countFillers("Um, I like, you know, basically did it"), 4);
  assert.equal(countFillers("It was kind of hard and sort of long"), 2);
});

test("a filler-free technical answer is not penalised for fluency", () => {
  const answer =
    "I wrote the documentation for the number of columns in our summary report and the results were great for the whole team over many months of steady work together.";
  const result = scoreTurn({ questionId: question.id, answerText: answer, inputMode: "voice" }, question);
  const wordCount = answer.split(/\s+/).length;
  const lengthOnly = Math.round(Math.min(100, (wordCount / 60) * 100));
  assert.equal(fillerRatio(answer), 0);
  assert.equal(criterion(result, "fluency").rawScore, lengthOnly, "no filler penalty should apply");
});

test("scoring is deterministic for identical input", () => {
  const turn = { questionId: question.id, answerText: "I have experience with a project in my role." };
  assert.deepEqual(scoreTurn(turn, question), scoreTurn(turn, question));
});

test("a heavily filler-laden answer scores lower fluency than a clean one", () => {
  const clean = "I led a project at my last role and delivered the result on time for the whole team.";
  const filler = "Um, I like, you know, basically um did a project, like, sort of, you know, um.";
  const cleanScore = criterion(scoreTurn({ questionId: question.id, answerText: clean, inputMode: "voice" }, question), "fluency");
  const fillerScore = criterion(scoreTurn({ questionId: question.id, answerText: filler, inputMode: "voice" }, question), "fluency");
  assert.ok(cleanScore.rawScore > fillerScore.rawScore);
});

test("relevance rises with keyword coverage", () => {
  const onTopic = "My background and experience in this role, my skills and a project I am interested in.";
  const offTopic = "The weather has been lovely and I enjoy long walks near the river.";
  const on = criterion(scoreTurn({ questionId: question.id, answerText: onTopic }, question), "relevance");
  const off = criterion(scoreTurn({ questionId: question.id, answerText: offTopic }, question), "relevance");
  assert.ok(on.rawScore > off.rawScore);
  assert.equal(off.rawScore, 0);
});

test("long answers are not penalised for vocabulary diversity relative to short ones", () => {
  const base = "I organised requirements, estimated tasks, mentored juniors, reviewed code, and shipped features weekly. ";
  const short = base;
  const long =
    base +
    "Later I automated deployments, improved monitoring, negotiated deadlines, documented decisions, and coordinated releases across teams. " +
    "Customers praised faster support responses, while analysts appreciated cleaner dashboards, reliable exports, and clearer metrics overall. " +
    "Colleagues valued honest retrospectives, thoughtful pairing sessions, patient onboarding, and generous knowledge sharing throughout.";
  const s = criterion(scoreTurn({ questionId: question.id, answerText: short }, question), "vocabulary_grammar");
  const l = criterion(scoreTurn({ questionId: question.id, answerText: long }, question), "vocabulary_grammar");
  assert.ok(l.rawScore >= s.rawScore - 15);
});

test("structure markers match whole words, not substrings", () => {
  const substringOnly = "Multitasking is my strength and I prefer unfirstly odd words.";
  const real = "First I planned the task, then I took action, and finally the result was good.";
  const a = criterion(scoreTurn({ questionId: question.id, answerText: substringOnly }, question), "structure");
  const b = criterion(scoreTurn({ questionId: question.id, answerText: real }, question), "structure");
  assert.ok(b.rawScore > a.rawScore);
});

test("scoreSession reports partial completion and overall score in range", () => {
  const session = {
    id: "sess_test",
    turns: [{ questionId: question.id, answerText: "I have experience in this role and a project I am proud of." }],
  };
  const feedback = scoreSession(session, scenario);
  assert.equal(feedback.questionsAnswered, 1);
  assert.equal(feedback.questionsTotal, scenario.questions.length);
  assert.ok(feedback.overallScore >= 0 && feedback.overallScore <= 100);
  assert.equal(feedback.criteria.length, 4);
});

test("a criterion that scored poorly is never called solid, and strong ones are not flagged to improve", () => {
  const scenarioForTest = scenarios[0];
  const q = scenarioForTest.questions[0];
  const weakSession = { id: "s1", turns: [{ questionId: q.id, answerText: "Yes." }] };
  const weak = scoreSession(weakSession, scenarioForTest);
  for (const s of weak.strengths) {
    const c = weak.criteria.find((x) => x.criterionId === s.criterionId);
    assert.ok(c.averageScore >= 55 || /relatively strongest/.test(s.note), `${s.name} scored ${c.averageScore} but was called a strength`);
    assert.equal(/also solid/.test(s.note) && c.averageScore < 55, false);
  }

  const strongAnswer =
    "First, my background is in building web products, and I am interested in this role because my skills and project experience match it. " +
    "Then I led a project as the main engineer, took action on performance, and finally the result was a faster, more reliable service that the whole team valued, " +
    "which shows the kind of varied, precise, and structured communication I bring to every role I take on.";
  const strong = scoreSession({ id: "s2", turns: [{ questionId: q.id, answerText: strongAnswer }] }, scenarioForTest);
  for (const i of strong.improvements) {
    const c = strong.criteria.find((x) => x.criterionId === i.criterionId);
    assert.ok(c.averageScore < 75 || /Every criterion scored/.test(i.note), `${i.name} scored ${c.averageScore} but was flagged to improve`);
  }
  assert.ok(strong.strengths.length >= 1 && strong.improvements.length >= 1);
});


test("typed answers score 0 for fluency, spoken ones are scored on delivery", () => {
  const answer = "I led a project at my last role and delivered the result on time for the whole team, first planning the work and then measuring the outcome carefully.";
  const fluency = (inputMode) => criterion(scoreTurn({ questionId: question.id, answerText: answer, inputMode }, question), "fluency");

  assert.equal(fluency("text").rawScore, 0);
  assert.equal(fluency(undefined).rawScore, 0, "an answer with no recorded input mode counts as typed");
  assert.equal(fluency("garbage").rawScore, 0);
  assert.ok(fluency("voice").rawScore > 0);
  assert.equal(fluency("text").label, "Limited");
});

test("typed answers only zero out fluency; the other criteria are unchanged", () => {
  const answer = "First I planned the work, then I took action on the project, and finally the result was a strong outcome for the team and my role.";
  const typed = scoreTurn({ questionId: question.id, answerText: answer, inputMode: "text" }, question);
  const spoken = scoreTurn({ questionId: question.id, answerText: answer, inputMode: "voice" }, question);
  for (const id of ["relevance", "vocabulary_grammar", "structure"]) {
    assert.equal(criterion(typed, id).rawScore, criterion(spoken, id).rawScore, id);
  }
});

test("a session of only typed answers has fluency 0 and explains why", () => {
  const turns = scenario.questions.map((q) => ({ questionId: q.id, answerText: "First I planned it, then I took action on the project and the result improved performance for the team.", inputMode: "text" }));
  const feedback = scoreSession({ id: "typed", turns }, scenario);
  const fluencyResult = feedback.criteria.find((c) => c.criterionId === "fluency");

  assert.equal(fluencyResult.averageScore, 0);
  assert.equal(feedback.typedAnswers, turns.length);
  assert.equal(feedback.spokenAnswers, 0);
  const note = feedback.improvements.find((i) => i.criterionId === "fluency").note;
  assert.match(note, /All of your answers were typed, so it scored 0/);
  assert.equal(feedback.strengths.some((s) => s.criterionId === "fluency"), false);
});

test("a mixed session averages fluency over spoken and typed answers", () => {
  const text = "First I planned it, then I took action on the project and the result improved performance for the team, with a role I owned.";
  const turns = scenario.questions.map((q, i) => ({ questionId: q.id, answerText: text, inputMode: i % 2 === 0 ? "voice" : "text" }));
  const feedback = scoreSession({ id: "mixed", turns }, scenario);
  const spokenOnly = scoreSession({ id: "spoken", turns: turns.map((t) => ({ ...t, inputMode: "voice" })) }, scenario);

  const fluency = (f) => f.criteria.find((c) => c.criterionId === "fluency").averageScore;
  assert.ok(fluency(feedback) > 0 && fluency(feedback) < fluency(spokenOnly));
  assert.equal(feedback.spokenAnswers + feedback.typedAnswers, turns.length);
  assert.match(feedback.improvements.find((i) => i.criterionId === "fluency").note, /of your \d+ answers were typed/);
});
