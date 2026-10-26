// Searching a user's interview history. The same criteria are answered two ways: in SQL against
// Postgres (the real deployment, run under the signed-in user's row-level security), and in memory
// (preview mode and unit tests). Every value reaches SQL as a bound parameter; the only text that is
// built into the statement comes from the two whitelists below, never from the request.

const store = require("./index");
const { getPool } = require("../db/postgres");

const SORT_COLUMNS = {
  date: "s.value->>'startedAt'",
  score: "(f.value->>'overallScore')::numeric",
};
const DIRECTIONS = { asc: "ASC", desc: "DESC" };

function toNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function buildWhere(userId, criteria) {
  const values = [userId];
  const clauses = ["s.value->>'userId' = $1"];
  const add = (clause, value) => {
    values.push(value);
    clauses.push(clause.replace("?", `$${values.length}`));
  };
  if (criteria.scenarioIds) add("s.value->>'scenarioId' = ANY(?::text[])", criteria.scenarioIds);
  if (criteria.status) add("s.value->>'status' = ?", criteria.status);
  if (criteria.startedFrom) add("s.value->>'startedAt' >= ?", criteria.startedFrom);
  if (criteria.startedBefore) add("s.value->>'startedAt' < ?", criteria.startedBefore);
  return { where: clauses.join(" AND "), values };
}

// criteria: { scenarioIds?, status?, startedFrom?, startedBefore?, sort, order, limit, offset }
// run: (sql, values) => { rows }. Defaults to the request-scoped pool, so row-level security applies.
async function searchSql(userId, criteria, run = (sql, values) => getPool().query(sql, values)) {
  const { where, values } = buildWhere(userId, criteria);
  const from = "FROM interviewai_sessions s LEFT JOIN interviewai_feedbacks f ON f.session_id = s.id";
  const count = await run(`SELECT count(*)::int AS total ${from} WHERE ${where}`, values);
  const sortColumn = SORT_COLUMNS[criteria.sort];
  const direction = DIRECTIONS[criteria.order];
  if (!sortColumn || !direction) throw new Error("invalid sort");
  const page = await run(
    `SELECT s.id AS "sessionId",
            s.value->>'scenarioId' AS "scenarioId",
            s.value->>'status' AS status,
            s.value->>'startedAt' AS "startedAt",
            s.value->>'endedAt' AS "endedAt",
            jsonb_array_length(coalesce(s.value->'turns', '[]'::jsonb)) AS answered,
            (f.value->>'overallScore')::numeric AS "overallScore"
       ${from}
      WHERE ${where}
      ORDER BY ${sortColumn} ${direction} NULLS LAST, s.id
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, criteria.limit, criteria.offset]
  );
  return {
    total: count.rows[0]?.total ?? 0,
    rows: page.rows.map((row) => ({
      sessionId: row.sessionId,
      scenarioId: row.scenarioId,
      status: row.status,
      startedAt: row.startedAt,
      endedAt: row.endedAt || null,
      answered: Number(row.answered),
      overallScore: toNumber(row.overallScore),
    })),
  };
}

async function searchMemory(userId, criteria) {
  const sessions = await store.sessions.valuesByUser(userId);
  const rows = [];
  for (const session of sessions) {
    if (criteria.scenarioIds && !criteria.scenarioIds.includes(session.scenarioId)) continue;
    if (criteria.status && session.status !== criteria.status) continue;
    if (criteria.startedFrom && !(session.startedAt >= criteria.startedFrom)) continue;
    if (criteria.startedBefore && !(session.startedAt < criteria.startedBefore)) continue;
    const feedback = await store.feedbacks.get(session.id);
    rows.push({
      sessionId: session.id,
      scenarioId: session.scenarioId,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt || null,
      answered: (session.turns || []).length,
      overallScore: feedback && Number.isFinite(Number(feedback.overallScore)) ? Number(feedback.overallScore) : null,
    });
  }
  const sign = criteria.order === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const left = criteria.sort === "score" ? a.overallScore : a.startedAt;
    const right = criteria.sort === "score" ? b.overallScore : b.startedAt;
    // A missing value (a session that was never scored) always sorts last, like NULLS LAST in SQL.
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    if (left !== right && left !== null) return left < right ? -sign : sign;
    return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
  });
  return { total: rows.length, rows: rows.slice(criteria.offset, criteria.offset + criteria.limit) };
}

function search(userId, criteria, run) {
  return process.env.STORE_BACKEND === "memory" ? searchMemory(userId, criteria) : searchSql(userId, criteria, run);
}

module.exports = { search, searchSql, searchMemory, buildWhere };
