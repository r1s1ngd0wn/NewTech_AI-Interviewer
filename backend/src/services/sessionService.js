const { newId } = require("../utils/id");
const store = require("../store");
const scenarioService = require("./scenarioService");
const aiSimulator = require("./aiSimulator");
const scoringService = require("./scoringService");
const llmService = require("./llmService");
const critiqueService = require("./critiqueService");
const { httpError } = require("./authService");

const STALE_SESSION_MS = 2 * 60 * 60 * 1000;
const MAX_ANSWER_LENGTH = 4000;
// How long finishing waits for model reviews still running in the background. Model latency is
// uneven (5-20 s per review on a free tier), so this is short: reviews that are not ready show up
// on the feedback page when they arrive (see critiquesPending in withCritiques).
const CRITIQUE_WAIT_MS = 6000;

// sessionId -> promises of reviews still being written by the model.
const pendingCritiques = new Map();

function startSession(userId, scenarioId) {
  const scenario = scenarioService.getScenario(scenarioId);
  if (!scenario) throw httpError(404, "scenario not found");

  // Reopening a scenario before answering anything (page refresh, React StrictMode's
  // double effect in dev) reuses the untouched session instead of orphaning a new one.
  const untouched = listSessionsForUser(userId).find(
    (s) => s.status === "in_progress" && s.scenarioId === scenarioId && s.turns.length === 0
  );
  if (untouched) {
    return {
      session: toPublicSession(untouched),
      question: aiSimulator.firstQuestion(scenario),
    };
  }

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

// inputMode is "voice" when the answer came from the microphone (even if the transcript was then
// corrected by hand) and "text" otherwise. Anything else is treated as typed, because Fluency &
// Delivery measures spoken delivery and a typed answer has none. The value comes from the browser,
// so it is a practice-app honour system, not proof.
function normalizeInputMode(inputMode) {
  return inputMode === "voice" ? "voice" : "text";
}

function submitAnswer(userId, sessionId, answerText, inputMode) {
  const session = getOwnedSession(userId, sessionId);
  if (session.status !== "in_progress") {
    throw httpError(400, "session is not in progress");
  }
  if (typeof answerText !== "string" || !answerText.trim()) {
    throw httpError(400, "answerText is required");
  }
  if (answerText.length > MAX_ANSWER_LENGTH) {
    throw httpError(400, `answers are limited to ${MAX_ANSWER_LENGTH} characters`);
  }
  const scenario = scenarioService.getScenario(session.scenarioId);
  const answeredCount = session.turns.length;
  const currentQuestion = scenario.questions[answeredCount];
  if (!currentQuestion) throw httpError(400, "session already has all questions answered");

  session.turns.push({
    questionId: currentQuestion.id,
    answerText: String(answerText || "").trim(),
    inputMode: normalizeInputMode(inputMode),
    answeredAt: new Date().toISOString(),
    // Always present; replaced by the model's review when one arrives (see answerTurn).
    critique: critiqueService.scriptedCritique(currentQuestion, answerText),
  });

  const next = aiSimulator.nextTurn(scenario, session);
  if (next.done) {
    session.status = "awaiting_finish";
  }
  store.sessions.set(sessionId, session);
  return { session: toPublicSession(session), next };
}

// Replaces the stored review for one answer, unless the session or answer is gone or changed.
function applyCritique(sessionId, index, questionId, critique) {
  const session = store.sessions.get(sessionId);
  const turn = session?.turns[index];
  if (!turn || turn.questionId !== questionId) return;
  turn.critique = critique;
  store.sessions.set(sessionId, session);
}

// Starts the model's review of the newest answer without making the interview wait for it: the
// scripted review is already stored, and the model's replaces it when it arrives.
// LLM_CRITIQUE=off keeps the model for the chat only (saves quota on free API tiers).
function startCritique(userId, sessionId) {
  if (!llmService.isEnabled() || process.env.LLM_CRITIQUE === "off") return;
  const session = getOwnedSession(userId, sessionId);
  const index = session.turns.length - 1;
  const turn = session.turns[index];
  const question = scenarioService.getScenario(session.scenarioId)?.questions.find((q) => q.id === turn.questionId);

  const job = critiqueService
    .critiqueAnswer(question, turn.answerText)
    .then((critique) => applyCritique(sessionId, index, turn.questionId, critique))
    .catch(() => {})
    .finally(() => {
      const jobs = pendingCritiques.get(sessionId);
      jobs?.delete(job);
      if (jobs && !jobs.size) pendingCritiques.delete(sessionId);
    });
  if (!pendingCritiques.has(sessionId)) pendingCritiques.set(sessionId, new Set());
  pendingCritiques.get(sessionId).add(job);
}

// Lets finishing pick up reviews that are almost done, but never for longer than CRITIQUE_WAIT_MS;
// whatever is not ready stays scripted until it arrives.
async function waitForCritiques(userId, sessionId, timeoutMs = CRITIQUE_WAIT_MS) {
  getOwnedSession(userId, sessionId); // ownership check
  const jobs = pendingCritiques.get(sessionId);
  if (!jobs?.size) return;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([Promise.all([...jobs]), timeout]);
  clearTimeout(timer);
}

// submitAnswer() plus an LLM-written interviewer reaction when one is configured. Any
// failure (no key, timeout, rejected output) silently keeps the scripted reaction, and the
// next question always comes from the scenario list.
async function answerTurn(userId, sessionId, answerText, inputMode) {
  const result = submitAnswer(userId, sessionId, answerText, inputMode);
  result.next.reactionSource = "scripted";
  startCritique(userId, sessionId);
  // LLM_REACTIONS=off keeps the model for the chat only (saves quota on free API tiers).
  if (!llmService.isEnabled() || process.env.LLM_REACTIONS === "off") return result;

  try {
    const session = getOwnedSession(userId, sessionId);
    const scenario = scenarioService.getScenario(session.scenarioId);
    result.next.reaction = await aiSimulator.llmReaction(scenario, session);
    result.next.reactionSource = llmService.status().provider;
  } catch {
    // keep the scripted reaction
  }
  return result;
}

function finishSession(userId, sessionId) {
  const session = getOwnedSession(userId, sessionId);
  if (session.status === "scored") {
    return withCritiques(store.feedbacks.get(sessionId), session);
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
  return withCritiques(feedback, session);
}

// Per-answer reviews live on the turns, not in the stored feedback, so a review that finishes
// after scoring still shows up the next time the feedback is read.
function withCritiques(feedback, session) {
  if (!feedback) return feedback;
  return {
    ...feedback,
    critiquesPending: pendingCritiques.has(session.id),
    highlights: feedback.highlights.map((h, i) => ({ ...h, critique: session.turns[i]?.critique || null })),
  };
}

function getSession(userId, sessionId) {
  const session = getOwnedSession(userId, sessionId);
  const scenario = scenarioService.getScenario(session.scenarioId);
  return { ...toPublicSession(session), scenarioTitle: scenario?.title };
}

function getFeedback(userId, sessionId) {
  const session = getOwnedSession(userId, sessionId);
  const feedback = store.feedbacks.get(sessionId);
  if (!feedback) throw httpError(404, "feedback not available yet, finish the session first");
  return withCritiques(feedback, session);
}

function removeSessionData(sessionId) {
  store.sessions.delete(sessionId);
  store.feedbacks.delete(sessionId);
  store.sessionChats.delete(sessionId);
  pendingCritiques.delete(sessionId);
}

function deleteSession(userId, sessionId) {
  getOwnedSession(userId, sessionId);
  removeSessionData(sessionId);
}

function deleteAllSessionsForUser(userId) {
  for (const session of listSessionsForUser(userId)) {
    removeSessionData(session.id);
  }
}

// Removes interviews that were started but never finished (tab closed, abandoned).
// Scored sessions are never touched.
function purgeStaleSessions(maxAgeMs = STALE_SESSION_MS) {
  const cutoff = Date.now() - maxAgeMs;
  let purged = 0;
  for (const session of store.sessions.values()) {
    if (session.status !== "scored" && new Date(session.startedAt).getTime() < cutoff) {
      removeSessionData(session.id);
      purged += 1;
    }
  }
  return purged;
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
    // Reviews quote the question bank's key points, so they are shown only after scoring.
    turns: session.status === "scored" ? session.turns : session.turns.map(({ critique, ...turn }) => turn),
    startedAt: session.startedAt,
    endedAt: session.endedAt,
  };
}

module.exports = {
  startSession,
  submitAnswer,
  answerTurn,
  waitForCritiques,
  finishSession,
  getSession,
  getFeedback,
  deleteSession,
  deleteAllSessionsForUser,
  purgeStaleSessions,
  listSessionsForUser,
  getOwnedSession,
};
