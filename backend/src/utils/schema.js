// Turns a Zod schema into the schema dialect Gemini's `responseSchema` accepts. Zod stays the
// single source of truth: the same schema validates what comes back. Gemini only understands a
// subset of JSON Schema, so everything else (limits, $schema, additionalProperties) is dropped
// here and enforced by Zod afterwards.

const { z } = require("zod");

const KEEP = new Set(["type", "properties", "items", "required", "description", "enum"]);

function simplify(node) {
  if (Array.isArray(node)) return node.map(simplify);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (!KEEP.has(key)) continue;
    // `properties` is a map of field names, so its keys are not schema keywords.
    out[key] = key === "properties" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, simplify(v)])) : simplify(value);
  }
  return out;
}

function toGeminiSchema(zodSchema) {
  return simplify(z.toJSONSchema(zodSchema));
}

module.exports = { toGeminiSchema };
