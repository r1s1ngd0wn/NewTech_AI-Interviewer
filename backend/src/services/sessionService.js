const { newId } = require("../utils/id");
const store = require("../store");
const scenarioService = require("./scenarioService");
const aiSimulator = require("./aiSimulator");
const scoringService = require("./scoringService");
const llmService = require("./llmService");
const critiqueService = require("./critiqueService");
const documentService = require("./documentService");
const ragService = require("./ragService");
const embeddingService = require("./embeddingService");
const { httpError } = require("./authService");

const STALE_SESSION_MS = 2 * 60 * 60 * 1000;
const MAX_ANSWER_LENGTH = 4000;
// How long finishing waits for model reviews still running in the background. Model latency is
// uneven (5-20 s per review on a free tier), so this is short: reviews that are not ready show up
// on the feedback page when they arrive (see critiquesPending in withCritiques).
const CRITIQUE_WAIT_MS = 6000;

// sessionId -> promises of reviews still being written by the model.
const pendingCritiques = new Map();

async function startSession(userId, scenarioId) {
  const scenario = scenarioService.getScenario(scenarioId);
  if (!scenario) throw httpError(404, "scenario not found");

  // Reopening a scenario before answering anything (page refresh, React StrictMode's
  // double effect in dev) reuses the untouched session instead of orphaning a new one.
  const untouched = (await listSessionsForUser(userId)).find(
    (s) => s.status === "in_progress" && s.scenarioId === scenarioId && s.turns.length === 0
  );
  if (untouched) {
    return {
      session: toPublicSession(untouched),
      question: aiSimulator.firstQuestion(effectiveScenario(untouched, scenario)),
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
  await store.sessions.set(session.id, session);

  const question = aiSimulator.firstQuestion(scenario);
  return { session: toPublicSession(session), question };
}

function effectiveScenario(session, scenario) {
  return session.preparedQuestions?.length === scenario.questions.length
    ? { ...scenario, questions: session.preparedQuestions.map((question) => {
      const original = scenario.questions.find((item) => item.id === question.id);
      if (!original || !question.text.startsWith("Your document (") ||
          !question.text.endsWith(original.text)) return question;
      return { ...question, text: original.text, sourceLabel: question.text.match(/^Your document \(([^)]+)\)/)?.[1] };
    }) }
    : scenario;
}

function documentExcerpt(text) {
  const cleaned = String(text || "")
    .replace(/https?:\/\/\S+|\b(?:www\.|github\.com\/)\S+|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/gi, " ")
    .replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const sentence = cleaned.split(/(?<=[.!?])\s+/).find((part) => part.length >= 40) || cleaned;
  return sentence.length <= 150 ? sentence : `${sentence.slice(0, 147).trimEnd()}...`;
}

async function prepareSession(userId, sessionId, options = {}) {
  const session = await getOwnedSession(userId, sessionId);
  if (session.status !== "in_progress" || session.turns.length) {
    throw httpError(400, "interview preparation is only available before the first answer");
  }
  const scenario = scenarioService.getScenario(session.scenarioId);
  if (!session.preparedAt) {
    const questions = [];
    for (const question of scenario.questions) {
      let match = null;
      if (options.retrieveDocumentContext ||
          (process.env.STORE_BACKEND !== "memory" && embeddingService.config())) {
        match = await (options.retrieveDocumentContext || ragService.retrieveDocumentContext)(userId, sessionId, question.text);
      }
      const excerpt = match && documentExcerpt(match.text);
      questions.push(excerpt
        ? { ...question, contextSnippet: excerpt, sourceLabel: match.label,
            sourceDocumentId: match.documentId }
        : { ...question });
    }
    session.preparedQuestions = questions;
    session.preparedAt = new Date().toISOString();
    if (!await store.sessions.updateExisting(sessionId, session)) throw httpError(404, "session not found");
  }
  return { session: toPublicSession(session), question: aiSimulator.firstQuestion(effectiveScenario(session, scenario)) };
}

// inputMode is "voice" when the answer came from the microphone (even if the transcript was then
// corrected by hand) and "text" otherwise. Anything else is treated as typed, because Fluency &
// Delivery measures spoken delivery and a typed answer has none. The value comes from the browser,
// so it is a practice-app honour system, not proof.
function normalizeInputMode(inputMode) {
  return inputMode === "voice" ? "voice" : "text";
}

async function submitAnswer(userId, sessionId, answerText, inputMode) {
  const session = await getOwnedSession(userId, sessionId);
  if (session.status !== "in_progress") {
    throw httpError(400, "session is not in progress");
  }
  if (typeof answerText !== "string" || !answerText.trim()) {
    throw httpError(400, "answerText is required");
  }
  if (answerText.length > MAX_ANSWER_LENGTH) {
    throw httpError(400, `answers are limited to ${MAX_ANSWER_LENGTH} characters`);
  }
  const scenario = effectiveScenario(session, scenarioService.getScenario(session.scenarioId));
  const answeredCount = session.turns.length;
  const currentQuestion = scenario.questions[answeredCount];
  if (!currentQuestion) throw httpError(400, "session already has all questions answered");

  session.turns.push({
    questionId: currentQuestion.id,
    answerText: String(answerText || "").trim(),
    inputMode: normalizeInputMode(inputMode),
    answeredAt: new Date().toISOString(),
    // Always present; replaced by the model's review when one arrives (see startCritique).
    critique: critiqueService.scriptedCritique(currentQuestion, answerText),
  });

  const next = aiSimulator.nextTurn(scenario, session);
  if (next.done) {
    session.status = "awaiting_finish";
  }
  if (!await store.sessions.updateExisting(sessionId, session)) throw httpError(404, "session not found");
  return { session: toPublicSession(session), next };
}

// Starts the model's review of the newest answer without making the interview wait for it: the
// scripted review is already stored, and the model's replaces it when it arrives. The write only
// touches that one turn (setTurnCritique), so it cannot overwrite an answer submitted meanwhile.
// LLM_CRITIQUE=off keeps the model for the chat only (saves quota on free API tiers).
async function startCritique(userId, sessionId) {
  if (!llmService.isEnabled() || process.env.LLM_CRITIQUE === "off") return;
  const session = await getOwnedSession(userId, sessionId);
  const index = session.turns.length - 1;
  const turn = session.turns[index];
  const scenario = effectiveScenario(session, scenarioService.getScenario(session.scenarioId));
  const question = scenario?.questions.find((q) => q.id === turn.questionId);

  const job = critiqueService
    .critiqueAnswer(question, turn.answerText)
    .then((critique) => store.sessions.setTurnCritique(sessionId, index, turn.questionId, critique))
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
  await getOwnedSession(userId, sessionId); // ownership check
  const jobs = pendingCritiques.get(sessionId);
  if (!jobs?.size) return;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([Promise.all([...jobs]), timeout]);
  clearTimeout(timer);
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

// submitAnswer() plus an LLM-written interviewer reaction when one is configured. Any
// failure (no key, timeout, rejected output) silently keeps the scripted reaction, and the
// next question always comes from the scenario list.
async function answerTurn(userId, sessionId, answerText, inputMode) {
  const result = await submitAnswer(userId, sessionId, answerText, inputMode);
  result.next.reactionSource = "scripted";
  await startCritique(userId, sessionId);
  // LLM_REACTIONS=off keeps the model for the chat only (saves quota on free API tiers).
  if (!llmService.isEnabled() || process.env.LLM_REACTIONS === "off") return result;

  try {
    const session = await getOwnedSession(userId, sessionId);
    const scenario = effectiveScenario(session, scenarioService.getScenario(session.scenarioId));
    result.next.reaction = await aiSimulator.llmReaction(scenario, session);
    result.next.reactionSource = llmService.status().provider;
  } catch {
    // keep the scripted reaction
  }
  return result;
}

async function finishSession(userId, sessionId) {
  const session = await getOwnedSession(userId, sessionId);
  if (session.status === "scored") {
    return withCritiques(await store.feedbacks.get(sessionId), session);
  }
  if (session.turns.length === 0) {
    throw httpError(400, "cannot finish a session with no answers");
  }
  const scenario = effectiveScenario(session, scenarioService.getScenario(session.scenarioId));
  const feedback = scoringService.scoreSession(session, scenario);

  session.status = "scored";
  session.endedAt = new Date().toISOString();
  if (!await store.sessions.updateExisting(sessionId, session)) throw httpError(404, "session not found");
  await store.feedbacks.set(sessionId, feedback);
  if (process.env.STORE_BACKEND !== "memory" && embeddingService.config()) {
    try {
      await ragService.indexSession(userId, { session, scenario, feedback });
    } catch (error) {
      console.error("Could not pre-index interview for RAG:", error.message);
    }
  }
  return withCritiques(feedback, session);
}

async function getSession(userId, sessionId) {
  const session = await getOwnedSession(userId, sessionId);
  const scenario = effectiveScenario(session, scenarioService.getScenario(session.scenarioId));
  return { ...toPublicSession(session), scenarioTitle: scenario?.title };
}

async function getFeedback(userId, sessionId) {
  const session = await getOwnedSession(userId, sessionId); // ownership check
  const feedback = await store.feedbacks.get(sessionId);
  if (!feedback) throw httpError(404, "feedback not available yet, finish the session first");
  return withCritiques(feedback, session);
}

async function removeSessionData(sessionId) {
  if (process.env.STORE_BACKEND !== "memory") await documentService.deleteForSession(sessionId);
  await store.sessionChats.delete(sessionId);
  await store.feedbacks.delete(sessionId);
  await store.sessions.delete(sessionId);
  pendingCritiques.delete(sessionId);
}

async function deleteSession(userId, sessionId) {
  await getOwnedSession(userId, sessionId);
  await removeSessionData(sessionId);
}

async function removeDocumentContext(userId, sessionId, documentId) {
  const session = await getOwnedSession(userId, sessionId);
  if (!session.preparedQuestions?.some((question) => question.sourceDocumentId === documentId)) return;
  const scenario = scenarioService.getScenario(session.scenarioId);
  session.preparedQuestions = session.preparedQuestions.map((question) => {
    if (question.sourceDocumentId !== documentId) return question;
    return { ...scenario.questions.find((item) => item.id === question.id) };
  });
  await store.sessions.updateExisting(sessionId, session);
  const feedback = await store.feedbacks.get(sessionId);
  if (feedback) {
    feedback.highlights = feedback.highlights.map((highlight) => ({ ...highlight,
      questionText: session.preparedQuestions.find((item) => item.id === highlight.questionId)?.text }));
    await store.feedbacks.updateExisting(sessionId, feedback);
    await ragService.deleteInterviewIndex(sessionId);
  }
  await store.sessionChats.delete(sessionId);
}

async function removeDocumentChatReferences(userId, sessionId, documentId) {
  await getOwnedSession(userId, sessionId);
  const chat = await store.sessionChats.get(sessionId);
  if (chat?.some((message) => message.sources?.some((source) =>
    source.documentId === documentId || source.id?.startsWith(`${documentId}-`) ||
    source.id?.includes(`-${documentId}-`)))) {
    await store.sessionChats.delete(sessionId);
  }
}

async function deleteAllSessionsForUser(userId) {
  for (const session of await listSessionsForUser(userId)) {
    await removeSessionData(session.id);
  }
}

// Removes interviews that were started but never finished (tab closed, abandoned).
// Scored sessions are never touched.
async function purgeStaleSessions(maxAgeMs = STALE_SESSION_MS) {
  const cutoff = Date.now() - maxAgeMs;
  let purged = 0;
  for (const session of await store.sessions.values()) {
    if (session.status !== "scored" && new Date(session.startedAt).getTime() < cutoff) {
      await removeSessionData(session.id);
      purged += 1;
    }
  }
  return purged;
}

async function listSessionsForUser(userId) {
  return (await store.sessions.valuesByUser(userId))
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

async function getOwnedSession(userId, sessionId) {
  const session = await store.sessions.get(sessionId);
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
    preparedAt: session.preparedAt || null,
  };
}

module.exports = {
  startSession,
  prepareSession,
  effectiveScenario,
  submitAnswer,
  answerTurn,
  waitForCritiques,
  finishSession,
  getSession,
  getFeedback,
  deleteSession,
  removeDocumentContext,
  removeDocumentChatReferences,
  deleteAllSessionsForUser,
  purgeStaleSessions,
  listSessionsForUser,
  getOwnedSession,
};
