const { newId } = require("../utils/id");
const store = require("../store");
const scenarioService = require("./scenarioService");
const aiSimulator = require("./aiSimulator");
const scoringService = require("./scoringService");
const { httpError } = require("./authService");

function startSession(userId, scenarioId) {
  const scenario = scenarioService.getScenario(scenarioId);
  if (!scenario) throw httpError(404, "scenario not found");

  const session = {
    id: newId("sess"),
    userId,
    scenarioId,
    status: "in_progress",
    turns: [],
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
  store.sessions.set(session.id, session);

  const question = aiSimulator.firstQuestion(scenario);
  return { session: toPublicSession(session), question };
}

function submitAnswer(userId, sessionId, answerText) {
  const session = getOwnedSession(userId, sessionId);
  if (session.status !== "in_progress") {
    throw httpError(400, "session is not in progress");
  }
  const scenario = scenarioService.getScenario(session.scenarioId);
  const answeredCount = session.turns.length;
  const currentQuestion = scenario.questions[answeredCount];
  if (!currentQuestion) throw httpError(400, "session already has all questions answered");

  session.turns.push({
    questionId: currentQuestion.id,
    answerText: String(answerText || "").trim(),
    answeredAt: new Date().toISOString(),
  });

  const next = aiSimulator.nextTurn(scenario, session);
  if (next.done) {
    session.status = "awaiting_finish";
  }
  store.sessions.set(sessionId, session);
  return { session: toPublicSession(session), next };
}

function finishSession(userId, sessionId) {
  const session = getOwnedSession(userId, sessionId);
  if (session.status === "scored") {
    return store.feedbacks.get(sessionId);
  }
  if (session.turns.length === 0) {
    throw httpError(400, "cannot finish a session with no answers");
  }
  const scenario = scenarioService.getScenario(session.scenarioId);
  const feedback = scoringService.scoreSession(session, scenario);

  session.status = "scored";
  session.endedAt = new Date().toISOString();
  store.sessions.set(sessionId, session);
  store.feedbacks.set(sessionId, feedback);
  return feedback;
}

function getSession(userId, sessionId) {
  const session = getOwnedSession(userId, sessionId);
  const scenario = scenarioService.getScenario(session.scenarioId);
  return { ...toPublicSession(session), scenarioTitle: scenario?.title };
}

function getFeedback(userId, sessionId) {
  getOwnedSession(userId, sessionId); // ownership check
  const feedback = store.feedbacks.get(sessionId);
  if (!feedback) throw httpError(404, "feedback not available yet, finish the session first");
  return feedback;
}

function deleteSession(userId, sessionId) {
  getOwnedSession(userId, sessionId);
  store.sessions.delete(sessionId);
  store.feedbacks.delete(sessionId);
}

function listSessionsForUser(userId) {
  return [...store.sessions.values()]
    .filter((s) => s.userId === userId)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

function getOwnedSession(userId, sessionId) {
  const session = store.sessions.get(sessionId);
  if (!session || session.userId !== userId) {
    throw httpError(404, "session not found");
  }
  return session;
}

function toPublicSession(session) {
  return {
    id: session.id,
    scenarioId: session.scenarioId,
    status: session.status,
    turns: session.turns,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
  };
}

module.exports = {
  startSession,
  submitAnswer,
  finishSession,
  getSession,
  getFeedback,
  deleteSession,
  listSessionsForUser,
};
