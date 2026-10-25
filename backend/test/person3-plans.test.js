process.env.STORE_BACKEND = 'memory';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const item = { scenarioId: 'scn_swe_junior_behavioral', scheduledDate: '2026-11-01', status: 'scheduled' };

test('plans validate real dates, scenarios and allowed fields', async () => {
  const { createMemoryPlanService } = require('../src/services/planService');
  const plans = createMemoryPlanService();
  for (const bad of [{ ...item, scheduledDate: '2026-02-30' }, { ...item, scenarioId: 'missing' }, { ...item, user_id: 'bob' }]) {
    await assert.rejects(plans.create('alice', { title: 'Practice', items: [bad] }), { status: 400 });
  }
  const plan = await plans.create('alice', { title: 'Practice', items: [item] });
  assert.equal(plan.items[0].scenarioId, item.scenarioId);
  assert.deepEqual(await plans.list('bob'), []);
  await assert.rejects(plans.update('bob', plan.id, { title: 'Stolen' }), { status: 404 });
  await assert.rejects(plans.updateItem('bob', plan.items[0].id, { status: 'done' }), { status: 404 });
  await plans.updateItem('alice', plan.items[0].id, { status: 'done' });
  assert.equal((await plans.list('alice'))[0].items[0].status, 'done');
  await plans.delete('alice', plan.id);
  assert.deepEqual(await plans.list('alice'), []);
});

test('pending write is inert until owner confirms; simultaneous confirms execute once', async () => {
  const { createMemoryPlanService } = require('../src/services/planService');
  const { createMemoryActionService } = require('../src/services/actionService');
  const plans = createMemoryPlanService();
  const actions = createMemoryActionService(plans);
  const action = await actions.propose('alice', 'create_practice_plan', { title: 'Week', items: [item] });
  assert.deepEqual(await plans.list('alice'), []);
  await assert.rejects(actions.confirm('bob', action.id), { status: 404 });
  const result = await Promise.allSettled([actions.confirm('alice', action.id), actions.confirm('alice', action.id)]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await plans.list('alice')).length, 1);
});

test('cancelled and expired actions cannot execute', async () => {
  const { createMemoryPlanService } = require('../src/services/planService');
  const { createMemoryActionService } = require('../src/services/actionService');
  const plans = createMemoryPlanService();
  let now = 0;
  const actions = createMemoryActionService(plans, () => now);
  const cancelled = await actions.propose('alice', 'create_practice_plan', { title: 'Week', items: [item] });
  await actions.cancel('alice', cancelled.id);
  await assert.rejects(actions.confirm('alice', cancelled.id), { status: 409 });
  const expired = await actions.propose('alice', 'create_practice_plan', { title: 'Week', items: [item] });
  now = 600001;
  await assert.rejects(actions.confirm('alice', expired.id), { status: 410 });
  assert.deepEqual(await plans.list('alice'), []);
});
