// LLM client used only for free-text replies: the post-interview chat and the interviewer's
// short reaction. It is never used to pick questions or to score, so it cannot change what
// the rubric decides.
//
// Two providers sit behind one contract, generate({ system, messages }) -> string:
//   gemini - Google's Gemini API (needs GEMINI_API_KEY)
//   local  - any local server that speaks the OpenAI chat API: LM Studio, Ollama, llama.cpp
//            (LLM_PROVIDER=local; default URL is LM Studio's http://localhost:1234/v1)
// With neither configured the app keeps using its scripted replies. Configuration is read from
// the environment on every call (see .env.example). API keys go in headers and are never
// logged or included in error messages.

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
// "gemini-flash-latest" is Google's alias for the current flash model, so the default does not
// break when a specific version is retired (gemini-2.5-flash already was for new keys).
const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
const DEFAULT_LOCAL_URL = "http://localhost:1234/v1";
const GEMINI_TIMEOUT_MS = 15000;
// A local model may have to load into memory on the first request, and small GPUs are slower.
const LOCAL_TIMEOUT_MS = 45000;

class LlmError extends Error {
  // code: "timeout" | "unreachable" | "empty" | "invalid_json" | "blocked" | "rate_limited" | "http_error"
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "LlmError";
    this.upstreamStatus = status;
    this.code = code || (status === 429 ? "rate_limited" : status ? "http_error" : "error");
  }
}

// ---- configuration ---------------------------------------------------------------------

function env(name) {
  return (process.env[name] || "").trim();
}

