// Pass/fail rules for evaluation cases. Each case has an `expect` block; the checks below turn it
// into a list of failures for one model review. Two checks apply to every case:
//   - the review never contains a score (scoring is done by the rubric, not the model)
//   - what the user would see is traceable to the sources: covered/missing points come from the
//     question bank's key points, and the stronger answer is built from the question, key points
//     and the candidate's own answer
// Everything here is deterministic, so a failure means the output was wrong, not that a second
// model disagreed.

const { isGroundedInReference, groundedRatio, MIN_GROUNDED_RATIO } = require("../src/services/critiqueService");

const SCORE_PATTERN = /\b\d{1,3}\s*(\/|out of)\s*100\b/i;

function textFields(review) {
  return [review.suggestion, review.improvedAnswer, ...review.strengths, ...review.coveredPoints, ...review.missingPoints].filter(Boolean);
}

function countMatches(points, stems) {
  const joined = points.join(" ").toLowerCase();
  return stems.filter((stem) => joined.includes(stem.toLowerCase())).length;
}

// Returns the list of failure messages (empty when the case passes).
function evaluate(testCase, question, answerText, review) {
  const expect = testCase.expect || {};
  const failures = [];
  const all = textFields(review).join(" \n ");

  if (SCORE_PATTERN.test(all)) failures.push("the review contains a score");

  if (question.referenceAnswer) {
    const stray = [...review.coveredPoints, ...review.missingPoints].filter((p) => !isGroundedInReference(p, question.referenceAnswer));
    if (stray.length) failures.push(`points not in the key points: ${stray.map((p) => `"${p}"`).join(", ")}`);
  }
  if (review.improvedAnswer) {
    const sources = `${question.text} ${question.referenceAnswer || ""} ${answerText}`;
    const ratio = groundedRatio(review.improvedAnswer, sources);
    if (ratio < MIN_GROUNDED_RATIO) failures.push(`stronger answer is only ${Math.round(ratio * 100)}% traceable to the sources`);
  }

  if (typeof expect.onTopic === "boolean" && review.onTopic !== expect.onTopic) {
    failures.push(`onTopic should be ${expect.onTopic}`);
  }
  if (expect.coveredEmpty && review.coveredPoints.length) failures.push("coveredPoints should be empty");
  if (expect.missingEmpty && review.missingPoints.length) failures.push("missingPoints should be empty");
  if (typeof expect.missingMax === "number" && review.missingPoints.length > expect.missingMax) {
    failures.push(`at most ${expect.missingMax} missing point(s), got ${review.missingPoints.length}`);
  }
  if (expect.coveredIncludesAny && countMatches(review.coveredPoints, expect.coveredIncludesAny) < 1) {
    failures.push(`coveredPoints should mention one of: ${expect.coveredIncludesAny.join(", ")}`);
  }
  if (expect.missingIncludesAtLeast) {
    const { anyOf, count } = expect.missingIncludesAtLeast;
    const found = countMatches(review.missingPoints, anyOf);
    if (found < count) failures.push(`missingPoints should mention ${count} of: ${anyOf.join(", ")} (found ${found})`);
  }
  for (const pattern of expect.forbidden || []) {
    if (new RegExp(pattern, "i").test(all)) failures.push(`output contains forbidden text: ${pattern}`);
  }
  return failures;
}

// "answer" in a case file is a string, or { repeat, times } for a very long answer.
function resolveAnswer(answer) {
  return typeof answer === "string" ? answer : answer.repeat.repeat(answer.times).trim();
}

module.exports = { evaluate, resolveAnswer };
