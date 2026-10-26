// Which LLM providers are usable, in the order they are tried.
//   LLM_PROVIDER=local,gemini   Gemma (LM Studio) first, Gemini when the local call fails
//   LLM_PROVIDER=gemini | local | none
//   LLM_PROVIDER unset          Gemini when GEMINI_API_KEY is set, otherwise scripted replies
// Read from the environment on every call, like the rest of the LLM configuration.

const KNOWN = new Set(["local", "gemini"]);

function configured() {
  return (process.env.LLM_PROVIDER || "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

function providers() {
  const names = configured();
  if (names.includes("none")) return [];
  const ordered = [...new Set(names.filter((name) => KNOWN.has(name)))];
  const usable = (ordered.length ? ordered : ["gemini"]).filter((name) => name === "local" || Boolean((process.env.GEMINI_API_KEY || "").trim()));
  return usable;
}

module.exports = { providers };
