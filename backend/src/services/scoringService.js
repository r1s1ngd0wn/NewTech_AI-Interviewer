// Rubric-based Scoring Service (SRS 3.1.5 / 2.5): the LLM is never asked to "grade this
// interview". Every score is a deterministic function of the transcript mapped through the
// fixed rubric in data/rubric.json, so the process is auditable and reproducible (FR-5.2..5.4).

const rubric = require("../data/rubric.json");
const { words, sentences, fillerRatio, containsPhrase } = require("../utils/text");

const STRUCTURE_MARKERS = [
  "situation", "task", "action", "result",
  "first", "then", "next", "finally", "as a result", "so i",
];
// Vocabulary diversity is measured over a fixed window so long answers are not
// penalised: unique/total shrinks naturally as an answer gets longer.
const DIVERSITY_WINDOW = 50;
const STRENGTH_MIN = 55;
const IMPROVE_BELOW = 75;

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
  const windowed = w.slice(0, DIVERSITY_WINDOW);
  const uniqueRatio = new Set(windowed).size / windowed.length;
  const avgWordLength = w.reduce((sum, t) => sum + t.length, 0) / w.length;
  const diversityScore = clamp(uniqueRatio * 130, 0, 100);
  const lengthBonus = clamp((avgWordLength - 3) * 15, -20, 20);
  return clamp(diversityScore * 0.75 + (60 + lengthBonus) * 0.25, 0, 100);
}

function scoreStructure(text) {
  const lower = text.toLowerCase();
  const markerHits = STRUCTURE_MARKERS.filter((m) => containsPhrase(lower, m)).length;
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
    // Fluency & Delivery is about spoken delivery, so an answer that was typed scores 0.
    fluency: turn.inputMode === "voice" ? scoreFluency(turn.answerText) : 0,
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

  // A criterion only counts as a strength from band 3 up (score 55+), and only counts as
  // something to improve below band 4 (under 75); otherwise "solid, scoring Off-topic" happens.
  const ranked = [...criteriaSummary].sort((a, b) => b.averageScore - a.averageScore);
  const solid = ranked.filter((c) => c.averageScore >= STRENGTH_MIN).slice(0, 3);
  const strengths = solid.length
    ? solid.map((c, i) => ({
        criterionId: c.criterionId,
        name: c.name,
        note:
          i === 0
            ? `${c.name} was your strongest area, scoring "${c.label}".`
            : `${c.name} was also solid, scoring "${c.label}".`,
      }))
    : [
        {
          criterionId: ranked[0].criterionId,
          name: ranked[0].name,
          note: `No criterion reached the middle band yet. ${ranked[0].name} was your relatively strongest area, scoring "${ranked[0].label}".`,
        },
      ];
  const spokenAnswers = session.turns.filter((t) => t.inputMode === "voice").length;
  const typedAnswers = session.turns.length - spokenAnswers;
  const weak = [...ranked].reverse().filter((c) => c.averageScore < IMPROVE_BELOW).slice(0, 3);
  const lowest = ranked[ranked.length - 1];
  const improvements = weak.length
    ? weak.map((c) => ({
        criterionId: c.criterionId,
        name: c.name,
        note: suggestionFor(c.criterionId, c.label, { spokenAnswers, typedAnswers }),
      }))
    : [
        {
          criterionId: lowest.criterionId,
          name: lowest.name,
          note: `Every criterion scored "Strong" or better. ${lowest.name} was lowest at ${lowest.averageScore}/100, so that is the place to keep polishing.`,
        },
      ];

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
    questionsAnswered: session.turns.length,
    questionsTotal: scenario.questions.length,
    spokenAnswers,
    typedAnswers,
    overallScore,
    criteria: criteriaSummary,
    strengths,
    improvements,
    highlights,
    rubricVersion: rubric.version,
  };
}

function suggestionFor(criterionId, label, { spokenAnswers = 0, typedAnswers = 0 } = {}) {
  if (criterionId === "fluency" && typedAnswers > 0) {
    return spokenAnswers === 0
      ? `Fluency & Delivery is scored on spoken answers. All of your answers were typed, so it scored 0. Answer with the microphone to be scored on your delivery. (currently: ${label}.)`
      : `${typedAnswers} of your ${typedAnswers + spokenAnswers} answers were typed and scored 0 for Fluency & Delivery, which measures spoken delivery. Speak every answer to be scored on it, and cut filler words like 'um' or 'like'. (currently: ${label}.)`;
  }
  const suggestions = {
    fluency: "Try to give fuller answers (aim for 45-60 seconds) and cut filler words like 'um' or 'like'.",
    relevance: "Anchor your answer more directly to the question's keywords before adding extra detail.",
    vocabulary_grammar: "Vary your word choice and reach for more precise terms instead of repeating the same words.",
    structure: "Use a clear shape - situation, action you took, then the result - instead of a free-form narrative.",
  };
  return `${suggestions[criterionId]} (currently: ${label}.)`;
}

module.exports = { scoreSession, scoreTurn };
