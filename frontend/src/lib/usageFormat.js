// Number formatting for the admin usage dashboard. Missing values are shown as "-" or "unknown",
// never as 0: "no price configured" is not the same as "free".

export function formatCount(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "-";
}

// Compact token counts: 1,234 -> 1.2k, 2,500,000 -> 2.5M
export function formatTokens(value) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(0)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function formatLatency(ms) {
  if (!Number.isFinite(ms)) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

// Dollar amounts keep enough digits for fractions of a cent.
export function formatCost(usd) {
  if (!Number.isFinite(usd)) return "unknown";
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatPercent(part, whole) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "-";
}

// Requests that reached a model and so could have a price.
export function pricedCount(totals) {
  return Math.max(0, totals.modelCalls - totals.unknownCost);
}

// Share of requests that were not refused that succeeded.
export function successRate(totals) {
  return formatPercent(totals.ok, totals.ok + totals.failed);
}

// "1 error", "3 errors"
export function plural(count, word) {
  return `${formatCount(count)} ${word}${count === 1 ? "" : "s"}`;
}

// Tokens for a group of requests: "-" when no request reported usage (so 0 never means "unknown").
export function formatTokenPair(row) {
  if (row.modelCalls > 0 && row.unknownTokens === row.modelCalls) return "-";
  return `${formatTokens(row.tokensIn)} / ${formatTokens(row.tokensOut)}${row.unknownTokens > 0 ? "*" : ""}`;
}

export function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

// {from, to} as YYYY-MM-DD for the last `days` days including today (UTC, like the server).
export function lastDays(days, now = new Date()) {
  const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { from: isoDay(from), to: isoDay(now) };
}
