const store = require("../store");
const scenarioService = require("./scenarioService");
const sessionService = require("./sessionService");

async function getProgress(userId) {
  const scoredSessions = (await sessionService.listSessionsForUser(userId))
    .filter((s) => s.status === "scored")
  const scored = (await Promise.all(scoredSessions.map(async (s) => ({ session: s, feedback: await store.feedbacks.get(s.id) }))))
    .filter((entry) => entry.feedback)
    .sort((a, b) => new Date(a.session.startedAt) - new Date(b.session.startedAt));

  const history = scored.map(({ session, feedback }) => ({
    sessionId: session.id,
    scenarioId: session.scenarioId,
    scenarioTitle: scenarioService.getScenario(session.scenarioId)?.title,
    date: session.endedAt,
    overallScore: feedback.overallScore,
    criteria: feedback.criteria.map((c) => ({
      criterionId: c.criterionId,
      name: c.name,
      score: c.averageScore,
    })),
  }));

  const trend = buildTrend(history);
  const weakestCriterion = findWeakestCriterion(history);

  return { history, trend, weakestCriterion };
}

// Criterion names come from the most recent session so a renamed rubric criterion
// shows its current name, not the one stored on older feedback.
function latestNames(history) {
  const names = {};
  for (const h of history) {
    for (const c of h.criteria) names[c.criterionId] = c.name;
  }
  return names;
}

function buildTrend(history) {
  const names = latestNames(history);
  const criterionIds = history[0]?.criteria.map((c) => c.criterionId) || [];
  return criterionIds.map((criterionId) => ({
    criterionId,
    name: names[criterionId],
    points: history.map((h) => ({
      date: h.date,
      score: h.criteria.find((c) => c.criterionId === criterionId)?.score ?? null,
    })),
  }));
}

function findWeakestCriterion(history) {
  if (!history.length) return null;
  const names = latestNames(history);
  const totals = {};
  const counts = {};
  for (const h of history) {
    for (const c of h.criteria) {
      totals[c.criterionId] = (totals[c.criterionId] || 0) + c.score;
      counts[c.criterionId] = (counts[c.criterionId] || 0) + 1;
    }
  }
  let weakest = null;
  for (const criterionId of Object.keys(totals)) {
    const avg = totals[criterionId] / counts[criterionId];
    if (!weakest || avg < weakest.avg) weakest = { criterionId, avg };
  }
  return (
    weakest && {
      criterionId: weakest.criterionId,
      name: names[weakest.criterionId],
      averageScore: Math.round(weakest.avg),
    }
  );
}

module.exports = { getProgress };
