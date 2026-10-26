process.env.STORE_BACKEND = "memory";

const test = require("node:test");
const assert = require("node:assert/strict");

const usage = require("../src/services/usageService");
const store = require("../src/store");
const { createDatabase, ALICE } = require("./helpers/pglite");

const NOW = new Date("2026-10-26T12:00:00.000Z");

// created_at, capability, prompt_name, prompt_version, model, tokens_in, tokens_out, latency_ms, cost_usd, status
const ROWS = [
  // coach, priced model: four ok requests
  ["2026-10-20T10:00:00Z", "coach", "coach", "v1", "m-known", 100, 50, 100, 0.001, "ok"],
  ["2026-10-21T10:00:00Z", "coach", "coach", "v1", "m-known", 100, 50, 200, 0.001, "ok"],
  ["2026-10-22T10:00:00Z", "coach", "coach", "v1", "m-known", 100, 50, 300, 0.001, "ok"],
  ["2026-10-23T10:00:00Z", "coach", "coach", "v1", "m-known", 100, 50, 400, 0.001, "ok"],
  // critique, priced
  ["2026-10-24T10:00:00Z", "critique", "critique", "v2", "m-known", 200, 100, 500, 0.002, "ok"],
  // a model with no known price and no usage reported: cost stays unknown, never zero
  ["2026-10-24T11:00:00Z", "coach", "coach", "v1", "m-unknown", null, null, 600, null, "ok"],
  // the guard refused before any model was called: no model, no latency to speak of
  ["2026-10-25T10:00:00Z", "coach", "coach", "v1", null, null, null, 0, null, "refused"],
  // three kinds of failure
  ["2026-10-25T11:00:00Z", "critique", "critique", "v2", "m-known", null, null, 700, null, "error"],
  ["2026-10-25T12:00:00Z", "coach", "coach", "v1", "m-known", null, null, 800, null, "timeout"],
  ["2026-10-26T00:30:00Z", "critique", "critique", "v2", "m-known", null, null, 900, null, "invalid_json"],
  // an older row that stored "name.vN" in prompt_version and no prompt_name
  ["2026-10-26T01:00:00Z", "coach", null, "debrief-rag.v1", "m-known", 300, 150, 1000, 0.003, "ok"],
  // an embedding call: no prompt at all
  ["2026-10-26T02:00:00Z", "embed", null, null, "embed-1", 10, 0, 50, 0.0001, "ok"],
  // outside the default 30-day window
  ["2026-08-01T10:00:00Z", "coach", "coach", "v1", "m-known", 999, 999, 5000, 9.99, "ok"],
];

async function seeded(t) {
  const db = await createDatabase();
  t.after(() => db.close());
  for (const row of ROWS) {
    await db.query(
      `insert into ai_logs(created_at, capability, prompt_name, prompt_version, model, provider, operation,
         tokens_in, tokens_out, latency_ms, cost_usd, status, user_id)
       values($1,$2,$3,$4,$5,'gemini','op',$6,$7,$8,$9,$10,$11)`,
      [...row.slice(0, 5), ...row.slice(5), ALICE]
    );
  }
  return (query = {}) => usage.summarize(query, { run: (sql, values) => db.query(sql, values), now: NOW, memory: false });
}

// ---- query validation ----------------------------------------------------------------------

test("the default range is the last 30 days ending now", () => {
  const parsed = usage.parseUsageQuery({}, NOW);
  assert.equal(parsed.to, "2026-10-26T12:00:00.001Z");
  assert.equal(parsed.from, "2026-09-26T12:00:00.001Z");
  assert.deepEqual([parsed.capability, parsed.model, parsed.prompt], [undefined, undefined, undefined]);
});

test("a bare 'to' date includes that whole day", () => {
  const parsed = usage.parseUsageQuery({ from: "2026-10-01", to: "2026-10-31" }, NOW);
  assert.equal(parsed.from, "2026-10-01T00:00:00.000Z");
  assert.equal(parsed.to, "2026-11-01T00:00:00.000Z");
});

