// Legacy authentication is isolated to explicit, nonproduction memory previews.
const { memoryPreview, adminClient } = require('../db/supabase');
const { httpError } = require('../utils/httpError');
const legacy = () => require('./legacyAuthService');
function preview(method, args) {
  if (!memoryPreview()) throw httpError(410, 'sign in using Supabase Auth');
  return legacy()[method](...args);
}
module.exports = {
  register: (...args) => preview('register', args),
  login: (...args) => preview('login', args),
  getUserFromToken: (...args) => preview('getUserFromToken', args),
  updateProfile: (...args) => preview('updateProfile', args),
  async revokeToken(token) {
    if (memoryPreview()) return legacy().revokeToken(token);
    const { error } = await adminClient().auth.admin.signOut(token, 'local');
    if (error) throw httpError(503, 'could not sign out; please try again');
  },
  toPublicUser(user) {
    if (!user) return user;
    const { passwordHash, salt, ...safe } = user;
    return safe;
  },
  httpError,
};
