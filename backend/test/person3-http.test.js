process.env.STORE_BACKEND = 'memory';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const llm = require('../src/services/llmService');
const { app } = require('../src/server');

test('HTTP auth, plans CRUD and agent confirmation integrate end to end', async t => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, method = 'GET', body, token) {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  const registered = await request('/auth/register', 'POST', { name: 'HTTP', email: 'http@test.dev', password: 'secret1' });
  assert.equal(registered.status, 201);
  const token = registered.data.token;
  assert.equal((await request('/plans')).status, 401);
  assert.equal((await request('/admin/usage', 'GET', undefined, token)).status, 403);
  assert.equal((await request('/plans', 'POST', { title: 'Invalid', items: [] }, token)).status, 400);
  const body = { title: 'Manual', items: [{ scenarioId: 'scn_swe_junior_behavioral', scheduledDate: '2026-11-01' }] };
  const created = await request('/plans', 'POST', body, token);
  assert.equal(created.status, 201);
  const plan = created.data.plan;
  assert.equal((await request(`/plans/items/${plan.items[0].id}`, 'PATCH', { status: 'done' }, token)).status, 200);
  assert.equal((await request(`/plans/${plan.id}`, 'PATCH', { title: 'Renamed' }, token)).data.plan.title, 'Renamed');
  const original = llm.generateWithTools;
  llm.generateWithTools = async () => ({ calls: [{ name: 'create_practice_plan', args: { ...body, title: 'Agent' } }] });
  t.after(() => { llm.generateWithTools = original; });
  const streamed = await fetch(`${base}/coach/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ message: 'Create interview practice plan' }) });
  assert.match(streamed.headers.get('content-type'), /text\/event-stream/);
  const events = (await streamed.text()).split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)));
  assert.ok(events.some(e => e.type === 'tool'));
  const action = events.find(e => e.type === 'action').action;
  assert.equal((await request('/plans', 'GET', undefined, token)).data.plans.length, 1);
  assert.equal((await request(`/coach/actions/${action.id}/confirm`, 'POST', {}, token)).status, 200);
  assert.equal((await request(`/coach/actions/${action.id}/confirm`, 'POST', {}, token)).status, 409);
  assert.equal((await request('/plans', 'GET', undefined, token)).data.plans.length, 2);
  assert.equal((await request(`/plans/${plan.id}`, 'DELETE', undefined, token)).status, 204);
  assert.equal((await request('/health/ai')).status, 200);
  await request('/auth/logout', 'POST', {}, token);
  assert.equal((await request('/plans', 'GET', undefined, token)).status, 401);
});
