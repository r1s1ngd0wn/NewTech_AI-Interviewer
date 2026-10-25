process.env.STORE_BACKEND = 'memory';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const context = require('../src/context/requestContext');
const telemetry = require('../src/services/aiTelemetry');

test('shared telemetry retains provider, operation, and legacy metadata', async () => {
  const rows = [];
  const row = await telemetry.logAiRequest({ provider: 'gemini', operation: 'chat', model: 'm',
    prompt_version: 'long-v1', status: 'ok' }, { write: async row => rows.push(row) });
  assert.equal(row.provider, 'gemini');
  assert.equal(row.operation, 'chat');
  assert.equal(rows.length, 1);
});

test('Long adapter preserves context and maps legacy fields without duplicate provider logs', async () => {
  const legacy = require('../src/services/aiRequestLogService');
  const rows = []; const write = async row => rows.push(row);
  await context.run({ requestId: 'request-1', promptName: 'knowledge-coach' }, () =>
    legacy.runForUser('alice', async () => {
      await telemetry.trackAiRequest({ provider: 'gemini', operation: 'chat', model: 'm' },
        async note => note({ usage: { promptTokenCount: 3, candidatesTokenCount: 2 } }), { write });
      await legacy.logAiRequest({ provider: 'gemini', model: 'm', operation: 'chat',
        durationMs: 25, promptVersion: 'long-v1', status: 'ok' }, { write });
    }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].request_id, 'request-1'); assert.equal(rows[0].user_id, null);
  assert.equal(rows[0].legacy_user_id, 'alice');
  assert.equal(rows[0].prompt_name, 'knowledge-coach');
  await legacy.runForUser('bob', () => legacy.logAiRequest({ provider: 'gemini', model: 'm',
    operation: 'embed_query', promptVersion: 'long-v1', durationMs: 25, status: 'cancelled' }, { write }));
  assert.equal(rows.length, 2); assert.equal(rows[1].capability, 'embed');
  assert.equal(rows[1].prompt_version, 'long-v1'); assert.equal(rows[1].latency_ms, 25);
  assert.equal(rows[1].status, 'error'); assert.equal(rows[1].error_code, 'cancelled');
  assert.ok(rows[1].request_id);
});

