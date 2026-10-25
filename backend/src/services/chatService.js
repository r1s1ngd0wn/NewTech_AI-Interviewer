// Post-interview chat (SRS: session-scoped Q&A over a completed interview).
//
// When embeddings are configured, chat retrieves only matching chunks from the
// candidate's own session in Supabase pgvector. Without embeddings, the original
// grounded-context chat remains available.
//
// Replies come from llmService (Gemini) when GEMINI_API_KEY is set, using the prompt from
// buildSystemPrompt(). If there is no key, or the call fails, generateReply() answers
// from the same data with scripted rules and the message records why. The project's
// approved local stack (ASR qwen3-1.7b-asr / LLM gemma3n-e4b / TTS vibevoice-1.5b) can
// replace llmService later without touching this file.

const store = require("../store");
const scenarioService = require("./scenarioService");
const sessionService = require("./sessionService");
const llmService = require("./llmService");
const embeddingService = require("./embeddingService");
const ragService = require("./ragService");
const inputGuard = require("../guards/inputGuard");
const { prompt, versions } = require("../prompts");
const { httpError } = require("./authService");

const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_MESSAGES = 200;
const LLM_CONTEXT_MESSAGES = 12;
const MAX_REPLY_LENGTH = 1500;

const CRITERION_KEYWORDS = {
  fluency: ["fluency", "filler", "pace", "pacing", "delivery"],
  relevance: ["relevance", "relevant", "on topic", "on-topic", "address the question"],
  vocabulary_grammar: ["vocabulary", "grammar", "word choice", "wording", "grammatical"],
  structure: ["structure", "star method", "situation task action result", "organi"],
};

async function loadContext(userId, sessionId) {
  const session = await sessionService.getOwnedSession(userId, sessionId);
  const feedback = await store.feedbacks.get(sessionId);
  if (!feedback) {
    throw httpError(400, "finish and score this session before asking about it");
  }
  const scenario = sessionService.effectiveScenario(session, scenarioService.getScenario(session.scenarioId));
  return { session, feedback, scenario };
}

function welcomeMessage(feedback) {
  return {
    role: "assistant",
    text:
      `You scored ${feedback.overallScore}/100 overall on "${feedback.scenarioTitle}". ` +
      `Ask me about a specific criterion (fluency, relevance, vocabulary, structure), ` +
      `a specific question, what you missed, or what to work on next.`,
    at: new Date().toISOString(),
  };
}

async function historyFor(sessionId, feedback) {
  let history = await store.sessionChats.get(sessionId);
  if (!history) {
    history = [welcomeMessage(feedback)];
    await store.sessionChats.set(sessionId, history);
  }
  return history;
}

async function getHistory(userId, sessionId) {
  const { feedback } = await loadContext(userId, sessionId);
  return historyFor(sessionId, feedback);
}

function findCriterion(feedback, criterionId) {
  return feedback.criteria.find((c) => c.criterionId === criterionId);
}

function noteFor(feedback, criterionId) {
  const strength = feedback.strengths.find((s) => s.criterionId === criterionId);
  if (strength) return strength.note;
  const improvement = feedback.improvements.find((s) => s.criterionId === criterionId);
  if (improvement) return improvement.note;
  return null;
}

