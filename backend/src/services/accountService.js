// Account-level data rights: export everything held about a user, or erase it all.
const store = require("../store");
const sessionService = require("./sessionService");
const { toPublicUser, httpError } = require("./authService");

function exportData(userId) {
  const user = store.users.get(userId);
  if (!user) throw httpError(404, "user not found");

  const sessions = sessionService.listSessionsForUser(userId).map((session) => ({
    session,
    feedback: store.feedbacks.get(session.id) || null,
    chat: store.sessionChats.get(session.id) || [],
  }));

  return { exportedAt: new Date().toISOString(), user: toPublicUser(user), sessions };
}

function deleteAccount(userId) {
  const user = store.users.get(userId);
  if (!user) throw httpError(404, "user not found");

  sessionService.deleteAllSessionsForUser(userId);
  for (const [token, record] of store.tokens.entries()) {
    const owner = typeof record === "string" ? record : record.userId;
    if (owner === userId) store.tokens.delete(token);
  }
  store.usersByEmail.delete(user.email);
  store.users.delete(userId);
}

module.exports = { exportData, deleteAccount };
