const { randomUUID } = require('node:crypto');
const { validatePlan, validateItem, dbError } = require('./planService');
const { httpError } = require('../utils/httpError');

function validateAction(tool, args) {
  if (tool === 'create_practice_plan') return validatePlan(args);
  if (tool === 'update_practice_plan_item') {
    if (!args || Object.keys(args).some(k => !['id', 'change'].includes(k)) || typeof args.id !== 'string' || !args.id) throw httpError(400, 'item id is required');
    return { id: args.id, change: validateItem(args.change, true) };
  }
  throw httpError(400, 'unknown write tool');
}
function createActionService(db, plans) {
  return {
    async propose(userId, tool, args) {
      const payload = validateAction(tool, args);
      if (tool === 'update_practice_plan_item') await plans.getItem(userId, payload.id);
      const r = await db.rpc('propose_coach_action', { tool_name: tool, payload });
      dbError(r.error); return r.data;
    },
    async confirm(userId, id) {
      // Validate stored payload again at the API boundary. SQL locks the same row
      // and performs the write in one transaction; clients cannot edit its payload.
      const action = await db.from('pending_actions').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
      dbError(action.error); if (!action.data) throw httpError(404, 'action not found');
      validateAction(action.data.tool, action.data.payload);
      const r = await db.rpc('confirm_coach_action', { action_id: id });
      dbError(r.error); return r.data;
    },
    async cancel(userId, id) {
      const r = await db.rpc('cancel_coach_action', { action_id: id });
      dbError(r.error); return r.data;
    },
  };
}
function createMemoryActionService(plans, now = Date.now) {
  const actions = new Map();
  const get = (user, id) => {
    const a = actions.get(id);
    if (!a || a.user_id !== user) throw httpError(404, 'action not found');
    if (a.status !== 'pending') throw httpError(409, 'action is no longer pending');
    if (Date.parse(a.expires_at) <= now()) throw httpError(410, 'action expired');
    return a;
  };
  return {
    async propose(user_id, tool, args) {
      const payload = validateAction(tool, args);
      if (tool === 'update_practice_plan_item') await plans.getItem(user_id, payload.id);
      const a = { id: randomUUID(), user_id, tool, payload, status: 'pending', expires_at: new Date(now() + 600000).toISOString() };
      actions.set(a.id, a); return structuredClone(a);
    },
    async confirm(user, id) {
      const a = get(user, id); a.status = 'executing';
      try {
        const result = a.tool === 'create_practice_plan' ? await plans.create(user, a.payload)
          : await plans.updateItem(user, a.payload.id, a.payload.change);
        a.status = 'confirmed'; return { status: a.status, result };
      } catch (error) { a.status = 'pending'; throw error; }
    },
    async cancel(user, id) { const a = get(user, id); a.status = 'cancelled'; return { status: 'cancelled' }; },
  };
}
module.exports = { createActionService, createMemoryActionService, validateAction };
