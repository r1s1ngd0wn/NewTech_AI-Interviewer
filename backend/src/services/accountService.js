// Account-level data rights: export everything held about a user, or erase it all.
const store = require("../store");
const sessionService = require("./sessionService");
const documentService = require("./documentService");
const { toPublicUser, httpError } = require("./authService");
const context = require('../context/requestContext');
const { adminClient, memoryPreview } = require('../db/supabase');

async function exportData(userId) {
  const user = memoryPreview() ? await store.users.get(userId) : context.getStore()?.user;
  if (!user) throw httpError(404, "user not found");

  const sessions = await Promise.all((await sessionService.listSessionsForUser(userId)).map(async (session) => ({
    session,
    feedback: (await store.feedbacks.get(session.id)) || null,
    chat: (await store.sessionChats.get(session.id)) || [],
    documents: process.env.STORE_BACKEND === "memory" ? [] : await documentService.exportDocuments(userId, session.id),
  })));

  const documents = process.env.STORE_BACKEND === "memory" ? [] : await documentService.exportUserDocuments(userId);
  const scope = context.getStore();
  const plans = scope?.db ? await require('./planService').createPlanService(scope.db).list(userId) : [];
  return { exportedAt: new Date().toISOString(), user: toPublicUser(user), sessions, documents, plans };
}

async function deleteAccount(userId) {
  const user = memoryPreview() ? await store.users.get(userId) : context.getStore()?.user;
  if (!user) throw httpError(404, "user not found");

  await sessionService.deleteAllSessionsForUser(userId);
  if (process.env.STORE_BACKEND !== "memory") await documentService.deleteAllUserDocuments(userId);
  if (!memoryPreview()) {
    const { error } = await adminClient().auth.admin.deleteUser(userId);
    if (error) throw httpError(503, 'could not delete authentication account');
    return;
  }
  for (const [token, record] of await store.tokens.entries()) {
    const owner = typeof record === "string" ? record : record.userId;
    if (owner === userId) await store.tokens.delete(token);
  }
  await store.usersByEmail.delete(user.email);
  await store.users.delete(userId);
}

module.exports = { exportData, deleteAccount };