test("bad ranges and filters are refused with a 400", () => {
  const bad = [
    [{ from: "soon" }, /from must be a date/], [{ to: "2026-02-31x" }, /to must be a date/], [{ from: "2026-13-01" }, /not a valid date/],
    [{ from: "2026-10-20", to: "2026-10-10" }, /from must be before to/], [{ from: "2024-01-01", to: "2026-10-01" }, /limited to 366 days/],
    [{ capability: ["a", "b"] }, /single value/], [{ model: "x".repeat(81) }, /at most 80/], [{ prompt: { a: 1 } }, /single value/],
  ];
  for (const [query, message] of bad) {
    assert.throws(() => usage.parseUsageQuery(query, NOW), (error) => error.status === 400 && message.test(error.message), JSON.stringify(query));
  }
});

// ---- the numbers, from real SQL ------------------------------------------------------------

test("totals are exactly what the log rows add up to", async (t) => {
  const { totals, available, range } = await (await seeded(t))();
  assert.equal(available, true);
  assert.equal(range.from, "2026-09-26T12:00:00.001Z");
  assert.equal(totals.requests, 12, "the August row is outside the window");
  assert.deepEqual([totals.ok, totals.refused, totals.failed], [8, 1, 3]);
  assert.deepEqual([totals.errors, totals.timeouts, totals.invalidJson], [1, 1, 1]);
  assert.equal(totals.modelCalls, 11, "the refused request never reached a model");
  assert.deepEqual([totals.tokensIn, totals.tokensOut], [910, 450]);
  assert.equal(totals.unknownTokens, 4);
  assert.ok(Math.abs(totals.costUsd - 0.0091) < 1e-9);
  assert.equal(totals.unknownCost, 4, "unknown cost is counted, not treated as free");
  assert.ok(Math.abs(totals.avgCostPerRequestUsd - 0.0091 / 7) < 1e-9, "average cost only divides by requests whose price is known");
});

test("latency covers model calls only: average and 95th percentile", async (t) => {
  const { totals } = await (await seeded(t))();
  // model calls: 50 100 200 300 400 500 600 700 800 900 1000 -> mean 504.5, p95 = 900 + 0.5 * 100
  assert.equal(totals.avgLatencyMs, 505);
  assert.equal(totals.p95LatencyMs, 950);
});

test("the breakdowns add up to the totals and are ordered busiest first", async (t) => {
  const result = await (await seeded(t))();
  for (const key of ["byCapability", "byModel", "byPrompt", "byDay"]) {
    assert.equal(result[key].reduce((sum, group) => sum + group.requests, 0), 12, key);
  }
  assert.deepEqual(result.byCapability.map((g) => [g.name, g.requests]), [["coach", 8], ["critique", 3], ["embed", 1]]);
  assert.deepEqual(result.byModel.map((g) => [g.name, g.requests]), [["m-known", 9], ["(none)", 1], ["embed-1", 1], ["m-unknown", 1]]);
  assert.deepEqual(result.byPrompt.map((g) => [g.name, g.requests]), [["coach.v1", 7], ["critique.v2", 3], ["(none)", 1], ["debrief-rag.v1", 1]]);
  assert.deepEqual(result.byDay.map((g) => [g.name, g.requests]),
    [["2026-10-20", 1], ["2026-10-21", 1], ["2026-10-22", 1], ["2026-10-23", 1], ["2026-10-24", 2], ["2026-10-25", 3], ["2026-10-26", 3]]);
  const critique = result.byCapability.find((g) => g.name === "critique");
  assert.deepEqual([critique.failed, critique.errors, critique.invalidJson, critique.ok], [2, 1, 1, 1]);
});

