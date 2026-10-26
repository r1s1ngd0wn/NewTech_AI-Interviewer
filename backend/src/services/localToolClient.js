// Tool-calling client for a local server that speaks the OpenAI chat API (LM Studio).
// The agent keeps its conversation in Gemini's shape (contents with text, functionCall and
// functionResponse parts). This client translates that to OpenAI messages and tools and back, so
// agent.js does not care which provider answered.
const { trackAiRequest } = require('./aiTelemetry');

class LocalError extends Error {
  constructor(message, status, code = 'provider_error') { super(message); this.name = 'LlmError'; this.upstreamStatus = status; this.code = code; }
}

// Gemini schemas use upper-case type names ("OBJECT"); JSON Schema wants lower case.
function toJsonSchema(node) {
  if (Array.isArray(node)) return node.map(toJsonSchema);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).map(([key, value]) =>
    [key, key === 'type' && typeof value === 'string' ? value.toLowerCase() : toJsonSchema(value)]));
}

function toOpenAiTools(tools) {
  return tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: toJsonSchema(tool.parameters) } }));
}

// A model turn can carry several calls; ids pair each call with its answer.
function toOpenAiMessages(system, contents) {
  const messages = [{ role: 'system', content: system }];
  let counter = 0;
  const pending = [];
  for (const content of contents) {
    const parts = content.parts || [];
    if (content.role === 'model') {
      const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
      const calls = parts.filter((p) => p.functionCall).map((p) => {
        const id = p.functionCall.id || `call_${++counter}`;
        pending.push({ id, name: p.functionCall.name });
        return { id, type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } };
      });
      messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    for (const part of parts) {
      if (part.functionResponse) {
        const index = pending.findIndex((p) => (part.functionResponse.id ? p.id === part.functionResponse.id : p.name === part.functionResponse.name));
        const [match] = index === -1 ? [{ id: part.functionResponse.id || `call_${++counter}` }] : pending.splice(index, 1);
        messages.push({ role: 'tool', tool_call_id: match.id, content: JSON.stringify(part.functionResponse.response) });
      } else if (part.text) {
        messages.push({ role: 'user', content: part.text });
      }
    }
  }
  return messages;
}

function parseArguments(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { const value = JSON.parse(raw || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch { throw new LocalError('the local model sent tool arguments that are not valid JSON', undefined, 'invalid_json'); }
}

async function requestJson({ system, contents, tools, signal, onToken, temperature = 0.2, maxOutputTokens = 1200, timeoutMs, model, meta = {}, config }) {
  const { baseUrl, apiKey, model: configuredModel, detectModel, filter } = config;
  const chosen = model || configuredModel || await detectModel();
  return trackAiRequest({ ...meta, model: chosen, signal, provider: 'local', operation: 'tools' }, async (note) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs || Number(process.env.LLM_TIMEOUT_MS) || 45000);
    try {
      let response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({
            model: chosen, messages: toOpenAiMessages(system, contents), temperature, max_tokens: maxOutputTokens,
            ...(tools?.length ? { tools: toOpenAiTools(tools), tool_choice: 'auto' } : {}),
            stream: true, stream_options: { include_usage: true },
          }),
        });
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new LocalError(`could not reach the local model server at ${baseUrl}`, undefined, 'unreachable');
      }
      note({ provider_status: response.status });
      if (!response.ok || !response.body) throw new LocalError(`the local model server returned ${response.status}`, response.status);

      let text = '';
      let usage;
      const calls = new Map();
      const hide = require('./llmService').reasoningFilter();
      for await (const raw of require('./llmService').parseSse(response.body)) {
        if (raw === '[DONE]') break;
        let event;
        try { event = JSON.parse(raw); } catch { continue; }
        if (event.error) throw new LocalError('the local model stream failed', event.error.code);
        if (event.usage) { usage = event.usage; note({ usage }); }
        const delta = event.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          text += delta.content;
          const visible = filter ? hide.push(delta.content) : delta.content;
          if (visible && !calls.size) onToken?.(visible);
        }
        for (const piece of delta.tool_calls || []) {
          const slot = calls.get(piece.index ?? 0) || { id: piece.id, name: '', arguments: '' };
          if (piece.id) slot.id = piece.id;
          if (piece.function?.name) slot.name += piece.function.name;
          if (piece.function?.arguments) slot.arguments += piece.function.arguments;
          calls.set(piece.index ?? 0, slot);
        }
      }
      const visibleText = text.replace(/<(think|thought|thinking)>[\s\S]*?<\/\1>/gi, '').trim();
      const functionCalls = [...calls.values()].filter((call) => call.name).map((call, index) =>
        ({ id: call.id || `call_${index + 1}`, name: call.name, args: parseArguments(call.arguments) }));
      note({ tools: functionCalls.map((call) => call.name) });
      if (!functionCalls.length && !visibleText) throw new LocalError('the local model returned an empty answer', response.status, 'empty_response');
      const parts = [...(visibleText ? [{ text: visibleText }] : []), ...functionCalls.map((call) => ({ functionCall: call }))];
      return { content: { role: 'model', parts }, calls: functionCalls, text: visibleText, value: undefined, model: chosen, usage };
    } catch (error) {
      if (error.name === 'AbortError' && !signal?.aborted) throw new LocalError('the local model request timed out', undefined, 'timeout');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  });
}

module.exports = { requestJson, toOpenAiMessages, toOpenAiTools, LocalError };
