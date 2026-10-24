// AI Simulator (SRS 3.1.4): plays the interviewer role, but is strictly bounded to the
// active scenario's fixed question set (FR-2.4) - it never invents new questions.
// This mock version reacts to the *shape* of the previous answer (length / filler ratio)
// with a small set of scripted transition lines, keeping the persona/tone of the scenario.

const { words, countFillers } = require("../utils/text");
const llmService = require("./llmService");
const prompts = require("../prompts");

const MAX_REACTION_LENGTH = 220;

function reactionFor(scenario, answerText) {
  const wordCount = words(answerText).length;
  const fillerCount = countFillers(answerText);
  const isCasual = /startup|casual/i.test(scenario.persona || "");

  // The simulator never asks for a re-answer (the next question always follows), so a
  // brief answer gets a neutral acknowledgement rather than "could you expand?".
  if (wordCount < 8) {
    return isCasual
      ? "Got it, thanks. Let's move on."
      : "Thank you. Let's continue with the next question.";
  }
  if (fillerCount >= 3) {
    return isCasual
      ? "Okay, thanks for sharing. Let's keep going."
      : "Understood. Let's move to the next question.";
  }
  return isCasual
    ? "That's great context, thanks!"
    : "Thank you, that's helpful context.";
}

function firstQuestion(scenario) {
  const question = scenario.questions[0];
  return {
    questionId: question.id,
    text: question.text,
    reaction: null,
    index: 0,
    total: scenario.questions.length,
  };
}

function nextTurn(scenario, session) {
  const answeredCount = session.turns.length;
  const previousTurn = session.turns[answeredCount - 1];
  const reaction = previousTurn ? reactionFor(scenario, previousTurn.answerText) : null;

  if (answeredCount >= scenario.questions.length) {
    return { done: true, reaction, questionId: null, text: null };
  }

  const question = scenario.questions[answeredCount];
  return {
    done: false,
    reaction,
    questionId: question.id,
    text: question.text,
    index: answeredCount,
    total: scenario.questions.length,
  };
}

// LLM-written version of the reaction line. Only the acknowledgement is generated: the
// next question is always taken from the scenario's list by nextTurn(), and a generated
// line that asks a question, runs long, or is empty is rejected so the scripted line is
// used instead. That keeps the "never invents questions" rule (FR-2.4) intact.
async function llmReaction(scenario, session) {
  const last = session.turns[session.turns.length - 1];
  if (!last) throw new Error("no answer to react to");
  const question = scenario.questions.find((q) => q.id === last.questionId);

  const prompt = prompts.render("reaction", { persona: scenario.persona });

  const text = await llmService.generate({
    system: prompt.text,
    messages: [
      {
        role: "user",
        text: `Question you asked: ${question?.text || "(unknown)"}\nCandidate's answer: "${last.answerText}"`,
      },
    ],
    temperature: 0.7,
    maxOutputTokens: 512,
    timeoutMs: llmService.reactionTimeoutMs(),
  });

  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.includes("?") || cleaned.length > MAX_REACTION_LENGTH) {
    throw new Error("generated reaction was rejected");
  }
  return cleaned;
}

module.exports = { firstQuestion, nextTurn, reactionFor, llmReaction };
