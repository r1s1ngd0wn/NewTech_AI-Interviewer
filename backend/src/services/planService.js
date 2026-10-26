const { randomUUID } = require('node:crypto');
const { getScenario } = require('./scenarioService');
const scenarioService = require('./scenarioService');
const { httpError } = require('../utils/httpError');

function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) {
    throw httpError(400, 'unexpected or invalid fields');
  }
}
function validateItem(item, partial = false) {
  object(item, ['scenarioId', 'scheduledDate', 'status']);
  const result = {};
  if (!partial || item.scenarioId !== undefined) {
    if (typeof item.scenarioId !== 'string' || !getScenario(item.scenarioId)) throw httpError(400, 'unknown scenario');
    result.scenarioId = item.scenarioId;
  }
  if (!partial || item.scheduledDate !== undefined) {
    const date = item.scheduledDate;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date) throw httpError(400, 'scheduledDate must be a real YYYY-MM-DD date');
    result.scheduledDate = date;
  }
  if (!partial || item.status !== undefined) {
    const status = item.status ?? 'scheduled';
    if (!['scheduled', 'done', 'skipped'].includes(status)) throw httpError(400, 'invalid plan item status');
    result.status = status;
  }
  if (partial && !Object.keys(result).length) throw httpError(400, 'provide an item change');
  return result;
}
function validatePlan(body, partial = false) {
  object(body, partial ? ['title'] : ['title', 'items']);
  if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 120) throw httpError(400, 'title is required, up to 120 characters');
  const result = { title: body.title.trim() };
  if (!partial) {
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) throw httpError(400, 'provide 1 to 20 plan items');
    result.items = body.items.map(i => validateItem(i));
  }
  return result;
}
function fromItem(row) {
  return { id: row.id, planId: row.plan_id, scenarioId: row.scenario_id, scheduledDate: row.scheduled_date, status: row.status };
}
function fromPlan(row) {
  return { id: row.id, title: row.title, createdAt: row.created_at, items: (row.practice_plan_items || row.items || []).map(fromItem) };
}
function dbError(error) {
  if (!error) return;
  const messages = { P0002: [404, 'plan or action not found'], '42501': [403, 'operation not permitted'],
    P0003: [409, 'action is no longer pending'], P0004: [410, 'action expired'] };
  const [status, message] = messages[error.code] || [400, 'could not save plan or action'];
  throw httpError(status, message);
}
function assertNewScenariosActive(items) {
  for (const item of items) if (item.scenarioId && !scenarioService.isActive(item.scenarioId)) {
    throw httpError(409, 'inactive scenarios cannot be added to a plan', 'SCENARIO_INACTIVE');
  }
}
function createPlanService(db) {
  return {
    async list(userId) {
      const r = await db.from('practice_plans').select('*,practice_plan_items(*)').eq('user_id', userId).order('created_at', { ascending: false });
      dbError(r.error); return r.data.map(fromPlan);
    },
    async create(userId, body) {
      const payload = validatePlan(body); assertNewScenariosActive(payload.items);
      const r = await db.rpc('create_practice_plan', { payload });
      dbError(r.error); return fromPlan(r.data);
    },
    async update(userId, id, patch) {
      const r = await db.from('practice_plans').update(validatePlan(patch, true)).eq('id', id).eq('user_id', userId).select('*,practice_plan_items(*)').maybeSingle();
      dbError(r.error); if (!r.data) throw httpError(404, 'plan not found'); return fromPlan(r.data);
    },
    async delete(userId, id) {
      const r = await db.from('practice_plans').delete().eq('id', id).eq('user_id', userId).select('id');
      dbError(r.error); if (!r.data.length) throw httpError(404, 'plan not found');
    },
    async addItem(userId, planId, item) {
      const value = validateItem(item);
      assertNewScenariosActive([value]);
      const r = await db.from('practice_plan_items').insert({ plan_id: planId, user_id: userId,
        scenario_id: value.scenarioId, scheduled_date: value.scheduledDate, status: value.status }).select('*').single();
      dbError(r.error); return fromItem(r.data);
    },
    async getItem(userId, id) {
      const r = await db.from('practice_plan_items').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
      dbError(r.error); if (!r.data) throw httpError(404, 'plan item not found'); return fromItem(r.data);
    },
    async updateItem(userId, id, patch) {
      const fields = { scenarioId: 'scenario_id', scheduledDate: 'scheduled_date', status: 'status' };
      const changes = Object.fromEntries(Object.entries(validateItem(patch, true)).map(([k, v]) => [fields[k], v]));
      if (changes.scenario_id) {
        const current = await db.from('practice_plan_items').select('scenario_id').eq('id',id).eq('user_id',userId).maybeSingle();
        dbError(current.error); if(!current.data) throw httpError(404,'plan item not found');
        if(changes.scenario_id!==current.data.scenario_id) assertNewScenariosActive([{ scenarioId: changes.scenario_id }]);
      }
      const r = await db.from('practice_plan_items').update(changes).eq('id', id).eq('user_id', userId).select('*').maybeSingle();
      dbError(r.error); if (!r.data) throw httpError(404, 'plan item not found'); return fromItem(r.data);
    },
    async deleteItem(userId, id) {
      const r = await db.from('practice_plan_items').delete().eq('id', id).eq('user_id', userId).select('id');
      dbError(r.error); if (!r.data.length) throw httpError(404, 'plan item not found');
    },
  };
}
function createMemoryPlanService() {
  const rows = new Map();
  const owned = (user, id) => {
    const row = rows.get(id);
    if (!row || row.userId !== user) throw httpError(404, 'plan not found');
    return row;
  };
  const ownedItem = (user, id) => {
    for (const plan of rows.values()) if (plan.userId === user) {
      const item = plan.items.find(i => i.id === id);
      if (item) return { plan, item };
    }
    throw httpError(404, 'plan item not found');
  };
  return {
    async list(user) { return structuredClone([...rows.values()].filter(p => p.userId === user)); },
    async create(userId, body) {
      const data = validatePlan(body); assertNewScenariosActive(data.items); const id = randomUUID();
      const plan = { id, userId, title: data.title, createdAt: new Date().toISOString(),
        items: data.items.map(item => ({ ...item, id: randomUUID(), planId: id })) };
      rows.set(id, plan); return structuredClone(plan);
    },
    async update(user, id, patch) { const p = owned(user, id); Object.assign(p, validatePlan(patch, true)); return structuredClone(p); },
    async delete(user, id) { owned(user, id); rows.delete(id); },
    async addItem(user, id, value) { const plan = owned(user, id); const valid=validateItem(value); assertNewScenariosActive([valid]); const item = { ...valid, id: randomUUID(), planId: id }; plan.items.push(item); return structuredClone(item); },
    async getItem(user, id) { return structuredClone(ownedItem(user, id).item); },
    async updateItem(user, id, patch) { const { item } = ownedItem(user, id); const changes=validateItem(patch, true); if(changes.scenarioId&&changes.scenarioId!==item.scenarioId) assertNewScenariosActive([changes]); Object.assign(item, changes); return structuredClone(item); },
    async deleteItem(user, id) { const { plan } = ownedItem(user, id); plan.items = plan.items.filter(i => i.id !== id); },
  };
}
const memory = createMemoryPlanService();
module.exports = { createPlanService, createMemoryPlanService, memory, validatePlan, validateItem, dbError };
