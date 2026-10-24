// Account-level data rights: export everything held about a user, or erase it all.
const store = require("../store");
const sessionService = require("./sessionService");
const documentService = require("./documentService");
const aiRequestLog = require("./aiRequestLogService");
const { toPublicUser, httpError } = require("./authService");

async function exportData(userId) {
  const user = await store.users.get(userId);
  if (!user) throw httpError(404, "user not found");

  const sessions = await Promise.all((await sessionService.listSessionsForUser(userId)).map(async (session) => ({
    session,
    feedback: (await store.feedbacks.get(session.id)) || null,
    chat: (await store.sessionChats.get(session.id)) || [],
    documents: process.env.STORE_BACKEND === "memory" ? [] : await documentService.exportDocuments(userId, session.id),
  })));

  const documents = process.env.STORE_BACKEND === "memory" ? [] : await documentService.exportUserDocuments(userId);
  const aiRequests = await aiRequestLog.listForUser(userId);
  return { exportedAt: new Date().toISOString(), user: toPublicUser(user), sessions, documents, aiRequests };
}

async function deleteAccount(userId) {
  const user = await store.users.get(userId);
  if (!user) throw httpError(404, "user not found");

  await sessionService.deleteAllSessionsForUser(userId);
  if (process.env.STORE_BACKEND !== "memory") await documentService.deleteAllUserDocuments(userId);
  await aiRequestLog.deleteForUser(userId);
  for (const [token, record] of await store.tokens.entries()) {
    const owner = typeof record === "string" ? record : record.userId;
    if (owner === userId) await store.tokens.delete(token);
  }
  await store.usersByEmail.delete(user.email);
  await store.users.delete(userId);
}

module.exports = { exportData, deleteAccount };