test('RAG chat, agent tools and embeddings emit three rows with one request ID', async t => {
  const supabase = require('../src/db/supabase');
  const rows = [];
  t.mock.method(supabase, 'memoryPreview', () => false);
  t.mock.method(supabase, 'adminClient', () => ({ from: table => {
    assert.equal(table, 'ai_logs'); return { insert: async row => { rows.push(row); return {}; } };
  } }));
  // Reload telemetry so its destructured persistence dependencies use the test writer.
  delete require.cache[require.resolve('../src/services/aiTelemetry')];
  for (const file of ['llmService', 'geminiClient', 'embeddingService']) delete require.cache[require.resolve(`../src/services/${file}`)];
  const client = require('../src/services/llmService');
  const embed = require('../src/services/embeddingService');
  const env = { ...process.env };
  t.after(() => { process.env = env; });
  process.env.GEMINI_API_KEY = 'test'; process.env.EMBEDDING_PROVIDER = 'gemini'; process.env.LLM_PROVIDER = 'gemini';
  t.mock.method(global, 'fetch', async url => ({ ok: true, status: 200, json: async () =>
    url.includes('embedContent') ? { embedding: { values: Array(768).fill(1) }, usageMetadata: { promptTokenCount: 7 } }
    : { candidates: [{ content: { parts: url.includes('generateContent') && rows.length === 1
      ? [{ functionCall: { name: 'search_knowledge', args: {} } }] : [{ text: 'answer' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } } }));
  const owner = '00000000-0000-4000-8000-000000000001';
  await context.run({ requestId: 'request-shared', userId: owner }, async () => {
    await client.generate({ system: 's', messages: [{ role: 'user', text: 'cv' }], meta: { prompt_version: 'long-v1' } });
    await client.generateWithTools({ system: 's', contents: [], tools: [{ name: 'search_knowledge' }] });
    await embed.embed('cv', 'RETRIEVAL_QUERY');
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.operation), ['chat', 'tools', 'embed_query']);
  assert.ok(rows.every(r => r.provider === 'gemini' && r.request_id === 'request-shared' && r.user_id === owner));
  assert.deepEqual(rows[1].tools, ['search_knowledge']); assert.equal(rows[2].tokens_out, 0);
});

test('compatibility summary is suppressed in the existing HTTP context without runForUser', async () => {
  const legacy = require('../src/services/aiRequestLogService');
  const rows = []; const write = async row => rows.push(row);
  await context.run({ requestId: 'http-request', userId: 'alice' }, async () => {
    await telemetry.trackAiRequest({ provider: 'gemini', operation: 'chat' }, async () => 'ok', { write });
    await legacy.logAiRequest({ provider: 'gemini', operation: 'chat', durationMs: 2, status: 'ok' }, { write });
  });
  assert.equal(rows.length, 1);
});

test('overlapping calls each suppress their own legacy summary', async () => {
  const legacy = require('../src/services/aiRequestLogService');
  const rows = []; const write = async row => rows.push(row);
  await legacy.runForUser('alice', async () => {
    await Promise.all([1, 2].map(() => telemetry.trackAiRequest({ provider: 'gemini', operation: 'chat' }, async () => 'ok', { write })));
    for (let i = 0; i < 2; i++) await legacy.logAiRequest({ provider: 'gemini', operation: 'chat', status: 'ok', durationMs: 1 }, { write });
  });
  assert.equal(rows.length, 2);
});

test('compatibility export and erase include owned legacy rows and never other users', async t => {
  const supabase = require('../src/db/supabase');
  const owner = '00000000-0000-4000-8000-000000000001';
  const deleted = [];
  const records = [
    { id: '1', user_id: owner, legacy_user_id: owner, prompt_version: 'long-v1', latency_ms: 12, created_at: '2026-10-24', status: 'ok' },
    { id: '2', user_id: null, legacy_user_id: owner, latency_ms: 14, created_at: '2026-10-25', status: 'error', error_code: 'cancelled' },
    { id: '3', user_id: 'bob', legacy_user_id: 'bob' },
  ];
  t.mock.method(supabase, 'memoryPreview', () => false);
  t.mock.method(supabase, 'adminClient', () => ({ from: table => {
    assert.equal(table, 'ai_logs');
    return {
      select: () => ({ eq: (key, value) => { const query = { order: () => query, range: async (start, end) =>
        ({ data: records.filter(r => r[key] === value).slice(start, end + 1) }) }; return query; } }),
      delete: () => ({ eq: async (key, value) => { deleted.push([key, value]); return {}; } }),
    };
  } }));
  delete require.cache[require.resolve('../src/services/aiRequestLogService')];
  const legacy = require('../src/services/aiRequestLogService');
  const rows = await legacy.listForUser(owner);
  assert.equal(rows.length, 2); assert.equal(rows[0].promptVersion, 'long-v1');
  assert.equal(rows[1].durationMs, 14); assert.equal(rows[1].status, 'cancelled');
  await legacy.deleteForUser(owner);
  assert.deepEqual(deleted, [['user_id', owner], ['legacy_user_id', owner]]);
});

test('legacy text owners never reach a UUID filter', async t => {
  const supabase = require('../src/db/supabase');
  const queried = [];
  t.mock.method(supabase, 'memoryPreview', () => false);
  const query = { order: () => query, range: async () => ({ data: [] }) };
  const eq = (key, value) => { queried.push([key, value]); assert.notEqual(key, 'user_id'); return query; };
  t.mock.method(supabase, 'adminClient', () => ({ from: () => ({ select: () => ({ eq }), delete: () => ({
    eq: async (key, value) => { eq(key, value); return {}; },
  }) }) }));
  delete require.cache[require.resolve('../src/services/aiRequestLogService')];
  const legacy = require('../src/services/aiRequestLogService');
  await legacy.listForUser('old-text-owner'); await legacy.deleteForUser('old-text-owner');
  assert.deepEqual(queried, [['legacy_user_id', 'old-text-owner'], ['legacy_user_id', 'old-text-owner']]);
});

test('provider retries and streams each record one attempt, and outages do not retry completed calls', async t => {
  const supabase = require('../src/db/supabase'); const rows = [];
  let failWrite = false;
  t.mock.method(supabase, 'memoryPreview', () => false);
  t.mock.method(supabase, 'adminClient', () => ({ from: () => ({ insert: async row => {
    rows.push(row); return failWrite ? { error: { message: 'private database detail' } } : {};
  } }) }));
  for (const file of ['aiTelemetry', 'llmService', 'geminiClient']) delete require.cache[require.resolve(`../src/services/${file}`)];
  const llm = require('../src/services/llmService');
  const env = { ...process.env }; t.after(() => { process.env = env; });
  process.env.GEMINI_API_KEY = 'test'; process.env.LLM_PROVIDER = 'gemini'; process.env.GEMINI_THINKING_BUDGET = '0';
  let calls = 0; let mode = 'retry';
  t.mock.method(global, 'fetch', async () => {
    calls++;
    if (mode === 'stream') return { ok: true, status: 200, body: (async function* () {
      yield Buffer.from('data: {"candidates":[{"content":{"parts":[{"text":"answer"}]}}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":2}}\n\n');
    })() };
    if (mode === 'retry' && calls === 1) return { ok: false, status: 400, json: async () => ({ error: { message: 'thinking unsupported' } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: mode === 'json' ? '{bad' : 'answer' }] } }] }) };
  });
  await context.run({ userId: 'alice', requestId: 'request-retry' }, async () => {
    assert.equal(await llm.generate({ system: 's', messages: [{ role: 'user', text: 'hi' }] }), 'answer');
    assert.equal(rows.length, 2); assert.deepEqual(rows.map(r => r.status), ['error', 'ok']);
    assert.ok(rows.every(r => r.operation === 'chat' && r.request_id === 'request-retry'));
    const legacy = require('../src/services/aiRequestLogService');
    await legacy.logAiRequest({ provider: 'gemini', operation: 'chat', status: 'ok', durationMs: 1 }, { write: async row => rows.push(row) });
    assert.equal(rows.length, 2);
    // A retry belongs to one invocation; it must not suppress a later legacy-only call.
    const standalone = [];
    await legacy.logAiRequest({ provider: 'gemini', operation: 'chat', status: 'ok', durationMs: 1 }, { write: async row => standalone.push(row) });
    assert.equal(standalone.length, 1);
    mode = 'json';
    assert.deepEqual(await llm.generateJson({ system: 's', messages: [{ role: 'user', text: 'hi' }], fallback: {} }), {});
    assert.equal(rows.length, 4); assert.ok(rows.slice(2).every(r => r.operation === 'json' && r.status === 'invalid_json'));
    mode = 'stream'; let text = '';
    for await (const token of llm.generateStream({ system: 's', messages: [{ role: 'user', text: 'hi' }] })) text += token;
    assert.equal(text, 'answer'); assert.equal(rows.length, 5); assert.equal(rows[4].operation, 'chat_stream');
    assert.equal(rows[4].provider_status, 200); assert.equal(rows[4].tokens_in, 4);
    mode = 'ok'; failWrite = true;
    const warnings = []; t.mock.method(console, 'warn', text => warnings.push(text));
    assert.equal(await llm.generate({ system: 's', messages: [{ role: 'user', text: 'hi' }] }), 'answer');
    assert.equal(calls, 6); assert.equal(warnings.length, 1); assert.doesNotMatch(warnings[0], /private/);
    process.env.LLM_PROVIDER = 'none';
    await assert.rejects(llm.generateWithTools({ system: 's', contents: [] }), /disabled/);
    assert.equal(calls, 6); assert.equal(rows.length, 6);
  });
});
