const test = require('node:test');
const assert = require('node:assert/strict');

test('structured callers own retries while agent validation can retry, with one log per attempt', async t => {
  const env = { ...process.env };
  t.after(() => { process.env = env; });
  process.env.STORE_BACKEND = 'memory';
  process.env.LLM_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = 'test';
  const rows = [];
  const supabase = require('../src/db/supabase');
  t.mock.method(supabase, 'memoryPreview', () => false);
  t.mock.method(supabase, 'adminClient', () => ({ from: () => ({ insert: async row => { rows.push(row); return {}; } }) }));
  for (const name of ['aiTelemetry', 'llmService', 'geminiClient']) delete require.cache[require.resolve(`../src/services/${name}`)];
  const llm = require('../src/services/llmService');
  let text = 'invalid';
  const requests = [];
  t.mock.method(global, 'fetch', async (_, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } }) };
  });
  const options = { system: 's', messages: [{ role: 'user', text: 'review' }], responseSchema: { type: 'OBJECT' }, promptVersion: 'critique.v2', temperature: 0.1, maxOutputTokens: 777, timeoutMs: 1000 };
  await assert.rejects(llm.generateJson(options), { code: 'invalid_json' });
  assert.equal(requests.length, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].operation, 'json');
  assert.equal(rows[0].status, 'invalid_json');
  assert.equal(rows[0].prompt_version, 'critique.v2');
  assert.equal(rows[0].tokens_in, 3);
  assert.equal(requests[0].generationConfig.temperature, 0.1);
  assert.equal(requests[0].generationConfig.maxOutputTokens, 777);
  assert.deepEqual(await llm.generateJson({ ...options, fallback: { scripted: true } }), { scripted: true });
  assert.equal(requests.length, 3);
  assert.equal(rows.length, 3);
  text = '```json\n{"valid":true}\n```';
  assert.deepEqual(await llm.generateJson(options), { valid: true });
  assert.equal(rows.length, 4);
  text = '';
  await assert.rejects(llm.generateJson(options), { code: 'empty' });
  assert.equal(requests.length, 5);
});

test('structured local output is available in every environment and is off only when the provider is none', async t => {
  const env = { ...process.env };
  t.after(() => { process.env = env; });
  process.env.STORE_BACKEND = 'memory';
  process.env.NODE_ENV = 'test';
  process.env.LLM_PROVIDER = 'local';
  process.env.LOCAL_LLM_MODEL = 'preview';
  const llm = require('../src/services/llmService');
  let calls = 0;
  t.mock.method(global, 'fetch', async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '<think>private</think>```json\n{"local":true}\n```' } }] }) };
  });
  assert.deepEqual(await llm.generateJson({ system: 's', messages: [{ role: 'user', text: 'review' }] }), { local: true });
  process.env.STORE_BACKEND = 'postgres';
  process.env.NODE_ENV = 'production';
  assert.deepEqual(await llm.generateJson({ system: 's', messages: [{ role: 'user', text: 'review' }] }), { local: true });
  process.env.LLM_PROVIDER = 'none';
  await assert.rejects(llm.generateJson({ system: 's', messages: [] }), { code: 'not_configured' });
  assert.equal(calls, 2);
});

test('structured Gemini preserves thinking settings and logs the corrective attempt separately', async t => {
  const env = { ...process.env }; t.after(() => { process.env = env; });
  process.env.GEMINI_API_KEY = 'test'; process.env.LLM_PROVIDER = 'gemini'; process.env.GEMINI_THINKING_BUDGET = '0';
  const bodies = [];
  t.mock.method(global, 'fetch', async (_, init) => {
    bodies.push(JSON.parse(init.body));
    return bodies.length === 1
      ? { ok: false, status: 400, json: async () => ({ error: { message: 'thinking configuration unsupported' } }) }
      : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"valid":true}' }] } }] }) };
  });
  const llm = require('../src/services/llmService');
  assert.deepEqual(await llm.generateJson({ system: 's', messages: [{ role: 'user', text: 'review' }] }), { valid: true });
  assert.deepEqual(bodies[0].generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.equal(bodies[1].generationConfig.thinkingConfig, undefined);
  process.env.GEMINI_THINKING_BUDGET = 'default';
  await llm.generateJson({ system: 's', messages: [{ role: 'user', text: 'review' }] });
  assert.equal(bodies[2].generationConfig.thinkingConfig, undefined);
});

test('parseable schema-invalid critiques log two failures without multiplying retries', async t => {
  const env = { ...process.env }; t.after(() => { process.env = env; });
  process.env.GEMINI_API_KEY = 'test'; process.env.LLM_PROVIDER = 'gemini';
  const rows = []; let calls = 0;
  const supabase = require('../src/db/supabase');
  t.mock.method(supabase, 'memoryPreview', () => false);
  t.mock.method(supabase, 'adminClient', () => ({ from: () => ({ insert: async row => { rows.push(row); return {}; } }) }));
  for (const name of ['aiTelemetry', 'llmService', 'geminiClient', 'critiqueService']) delete require.cache[require.resolve(`../src/services/${name}`)];
  t.mock.method(global, 'fetch', async () => { calls++; return { ok: true, status: 200, json: async () => ({
    candidates: [{ content: { parts: [{ text: '{"bad":true}' }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
  }) }; });
  const result = await require('../src/services/critiqueService').critiqueAnswer({ text: 'Question', referenceAnswer: 'reference', keywords: [] }, 'answer');
  assert.equal(result.source, 'scripted'); assert.equal(result.fallbackReason, 'invalid_json');
  assert.equal(calls, 2); assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.status === 'invalid_json' && row.operation === 'json'));
});
