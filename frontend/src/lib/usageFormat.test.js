import { expect, test } from "vitest";
import { formatCost, formatCount, formatLatency, formatPercent, formatTokenPair, formatTokens, lastDays, plural, pricedCount, successRate } from "./usageFormat.js";
import { queryString } from "./api.js";

test("missing numbers are shown as unknown, never as zero", () => {
  expect(formatCost(null)).toBe("unknown");
  expect(formatCost(undefined)).toBe("unknown");
  expect(formatLatency(null)).toBe("-");
  expect(formatTokens(undefined)).toBe("-");
  expect(formatCount(NaN)).toBe("-");
  expect(formatPercent(1, 0)).toBe("-");
});

test("costs keep enough digits for fractions of a cent", () => {
  expect(formatCost(0)).toBe("$0.00");
  expect(formatCost(0.0013)).toBe("$0.0013");
  expect(formatCost(0.0091)).toBe("$0.0091");
  expect(formatCost(12.3456)).toBe("$12.35");
});

test("latency, counts and tokens are compact and readable", () => {
  expect(formatLatency(950)).toBe("950 ms");
  expect(formatLatency(1500)).toBe("1.5 s");
  expect(formatCount(12345)).toBe("12,345");
  expect(formatTokens(910)).toBe("910");
  expect(formatTokens(1234)).toBe("1.2k");
  expect(formatTokens(45000)).toBe("45k");
  expect(formatTokens(2_500_000)).toBe("2.5M");
});

test("success rate ignores refused requests, and priced count only counts model calls", () => {
  expect(successRate({ ok: 8, failed: 3, refused: 5 })).toBe("73%");
  expect(successRate({ ok: 0, failed: 0, refused: 4 })).toBe("-");
  expect(pricedCount({ modelCalls: 11, unknownCost: 4 })).toBe(7);
  expect(pricedCount({ modelCalls: 0, unknownCost: 0 })).toBe(0);
});

test("lastDays gives an inclusive UTC window", () => {
  expect(lastDays(7, new Date("2026-10-26T23:30:00Z"))).toEqual({ from: "2026-10-20", to: "2026-10-26" });
  expect(lastDays(1, new Date("2026-10-26T00:00:00Z"))).toEqual({ from: "2026-10-26", to: "2026-10-26" });
});

test("queryString drops empty values and encodes the rest", () => {
  expect(queryString({})).toBe("");
  expect(queryString({ q: "", status: undefined, page: null })).toBe("");
  expect(queryString({ q: "a b&c", page: 2 })).toBe("?q=a+b%26c&page=2");
});

test("plurals read naturally and token pairs never show zero for unknown usage", () => {
  expect(plural(1, "error")).toBe("1 error");
  expect(plural(0, "timeout")).toBe("0 timeouts");
  expect(plural(1234, "request")).toBe("1,234 requests");
  expect(formatTokenPair({ modelCalls: 5, unknownTokens: 5, tokensIn: 0, tokensOut: 0 })).toBe("-");
  expect(formatTokenPair({ modelCalls: 5, unknownTokens: 0, tokensIn: 1200, tokensOut: 600 })).toBe("1.2k / 600");
  expect(formatTokenPair({ modelCalls: 5, unknownTokens: 2, tokensIn: 1200, tokensOut: 600 })).toBe("1.2k / 600*");
  expect(formatTokenPair({ modelCalls: 0, unknownTokens: 0, tokensIn: 0, tokensOut: 0 })).toBe("0 / 0");
});