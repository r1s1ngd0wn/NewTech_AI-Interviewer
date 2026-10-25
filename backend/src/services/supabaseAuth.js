const { httpError } = require('../utils/httpError');
const { userClient } = require('../db/supabase');

function publicProfile(row, email) {
  return {
    id: row.id, email, name: row.name, role: row.role, createdAt: row.created_at,
    profile: {
      targetIndustry: row.target_industry, targetRole: row.target_role,
      experienceLevel: row.experience_level, onboardingComplete: row.onboarding_complete,
    },
  };
}
async function authenticate(token, db = userClient(token)) {
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw httpError(401, 'missing or invalid authorization token');
  // Unlike offline JWT verification this also rejects tokens of signed-out sessions.
  const active = await db.rpc('is_session_active');
  if (active.error) throw httpError(503, 'could not verify authentication session');
  if (!active.data) throw httpError(401, 'authentication session has ended');
  const profile = await db.from('profiles').select('*').eq('id', data.user.id).single();
  if (profile.error || !profile.data) throw httpError(503, 'could not load user profile');
  return publicProfile(profile.data, data.user.email);
}

function profilePatch(patch) {
  const fields = { name: 'name', targetIndustry: 'target_industry', targetRole: 'target_role', experienceLevel: 'experience_level' };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => !fields[k])) {
    throw httpError(400, 'only name and profile fields may be edited');
  }
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null && key !== 'name') { result[fields[key]] = null; continue; }
    if (typeof value !== 'string' || value.trim().length > 80 || (key === 'name' && !value.trim())) {
      throw httpError(400, `${key} must contain at most 80 characters`);
    }
    result[fields[key]] = value.trim() || null;
  }
  return result;
}
async function updateProfile(userId, patch, db, email) {
  const result = await db.from('profiles').update(profilePatch(patch)).eq('id', userId).select('*').single();
  if (result.error) throw httpError(400, 'could not update profile');
  return publicProfile(result.data, email);
}
module.exports = { authenticate, publicProfile, profilePatch, updateProfile };
