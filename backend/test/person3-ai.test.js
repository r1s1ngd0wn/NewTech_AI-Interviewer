process.env.STORE_BACKEND = 'memory';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('telemetry records failures and usage without logging private inputs', async () => {
  const { trackAiRequest } = require('../src/services/aiTelemetry');
  const rows = []; const write = async row => rows.push(row);
  const value = await trackAiRequest({ model: 'unknown-model', capability: 'coach', prompt: 'PRIVATE CV' },
    async note => { note({ usage: { promptTokenCount: 10, candidatesTokenCount: 4 }, tools: ['list_sessions'] }); return 'OK'; }, { write });
  assert.equal(value, 'OK'); assert.equal(rows[0].tokens_in, 10); assert.equal(rows[0].tokens_out, 4);
  assert.equal(rows[0].cost_usd, null); assert.deepEqual(rows[0].tools, ['list_sessions']);
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE CV/);
  await assert.rejects(trackAiRequest({ capability: 'coach' }, async () => { throw Object.assign(new Error('secret key'), { name: 'AbortError' }); }, { write }));
  assert.equal(rows[1].status, 'timeout'); assert.doesNotMatch(JSON.stringify(rows), /secret key/);
});

test('function calling preserves signed parts and sends bounded declarations', async () => {
  const llm = require('../src/services/llmService');
  process.env.GEMINI_API_KEY = 'test-key';
  const original = global.fetch;
  const content = { role: 'model', parts: [{ functionCall: { name: 'list_sessions', args: {}, id: 'call-1' }, thoughtSignature: 'signature' }] };
  let body;
  global.fetch = async (url, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ candidates: [{ content }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2 } }) }; };
  try {
    assert.equal(typeof llm.generateWithTools, 'function');
    const result = await llm.generateWithTools({ system: 'coach', contents: [{ role: 'user', parts: [{ text: 'plan' }] }], tools: [{ name: 'list_sessions', parameters: { type: 'OBJECT' } }] });
    assert.deepEqual(result.content, content);
    assert.equal(result.calls[0].id, 'call-1');
    assert.equal(body.tools[0].functionDeclarations[0].name, 'list_sessions');
  } finally { global.fetch = original; delete process.env.GEMINI_API_KEY; }
});

test('health uses cached failure state without making paid requests', () => {
  const health = require('../src/services/aiHealth');
  process.env.GEMINI_API_KEY = 'test';
  assert.equal(health.status().state, 'unknown');
  health.recordFailure({ upstreamStatus: 429 });
  assert.equal(health.status().available, false); assert.equal(health.status().reason, 'quota');
  health.recordSuccess(); assert.equal(health.status().available, true);
  delete process.env.GEMINI_API_KEY;
});

test('agent receives provider tokens incrementally and preserves streamed tool signatures', async () => {
  const llm = require('../src/services/llmService');
  process.env.GEMINI_API_KEY = 'test';
  const original = global.fetch;
  const tokens = [];
  global.fetch = async () => ({ ok: true, status: 200, body: (async function* () {
    yield Buffer.from('data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}\n\n');
    assert.deepEqual(tokens, ['Hello ']);
    yield Buffer.from('data: {"candidates":[{"content":{"parts":[{"text":"there."}]}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2}}\n\n');
  })() });
  try {
    const result = await llm.generateWithTools({ system: 's', contents: [{ role: 'user', parts: [{ text: 'hi' }] }], tools: [], onToken: token => tokens.push(token) });
    assert.equal(result.text, 'Hello there.');
    assert.deepEqual(tokens, ['Hello ', 'there.']);
  } finally { global.fetch = original; delete process.env.GEMINI_API_KEY; }
});

test('invalid JSON retries once and returns scripted fallback after the second failure', async () => {
  const llm = require('../src/services/llmService');
  assert.equal(typeof llm.generateJson, 'function');
  process.env.GEMINI_API_KEY = 'test';
  const original = global.fetch;
  let attempts = 0;
  global.fetch = async () => { attempts++; return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ text: '{bad json' }] } }] }) }; };
  try {
    const value = await llm.generateJson({ system: 's', messages: [{ role: 'user', text: 'answer' }], responseSchema: { type: 'OBJECT' }, fallback: { scripted: true } });
    assert.deepEqual(value, { scripted: true }); assert.equal(attempts, 2);
  } finally { global.fetch = original; delete process.env.GEMINI_API_KEY; }
});

test('disabled provider never sends an agent request even when a key is present', async () => {
  const llm = require('../src/services/llmService');
  process.env.GEMINI_API_KEY = 'test'; process.env.LLM_PROVIDER = 'none';
  const original = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error('must not fetch'); };
  try {
    await assert.rejects(llm.generateWithTools({ system: 's', contents: [] }), /not configured|disabled/);
    assert.equal(called, false);
  } finally { global.fetch = original; delete process.env.GEMINI_API_KEY; delete process.env.LLM_PROVIDER; }
});
