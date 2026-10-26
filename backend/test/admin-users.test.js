const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAdminUserService } = require('../src/services/adminUserService');

function fixture() {
  const users = [
    { id: 'admin-1', email: 'admin@example.test', created_at: '2026-01-01', app_metadata: { is_active: true, provider: 'google' } },
    { id: 'admin-2', email: 'admin2@example.test', created_at: '2026-01-15', app_metadata: { is_active: true } },
    { id: 'user-1', email: 'alice@example.test', created_at: '2026-02-01', app_metadata: { provider: 'google' } },
    { id: 'user-2', email: 'bob@example.test', created_at: '2026-03-01', app_metadata: { is_active: false, sessions_valid_after: '2026-10-01T00:00:00.000Z' } },
  ];
  const profiles = [
    { id: 'admin-1', name: 'Admin', role: 'admin', target_industry: null, target_role: null, experience_level: null, created_at: '2026-01-01' },
    { id: 'admin-2', name: 'Admin Two', role: 'admin', target_industry: null, target_role: null, experience_level: null, created_at: '2026-01-15' },
    { id: 'user-1', name: 'Alice', role: 'user', target_industry: 'Tech', target_role: 'Engineer', experience_level: 'Junior', created_at: '2026-02-01' },
    { id: 'user-2', name: 'Bob', role: 'user', target_industry: null, target_role: null, experience_level: null, created_at: '2026-03-01' },
  ];
  const updated = [];
  const service = createAdminUserService({
    authAdmin: {
      async listUsers() { return { users: structuredClone(users) }; },
      async getUserById(id) { return { user: structuredClone(users.find(user => user.id === id) || null) }; },
      async updateUserById(id, patch) {
        const user = users.find(entry => entry.id === id);
        Object.assign(user, patch);
        updated.push({ id, patch: structuredClone(patch) });
        return { user: structuredClone(user) };
      },
    },
    profileStore: {
      async listProfiles(ids) { return profiles.filter(profile => ids.includes(profile.id)).map(profile => structuredClone(profile)); },
      async getProfile(id) { return structuredClone(profiles.find(profile => profile.id === id) || null); },
      async updateProfile(id, patch) {
        const profile = profiles.find(entry => entry.id === id);
        Object.assign(profile, patch);
        return { profile: structuredClone(profile) };
      },
    },
    now: () => new Date('2026-10-26T12:00:00.000Z'),
  });
  return { service, users, profiles, updated };
}

test('user list joins profiles and filters all users before pagination', async () => {
  const { service } = fixture();
  const result = await service.listUsers({ q: 'alice', status: 'active', sort: 'created-desc', page: 1 });
  assert.equal(result.total, 1);
  assert.equal(result.pageSize, 20);
  assert.deepEqual(result.users.map(user => user.id), ['user-1']);
  assert.equal(result.users[0].isActive, true);
  assert.equal(result.users[0].targetRole, 'Engineer');
});

test('user profile update only changes editable profile fields', async () => {
  const { service, profiles } = fixture();
  const result = await service.updateProfile('user-1', { name: ' Alice Two ', targetIndustry: 'Health' });
  assert.equal(result.name, 'Alice Two');
  assert.equal(profiles[2].role, 'user');
  assert.equal(profiles[2].target_industry, 'Health');
  await assert.rejects(service.updateProfile('user-1', { role: 'admin' }), { code: 'INVALID_USER_PATCH' });
});

test('deactivation sets app metadata cutoff while preserving provider metadata', async () => {
  const { service, updated } = fixture();
  const result = await service.setActive('admin-1', 'user-1', false);
  assert.equal(result.isActive, false);
  assert.deepEqual(updated[0], {
    id: 'user-1',
    patch: { app_metadata: { provider: 'google', is_active: false, sessions_valid_after: '2026-10-26T12:00:00.000Z' } },
  });
});

test('reactivation moves cutoff forward so prior sessions stay revoked', async () => {
  const { service, updated } = fixture();
  const result = await service.setActive('admin-1', 'user-2', true);
  assert.equal(result.isActive, true);
  assert.equal(updated[0].patch.app_metadata.sessions_valid_after, '2026-10-26T12:00:00.000Z');
});

test('admin cannot deactivate self or let admins deactivate each other concurrently', async () => {
  const { service, users } = fixture();
  await assert.rejects(service.setActive('admin-1', 'admin-1', false), { code: 'SELF_DEACTIVATION' });
  const results = await Promise.allSettled([
    service.setActive('admin-1', 'admin-2', false),
    service.setActive('admin-2', 'admin-1', false),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(users.filter(user => user.id.startsWith('admin-') && user.app_metadata.is_active !== false).length, 1);
});
