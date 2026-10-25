const { AsyncLocalStorage } = require("node:async_hooks");
const { getPool } = require("../db/postgres");

const context = new AsyncLocalStorage();
let warned = false;

function runForUser(userId, callback) {
  return context.run({ userId }, callback);
}

async function logAiRequest({ provider, model, operation, promptVersion = null, durationMs, status }) {
  if (process.env.STORE_BACKEND === "memory") return;
  try {
    await getPool().query(`INSERT INTO interviewai_ai_request_logs
      (user_id, provider, model, operation, prompt_version, duration_ms, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [context.getStore()?.userId || null, provider, model, operation, promptVersion,
      Math.max(0, Math.round(durationMs)), status]);
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn("AI request metadata could not be saved; check the 005_ai_request_logs.sql migration.");
    }
  }
}

async function listForUser(userId) {
  if (process.env.STORE_BACKEND === "memory") return [];
  const result = await getPool().query(`SELECT provider, model, operation, prompt_version AS "promptVersion",
    duration_ms AS "durationMs", status, created_at AS "createdAt"
    FROM interviewai_ai_request_logs WHERE user_id = $1 ORDER BY created_at`, [userId]);
  return result.rows;
}

async function deleteForUser(userId) {
  if (process.env.STORE_BACKEND === "memory") return;
  await getPool().query("DELETE FROM interviewai_ai_request_logs WHERE user_id = $1", [userId]);
}

module.exports = { runForUser, logAiRequest, listForUser, deleteForUser };
