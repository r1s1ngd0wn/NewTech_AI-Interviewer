const router = require('express').Router();
const { adminClient } = require('../db/supabase');
const { createAdminUserService } = require('../services/adminUserService');
const { httpError } = require('../utils/httpError');

function createService() {
  return createAdminUserService({
    authAdmin: {
      async listUsers(options) {
        const { data, error } = await adminClient().auth.admin.listUsers(options);
        return { users: data?.users, error };
      },
      async getUserById(id) {
        const { data, error } = await adminClient().auth.admin.getUserById(id);
        return { user: data?.user, error };
      },
      async updateUserById(id, patch) {
        const { data, error } = await adminClient().auth.admin.updateUserById(id, patch);
        return { user: data?.user, error };
      },
    },
    profileStore: {
      async listProfiles(ids) {
        const { data, error } = await adminClient().from('profiles')
          .select('id,name,role,target_industry,target_role,experience_level,created_at')
          .in('id', ids);
        if (error) throw httpError(503, 'could not load user profiles', 'PROFILE_LIST_UNAVAILABLE');
        return data || [];
      },
      async getProfile(id) {
        const { data, error } = await adminClient().from('profiles')
          .select('id,name,role,target_industry,target_role,experience_level,created_at')
          .eq('id', id).maybeSingle();
        if (error) throw httpError(503, 'could not load user profile', 'PROFILE_LOOKUP_FAILED');
        return data;
      },
      async updateProfile(id, patch) {
        const { data, error } = await adminClient().from('profiles').update(patch).eq('id', id)
          .select('id,name,role,target_industry,target_role,experience_level,created_at').maybeSingle();
        return { profile: data, error };
      },
    },
  });
}

const service = createService();
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const validUserId = id => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id);

router.get('/', handle(async (req, res) => res.json({ ...await service.listUsers(req.query), currentAdminId: req.user.id })));
router.patch('/:id/status', handle(async (req, res) => {
  if (!validUserId(req.params.id)) throw httpError(400, 'invalid user ID', 'INVALID_USER_ID');
  if (!req.body || Object.keys(req.body).length !== 1 || typeof req.body.isActive !== 'boolean') {
    throw httpError(400, 'provide only the isActive boolean field', 'INVALID_USER_STATUS');
  }
  res.json({ user: await service.setActive(req.user.id, req.params.id, req.body.isActive) });
}));
router.patch('/:id', handle(async (req, res) => {
  if (!validUserId(req.params.id)) throw httpError(400, 'invalid user ID', 'INVALID_USER_ID');
  res.json({ user: await service.updateProfile(req.params.id, req.body) });
}));

module.exports = router;
