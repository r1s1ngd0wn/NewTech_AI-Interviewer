// AI Simulator (SRS 3.1.4): plays the interviewer role, but is strictly bounded to the
// active scenario's fixed question set (FR-2.4) - it never invents new questions.
// This mock version reacts to the *shape* of the previous answer (length / filler ratio)
// with a small set of scripted transition lines, keeping the persona/tone of the scenario.

const FILLER_WORDS = ["um", "uh", "like", "you know", "sort of", "kind of", "basically"];

function countFillers(text) {
  const lower = text.toLowerCase();
  return FILLER_WORDS.reduce((count, filler) => {
    const matches = lower.split(filler).length - 1;
    return count + matches;
  }, 0);
}

function reactionFor(scenario, answerText) {
  const wordCount = answerText.trim().split(/\s+/).filter(Boolean).length;
  const fillerCount = countFillers(answerText);
  const isCasual = /startup|casual/i.test(scenario.persona || "");

  if (wordCount < 8) {
    return isCasual
      ? "Got it, could you tell me a bit more about that?"
      : "Thank you. Could you expand on that a little further?";
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

module.exports = { firstQuestion, nextTurn, reactionFor };
