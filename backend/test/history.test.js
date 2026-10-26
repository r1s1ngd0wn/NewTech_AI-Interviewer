process.env.STORE_BACKEND = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");

const history = require("../src/services/historyService");
const sessionSearch = require("../src/store/sessionSearch");
const store = require("../src/store");
const { createDatabase, asUser, ALICE, BOB, ALICE_SESSION, BOB_SESSION } = require("./helpers/pglite");

const BEHAVIORAL = "scn_swe_junior_behavioral"; // "Junior Software Engineer - Behavioral"
const FUNDAMENTALS = "scn_swe_junior_fundamentals";
const FINANCE = "scn_finance_senior_behavioral";

// id, owner, scenario, status, startedAt, score (null = never scored)
const SESSIONS = [
  ["s01", "alice", BEHAVIORAL, "scored", "2026-10-01T09:00:00.000Z", 82],
  ["s02", "alice", BEHAVIORAL, "scored", "2026-10-05T09:00:00.000Z", 45],
  ["s03", "alice", FUNDAMENTALS, "scored", "2026-10-10T09:00:00.000Z", 67],
  ["s04", "alice", FUNDAMENTALS, "in_progress", "2026-10-12T09:00:00.000Z", null],
  ["s05", "alice", FINANCE, "awaiting_finish", "2026-10-20T09:00:00.000Z", null],
  ["s06", "alice", FINANCE, "scored", "2026-10-25T23:30:00.000Z", 90],
  ["b01", "bob", BEHAVIORAL, "scored", "2026-10-02T09:00:00.000Z", 99],
];

async function seedMemory() {
  for (const [id, userId, scenarioId, status, startedAt, score] of SESSIONS) {
    await store.sessions.set(id, { id, userId, scenarioId, status, startedAt, endedAt: status === "scored" ? startedAt : null,
      turns: [{ questionId: "q1", answerText: "x" }, { questionId: "q2", answerText: "y" }] });
    if (score !== null) await store.feedbacks.set(id, { sessionId: id, overallScore: score });
  }
}

const ids = (result) => result.items.map((item) => item.sessionId);

// ---- query validation ----------------------------------------------------------------------

test("a bare query gets sensible defaults", () => {
  const parsed = history.parseHistoryQuery({});
  assert.deepEqual([parsed.page, parsed.limit, parsed.sort, parsed.order, parsed.offset], [1, 10, "date", "desc", 0]);
  assert.equal(parsed.scenarioIds, undefined);
});

test("every bad parameter is refused with a 400 and a readable message", () => {
  const bad = [
    [{ status: "finished" }, /status must be one of/], [{ sort: "name" }, /sort must be one of/],
    [{ order: "up" }, /order must be one of/], [{ page: "0" }, /page must be between/], [{ page: "1.5" }, /whole number/],
    [{ page: "-1" }, /whole number/], [{ limit: "0" }, /limit must be between/], [{ limit: "51" }, /limit must be between/],
    [{ limit: "abc" }, /whole number/], [{ from: "yesterday" }, /from must be a date/], [{ to: "2026-13-45" }, /not a valid date/],
    [{ from: "1999-01-01" }, /not a valid date/], [{ from: "2026-11-01", to: "2026-10-01" }, /from must be before to/],
    [{ q: ["a", "b"] }, /single value/], [{ q: { $ne: "x" } }, /single value/], [{ q: "x".repeat(81) }, /at most 80/],
    [{ scenario: "scn_made_up" }, /not a known scenario/],
  ];
  for (const [query, message] of bad) {
    assert.throws(() => history.parseHistoryQuery(query), (error) => error.status === 400 && message.test(error.message), JSON.stringify(query));
  }
});

test("a bare 'to' date includes that whole day, and dates are read as UTC", () => {
  const parsed = history.parseHistoryQuery({ from: "2026-10-25", to: "2026-10-25" });
  assert.equal(parsed.startedFrom, "2026-10-25T00:00:00.000Z");
  assert.equal(parsed.startedBefore, "2026-10-26T00:00:00.000Z");
});

test("text search matches scenario title, industry, level and type, ignoring case", () => {
  assert.ok(history.parseHistoryQuery({ q: "BEHAVIORAL" }).scenarioIds.includes(BEHAVIORAL));
  assert.ok(history.parseHistoryQuery({ q: "finance" }).scenarioIds.includes(FINANCE));
  assert.deepEqual(history.parseHistoryQuery({ q: "no such scenario anywhere" }).scenarioIds, []);
  assert.deepEqual(history.parseHistoryQuery({ q: "behavioral", scenario: FINANCE }).scenarioIds, [FINANCE], "the scenario is behavioral, so both filters hold");
  assert.deepEqual(history.parseHistoryQuery({ q: "behavioral", scenario: FUNDAMENTALS }).scenarioIds, [], "a technical scenario fails the text filter");
});

