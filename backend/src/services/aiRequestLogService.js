// Compatibility with Long_RAG. Provider clients own per-attempt telemetry.
const { randomUUID } = require('node:crypto');
const context = require('../context/requestContext');
const telemetry = require('./aiTelemetry');
const { adminClient, memoryPreview } = require('../db/supabase');

function ownerColumns(userId) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
    ? ['user_id', 'legacy_user_id'] : ['legacy_user_id'];
}

function runForUser(userId, callback) {
  const scope = context.getStore() || {};
  return context.run({ ...scope, userId, requestId: scope.requestId || randomUUID(), legacyAiOperations: new Map() }, callback);
}

async function logAiRequest(entry, options) {
  const recorded = context.getStore()?.legacyAiOperations;
  const pending = recorded?.get(entry.operation) || 0;
  if (pending) { recorded.set(entry.operation, pending - 1); return; }
  return telemetry.logAiRequest({ ...entry,
    capability: entry.capability || (entry.operation?.startsWith('embed') ? 'embed' : entry.operation === 'json' ? 'critique' : 'coach'),
    prompt_version: entry.prompt_version ?? entry.promptVersion,
    latency_ms: entry.latency_ms ?? entry.durationMs,
    status: entry.status === 'cancelled' ? 'error' : entry.status,
    error_code: entry.status === 'cancelled' ? 'cancelled' : entry.error_code,
  }, options);
}

async function listForUser(userId) {
  if (memoryPreview()) return [];
  const client = adminClient(); const rows = new Map();
  // Equality filters avoid interpolating owner IDs into PostgREST expressions.
  for (const ownerColumn of ownerColumns(userId)) {
    for (let start = 0; ; start += 1000) {
      const { data, error } = await client.from('ai_logs').select('*').eq(ownerColumn, userId)
        .order('created_at').order('id').range(start, start + 999);
      if (error) throw new Error('AI request metadata could not be read');
      for (const row of data) rows.set(row.id, row);
      if (data.length < 1000) break;
    }
  }
  return [...rows.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(row => ({ ...row,
    promptVersion: row.prompt_version, durationMs: row.latency_ms, createdAt: row.created_at,
    status: row.error_code === 'cancelled' ? 'cancelled' : row.status }));
}

async function deleteForUser(userId) {
  if (memoryPreview()) return;
  const client = adminClient();
  for (const ownerColumn of ownerColumns(userId)) {
    const { error } = await client.from('ai_logs').delete().eq(ownerColumn, userId);
    if (error) throw new Error('AI request metadata could not be deleted');
  }
}

module.exports = { runForUser, logAiRequest, listForUser, deleteForUser };
