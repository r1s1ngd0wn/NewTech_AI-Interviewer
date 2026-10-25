// Live persistence/JWT check with synthetic model responses; no paid AI requests.
require('dotenv').config();
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const context = require('../src/context/requestContext');
const { adminClient } = require('../src/db/supabase');
const { withTransaction, getPool } = require('../src/db/postgres');

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Use a development environment');
  if (!process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD) throw new Error('Dedicated test account is required');
  const loginClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await loginClient.auth.signInWithPassword({ email: process.env.TEST_USER_EMAIL, password: process.env.TEST_USER_PASSWORD });
  if (login.error || !login.data.session) throw new Error('Test login failed');
  const token = login.data.session.access_token;
  const userId = login.data.user.id;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  const requestId = randomUUID(); const admin = adminClient();
  const actualFetch = global.fetch;
  let fakeCalls = 0;
  try {
    // Keep Auth, PostgREST and PostgreSQL real; stub only the model HTTP endpoints.
    global.fetch = async (url, init) => {
      const endpoint = new URL(typeof url === 'string' ? url : url.url || url.toString());
      if (endpoint.hostname !== 'generativelanguage.googleapis.com') return actualFetch(url, init);
      fakeCalls++;
      return { ok: true, status: 200, json: async () => endpoint.pathname.endsWith(':embedContent')
        ? { embedding: { values: Array(768).fill(1) }, usageMetadata: { promptTokenCount: 7 } }
        : { candidates: [{ content: { role: 'model', parts: fakeCalls === 2
          ? [{ functionCall: { name: 'search_knowledge', args: {} } }] : [{ text: 'Synthetic verification response' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } } };
    };
    process.env.STORE_BACKEND = 'postgres'; process.env.LLM_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'synthetic-no-provider-request'; process.env.EMBEDDING_PROVIDER = 'gemini';
    const llm = require('../src/services/llmService');
    const embed = require('../src/services/embeddingService');
    await context.run({ requestId, userId, claims }, async () => {
      await withTransaction(async client => {
        const result = await client.query('select auth.uid()::text as owner, current_user as role');
        assert.equal(result.rows[0].owner, userId); assert.equal(result.rows[0].role, 'authenticated');
      });
      await llm.generate({ system: 'Synthetic check', messages: [{ role: 'user', text: 'test' }], promptVersion: 'smoke.v1' });
      await llm.generateWithTools({ system: 'Synthetic check', contents: [{ role: 'user', parts: [{ text: 'test' }] }], tools: [{ name: 'search_knowledge' }] });
      await embed.embed('Synthetic check', 'RETRIEVAL_QUERY');
    });
    const { data, error } = await admin.from('ai_logs').select('*').eq('request_id', requestId);
    assert.ifError(error); assert.equal(fakeCalls, 3); assert.equal(data.length, 3);
    assert.deepEqual(data.map(row => row.operation).sort(), ['chat', 'embed_query', 'tools']);
    assert.ok(data.every(row => row.user_id === userId && row.provider === 'gemini' && row.status === 'ok'));
    assert.deepEqual(data.find(row => row.operation === 'tools').tools, ['search_knowledge']);
    assert.equal(data.find(row => row.operation === 'chat').prompt_version, 'smoke.v1');
    assert.equal(data.find(row => row.operation === 'embed_query').tokens_out, 0);
    console.log(JSON.stringify({ jwtTransactionScope: true, liveSharedRows: data.length, requestCorrelation: true, providerCallsStubbed: true }));
  } finally {
    global.fetch = actualFetch;
    const deleted = await admin.from('ai_logs').delete().eq('request_id', requestId);
    const signedOut = await admin.auth.admin.signOut(token, 'local');
    await getPool().end();
    if (deleted.error || signedOut.error) throw new Error('Temporary smoke-test cleanup failed');
    console.log('Temporary telemetry rows and test Auth session cleaned.');
  }
}
main().catch(error => { console.error(JSON.stringify({ unifiedLogsSmokeFailed: true, code: error.code || error.name })); process.exitCode = 1; });
