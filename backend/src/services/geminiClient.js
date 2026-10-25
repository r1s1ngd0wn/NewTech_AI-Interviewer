const { trackAiRequest } = require('./aiTelemetry');
class GeminiError extends Error {
  constructor(message, status, code = 'provider_error') { super(message); this.name = 'LlmError'; this.upstreamStatus = status; this.code = code; }
}
async function requestAttempt({ system, contents, tools, signal, onToken, temperature = 0.2, maxOutputTokens = 1200, timeoutMs, model, responseSchema, validateOutput, thinkingBudget, meta = {} }) {
  model ||= process.env.GEMINI_MODEL || 'gemini-flash-latest';
  if (!process.env.GEMINI_API_KEY || process.env.LLM_PROVIDER === 'none' || process.env.LLM_PROVIDER === 'local') throw new GeminiError('the LLM is not configured or is disabled', undefined, 'not_configured');
  return trackAiRequest({ ...meta, model, signal, provider: 'gemini', operation: responseSchema || validateOutput ? 'json' : 'tools' }, async note => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs || Number(process.env.LLM_TIMEOUT_MS) || 15000);
    try {
      const method = onToken ? 'streamGenerateContent?alt=sse' : 'generateContent';
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, signal: controller.signal,
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents,
          ...(tools?.length ? { tools: [{ functionDeclarations: tools }] } : {}),
          generationConfig: { temperature, maxOutputTokens,
            ...(thinkingBudget !== undefined && thinkingBudget !== null ? { thinkingConfig: { thinkingBudget } } : {}),
            ...(responseSchema ? { responseMimeType: 'application/json', responseSchema } : {}) } }),
      });
      let data;
      if (onToken && response.ok && response.body) {
        const parts = [];
        let usageMetadata;
        for await (const raw of require('./llmService').parseSse(response.body)) {
          let event;
          try { event = JSON.parse(raw); } catch { throw new GeminiError('Gemini returned invalid stream data', response.status, 'invalid_json'); }
          if (event.error) throw new GeminiError('Gemini stream failed', event.error.code);
          if (event.usageMetadata) { usageMetadata = event.usageMetadata; note({ usage: usageMetadata }); }
          if (event.modelVersion) note({ model: event.modelVersion });
          for (const part of event.candidates?.[0]?.content?.parts || []) {
            parts.push(part);
            if (part.text && !part.thought) onToken(part.text);
          }
          if (event.promptFeedback?.blockReason) throw new GeminiError('Gemini refused this request', response.status, 'provider_blocked');
        }
        data = { candidates: [{ content: { role: 'model', parts } }], usageMetadata };
      } else data = await response.json().catch(() => null);
      note({ usage: data?.usageMetadata, provider_status: response.status });
      if (data?.modelVersion) note({ model: data.modelVersion });
      if (!response.ok) throw new GeminiError(`Gemini returned ${response.status}`, response.status,
        response.status === 400 && thinkingBudget !== undefined && thinkingBudget !== null && /think/i.test(data?.error?.message || '')
          ? 'thinking_config' : 'provider_error');
      const content = data?.candidates?.[0]?.content;
      const calls = (content?.parts || []).filter(p => p.functionCall).map(p => p.functionCall);
      note({ tools: calls.map(c => c.name) });
      if (data?.promptFeedback?.blockReason) { note({ status: 'refused', error_code: 'provider_blocked' }); throw new GeminiError('Gemini refused this request', response.status, 'provider_blocked'); }
      const text = (content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
      if (!calls.length && !text) throw new GeminiError('Gemini returned an empty answer', response.status, 'empty_response');
      let value;
      if (validateOutput) {
        try { value = validateOutput(text); }
        catch { throw new GeminiError('AI output failed JSON/schema validation', response.status, 'invalid_json'); }
      }
      return { content, calls, text, value, model: data.modelVersion || model, usage: data.usageMetadata };
    } catch (error) {
      if (error.name === 'AbortError' && !signal?.aborted) throw new GeminiError('the Gemini request timed out', undefined, 'timeout');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  });
}
async function requestJson(options) {
  try { return await requestAttempt(options); }
  catch (error) {
    // A rejected configuration is a separate outbound attempt, not a JSON retry.
    if (error.code === 'thinking_config' && !options.signal?.aborted) {
      return requestAttempt({ ...options, thinkingBudget: null });
    }
    throw error;
  }
}
module.exports = { requestJson, GeminiError };
