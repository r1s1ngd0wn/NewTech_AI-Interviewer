const { randomUUID } = require('node:crypto');
const context = require('../context/requestContext');
const { adminClient, memoryPreview } = require('../db/supabase');
const pricing = require('../config/pricing.json');
const health = require('./aiHealth');

function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
async function defaultWrite(row) {
  if (memoryPreview()) return;
  const { error } = await adminClient().from('ai_logs').insert(row);
  if (error) throw new Error('telemetry write failed');
}
async function logAiRequest(entry, { write = defaultWrite } = {}) {
  const scope = context.getStore() || {};
  const uuidOwner = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scope.userId || '');
  const tokensIn = count(entry.tokens_in); const tokensOut = count(entry.tokens_out);
  const rate = pricing.models[entry.model];
  const cost = rate && tokensIn !== null && tokensOut !== null
    ? (tokensIn * rate.input + tokensOut * rate.output) / 1000000 : null;
  const row = {
    id: randomUUID(), created_at: new Date().toISOString(), request_id: scope.requestId || null,
    user_id: uuidOwner ? scope.userId : null, legacy_user_id: !uuidOwner ? scope.userId || null : null,
    capability: entry.capability || scope.capability || 'coach',
    prompt_name: entry.prompt_name || scope.promptName || null, prompt_version: entry.prompt_version || scope.promptVersion || null,
    model: entry.model || null, provider: entry.provider || null, operation: entry.operation || (entry.model ? 'unknown' : 'guardrail'),
    tools: [...new Set(entry.tools || [])].slice(0, 30),
    tokens_in: tokensIn, tokens_out: tokensOut, latency_ms: Math.max(0, Math.round(entry.latency_ms || 0)),
    cost_usd: cost, status: entry.status || 'ok', error_code: entry.error_code || null, provider_status: entry.provider_status || null,
  };
  // A logging outage must not break interviews or retry a completed write tool.
  try { await write(row); } catch { console.warn('AI telemetry could not be persisted'); }
  return row;
}
function createRequestLog(meta, options) {
  const start = performance.now(); let details = {}; let finished = false;
  return {
    note(value) { details = { ...details, ...value }; },
    async finish(error) {
      if (finished) return; finished = true;
      // Suppress Long's outer summary when a provider attempt already owns the log.
      const scope = context.getStore();
      if (scope && !meta.legacyInvocation?.recorded) {
        const recorded = scope.legacyAiOperations ||= new Map();
        recorded.set(meta.operation, (recorded.get(meta.operation) || 0) + 1);
        if (meta.legacyInvocation) meta.legacyInvocation.recorded = true;
      }
      if (!error && meta.signal?.aborted) error = Object.assign(new Error('cancelled'), { name: 'AbortError' });
      const aborted = error?.name === 'AbortError' || /timed out|timeout/i.test(error?.message || '');
      const cancelled = error?.name === 'AbortError' && meta.signal?.aborted;
      const status = error ? error.code === 'invalid_json' ? 'invalid_json' : error.code === 'provider_blocked' ? 'refused'
        : (aborted && !cancelled ? 'timeout' : 'error') : details.status || 'ok';
      if (!cancelled && meta.provider !== 'local') {
        if (status === 'ok' || status === 'refused') health.recordSuccess();
        else health.recordFailure(error || { upstreamStatus: details.provider_status });
      }
      return logAiRequest({ ...meta, ...details, status,
        tokens_in: details.usage?.promptTokenCount ?? details.usage?.inputTokenCount ?? details.usage?.prompt_tokens,
        // Gemini totalTokenCount includes reasoning; output usage must include it too.
        tokens_out: (meta.capability === 'embed' && details.usage) ? 0
          : details.usage && Number.isFinite(details.usage.candidatesTokenCount ?? details.usage.outputTokenCount ?? details.usage.completion_tokens)
            ? (details.usage.candidatesTokenCount ?? details.usage.outputTokenCount ?? details.usage.completion_tokens) + (details.usage.thoughtsTokenCount || 0) : null,
        latency_ms: performance.now() - start,
        error_code: cancelled ? 'cancelled' : error?.code || (error ? (aborted ? 'timeout' : 'provider_error') : details.error_code),
        provider_status: error?.upstreamStatus || details.provider_status,
      }, options);
    },
  };
}
async function trackAiRequest(meta, operation, options) {
  const log = createRequestLog(meta, options);
  try { const value = await operation(log.note); await log.finish(); return value; }
  catch (error) { await log.finish(error); throw error; }
}
module.exports = { logAiRequest, trackAiRequest, createRequestLog };
