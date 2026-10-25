// Shape of the per-answer review the LLM must return (capability C, structured output). The
// same schema is sent to Gemini as the response schema and used to validate what comes back, so
// an invalid or over-long result is rejected before the app uses it.

const { z } = require("zod");

const point = z.string().trim().min(1).max(200);

// Smaller models sometimes answer a list field with one string instead of an array. A string is
// split into its lines (or semicolon-separated parts) rather than rejected, because the content
// is usable and the points are still checked against the key points afterwards.
const list = (max) =>
  z.preprocess(
    (value) =>
      typeof value === "string"
        ? value
            .split(/\r?\n|;/)
            .map((part) => part.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
            .filter(Boolean)
        : value,
    z.array(point).max(max)
  );

const critiqueSchema = z.object({
  coveredPoints: list(8),
  missingPoints: list(8),
  strengths: list(3),
  suggestion: z.string().trim().min(1).max(300),
  improvedAnswer: z.string().trim().max(800),
  onTopic: z.boolean(),
});

module.exports = { critiqueSchema };
