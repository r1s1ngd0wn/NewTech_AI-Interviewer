const { httpError } = require('../utils/httpError');

const PAGE_SIZE = 20;
const AUTH_PAGE_SIZE = 1000;
const PROFILE_FIELDS = {
  name: 'name',
  targetIndustry: 'target_industry',
  targetRole: 'target_role',
  experienceLevel: 'experience_level',
};

function active(user) {
  return user?.app_metadata?.is_active !== false;
}

function validateProfilePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw httpError(400, 'invalid user update', 'INVALID_USER_PATCH');
  const keys = Object.keys(patch);
  if (!keys.length || keys.some(key => !Object.hasOwn(PROFILE_FIELDS, key))) {
    throw httpError(400, 'only name and career profile fields may be edited', 'INVALID_USER_PATCH');
  }
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null && key !== 'name') { result[PROFILE_FIELDS[key]] = null; continue; }
    if (typeof value !== 'string' || value.trim().length > 80 || (key === 'name' && !value.trim())) {
      throw httpError(400, `${key} must be a non-empty string up to 80 characters`, 'INVALID_USER_PATCH');
    }
    result[PROFILE_FIELDS[key]] = value.trim();
  }
  return result;
}

function validateListQuery(query = {}) {
  const { q = '', role = '', status = 'all', sort = 'created-desc', page = 1 } = query;
  if (typeof q !== 'string' || q.trim().length > 100) throw httpError(400, 'search must be at most 100 characters', 'INVALID_USER_QUERY');
  if (role && !['user', 'admin'].includes(role)) throw httpError(400, 'role must be user or admin', 'INVALID_USER_QUERY');
  if (!['all', 'active', 'inactive'].includes(status)) throw httpError(400, 'status must be all, active or inactive', 'INVALID_USER_QUERY');
  if (!['created-desc', 'name-asc'].includes(sort)) throw httpError(400, 'unsupported user sort', 'INVALID_USER_QUERY');
  const numericPage = Number(page);
  if (!Number.isSafeInteger(numericPage) || numericPage < 1 || numericPage > 1_000_000) throw httpError(400, 'page must be a positive integer', 'INVALID_USER_QUERY');
  return { q: q.trim().toLocaleLowerCase(), role, status, sort, page: numericPage };
}

function createAdminUserService({ authAdmin, profileStore, now = () => new Date() }) {
  if (!authAdmin || !profileStore) throw new TypeError('authAdmin and profileStore are required');
  let mutationQueue = Promise.resolve();
  const serializeMutation = operation => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  async function allUsers() {
    const users = [];
    for (let page = 1; ; page++) {
      const { users: batch, error } = await authAdmin.listUsers({ page, perPage: AUTH_PAGE_SIZE });
      if (error) throw httpError(503, 'could not load user accounts', 'USER_LIST_UNAVAILABLE');
      users.push(...(batch || []));
      if (!batch || batch.length < AUTH_PAGE_SIZE) return users;
    }
  }

  function publicUser(user, profile) {
    if (!profile) return null;
    return {
      id: user.id,
      email: user.email || '',
      name: profile.name || '',
      role: profile.role,
      isActive: active(user),
      createdAt: profile.created_at || user.created_at,
      targetIndustry: profile.target_industry ?? null,
      targetRole: profile.target_role ?? null,
      experienceLevel: profile.experience_level ?? null,
    };
  }

  return {
    async listUsers(rawQuery = {}) {
      const query = validateListQuery(rawQuery);
      const users = await allUsers();
      if (!users.length) return { users: [], page: query.page, pageSize: PAGE_SIZE, total: 0, totalPages: 0 };
      const profiles = await profileStore.listProfiles(users.map(user => user.id));
      const byId = new Map((profiles || []).map(profile => [profile.id, profile]));
      let result = users.map(user => publicUser(user, byId.get(user.id))).filter(Boolean);
      result = result.filter(user => !query.role || user.role === query.role)
        .filter(user => query.status === 'all' || user.isActive === (query.status === 'active'))
        .filter(user => !query.q || `${user.name || ''} ${user.email}`.toLocaleLowerCase().includes(query.q));
      result.sort(query.sort === 'name-asc'
        ? (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)
        : (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id));
      const total = result.length;
      const offset = (query.page - 1) * PAGE_SIZE;
      return { users: result.slice(offset, offset + PAGE_SIZE), page: query.page, pageSize: PAGE_SIZE, total, totalPages: Math.ceil(total / PAGE_SIZE) };
    },

    async updateProfile(id, patch) {
      const changes = validateProfilePatch(patch);
      const authResult = await authAdmin.getUserById(id);
      if (authResult.error || !authResult.user) throw httpError(404, 'user account not found', 'USER_NOT_FOUND');
      const { profile, error } = await profileStore.updateProfile(id, changes);
      if (error) throw httpError(error.status || 400, 'could not update user profile', 'USER_UPDATE_FAILED');
      if (!profile) throw httpError(404, 'user profile not found', 'USER_NOT_FOUND');
      return publicUser(authResult.user, profile);
    },

    async setActive(actorId, targetId, isActive) {
      if (typeof isActive !== 'boolean') throw httpError(400, 'isActive must be a boolean', 'INVALID_USER_STATUS');
      return serializeMutation(async () => {
        const actorResult = await authAdmin.getUserById(actorId);
        if (actorResult.error || !actorResult.user || !active(actorResult.user)) {
          throw httpError(403, 'active administrator access required', 'FORBIDDEN');
        }
        const actor = await profileStore.getProfile(actorId);
        if (!actor || actor.role !== 'admin') throw httpError(403, 'admin access required', 'FORBIDDEN');
        const targetResult = await authAdmin.getUserById(targetId);
        const target = targetResult.user;
        if (targetResult.error || !target) throw httpError(404, 'user account not found', 'USER_NOT_FOUND');
        const targetProfile = await profileStore.getProfile(targetId);
        if (!targetProfile) throw httpError(404, 'user profile not found', 'USER_NOT_FOUND');
        if (active(target) === isActive) return publicUser(target, targetProfile);
        if (!isActive && actorId === targetId) throw httpError(409, 'you cannot deactivate your own admin account', 'SELF_DEACTIVATION');

        if (!isActive && targetProfile.role === 'admin') {
          const users = await allUsers();
          const profiles = await profileStore.listProfiles(users.map(user => user.id));
          const roleById = new Map((profiles || []).map(profile => [profile.id, profile.role]));
          const activeAdmins = users.filter(user => roleById.get(user.id) === 'admin' && active(user)).length;
          if (activeAdmins <= 1) throw httpError(409, 'the last active administrator cannot be deactivated', 'LAST_ACTIVE_ADMIN');
        }

        const appMetadata = {
          ...(target.app_metadata || {}),
          is_active: isActive,
          sessions_valid_after: now().toISOString(),
        };
        const { user, error } = await authAdmin.updateUserById(targetId, { app_metadata: appMetadata });
        if (error || !user) throw httpError(503, 'could not update account status', 'USER_STATUS_UPDATE_FAILED');
        return publicUser(user, targetProfile);
      });
    },
  };
}

module.exports = { createAdminUserService, validateListQuery, validateProfilePatch, PAGE_SIZE, active };