// ---- search over the in-memory store -------------------------------------------------------

test("search filters, sorts and paginates, and only ever returns the caller's own sessions", async () => {
  await seedMemory();
  const alice = (query) => history.searchHistory("alice", query);

  assert.equal((await alice({})).total, 6, "bob's session is never counted");
  assert.deepEqual(ids(await alice({})), ["s06", "s05", "s04", "s03", "s02", "s01"], "newest first by default");
  assert.deepEqual(ids(await alice({ order: "asc" })), ["s01", "s02", "s03", "s04", "s05", "s06"]);

  assert.deepEqual(ids(await alice({ status: "scored" })), ["s06", "s03", "s02", "s01"]);
  assert.deepEqual(ids(await alice({ scenario: FUNDAMENTALS })), ["s04", "s03"]);
  assert.deepEqual(ids(await alice({ q: "finance" })), ["s06", "s05"]);
  assert.deepEqual(ids(await alice({ q: "behavioral", status: "scored" })), ["s06", "s02", "s01"], "both behavioral scenarios, scored only");
  assert.deepEqual(ids(await alice({ from: "2026-10-05", to: "2026-10-12" })), ["s04", "s03", "s02"]);
  assert.deepEqual(ids(await alice({ from: "2026-10-25", to: "2026-10-25" })), ["s06"], "late evening still counts as that day");
  assert.deepEqual(ids(await alice({ q: "nothing matches this" })), []);
});

test("sorting by score puts unscored sessions last in both directions", async () => {
  await seedMemory();
  const alice = (query) => history.searchHistory("alice", query);
  assert.deepEqual(ids(await alice({ sort: "score", order: "desc" })), ["s06", "s01", "s03", "s02", "s04", "s05"]);
  assert.deepEqual(ids(await alice({ sort: "score", order: "asc" })), ["s02", "s03", "s01", "s06", "s04", "s05"]);
});

test("pagination reports total and pages, and a page past the end is empty", async () => {
  await seedMemory();
  const first = await history.searchHistory("alice", { limit: "4", page: "1" });
  assert.deepEqual([first.items.length, first.total, first.totalPages, first.page, first.limit], [4, 6, 2, 1, 4]);
  const second = await history.searchHistory("alice", { limit: "4", page: "2" });
  assert.deepEqual(ids(second), ["s02", "s01"]);
  const beyond = await history.searchHistory("alice", { limit: "4", page: "9" });
  assert.deepEqual([beyond.items.length, beyond.total, beyond.totalPages], [0, 6, 2]);
  assert.deepEqual([...ids(first), ...ids(second)], ["s06", "s05", "s04", "s03", "s02", "s01"], "pages do not overlap or skip");
});

test("each item carries what the history list needs", async () => {
  await seedMemory();
  const [scored, unfinished] = (await history.searchHistory("alice", { q: "fundamentals", sort: "date" })).items;
  assert.equal(unfinished.sessionId, "s03");
  assert.equal(scored.sessionId, "s04");
  const item = (await history.searchHistory("alice", { status: "scored", scenario: BEHAVIORAL })).items[0];
  assert.deepEqual(Object.keys(item).sort(), ["answered", "endedAt", "overallScore", "scenarioId", "scenarioTitle", "sessionId", "startedAt", "status", "totalQuestions"]);
  assert.equal(item.scenarioTitle, "Junior Software Engineer - Behavioral");
  assert.equal(item.answered, 2);
  assert.ok(item.totalQuestions > 2);
  assert.equal(item.overallScore, 45);
});

// ---- the same search in real SQL, under row-level security ---------------------------------

