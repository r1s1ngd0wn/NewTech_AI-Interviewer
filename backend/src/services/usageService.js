// AI usage statistics for the admin dashboard (US-13), computed from the ai_logs table that every AI
// request writes to (services/aiTelemetry.js). Aggregation happens in SQL; this file validates the
// filters, runs the queries and shapes the numbers.
//
// Two rules keep the numbers honest:
//   - A request the guard refused before any model was called has no model, latency or cost. It counts
//     as a request (and as "refused") but is left out of latency, cost and token figures.
//   - A request whose price is unknown (the model has no rate in config/pricing.json, or the provider
//     sent no usage) has a NULL cost. It is counted in `unknownCost`, never treated as free, so the
//     dashboard can say "cost covers N of M requests".

const { privilegedQuery } = require("../db/postgres");
const { memoryPreview } = require("../db/supabase");
const { httpError } = require("../utils/httpError");

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MAX_RANGE_DAYS = 366;
const MAX_FILTER_LENGTH = 80;

// How a prompt is shown and filtered. Newer rows store the name and version separately; older rows
// already hold "name.vN" in prompt_version.
const PROMPT_LABEL = `(CASE
    WHEN prompt_name IS NOT NULL AND prompt_version IS NOT NULL AND prompt_version NOT LIKE prompt_name || '%'
      THEN prompt_name || '.' || prompt_version
    ELSE coalesce(prompt_version, prompt_name, '(none)') END)`;

const AGGREGATES = `
  count(*)::int AS requests,
  count(*) FILTER (WHERE status = 'ok')::int AS ok,
  count(*) FILTER (WHERE status = 'refused')::int AS refused,
  count(*) FILTER (WHERE status = 'error')::int AS errors,
  count(*) FILTER (WHERE status = 'timeout')::int AS timeouts,
  count(*) FILTER (WHERE status = 'invalid_json')::int AS invalid_json,
  count(*) FILTER (WHERE model IS NOT NULL)::int AS model_calls,
  coalesce(sum(tokens_in), 0)::float8 AS tokens_in,
  coalesce(sum(tokens_out), 0)::float8 AS tokens_out,
  count(*) FILTER (WHERE model IS NOT NULL AND (tokens_in IS NULL OR tokens_out IS NULL))::int AS unknown_tokens,
  coalesce(sum(cost_usd), 0)::float8 AS cost_usd,
  count(*) FILTER (WHERE model IS NOT NULL AND cost_usd IS NULL)::int AS unknown_cost,
  (avg(latency_ms) FILTER (WHERE model IS NOT NULL))::float8 AS avg_latency_ms,
  (percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE model IS NOT NULL))::float8 AS p95_latency_ms`;

function single(query, name) {
  const value = query[name];
  if (value === undefined || value === "") return undefined;
  if (Array.isArray(value) || typeof value !== "string") throw httpError(400, `${name} must be a single value`);
  const trimmed = value.trim();
  if (trimmed.length > MAX_FILTER_LENGTH) throw httpError(400, `${name} must be at most ${MAX_FILTER_LENGTH} characters`);
  return trimmed;
}

function parseMoment(value, name) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!dateOnly && !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?$/.test(value)) {
    throw httpError(400, `${name} must be a date like 2026-10-26`);
  }
  const date = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) {
    throw httpError(400, `${name} is not a valid date`);
  }
  return { date, dateOnly };
}

// Defaults to the last 30 days. A bare `to` date includes that whole (UTC) day.
function parseUsageQuery(query = {}, now = new Date()) {
  const fromText = single(query, "from");
  const toText = single(query, "to");
  let to = new Date(now.getTime() + 1);
  if (toText) {
    const { date, dateOnly } = parseMoment(toText, "to");
    to = new Date(date.getTime() + (dateOnly ? DAY_MS : 1));
  }
  const from = fromText ? parseMoment(fromText, "from").date : new Date(to.getTime() - DEFAULT_DAYS * DAY_MS);
  if (from >= to) throw httpError(400, "from must be before to");
  if (to - from > MAX_RANGE_DAYS * DAY_MS) throw httpError(400, `the date range is limited to ${MAX_RANGE_DAYS} days`);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    capability: single(query, "capability"),
    model: single(query, "model"),
    prompt: single(query, "prompt"),
  };
}

