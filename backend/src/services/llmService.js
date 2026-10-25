// LLM client for post-interview replies and short interviewer reactions. Interview
// preparation retrieves document context separately; scoring remains deterministic.
//
// Two providers sit behind one contract, generate({ system, messages }) -> string:
//   gemini - Google's Gemini API (needs GEMINI_API_KEY)
//   local  - any local server that speaks the OpenAI chat API: LM Studio, Ollama, llama.cpp
//            (LLM_PROVIDER=local; default URL is LM Studio's http://localhost:1234/v1)
// With neither configured the app keeps using its scripted replies. Configuration is read from
// the environment on every call (see .env.example). API keys go in headers and are never
// logged or included in error messages.

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const { trackAiRequest, createRequestLog } = require('./aiTelemetry');
// "gemini-flash-latest" is Google's alias for the current flash model, so the default does not
// break when a specific version is retired (gemini-2.5-flash already was for new keys).
const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
const DEFAULT_LOCAL_URL = "http://localhost:1234/v1";
const GEMINI_TIMEOUT_MS = 15000;
// A local model may have to load into memory on the first request, and small GPUs are slower.
const LOCAL_TIMEOUT_MS = 45000;

class LlmError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = "LlmError";
    this.upstreamStatus = status;
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
  if (explicit === "local") return process.env.STORE_BACKEND === 'memory' && process.env.NODE_ENV !== 'production' ? "local" : null;
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
    throw new LlmError(err.name === "AbortError" ? timeoutMessage : unreachableMessage);
  } finally {
    clearTimeout(timer);
  }
}

// ---- Gemini ----------------------------------------------------------------------------

async function generateGemini({ system, messages, temperature, maxOutputTokens, timeoutMs, meta }) {
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
      ...(withThinking && budget !== null ? { thinkingConfig: { thinkingBudget: budget } } : {}),
    },
  });
  const send = (withThinking) => trackAiRequest({ ...meta, model, provider: 'gemini', operation: 'chat' }, async note => {
    const result = await postJson({
      url: `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`,
      headers: { "x-goog-api-key": apiKey },
      body: buildBody(withThinking),
      timeoutMs,
      timeoutMessage: "the Gemini request timed out",
      unreachableMessage: "could not reach the Gemini API",
    });
    note({ usage: result.data?.usageMetadata, provider_status: result.res.status,
      ...(result.data?.modelVersion ? { model: result.data.modelVersion } : {}),
      ...(!result.res.ok ? { status: 'error', error_code: 'http_error' } : {}) });
    if (result.data?.promptFeedback?.blockReason) note({ status: 'refused', error_code: 'provider_blocked' });
    else if (result.res.ok && !(result.data?.candidates?.[0]?.content?.parts || []).some(p => !p.thought && p.text?.trim())) {
      throw Object.assign(new LlmError('Gemini returned an empty answer'), { code: 'empty_response' });
    }
    return result;
  });

  let { res, data } = await send(true);
  // Some models (for example pro-tier ones) cannot switch thinking off; retry without the setting.
  if (res.status === 400 && budget !== null && /think/i.test(data?.error?.message || "")) {
    ({ res, data } = await send(false));
  }

  if (!res.ok) {
    const safeDetail = /api key.*not valid/i.test(data?.error?.message || '') ? ': API key not valid.' : '';
    throw new LlmError(`Gemini returned ${res.status}${safeDetail}`, { status: res.status });
  }
  if (data?.promptFeedback?.blockReason) {
    throw new LlmError(`Gemini blocked the request (${data.promptFeedback.blockReason})`);
  }

  // Reasoning models can return their thinking as parts flagged `thought`; never show those.
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .filter((p) => p.thought !== true)
    .map((p) => p.text || "")
    .join("")
    .trim();
  if (!text) throw new LlmError("Gemini returned an empty answer");
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

async function generateLocal({ system, messages, temperature, maxOutputTokens, timeoutMs, meta }) {
  const cfg = localConfig();
  const turns = normalizeTurns(messages);
  if (!turns.length) throw new LlmError("there was nothing to send");
  const model = cfg.model || (await detectLocalModel(cfg));

  return trackAiRequest({ ...meta, model, provider: 'local', operation: 'chat' }, async note => {
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
  note({ usage: data?.usage, provider_status: res.status });
  const text = stripReasoning(String(data?.choices?.[0]?.message?.content || ""));
  if (!text) throw new LlmError("the local model returned an empty answer");
  return text;
  });
}

// ---- public ----------------------------------------------------------------------------

async function generate({ system, messages, temperature = 0.4, maxOutputTokens = 1024, timeoutMs, meta }) {
  const active = provider();
  if (!active) throw new LlmError("the LLM is not configured");
  const args = { system, messages, temperature, maxOutputTokens, timeoutMs: timeoutMs || defaultTimeoutMs(),
    meta: { ...meta, legacyInvocation: {} } };
  const text = await (active === "local" ? generateLocal(args) : generateGemini(args));
  // The app never shows em/en dashes; models like to write them.
  return text.replace(/\s*[–—]\s*/g, (m) => (/\s/.test(m) ? " - " : "-"));
}

async function* parseSse(body) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let end;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block.split("\n").filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart()).join("\n");
      if (data) yield data;
    }
  }
}

