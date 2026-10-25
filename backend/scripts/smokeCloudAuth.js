require('dotenv').config();
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { userClient, adminClient } = require('../src/db/supabase');

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Run cloud smoke checks from a development environment');
  if (!process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD) throw new Error('Configure the dedicated test account first');
  // This process intentionally tests manual features with all model calls off.
  process.env.LLM_PROVIDER = 'none';
  process.env.LLM_REACTIONS = 'off';
  process.env.EMBEDDING_PROVIDER = 'none';
  const { app } = require('../src/server');
  const admin = adminClient();
  // Login needs a normal public-key client; a fixed Authorization header would
  // override the session that signInWithPassword obtains.
  const loginClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let server, token, planId, sessionId;
  const actionIds = [];
  try {
    const login = await loginClient.auth.signInWithPassword({ email: process.env.TEST_USER_EMAIL, password: process.env.TEST_USER_PASSWORD });
    if (login.error || !login.data.session) throw Object.assign(new Error('test login failed'), { code: login.error?.code || 'test_login_failed' });
    token = login.data.session.access_token;
    const db = userClient(token);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(path, method = 'GET', body, accessToken = token) {
      const response = await fetch(base + path, {
        method, headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: response.status === 204 ? null : await response.json() };
    }
    const me = await request('/auth/me');
    assert.equal(me.status, 200); assert.ok(me.data.user.profile);
    assert.equal((await request('/admin/usage')).status, 403);
    assert.equal((await request('/plans', 'GET', undefined, 'invalid-token')).status, 401);
    const payload = { title: `HTTP_CLOUD_SMOKE_${randomUUID()}`, items: [{ scenarioId: 'scn_swe_junior_behavioral', scheduledDate: '2026-11-01' }] };
    const proposed = await db.rpc('propose_coach_action', { tool_name: 'create_practice_plan', payload });
    if (proposed.error) throw Object.assign(new Error('proposal failed'), { code: proposed.error.code });
    actionIds.push(proposed.data.id);
    const confirmed = await request(`/coach/actions/${proposed.data.id}/confirm`, 'POST', {});
    assert.equal(confirmed.status, 200); planId = confirmed.data.result.id;
    assert.equal((await request(`/coach/actions/${proposed.data.id}/confirm`, 'POST', {})).status, 409);
    const plans = await request('/plans');
    assert.equal(plans.status, 200);
    const plan = plans.data.plans.find(p => p.id === planId); assert.ok(plan);
    assert.equal((await request(`/plans/items/${plan.items[0].id}`, 'PATCH', { status: 'done' })).status, 200);
    assert.equal((await request(`/plans/${planId}`, 'DELETE')).status, 204); planId = null;
    const started = await request('/sessions', 'POST', { scenarioId: 'scn_swe_junior_behavioral' });
    assert.equal(started.status, 201); sessionId = started.data.session.id;
    const answered = await request(`/sessions/${sessionId}/answer`, 'POST', {
      answerText: 'I built a project with my team and improved performance by measuring results.', inputMode: 'text',
    });
    assert.equal(answered.status, 200);
    assert.equal((await request(`/sessions/${sessionId}/finish`, 'POST', {})).status, 200);
    assert.equal((await request('/progress')).status, 200);
    assert.equal((await request(`/sessions/${sessionId}`, 'DELETE')).status, 204); sessionId = null;
    assert.equal((await request('/auth/logout', 'POST', {})).status, 204);
    assert.equal((await request('/auth/me')).status, 401);
    // Logout has already revoked this session; a second admin signOut returns
    // HTTP400 from Auth and must not be reported as failed record cleanup.
    token = null;
    console.log(JSON.stringify({ publicKeyAuth: true, expressJwt: true, invalidJwt401: true, userAdmin403: true,
      confirmApi: true, duplicate409: true, planCrud: true, interviewAndScoringWithoutAI: true, progress: true, logoutRevocation401: true }));
    const settings = await fetch(`${process.env.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: process.env.SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(10000) });
    const config = await settings.json();
    console.log(JSON.stringify({ googleEnabled: config.external?.google === true }));
  } finally {
    const cleanup = [];
    if (planId) cleanup.push(await admin.from('practice_plans').delete().eq('id', planId));
    if (sessionId) cleanup.push(await admin.from('interviewai_sessions').delete().eq('id', sessionId));
    for (const id of actionIds) cleanup.push(await admin.from('pending_actions').delete().eq('id', id));
    if (token) cleanup.push(await admin.auth.admin.signOut(token, 'local'));
    if (server) await new Promise(resolve => server.close(resolve));
    if (cleanup.some(result => result.error)) {
      console.error('Some temporary smoke-test cleanup failed; inspect test records.'); process.exitCode = 1;
    } else console.log('Temporary test records cleaned; environment files unchanged.');
  }
}
main().catch(error => { console.error(JSON.stringify({ cloudSmokeFailed: true, code: error.code || error.name, status: error.status || null })); process.exitCode = 1; });