function matchCriterion(lower) {
  for (const [criterionId, keywords] of Object.entries(CRITERION_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return criterionId;
  }
  return null;
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth"];

function matchQuestionIndex(lower, total) {
  const numeric = lower.match(/question\s*#?\s*(\d+)/);
  if (numeric) {
    const idx = Number(numeric[1]) - 1;
    if (idx >= 0 && idx < total) return idx;
  }
  for (let i = 0; i < ORDINALS.length && i < total; i++) {
    if (lower.includes(`${ORDINALS[i]} question`)) return i;
  }
  return null;
}

// Scripted stand-in for the local LLM call - see file header. Reads real session
// data below, but the *generation* is templated, not model output.
function referenceFor(context, turnIndex) {
  const turn = context.session.turns[turnIndex];
  const question = context.scenario?.questions.find((q) => q.id === turn?.questionId);
  return question?.referenceAnswer || null;
}

function generateReply(message, context) {
  const { feedback } = context;
  const lower = message.toLowerCase();
  const qIndex = matchQuestionIndex(lower, feedback.highlights.length);

  // "What did I miss / what should I have said": answered from the question bank only.
  if (/\b(miss|model answer|ideal|reference|expected|should i have|correct answer|better answer|key point)/.test(lower)) {
    const indexes = qIndex !== null ? [qIndex] : feedback.highlights.map((_, i) => i);
    const lines = indexes
      .map((i) => ({ i, ref: referenceFor(context, i) }))
      .filter((x) => x.ref)
      .map((x) => `Question ${x.i + 1} (${feedback.highlights[x.i].questionText}) - key points from the question bank: ${x.ref}`);
    return lines.length
      ? lines.join(" ")
      : "The question bank has no reference answer for this scenario, so I can only comment on how you answered, not on what was missing.";
  }

  if (qIndex !== null) {
    const h = feedback.highlights[qIndex];
    const scoreLines = h.scores
      .map((s) => `${s.label} on ${criterionName(feedback, s.criterionId)}`)
      .join(", ");
    const ref = referenceFor(context, qIndex);
    return (
      `For "${h.questionText}" you answered: "${h.answerExcerpt}${h.answerExcerpt.length >= 180 ? "..." : ""}" ` +
      `That turn scored: ${scoreLines}.` +
      (ref ? ` Key points from the question bank: ${ref}` : "")
    );
  }

  const criterionId = matchCriterion(lower);
  if (criterionId) {
    const c = findCriterion(feedback, criterionId);
    const note = noteFor(feedback, criterionId);
    return (
      `${c.name}: ${c.averageScore}/100, banded "${c.label}". ${c.description} ` +
      (note ? note : "")
    );
  }

  if (/\b(strength|good|well done|best|strong)/.test(lower)) {
    return feedback.strengths.map((s) => `${s.name}: ${s.note}`).join(" ");
  }

  if (/\b(improve|weak|tip|advice|better|why|work on)/.test(lower)) {
    return feedback.improvements.map((s) => `${s.name}: ${s.note}`).join(" ");
  }

  if (/\b(hi|hello|hey)\b/.test(lower)) {
    return welcomeMessage(feedback).text;
  }

  if (/\b(score|overall|how did i do)/.test(lower)) {
    const breakdown = feedback.criteria.map((c) => `${c.name} ${c.averageScore}`).join(", ");
    return `Overall you scored ${feedback.overallScore}/100. Per criterion: ${breakdown}.`;
  }

  return (
    `I can tell you about your ${feedback.overallScore}/100 overall score, a specific criterion ` +
    `(fluency, relevance, vocabulary, structure), a specific question ("what about the first question"), ` +
    `what you missed, or your strengths and improvement areas - what would you like to know?`
  );
}

function criterionName(feedback, criterionId) {
  return findCriterion(feedback, criterionId)?.name || criterionId;
}

// Everything the model may rely on, and the rules it must follow. It may only compare the
// candidate's answers with the question bank's key points and explain the fixed rubric
// result; it is not allowed to add facts of its own. The rubric result is passed as final
// so the model explains the scores instead of re-grading.
function buildSystemPrompt({ session, scenario, feedback }) {
  const questionsById = Object.fromEntries((scenario?.questions || []).map((q) => [q.id, q]));
  const transcript = session.turns
    .map((turn, i) => {
      const question = questionsById[turn.questionId];
      const reference = question?.referenceAnswer
        ? `Key points from the question bank: ${question.referenceAnswer}`
        : "Key points from the question bank: (none for this question)";
      return `Q${i + 1}: ${question?.text || "(question)"}\n${reference}\nA${i + 1} (candidate): ${turn.answerText}`;
    })
    .join("\n\n");
  const criteria = feedback.criteria
    .map((c) => `- ${c.name}: ${c.averageScore}/100 (${c.label}). ${c.description}`)
    .join("\n");
  const perQuestion = feedback.highlights
    .map((h, i) => `Q${i + 1}: ${h.scores.map((s) => `${s.name} ${s.label}`).join(", ")}`)
    .join("\n");

  return [
    prompt("debrief"),
    "",
    "INTERVIEW",
    `Scenario: ${scenario?.title || feedback.scenarioTitle} (${scenario?.industry}, ${scenario?.seniority}, ${scenario?.questionType})`,
    `Questions answered: ${feedback.questionsAnswered ?? session.turns.length} of ${feedback.questionsTotal ?? scenario?.questions.length}`,
    ...(feedback.typedAnswers > 0
      ? [
          `Answer input: ${feedback.spokenAnswers} spoken, ${feedback.typedAnswers} typed. Fluency & Delivery measures spoken delivery, so every typed answer scored 0 there. If asked why fluency is low or zero, explain this.`,
        ]
      : []),
    "",
    "TRANSCRIPT",
    transcript,
    "",
    "RUBRIC RESULT (final)",
    `Overall: ${feedback.overallScore}/100`,
    criteria,
    "",
    "Per-question bands:",
    perQuestion,
    "",
    "Strengths:",
    ...feedback.strengths.map((s) => `- ${s.note}`),
    "Areas to improve:",
    ...feedback.improvements.map((s) => `- ${s.note}`),
  ].join("\n");
}

function normalizeForMatch(text) {
  return String(text)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Everything the model was allowed to quote from.
function quotableText({ session, scenario, feedback }) {
  const parts = [];
  for (const turn of session.turns) {
    const question = scenario?.questions.find((q) => q.id === turn.questionId);
    parts.push(turn.answerText, question?.text, question?.referenceAnswer);
  }
  for (const c of feedback.criteria) parts.push(c.name, c.label, c.description);
  for (const n of [...feedback.strengths, ...feedback.improvements]) parts.push(n.note);
  return normalizeForMatch(parts.filter(Boolean).join(" \n "));
}

// Quoted passages (3+ words) in the reply that do not appear in the sources. "..." inside a
// quote splits it into separately checked pieces.
function findUngroundedQuotes(reply, sourcesText) {
  const bad = [];
  for (const match of reply.matchAll(/["“]([^"“”]+)["”]/g)) {
    for (const piece of match[1].split(/\.{3}|…/)) {
      const normalized = normalizeForMatch(piece);
      if (normalized.split(" ").length >= 3 && !sourcesText.includes(normalized)) bad.push(piece.trim());
    }
  }
  return bad;
}

// One model call, checked for invented quotes. If the first answer quotes text that is not in
// the transcript or key points, the model gets one chance to fix it; a second failure raises
// so the caller falls back to the scripted (data-only) answer.
async function groundedReply(context, recent) {
  const system = buildSystemPrompt(context);
  const sources = quotableText(context);
  const messages = recent.map((m) => ({ role: m.role, text: m.text }));

  let text = await llmService.generate({ system, messages, promptVersion: `debrief.${versions.debrief}` });
  let bad = findUngroundedQuotes(text, sources);
  if (bad.length) {
    text = await llmService.generate({      system,
      promptVersion: `debrief.${versions.debrief}`,
      messages: [
        ...messages,
        { role: "assistant", text },
        {
          role: "user",
          text:
            `Your reply put this in quotation marks, but it is not in the candidate's answers or the key points: ${bad.map((q) => `"${q}"`).join("; ")}. ` +
            "Rewrite the whole reply. Only use quotation marks for text copied exactly from those sources; paraphrase everything else without quotation marks.",
        },
      ],
    });
    bad = findUngroundedQuotes(text, sources);
    if (bad.length) throw new Error("the model quoted text that is not in your transcript or the question bank");
  }
  return text.slice(0, MAX_REPLY_LENGTH);
}

function isPromptInjection(message) {
  return inputGuard.classifyInput(message) === "injection";
}

const NO_MATCH = "I couldn't find an answer to that in this interview or its uploaded documents.";
const OUT_OF_SCOPE_REPLY = "I can only help with interview practice and feedback, not that topic.";

function sourceList(matches) {
  return matches.map(({ id, label, text }, index) => ({ id, label,
    excerpt: inputGuard.sanitizeSourceText(text).slice(0, 220), number: index + 1 }));
}

function citedSources(reply, matches) {
  const cited = new Set([...reply.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])));
  return sourceList(matches).filter((source) => cited.has(source.number))
    .map(({ number, ...source }) => source);
}

function validateCitations(reply, matches, noMatch = NO_MATCH) {
  const text = reply.replace(/\[(\d+)\]/g, (citation, value) =>
    Number(value) >= 1 && Number(value) <= matches.length ? citation : "").replace(/ {2,}/g, " ").trim();
  const sources = citedSources(text, matches);
  if (!sources.length && !/could not find|couldn't find|not in (the|these) (sources|excerpts)/i.test(text)) {
    return { text: noMatch, sources: [] };
  }
  return { text, sources };
}

async function retrievedReply(message, matches) {
  const system = [
    prompt("debrief-rag"),
    ...matches.map((match, index) => `[${index + 1}] ${match.label}: ${inputGuard.sanitizeSourceText(match.text)}`),
  ].join("\n\n");
  return (await llmService.generate({ system, messages: [{ role: "user", text: message }],
    temperature: 0.2, promptVersion: `debrief-rag.${versions["debrief-rag"]}` })).slice(0, MAX_REPLY_LENGTH);
}

async function postMessage(userId, sessionId, message) {
  if (typeof message !== "string" || !message.trim()) {
    throw httpError(400, "message is required");
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw httpError(400, `messages are limited to ${MAX_MESSAGE_LENGTH} characters`);
  }

  const context = await loadContext(userId, sessionId);
  const history = await historyFor(sessionId, context.feedback);
  const userMsg = { role: "user", text: message.trim(), at: new Date().toISOString() };

  let replyText = null;
  let source = "scripted";
  let sources = [];
  let fallbackReason;
  const guardResult = inputGuard.classifyInput(userMsg.text);
  if (guardResult === "injection") {
    replyText = "I can only discuss your interview and cannot follow instructions to change my rules or reveal private information.";
    source = "guardrail";
  } else if (guardResult === "out-of-scope") {
    replyText = OUT_OF_SCOPE_REPLY;
    source = "guardrail";
  } else if (llmService.isEnabled() && embeddingService.config()) {
    try {
      const matches = await ragService.retrieve(userId, context, userMsg.text);
      if (matches.length) {
        replyText = await retrievedReply(userMsg.text, matches);
        ({ text: replyText, sources } = validateCitations(replyText, matches));
        source = "rag";
      } else {
        replyText = NO_MATCH;
        source = "rag-no-match";
      }
    } catch (err) {
      fallbackReason = err.message;
    }
  } else if (llmService.isEnabled()) {
    try {
      replyText = await groundedReply(context, [...history, userMsg].slice(-LLM_CONTEXT_MESSAGES));
      source = llmService.status().provider;
    } catch (err) {
      fallbackReason = err.message;
    }
  }
  if (!replyText) replyText = generateReply(userMsg.text, context);

  const assistantMsg = { role: "assistant", text: replyText, at: new Date().toISOString(), source };
  if (guardResult !== "ok") assistantMsg.refusalReason = guardResult;
  if (sources.length) assistantMsg.sources = sources;
  if (fallbackReason) assistantMsg.fallbackReason = fallbackReason;

  // The session may have been deleted while the model was answering; don't recreate its chat.
  if (!await store.sessions.has(sessionId)) throw httpError(404, "session not found");
  const latest = (await store.sessionChats.get(sessionId)) || history;
  const updated = [...latest, userMsg, assistantMsg].slice(-MAX_HISTORY_MESSAGES);
  await store.sessionChats.set(sessionId, updated);
  return updated;
}

async function streamMessage(userId, sessionId, message, onEvent, signal) {
  if (typeof message !== "string" || !message.trim()) throw httpError(400, "message is required");
  if (message.length > MAX_MESSAGE_LENGTH) throw httpError(400, `messages are limited to ${MAX_MESSAGE_LENGTH} characters`);
  const context = await loadContext(userId, sessionId);
  const history = await historyFor(sessionId, context.feedback);
  const userMsg = { role: "user", text: message.trim(), at: new Date().toISOString() };
  let system;
  let sources = [];
  let source = "scripted";
  let reply = "";
  let fallbackReason;
  let emitted = false;
  let matches = [];

  const guardResult = inputGuard.classifyInput(userMsg.text);
  if (guardResult === "injection") {
    reply = "I can only discuss your interview and cannot follow instructions to change my rules or reveal private information.";
    source = "guardrail";
  } else if (guardResult === "out-of-scope") {
    reply = OUT_OF_SCOPE_REPLY;
    source = "guardrail";
  } else if (llmService.isEnabled()) {
    try {
      if (embeddingService.config()) {
        matches = await ragService.retrieve(userId, context, userMsg.text);
        if (matches.length) {
          sources = sourceList(matches).map(({ number, ...source }) => source);
          system = [
            prompt("debrief-rag"),
            ...matches.map((match, index) => `[${index + 1}] ${match.label}: ${inputGuard.sanitizeSourceText(match.text)}`),
          ].join("\n\n");
          source = "rag";
        } else {
          reply = NO_MATCH;
          source = "rag-no-match";
        }
      } else {
        system = buildSystemPrompt(context);
        source = llmService.status().provider;
      }
      if (system) {
        if (sources.length) onEvent({ type: "sources", sources });
        for await (const token of llmService.generateStream({ system, messages: [{ role: "user", text: userMsg.text }],
          signal, promptVersion: source === "rag" ? `debrief-rag.${versions["debrief-rag"]}` :
            `debrief.${versions.debrief}` })) {
          const remaining = MAX_REPLY_LENGTH - reply.length;
          if (remaining <= 0) break;
          const part = token.slice(0, remaining);
          reply += part;
          onEvent({ type: "token", text: part });
          emitted = true;
        }
        if (!reply.trim()) throw new Error("the LLM stream returned an empty answer");
        if (source === "rag") {
          ({ text: reply, sources } = validateCitations(reply, matches));
        }
      }
    } catch (error) {
      if (reply) throw error;
      fallbackReason = error.message;
      sources = [];
      source = "scripted";
    }
  }
  if (!reply) reply = generateReply(userMsg.text, context);
  if (!emitted) {
    onEvent({ type: "token", text: reply });
  }
  if (!await store.sessions.has(sessionId)) throw httpError(404, "session not found");
  const assistantMsg = { role: "assistant", text: reply, at: new Date().toISOString(), source };
  if (guardResult !== "ok") assistantMsg.refusalReason = guardResult;
  if (sources.length) assistantMsg.sources = sources;
  if (fallbackReason) assistantMsg.fallbackReason = fallbackReason;
  const latest = (await store.sessionChats.get(sessionId)) || history;
  const updated = [...latest, userMsg, assistantMsg].slice(-MAX_HISTORY_MESSAGES);
  await store.sessionChats.set(sessionId, updated);
  return updated;
}

module.exports = { getHistory, postMessage, streamMessage, buildSystemPrompt, findUngroundedQuotes,
  quotableText, isPromptInjection, validateCitations };