function reasoningFilter() {
  let buffer = "";
  let hidden = false;
  return {
    push(text) {
      buffer += text;
      let visible = "";
      while (buffer) {
        if (hidden) {
          const end = buffer.match(/<\/(think|thought|thinking)>/i);
          if (!end) {
            buffer = buffer.slice(-32);
            break;
          }
          buffer = buffer.slice(end.index + end[0].length);
          hidden = false;
          continue;
        }
        const start = buffer.match(/<(think|thought|thinking)>/i);
        if (start) {
          visible += buffer.slice(0, start.index);
          buffer = buffer.slice(start.index + start[0].length);
          hidden = true;
          continue;
        }
        const partial = buffer.lastIndexOf("<");
        if (partial !== -1 && buffer.length - partial < 12) {
          visible += buffer.slice(0, partial);
          buffer = buffer.slice(partial);
          break;
        }
        visible += buffer;
        buffer = "";
      }
      return visible;
    },
    finish() { return hidden ? "" : buffer.replace(/<[^>]*$/, ""); },
  };
}

async function* generateStream({ system, messages, temperature = 0.2, maxOutputTokens = 1024, signal, meta }) {
  meta = { ...meta, legacyInvocation: {} };
  const active = provider();
  if (!active) throw new LlmError("the LLM is not configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), defaultTimeoutMs());
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const turns = normalizeTurns(messages);
  const filter = reasoningFilter();
  const budget = active === "gemini" ? thinkingBudget() : null;
  let log = createRequestLog({ ...meta, model: status().model, provider: active, operation: 'chat_stream', signal });
  let failure;
  let visibleText = '';
  try {
    let url;
    let headers = { "Content-Type": "application/json" };
    let body;
    if (active === "gemini") {
      const model = env("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;
      url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
      headers["x-goog-api-key"] = env("GEMINI_API_KEY");
      body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((turn) => ({ role: turn.role === "assistant" ? "model" : "user", parts: [{ text: turn.text }] })),
        generationConfig: { temperature, maxOutputTokens,
          ...(budget !== null ? { thinkingConfig: { thinkingBudget: budget } } : {}) },
      };
    } else {
      const cfg = localConfig();
      url = `${cfg.baseUrl}/chat/completions`;
      headers = { ...headers, ...localHeaders(cfg) };
      body = {
        model: cfg.model || await detectLocalModel(cfg),
        messages: [{ role: "system", content: system }, ...turns.map((turn) => ({ role: turn.role, content: turn.text }))],
        temperature, max_tokens: maxOutputTokens, stream: true,
      };
    }
    let response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    if (active === "gemini" && response.status === 400 && budget !== null) {
      const detail = await response.json().catch(() => ({}));
      if (/think/i.test(detail?.error?.message || "")) {
        await log.finish(new LlmError('thinking configuration rejected', { status: 400 }));
        log = createRequestLog({ ...meta, model: status().model, provider: active, operation: 'chat_stream', signal });
        delete body.generationConfig.thinkingConfig;
        response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
      }
    }
    if (!response.ok || !response.body) throw new LlmError(`${active} stream returned ${response.status}`, { status: response.status });
    log.note({ provider_status: response.status, ...(active === 'local' ? { model: body.model } : {}) });
    for await (const data of parseSse(response.body)) {
      if (data === "[DONE]") break;
      let event;
      try { event = JSON.parse(data); } catch { continue; }
      if (event.usageMetadata) log.note({ usage: event.usageMetadata });
      if (event.usage) log.note({ usage: event.usage });
      if (event.modelVersion) log.note({ model: event.modelVersion });
      if (event.error) throw new LlmError('the Gemini stream failed', { status: event.error.code });
      const token = active === "gemini"
        ? (event.candidates?.[0]?.content?.parts || []).filter((part) => part.thought !== true).map((part) => part.text || "").join("")
        : event.choices?.[0]?.delta?.content;
      if (token) {
        visibleText += token;
        const visible = filter.push(token);
        if (visible) yield visible.replace(/\s*[–—]\s*/g, (part) => (/\s/.test(part) ? " - " : "-"));
      }
    }
    const tail = filter.finish();
    if (tail) yield tail;
    if (!visibleText.trim()) throw Object.assign(new LlmError('the AI returned an empty answer'), { code: 'empty_response' });
  } catch (error) {
    failure = error;
    if (error.name === "AbortError") throw new LlmError("the LLM stream timed out or was cancelled");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    await log.finish(failure);
  }
}

const generateWithTools = options => require('./geminiClient').requestJson(options);
async function generateJson({ system, messages = [], contents, responseSchema, validate, schema, fallback, signal, model, meta = {} }) {
  const turns = contents || normalizeTurns(messages).map(t => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] }));
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await require('./geminiClient').requestJson({ system, contents: turns, responseSchema, signal, model,
        meta: { ...meta, capability: meta.capability || 'critique' }, validateOutput: text => {
          const json = JSON.parse(text); return validate ? validate(json) : schema ? schema.parse(json) : json;
        } });
      return result.value;
    } catch (error) {
      failure = error;
      if (signal?.aborted || error.code !== 'invalid_json') break;
      turns.push({ role: 'model', parts: [{ text: 'Invalid JSON output.' }] }, { role: 'user', parts: [{ text: 'The output failed JSON/schema validation. Return only valid JSON matching the requested schema.' }] });
    }
  }
  if (fallback !== undefined && !signal?.aborted) return typeof fallback === 'function' ? fallback() : fallback;
  throw failure;
}
module.exports = { generate, generateStream, stream: generateStream, generateJson, generateWithTools, parseSse, reasoningFilter, isEnabled, status, reactionTimeoutMs, LlmError };