// Reasoning ("thinking") models can spend 5-10 seconds deliberating before a one-line answer.
// These replies are short and fully grounded in the prompt, so Gemini thinking is turned off by
// default (budget 0). GEMINI_THINKING_BUDGET=default leaves the model's own behaviour alone.
function thinkingBudget() {
  const raw = (env("GEMINI_THINKING_BUDGET") || "0").toLowerCase();
  if (raw === "default") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function provider() {
  const explicit = env("LLM_PROVIDER").toLowerCase();
  if (explicit === "none") return null;
  if (explicit === "local") return "local";
  return env("GEMINI_API_KEY") ? "gemini" : null;
}

function isEnabled() {
  return provider() !== null;
}

let detectedLocalModel = null;

function localConfig() {
  return {
    baseUrl: (env("LOCAL_LLM_URL") || DEFAULT_LOCAL_URL).replace(/\/+$/, ""),
    model: env("LOCAL_LLM_MODEL") || detectedLocalModel?.name || "",
    apiKey: env("LOCAL_LLM_API_KEY"),
  };
}

function status() {
  const p = provider();
  if (p === "gemini") return { enabled: true, provider: "gemini", model: env("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL, local: false };
  if (p === "local") return { enabled: true, provider: "local", model: localConfig().model || "local model", local: true };
  return { enabled: false };
}

function defaultTimeoutMs() {
  return Number(env("LLM_TIMEOUT_MS")) || (provider() === "local" ? LOCAL_TIMEOUT_MS : GEMINI_TIMEOUT_MS);
}

// How long the interview may wait for the model before falling back to the scripted line.
function reactionTimeoutMs() {
  return Number(env("LLM_REACTION_TIMEOUT_MS")) || (provider() === "local" ? 20000 : 8000);
}

// ---- shared helpers --------------------------------------------------------------------

// Alternating user/assistant turns that start with a user turn.
function normalizeTurns(messages) {
  const turns = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const last = turns[turns.length - 1];
    if (!last && role === "assistant") continue;
    if (last && last.role === role) last.text += `\n${m.text}`;
    else turns.push({ role, text: m.text });
  }
  return turns;
}

async function postJson({ url, headers, body, timeoutMs, timeoutMessage, unreachableMessage, method = "POST" }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    return { res, data };
  } catch (err) {
    const timedOut = err.name === "AbortError";
    throw new LlmError(timedOut ? timeoutMessage : unreachableMessage, { code: timedOut ? "timeout" : "unreachable" });
  } finally {
    clearTimeout(timer);
  }
}

// ---- Gemini ----------------------------------------------------------------------------

async function generateGemini({ system, messages, temperature, maxOutputTokens, timeoutMs, responseSchema }) {
  const apiKey = env("GEMINI_API_KEY");
  const model = env("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;
  const budget = thinkingBudget();

  const contents = normalizeTurns(messages).map((t) => ({
    role: t.role === "assistant" ? "model" : "user",
    parts: [{ text: t.text }],
  }));
  if (!contents.length) throw new LlmError("there was nothing to send");

  const buildBody = (withThinking) => ({
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens,
      ...(responseSchema ? { responseMimeType: "application/json", responseSchema } : {}),
      ...(withThinking && budget !== null ? { thinkingConfig: { thinkingBudget: budget } } : {}),
    },
  });
  const send = (withThinking) =>
    postJson({
      url: `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`,
      headers: { "x-goog-api-key": apiKey },
      body: buildBody(withThinking),
      timeoutMs,
      timeoutMessage: "the Gemini request timed out",
      unreachableMessage: "could not reach the Gemini API",
    });

  let { res, data } = await send(true);
  // Some models (for example pro-tier ones) cannot switch thinking off; retry without the setting.
  if (res.status === 400 && budget !== null && /think/i.test(data?.error?.message || "")) {
    ({ res, data } = await send(false));
  }

  if (!res.ok) {
    const detail = data?.error?.message ? `: ${String(data.error.message).slice(0, 140)}` : "";
    throw new LlmError(`Gemini returned ${res.status}${detail}`, { status: res.status });
  }
  if (data?.promptFeedback?.blockReason) {
    throw new LlmError(`Gemini blocked the request (${data.promptFeedback.blockReason})`, { code: "blocked" });
  }

  // Reasoning models can return their thinking as parts flagged `thought`; never show those.
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .filter((p) => p.thought !== true)
    .map((p) => p.text || "")
    .join("")
    .trim();
  if (!text) throw new LlmError("Gemini returned an empty answer", { code: "empty" });
  return text;
}

// ---- local (OpenAI-compatible) ---------------------------------------------------------

function localHeaders({ apiKey }) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function localUnreachable(baseUrl) {
  return `could not reach the local model server at ${baseUrl} (is the LM Studio server running?)`;
}

// With no LOCAL_LLM_MODEL set, use the first non-embedding model the server lists.
async function detectLocalModel(cfg) {
  if (detectedLocalModel && detectedLocalModel.baseUrl === cfg.baseUrl) return detectedLocalModel.name;
  const { res, data } = await postJson({
    method: "GET",
    url: `${cfg.baseUrl}/models`,
    headers: localHeaders(cfg),
    timeoutMs: 5000,
    timeoutMessage: "the local model server did not answer in time",
    unreachableMessage: localUnreachable(cfg.baseUrl),
  });
  const name = res.ok ? (data?.data || []).map((m) => m.id).find((id) => id && !/embed/i.test(id)) : null;
  if (!name) throw new LlmError("no chat model is loaded on the local server (set LOCAL_LLM_MODEL)");
  detectedLocalModel = { baseUrl: cfg.baseUrl, name };
  return name;
}

// Some local models print their reasoning inline; it must not reach the candidate.
function stripReasoning(text) {
  return text.replace(/<(think|thought|thinking)>[\s\S]*?<\/\1>/gi, "").trim();
}

async function generateLocal({ system, messages, temperature, maxOutputTokens, timeoutMs }) {
  const cfg = localConfig();
  const turns = normalizeTurns(messages);
  if (!turns.length) throw new LlmError("there was nothing to send");
  const model = cfg.model || (await detectLocalModel(cfg));

  const { res, data } = await postJson({
    url: `${cfg.baseUrl}/chat/completions`,
    headers: localHeaders(cfg),
    body: {
      model,
      messages: [{ role: "system", content: system }, ...turns.map((t) => ({ role: t.role, content: t.text }))],
      temperature,
      max_tokens: maxOutputTokens,
      stream: false,
    },
    timeoutMs,
    timeoutMessage: "the local model took too long to answer",
    unreachableMessage: localUnreachable(cfg.baseUrl),
  });

  if (!res.ok) {
    const raw = data?.error?.message || data?.error;
    const detail = raw ? `: ${String(raw).slice(0, 140)}` : "";
    throw new LlmError(`the local model server returned ${res.status}${detail}`, { status: res.status });
  }
  const text = stripReasoning(String(data?.choices?.[0]?.message?.content || ""));
  if (!text) throw new LlmError("the local model returned an empty answer", { code: "empty" });
  return text;
}

// ---- public ----------------------------------------------------------------------------

async function generate({ system, messages, temperature = 0.4, maxOutputTokens = 1024, timeoutMs }) {
  const active = provider();
  if (!active) throw new LlmError("the LLM is not configured");
  const args = { system, messages, temperature, maxOutputTokens, timeoutMs: timeoutMs || defaultTimeoutMs() };
  const text = await (active === "local" ? generateLocal(args) : generateGemini(args));
  // The app never shows em/en dashes; models like to write them.
  return text.replace(/\s*[–—]\s*/g, (m) => (/\s/.test(m) ? " - " : "-"));
}

// ---- structured (JSON) output ----------------------------------------------------------

// Models sometimes wrap JSON in a ```json fence or add a sentence around it.
function parseJsonText(text) {
  const unfenced = String(text).replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        // fall through to the error below
      }
    }
    throw new LlmError("the model did not return valid JSON", { code: "invalid_json" });
  }
}

// Asks the model for a JSON object and returns it parsed. `responseSchema` is a Gemini schema
// (see toGeminiSchema in utils/schema.js) that makes Gemini produce matching JSON; the caller
// still has to validate the result, because a model can follow a schema and still be wrong.
async function generateJson({ system, messages, responseSchema, temperature = 0.2, maxOutputTokens = 1024, timeoutMs }) {
  const active = provider();
  if (!active) throw new LlmError("the LLM is not configured");
  const args = { system, messages, temperature, maxOutputTokens, timeoutMs: timeoutMs || defaultTimeoutMs() };
  const text = await (active === "local" ? generateLocal(args) : generateGemini({ ...args, responseSchema }));
  return parseJsonText(text);
}

module.exports = { generate, generateJson, isEnabled, status, reactionTimeoutMs, LlmError };