test("older rows with 'name.vN' in the version column are not shown as 'name.name.vN'", async (t) => {
  const { byPrompt } = await (await seeded(t))();
  assert.ok(byPrompt.some((g) => g.name === "debrief-rag.v1"));
  assert.ok(!byPrompt.some((g) => /debrief-rag\.debrief-rag/.test(g.name)));
});

test("filters narrow every figure, while the filter choices stay complete", async (t) => {
  const run = await seeded(t);
  const critique = await run({ capability: "critique" });
  assert.equal(critique.totals.requests, 3);
  assert.deepEqual(critique.byCapability.map((g) => g.name), ["critique"]);
  assert.deepEqual(critique.facets.capabilities, ["coach", "critique", "embed"], "other options remain selectable");

  assert.equal((await run({ model: "m-unknown" })).totals.requests, 1);
  assert.equal((await run({ prompt: "critique.v2" })).totals.requests, 3);
  assert.equal((await run({ prompt: "debrief-rag.v1" })).totals.requests, 1);
  const both = await run({ capability: "coach", model: "m-known" });
  assert.equal(both.totals.requests, 6);
  assert.equal((await run({ capability: "nothing" })).totals.requests, 0);

  const all = await run();
  assert.deepEqual(all.facets, {
    capabilities: ["coach", "critique", "embed"],
    models: ["embed-1", "m-known", "m-unknown"],
    prompts: ["(none)", "coach.v1", "critique.v2", "debrief-rag.v1"],
  });
});

test("an explicit range reaches older rows, and an empty range gives zeros", async (t) => {
  const run = await seeded(t);
  assert.equal((await run({ from: "2026-07-01", to: "2026-10-26" })).totals.requests, 13);
  const empty = await run({ from: "2026-01-01", to: "2026-01-31" });
  assert.equal(empty.totals.requests, 0);
  assert.equal(empty.totals.avgLatencyMs, null);
  assert.equal(empty.totals.avgCostPerRequestUsd, null);
  assert.deepEqual(empty.byDay, []);
});

test("the dashboard exposes aggregates only, never who made a request", async (t) => {
  const json = JSON.stringify(await (await seeded(t))());
  assert.equal(json.includes(ALICE), false);
  assert.equal(/user_id|userId|request_id|prompt text/i.test(json), false);
});

test("filter text is bound as data, never run as SQL", async (t) => {
  const run = await seeded(t);
  for (const hostile of ["x' OR '1'='1", "'; DROP TABLE ai_logs; --"]) {
    assert.equal((await run({ capability: hostile, model: hostile, prompt: hostile })).totals.requests, 0);
  }
  assert.equal((await run()).totals.requests, 12, "ai_logs is intact");
});

test("without a database (preview mode) the dashboard says so instead of failing", async () => {
  const result = await usage.summarize({}, { memory: true, now: NOW });
  assert.equal(result.available, false);
  assert.match(result.note, /Supabase/);
  assert.equal(result.totals.requests, 0);
  assert.deepEqual(result.facets, { capabilities: [], models: [], prompts: [] });
});

// ---- HTTP: only administrators ---------------------------------------------------------------

test("GET /api/admin/usage needs a login, then the admin role", async (t) => {
  const { app } = require("../src/server");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, token) => {
    const response = await fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: response.status, data: await response.json() };
  };
  const register = async (email) => (await (await fetch(`${base}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name: "Usage", password: "secret1" }) })).json());
  const user = await register("usage-user@test.dev");
  const admin = await register("usage-admin@test.dev");
  await store.users.set(admin.user.id, { ...(await store.users.get(admin.user.id)), role: "admin" });

  assert.equal((await call("/admin/usage")).status, 401);
  assert.equal((await call("/admin/usage", user.token)).status, 403);
  const ok = await call("/admin/usage", admin.token);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.available, false, "preview mode keeps no AI log");
  assert.equal(ok.data.totals.requests, 0);
  const bad = await call("/admin/usage?from=2026-10-20&to=2026-10-10", admin.token);
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /from must be before to/);
});
