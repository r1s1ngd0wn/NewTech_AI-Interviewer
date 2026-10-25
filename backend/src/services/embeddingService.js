const DIMENSIONS = 768;
const { trackAiRequest } = require('./aiTelemetry');

function config() {
  const provider = (process.env.EMBEDDING_PROVIDER || "").toLowerCase();
  if (provider === "gemini" && process.env.GEMINI_API_KEY) {
    return { provider, model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001" };
  }
  if (provider === "local" && process.env.LOCAL_EMBEDDING_MODEL && process.env.STORE_BACKEND === 'memory' && process.env.NODE_ENV !== 'production') {
    return { provider, model: process.env.LOCAL_EMBEDDING_MODEL };
  }
  return null;
}

async function embedRequest(text, taskType = "RETRIEVAL_DOCUMENT", note = () => {}) {
  const active = config();
  if (!active) throw new Error("embedding provider is not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const url = active.provider === "gemini"
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(active.model)}:embedContent`
      : `${(process.env.LOCAL_LLM_URL || "http://localhost:1234/v1").replace(/\/+$/, "")}/embeddings`;
    const headers = { "Content-Type": "application/json" };
    if (active.provider === "gemini") headers["x-goog-api-key"] = process.env.GEMINI_API_KEY;
    else if (process.env.LOCAL_LLM_API_KEY) headers.Authorization = `Bearer ${process.env.LOCAL_LLM_API_KEY}`;
    const body = active.provider === "gemini"
      ? { model: `models/${active.model}`, content: { parts: [{ text }] },
          embedContentConfig: { taskType, outputDimensionality: DIMENSIONS, autoTruncate: true } }
      : { model: active.model, input: text };
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    if (!response.ok) throw Object.assign(new Error(`embedding provider returned ${response.status}`), { upstreamStatus: response.status });
    const data = await response.json();
    note({ usage: data.usageMetadata, provider_status: response.status });
    const vector = active.provider === "gemini" ? data.embedding?.values : data.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.some((value) => !Number.isFinite(value))) {
      throw new Error("embedding model returned an invalid vector");
    }
    if (active.provider === "gemini" && vector.length >= DIMENSIONS) {
      const reduced = vector.slice(0, DIMENSIONS);
      const magnitude = Math.hypot(...reduced);
      if (!magnitude) throw new Error("embedding model returned a zero vector");
      return reduced.map((value) => value / magnitude);
    }
    if (vector.length !== DIMENSIONS) {
      throw new Error(`embedding model returned ${vector.length} dimensions; expected ${DIMENSIONS}`);
    }
    return vector;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("embedding request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function embed(text, taskType = 'RETRIEVAL_DOCUMENT') {
  const active = config();
  return trackAiRequest({ capability: 'embed', prompt_name: 'embedding', prompt_version: 'long-v1', model: active?.model, provider: active?.provider }, note => embedRequest(text, taskType, note));
}
module.exports = { config, embed, DIMENSIONS };
