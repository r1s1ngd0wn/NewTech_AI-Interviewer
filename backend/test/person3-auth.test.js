process.env.STORE_BACKEND = 'memory';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('JWT authentication rejects a revoked session and never trusts metadata roles', async () => {
  const { authenticate } = require('../src/services/supabaseAuth');
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'alice', email: 'a@test.dev', user_metadata: { role: 'admin' } } } }) },
    rpc: async () => ({ data: false }),
    from: () => { throw new Error('revoked session must not read a profile'); },
  };
  await assert.rejects(authenticate('signed-token', db), { status: 401 });
});

test('valid auth returns authoritative profile and onboarding compatibility', async () => {
  const { authenticate } = require('../src/services/supabaseAuth');
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'alice', email: 'a@test.dev', user_metadata: { role: 'admin' } } } }) },
    rpc: async () => ({ data: true }),
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: {
      id: 'alice', name: 'Alice', role: 'user', target_role: 'Developer', onboarding_complete: true,
    } }) }) }) }),
  };
  const user = await authenticate('signed-token', db);
  assert.equal(user.role, 'user');
  assert.equal(user.profile.targetRole, 'Developer');
  assert.equal(user.profile.onboardingComplete, true);
});

test('profile edits cannot request role or ownership changes', () => {
  const { profilePatch } = require('../src/services/supabaseAuth');
  assert.throws(() => profilePatch({ role: 'admin' }), { status: 400 });
  assert.throws(() => profilePatch({ id: 'other' }), { status: 400 });
  assert.deepEqual(profilePatch({ name: ' Alice ', targetRole: 'Engineer' }), { name: 'Alice', target_role: 'Engineer' });
});

test('role middleware denies ordinary users and missing identities', () => {
  const role = require('../src/middleware/requireRole')('admin');
  for (const user of [undefined, { role: 'user' }]) {
    let status;
    role({ user }, { status(n) { status = n; return this; }, json() {} }, () => assert.fail('must deny'));
    assert.equal(status, user ? 403 : 401);
  }
  let allowed = false;
  role({ user: { role: 'admin' } }, {}, () => { allowed = true; });
  assert.equal(allowed, true);
});
