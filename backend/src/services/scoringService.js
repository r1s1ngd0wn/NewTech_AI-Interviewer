// Rubric-based Scoring Service (SRS 3.1.5 / 2.5): the LLM is never asked to "grade this
// interview". Every score is a deterministic function of the transcript mapped through the
// fixed rubric in data/rubric.json, so the process is auditable and reproducible (FR-5.2..5.4).

const rubric = require("../data/rubric.json");

const FILLER_WORDS = ["um", "uh", "like", "you know", "sort of", "kind of", "basically"];
const STRUCTURE_MARKERS = [
  "situation", "task", "action", "result",
  "first", "then", "next", "finally", "as a result", "so i",
];

function words(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function sentences(text) {
  return text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
}

function fillerRatio(text) {
  const lower = text.toLowerCase();
  const fillerCount = FILLER_WORDS.reduce(
    (count, filler) => count + (lower.split(filler).length - 1),
    0
  );
  const total = words(text).length || 1;
  return fillerCount / total;
}

// --- Per-criterion metric functions, each returns a 0-100 raw score --------------------

function scoreFluency(text) {
  const wc = words(text).length;
  const filler = fillerRatio(text);
  const lengthScore = Math.min(100, (wc / 60) * 100); // ~60 words reads as a full answer
  const fillerPenalty = Math.min(60, filler * 400);
  return clamp(lengthScore - fillerPenalty, 0, 100);
}

function scoreRelevance(text, question) {
  const lower = text.toLowerCase();
  const keywords = question.keywords || [];
  if (!keywords.length) return 60; // no keyword data for this question -> neutral score
  const hits = keywords.filter((kw) => lower.includes(kw.toLowerCase())).length;
  return clamp((hits / keywords.length) * 100, 0, 100);
}

function scoreVocabularyGrammar(text) {
  const w = words(text).map((t) => t.toLowerCase().replace(/[^a-z']/g, "")).filter(Boolean);
  if (!w.length) return 0;
  const uniqueRatio = new Set(w).size / w.length;
  const avgWordLength = w.reduce((sum, t) => sum + t.length, 0) / w.length;
  const diversityScore = clamp(uniqueRatio * 130, 0, 100);
  const lengthBonus = clamp((avgWordLength - 3) * 15, -20, 20);
  return clamp(diversityScore * 0.75 + (60 + lengthBonus) * 0.25, 0, 100);
}

function scoreStructure(text) {
  const lower = text.toLowerCase();
  const markerHits = STRUCTURE_MARKERS.filter((m) => lower.includes(m)).length;
  const sentenceCount = sentences(text).length;
  const markerScore = clamp((markerHits / 3) * 70, 0, 70);
  const sentenceScore = clamp((sentenceCount / 4) * 30, 0, 30);
  return clamp(markerScore + sentenceScore, 0, 100);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function bandFor(criterionId, rawScore) {
  const criterion = rubric.criteria.find((c) => c.id === criterionId);
  const sortedBands = [...criterion.bands].sort((a, b) => b.min - a.min);
  const matched = sortedBands.find((b) => rawScore >= b.min) || sortedBands[sortedBands.length - 1];
  return { band: matched.band, label: matched.label };
}

// Scores one turn (question + answer) against every rubric criterion.
function scoreTurn(turn, question) {
  const raw = {
    fluency: scoreFluency(turn.answerText),
    relevance: scoreRelevance(turn.answerText, question),
    vocabulary_grammar: scoreVocabularyGrammar(turn.answerText),
    structure: scoreStructure(turn.answerText),
  };

  const perCriterion = rubric.criteria.map((criterion) => {
    const rawScore = raw[criterion.id];
    const { band, label } = bandFor(criterion.id, rawScore);
    return {
      criterionId: criterion.id,
      name: criterion.name,
      rawScore: Math.round(rawScore),
      band,
      label,
    };
  });

  return { questionId: turn.questionId, perCriterion };
}

// Scores a full session transcript and produces the feedback report (FR-6.1/6.2).
function scoreSession(session, scenario) {
  const questionsById = Object.fromEntries(scenario.questions.map((q) => [q.id, q]));
  const turnScores = session.turns.map((turn) =>
    scoreTurn(turn, questionsById[turn.questionId])
  );

  const criteriaSummary = rubric.criteria.map((criterion) => {
    const scoresForCriterion = turnScores.map(
      (t) => t.perCriterion.find((p) => p.criterionId === criterion.id).rawScore
    );
    const avgRaw = scoresForCriterion.reduce((a, b) => a + b, 0) / (scoresForCriterion.length || 1);
    const { band, label } = bandFor(criterion.id, avgRaw);
    return {
      criterionId: criterion.id,
      name: criterion.name,
      description: criterion.description,
      averageScore: Math.round(avgRaw),
      band,
      label,
    };
  });

  const ranked = [...criteriaSummary].sort((a, b) => b.averageScore - a.averageScore);
  const strengths = ranked.slice(0, Math.min(3, ranked.length)).map((c, i) => ({
    criterionId: c.criterionId,
    name: c.name,
    note:
      i === 0
        ? `${c.name} was your strongest area, scoring "${c.label}".`
        : `${c.name} was also solid, scoring "${c.label}".`,
  }));
  const improvements = [...ranked]
    .reverse()
    .slice(0, Math.min(3, ranked.length))
    .map((c) => ({
      criterionId: c.criterionId,
      name: c.name,
      note: suggestionFor(c.criterionId, c.label),
    }));

  const highlights = session.turns.map((turn, i) => ({
    questionId: turn.questionId,
    questionText: questionsById[turn.questionId]?.text,
    answerExcerpt: turn.answerText.slice(0, 180),
    scores: turnScores[i].perCriterion,
  }));

  const overallScore = Math.round(
    criteriaSummary.reduce((sum, c) => sum + c.averageScore, 0) / criteriaSummary.length
  );

  return {
    sessionId: session.id,
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    generatedAt: new Date().toISOString(),
    overallScore,
    criteria: criteriaSummary,
    strengths,
    improvements,
    highlights,
    rubricVersion: rubric.version,
  };
}

function suggestionFor(criterionId, label) {
  const suggestions = {
    fluency: "Try to give fuller answers (aim for 45-60 seconds) and cut filler words like 'um' or 'like'.",
    relevance: "Anchor your answer more directly to the question's keywords before adding extra detail.",
    vocabulary_grammar: "Vary your vocabulary and double-check subject-verb agreement in longer sentences.",
    structure: "Use a clear shape - situation, action you took, then the result - instead of a free-form narrative.",
  };
  return `${suggestions[criterionId]} (currently: ${label}.)`;
}

module.exports = { scoreSession, scoreTurn };
