// Shared text helpers for the AI simulator and the scoring service. Filler words are
// matched on word boundaries so "um" does not fire inside "documentation" or "number".

const FILLER_WORDS = ["um", "uh", "like", "you know", "sort of", "kind of", "basically"];

const FILLER_PATTERNS = FILLER_WORDS.map(
  (filler) => new RegExp(`(?<![a-z'])${filler.replace(/ /g, "\\s+")}(?![a-z'])`, "g")
);

function words(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean);
}

function sentences(text) {
  return String(text || "")
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function countFillers(text) {
  const lower = String(text || "").toLowerCase();
  return FILLER_PATTERNS.reduce((count, pattern) => count + (lower.match(pattern) || []).length, 0);
}

function fillerRatio(text) {
  const total = words(text).length || 1;
  return countFillers(text) / total;
}

function containsPhrase(lowerText, phrase) {
  return new RegExp(`(?<![a-z])${phrase.replace(/ /g, "\\s+")}(?![a-z])`).test(lowerText);
}

module.exports = { FILLER_WORDS, words, sentences, countFillers, fillerRatio, containsPhrase };
