// Interview history: search, filter, sort and paginate a user's own sessions (US-05).
// Validation is strict on purpose: every query parameter is checked here, bad values get a 400 with a
// clear message, and nothing from the request is ever put into SQL text (see store/sessionSearch.js).

const scenarios = require("../data/scenarios.json");
const sessionSearch = require("../store/sessionSearch");
const { httpError } = require("../utils/httpError");

const STATUSES = ["in_progress", "awaiting_finish", "scored"];
const SORTS = ["date", "score"];
const ORDERS = ["asc", "desc"];
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_PAGE = 10000;
const MAX_TEXT = 80;
const DAY_MS = 24 * 60 * 60 * 1000;

function single(query, name) {
  const value = query[name];
  if (value === undefined || value === "") return undefined;
  if (Array.isArray(value) || typeof value !== "string") throw httpError(400, `${name} must be a single value`);
  return value.trim();
}

function oneOf(value, allowed, name, fallback) {
  if (value === undefined) return fallback;
  if (!allowed.includes(value)) throw httpError(400, `${name} must be one of: ${allowed.join(", ")}`);
  return value;
}

function integer(value, name, min, max, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d{1,6}$/.test(value)) throw httpError(400, `${name} must be a whole number`);
  const number = Number(value);
  if (number < min || number > max) throw httpError(400, `${name} must be between ${min} and ${max}`);
  return number;
}

// "2026-10-26" is a whole UTC day; a full ISO timestamp is an exact instant.
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

function scenarioIdsFor(text, scenarioId) {
  let ids = scenarios.map((s) => s.id);
  if (text) {
    const needle = text.toLowerCase();
    ids = scenarios
      .filter((s) => [s.title, s.industry, s.seniority, s.questionType].some((v) => String(v).toLowerCase().includes(needle)))
      .map((s) => s.id);
  }
  if (scenarioId) ids = ids.filter((id) => id === scenarioId);
  return ids;
}

// Turns raw query-string values into the criteria the store understands, or throws a 400.
function parseHistoryQuery(query = {}) {
  const text = single(query, "q");
  if (text && text.length > MAX_TEXT) throw httpError(400, `q must be at most ${MAX_TEXT} characters`);
  const scenario = single(query, "scenario");
  if (scenario && !scenarios.some((s) => s.id === scenario)) throw httpError(400, "scenario is not a known scenario");
  const status = oneOf(single(query, "status"), STATUSES, "status");
  const sort = oneOf(single(query, "sort"), SORTS, "sort", "date");
  const order = oneOf(single(query, "order"), ORDERS, "order", "desc");
  const page = integer(single(query, "page"), "page", 1, MAX_PAGE, 1);
  const limit = integer(single(query, "limit"), "limit", 1, MAX_LIMIT, DEFAULT_LIMIT);

  let startedFrom;
  let startedBefore;
  const from = single(query, "from");
  const to = single(query, "to");
  if (from) startedFrom = parseMoment(from, "from").date.toISOString();
  if (to) {
    const { date, dateOnly } = parseMoment(to, "to");
    // A bare date means "through the end of that day".
    startedBefore = new Date(date.getTime() + (dateOnly ? DAY_MS : 1)).toISOString();
  }
  if (startedFrom && startedBefore && startedFrom >= startedBefore) throw httpError(400, "from must be before to");

  const filtered = Boolean(text || scenario);
  const scenarioIds = filtered ? scenarioIdsFor(text, scenario) : undefined;
  return {
    text, scenario, status, sort, order, page, limit, startedFrom, startedBefore, scenarioIds,
    offset: (page - 1) * limit,
  };
}

async function searchHistory(userId, query) {
  const criteria = parseHistoryQuery(query);
  // A text search that matches no scenario cannot match any session: skip the database.
  const { rows, total } = criteria.scenarioIds && !criteria.scenarioIds.length
    ? { rows: [], total: 0 }
    : await sessionSearch.search(userId, criteria);

  const byId = new Map(scenarios.map((s) => [s.id, s]));
  return {
    items: rows.map((row) => {
      const scenario = byId.get(row.scenarioId);
      return {
        sessionId: row.sessionId,
        scenarioId: row.scenarioId,
        scenarioTitle: scenario?.title || row.scenarioId,
        status: row.status,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        answered: row.answered,
        totalQuestions: scenario?.questions.length ?? null,
        overallScore: row.overallScore,
      };
    }),
    page: criteria.page,
    limit: criteria.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / criteria.limit)),
    sort: criteria.sort,
    order: criteria.order,
  };
}

module.exports = { searchHistory, parseHistoryQuery, STATUSES, MAX_LIMIT, DEFAULT_LIMIT };