function shape(row) {
  const modelCalls = row.model_calls;
  const pricedCalls = modelCalls - row.unknown_cost;
  return {
    requests: row.requests,
    ok: row.ok,
    refused: row.refused,
    failed: row.errors + row.timeouts + row.invalid_json,
    errors: row.errors,
    timeouts: row.timeouts,
    invalidJson: row.invalid_json,
    modelCalls,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    unknownTokens: row.unknown_tokens,
    costUsd: row.cost_usd,
    unknownCost: row.unknown_cost,
    avgCostPerRequestUsd: pricedCalls > 0 ? row.cost_usd / pricedCalls : null,
    avgLatencyMs: row.avg_latency_ms === null || row.avg_latency_ms === undefined ? null : Math.round(row.avg_latency_ms),
    p95LatencyMs: row.p95_latency_ms === null || row.p95_latency_ms === undefined ? null : Math.round(row.p95_latency_ms),
  };
}

function filterClause(filters, startAt) {
  const values = [];
  const clauses = [];
  const add = (clause, value) => {
    values.push(value);
    clauses.push(clause.replace("?", `$${startAt + values.length - 1}`));
  };
  if (filters.capability) add("capability = ?", filters.capability);
  if (filters.model) add("model = ?", filters.model);
  if (filters.prompt) add(`${PROMPT_LABEL} = ?`, filters.prompt);
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", values };
}

async function summarize(query, { run = privilegedQuery, now = new Date(), memory = memoryPreview() } = {}) {
  const filters = parseUsageQuery(query, now);
  const range = { from: filters.from, to: filters.to };
  const applied = { capability: filters.capability || null, model: filters.model || null, prompt: filters.prompt || null };
  if (memory) {
    return { range, filters: applied, available: false,
      note: "AI requests are only recorded when the backend runs against Supabase.", ...emptySummary() };
  }

  const extra = filterClause(filters, 3);
  const where = `created_at >= $1 AND created_at < $2${extra.sql}`;
  const values = [filters.from, filters.to, ...extra.values];
  const grouped = (expression, alias) =>
    run(`SELECT ${expression} AS ${alias}, ${AGGREGATES} FROM ai_logs WHERE ${where} GROUP BY 1 ORDER BY requests DESC, 1`, values);

  const [totals, byCapability, byModel, byPrompt, byDay, facets] = await Promise.all([
    run(`SELECT ${AGGREGATES} FROM ai_logs WHERE ${where}`, values),
    grouped("capability", "name"),
    grouped("coalesce(model, '(none)')", "name"),
    grouped(PROMPT_LABEL, "name"),
    run(`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS name, ${AGGREGATES}
           FROM ai_logs WHERE ${where} GROUP BY 1 ORDER BY 1`, values),
    // Filter choices come from the whole date range, so picking one value does not hide the others.
    run(`SELECT DISTINCT capability, model, ${PROMPT_LABEL} AS prompt FROM ai_logs WHERE created_at >= $1 AND created_at < $2`,
      [filters.from, filters.to]),
  ]);

  const groupRows = (result) => result.rows.map((row) => ({ name: row.name, ...shape(row) }));
  const unique = (key) => [...new Set(facets.rows.map((row) => row[key]).filter(Boolean))].sort();
  return {
    range,
    filters: applied,
    available: true,
    totals: shape(totals.rows[0]),
    byCapability: groupRows(byCapability),
    byModel: groupRows(byModel),
    byPrompt: groupRows(byPrompt),
    byDay: groupRows(byDay),
    facets: { capabilities: unique("capability"), models: unique("model"), prompts: unique("prompt") },
  };
}

function emptySummary() {
  const zero = { requests: 0, ok: 0, refused: 0, failed: 0, errors: 0, timeouts: 0, invalidJson: 0, modelCalls: 0,
    tokensIn: 0, tokensOut: 0, unknownTokens: 0, costUsd: 0, unknownCost: 0, avgCostPerRequestUsd: null,
    avgLatencyMs: null, p95LatencyMs: null };
  return { totals: zero, byCapability: [], byModel: [], byPrompt: [], byDay: [],
    facets: { capabilities: [], models: [], prompts: [] } };
}

module.exports = { summarize, parseUsageQuery, PROMPT_LABEL };