test("the SQL search matches the memory search and respects row-level security", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  for (const [id, owner, scenarioId, status, startedAt, score] of SESSIONS) {
    const userId = owner === "alice" ? ALICE : BOB;
    await db.query("insert into interviewai_sessions(id, value) values($1, $2::jsonb)", [id,
      JSON.stringify({ id, userId, scenarioId, status, startedAt, endedAt: status === "scored" ? startedAt : null,
        turns: [{ questionId: "q1" }, { questionId: "q2" }] })]);
    if (score !== null) await db.query("insert into interviewai_feedbacks(session_id, value) values($1, $2::jsonb)", [id, JSON.stringify({ overallScore: score })]);
  }
  const asAlice = asUser(db, ALICE, ALICE_SESSION);
  const base = { sort: "date", order: "desc", limit: 10, offset: 0 };
  const rows = async (criteria, userId = ALICE, run = asAlice) => (await sessionSearch.searchSql(userId, { ...base, ...criteria }, run)).rows.map((row) => row.sessionId);

  assert.deepEqual(await rows({}), ["s06", "s05", "s04", "s03", "s02", "s01"]);
  assert.deepEqual(await rows({ status: "scored" }), ["s06", "s03", "s02", "s01"]);
  assert.deepEqual(await rows({ scenarioIds: [FUNDAMENTALS, FINANCE] }), ["s06", "s05", "s04", "s03"]);
  assert.deepEqual(await rows({ startedFrom: "2026-10-05T00:00:00.000Z", startedBefore: "2026-10-13T00:00:00.000Z" }), ["s04", "s03", "s02"]);
  assert.deepEqual(await rows({ sort: "score", order: "desc" }), ["s06", "s01", "s03", "s02", "s04", "s05"], "unscored last");
  assert.deepEqual(await rows({ sort: "score", order: "asc" }), ["s02", "s03", "s01", "s06", "s04", "s05"], "unscored last");
  assert.deepEqual(await rows({ limit: 2, offset: 2 }), ["s04", "s03"]);

  const page = await sessionSearch.searchSql(ALICE, { ...base, limit: 2, offset: 4 }, asAlice);
  assert.equal(page.total, 6);
  assert.equal(page.rows[0].answered, 2);
  assert.equal(typeof page.rows.find((row) => row.sessionId === "s02").overallScore, "number");

  // The memory implementation must agree with SQL on every one of these.
  await seedMemory();
  for (const criteria of [{}, { status: "scored" }, { sort: "score", order: "asc" }, { scenarioIds: [FINANCE] }, { limit: 3, offset: 3 }]) {
    const memory = (await sessionSearch.searchMemory("alice", { ...base, ...criteria })).rows.map((row) => row.sessionId);
    assert.deepEqual(await rows(criteria), memory, JSON.stringify(criteria));
  }

  // Row-level security is a second lock: even if the application filter named another user, the database
  // would only show the signed-in user's own rows.
  assert.deepEqual(await rows({}, BOB, asAlice), []);
  assert.deepEqual(await rows({}, BOB, asUser(db, BOB, BOB_SESSION)), ["b01"]);
  assert.deepEqual(await rows({}, ALICE, asUser(db, BOB, BOB_SESSION)), [], "bob cannot read alice's rows");
});

test("hostile text in the criteria is data, never SQL", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await db.query("insert into interviewai_sessions(id, value) values('s1', $1::jsonb)",
    [JSON.stringify({ id: "s1", userId: ALICE, scenarioId: BEHAVIORAL, status: "scored", startedAt: "2026-10-01T00:00:00.000Z", turns: [] })]);
  const run = asUser(db, ALICE, ALICE_SESSION);
  const base = { sort: "date", order: "desc", limit: 10, offset: 0 };
  for (const hostile of ["scored' OR '1'='1", "x'; DROP TABLE interviewai_sessions; --", "' UNION SELECT value FROM interviewai_users --"]) {
    const result = await sessionSearch.searchSql(ALICE, { ...base, status: hostile, scenarioIds: [hostile], startedFrom: hostile }, run);
    assert.equal(result.total, 0);
  }
  assert.equal((await sessionSearch.searchSql(ALICE, base, run)).total, 1, "the table is intact");
  await assert.rejects(sessionSearch.searchSql(ALICE, { ...base, sort: "id; DROP TABLE x" }, run), /invalid sort/);
  await assert.rejects(sessionSearch.searchSql(ALICE, { ...base, order: "asc; --" }, run), /invalid sort/);
});

// ---- HTTP ----------------------------------------------------------------------------------

test("GET /api/sessions is login-protected, validated and scoped to the caller", async (t) => {
  const { app } = require("../src/server");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, token, method = "GET", body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const make = async (email) => (await call("/auth/register", null, "POST", { email, name: "History", password: "secret1" })).data;
  const owner = await make("history-owner@test.dev");
  const other = await make("history-other@test.dev");
  for (const [id, , scenarioId, status, startedAt, score] of SESSIONS.filter((row) => row[1] === "alice")) {
    await store.sessions.set(`h-${id}`, { id: `h-${id}`, userId: owner.user.id, scenarioId, status, startedAt, turns: [] });
    if (score !== null) await store.feedbacks.set(`h-${id}`, { overallScore: score });
  }

  assert.equal((await call("/sessions")).status, 401);
  const all = await call("/sessions?limit=3&sort=score&order=desc", owner.token);
  assert.equal(all.status, 200);
  assert.deepEqual(all.data.items.map((item) => item.overallScore), [90, 82, 67]);
  assert.equal(all.data.total, 6);
  assert.equal((await call("/sessions?status=scored&q=finance", owner.token)).data.items.length, 1);
  assert.equal((await call("/sessions", other.token)).data.total, 0, "another account sees none of them");
  const bad = await call("/sessions?page=0", owner.token);
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /page must be between/);
  assert.equal((await call("/sessions?status=scored&status=in_progress", owner.token)).status, 400);
  const one = await call(`/sessions/h-s01`, owner.token);
  assert.equal(one.status, 200, "listing did not break fetching a single session");
});
