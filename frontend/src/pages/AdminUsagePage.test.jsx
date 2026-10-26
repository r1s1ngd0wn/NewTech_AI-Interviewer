import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({ getUsage: vi.fn() }));
vi.mock("../lib/api.js", () => ({ api }));
import AdminUsagePage from "./AdminUsagePage.jsx";

const group = (name, overrides = {}) => ({ name, requests: 4, ok: 3, refused: 0, failed: 1, errors: 1, timeouts: 0, invalidJson: 0,
  modelCalls: 4, tokensIn: 1200, tokensOut: 600, unknownTokens: 0, costUsd: 0.004, unknownCost: 0, avgCostPerRequestUsd: 0.001,
  avgLatencyMs: 420, p95LatencyMs: 900, ...overrides });

const usage = (overrides = {}) => ({
  range: { from: "2026-09-27T00:00:00.000Z", to: "2026-10-27T00:00:00.000Z" },
  filters: { capability: null, model: null, prompt: null },
  available: true,
  totals: group("", { requests: 12, ok: 8, refused: 1, failed: 3, errors: 1, timeouts: 1, invalidJson: 1, modelCalls: 11,
    tokensIn: 910, tokensOut: 450, unknownTokens: 4, costUsd: 0.0091, unknownCost: 4, avgCostPerRequestUsd: 0.0013, avgLatencyMs: 505, p95LatencyMs: 950 }),
  byCapability: [group("coach", { requests: 8 }), group("critique", { requests: 3, modelCalls: 3, unknownCost: 3, costUsd: 0 })],
  byModel: [group("gemini-x", { requests: 9 }), group("(none)", { requests: 1, modelCalls: 0, avgLatencyMs: null, p95LatencyMs: null })],
  byPrompt: [group("coach.v1", { requests: 7 })],
  byDay: [group("2026-10-25", { requests: 5, failed: 1 }), group("2026-10-26", { requests: 7, failed: 2 })],
  facets: { capabilities: ["coach", "critique"], models: ["gemini-x"], prompts: ["coach.v1"] },
  ...overrides,
});

const show = () => render(<MemoryRouter><AdminUsagePage /></MemoryRouter>);
const lastCall = () => api.getUsage.mock.calls.at(-1)[0];
const kpi = (label) => screen.getByText(label, { selector: ".eyebrow" }).closest(".usage-kpi");

beforeEach(() => { api.getUsage.mockResolvedValue(usage()); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

test("shows the headline numbers for the last 30 days", async () => {
  show();
  await screen.findByRole("region", { name: "Summary" });
  expect(lastCall()).toMatchObject({ capability: "", model: "", prompt: "" });
  expect(lastCall().from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(within(kpi("Requests")).getByText("12")).toBeTruthy();
  expect(within(kpi("Requests")).getByText("11 reached a model")).toBeTruthy();
  expect(within(kpi("Succeeded")).getByText("73%")).toBeTruthy();
  expect(within(kpi("Failed")).getByText("3")).toBeTruthy();
  expect(within(kpi("Failed")).getByText("1 error, 1 timeout, 1 invalid JSON")).toBeTruthy();
  expect(within(kpi("Refused")).getByText("1")).toBeTruthy();
  expect(within(kpi("Average time")).getByText("505 ms")).toBeTruthy();
  expect(within(kpi("Average time")).getByText(/95th percentile 950 ms/)).toBeTruthy();
  expect(within(kpi("Tokens in / out")).getByText("910 / 450")).toBeTruthy();
  expect(within(kpi("Tokens in / out")).getByText("4 requests reported no usage")).toBeTruthy();
});

test("cost is an estimate and says how many requests it covers; unknown prices are not free", async () => {
  show();
  await screen.findByRole("region", { name: "Summary" });
  expect(within(kpi("Estimated cost")).getByText("$0.0091")).toBeTruthy();
  expect(within(kpi("Estimated cost")).getByText(/\$0\.0013 per priced request/)).toBeTruthy();
  expect(screen.getByText(/Cost covers 7 of 11 model requests/)).toBeTruthy();
  expect(screen.getByText(/A \* in the tables means/)).toBeTruthy();
  // a group whose price is entirely unknown reads "unknown", a partly priced one is starred
  const critiqueRow = screen.getByRole("rowheader", { name: "critique" }).closest("tr");
  expect(within(critiqueRow).getByText("unknown")).toBeTruthy();
});

test("with no price configured at all the cost reads unknown", async () => {
  api.getUsage.mockResolvedValue(usage({ totals: { ...usage().totals, unknownCost: 11, costUsd: 0, avgCostPerRequestUsd: null } }));
  show();
  await screen.findByRole("region", { name: "Summary" });
  expect(within(kpi("Estimated cost")).getByText("unknown")).toBeTruthy();
  expect(screen.getByText("No price is configured for the models used")).toBeTruthy();
});

test("breakdown tables and the daily chart list every group", async () => {
  show();
  await screen.findByRole("region", { name: "Summary" });
  for (const name of ["coach", "critique", "gemini-x", "(none)", "coach.v1"]) {
    expect(screen.getAllByRole("rowheader", { name })[0]).toBeTruthy();
  }
  const days = screen.getByRole("list", { name: "Requests per day" });
  expect(within(days).getAllByRole("listitem")).toHaveLength(2);
  expect(within(days).getByText("7 (2 failed)")).toBeTruthy();
  const noModel = screen.getByRole("rowheader", { name: "(none)" }).closest("tr");
  expect(within(noModel).getAllByText("-").length).toBeGreaterThanOrEqual(3);
});

test("choosing a filter or a period asks the server again", async () => {
  show();
  await screen.findByRole("region", { name: "Summary" });
  fireEvent.change(screen.getByLabelText("Capability"), { target: { value: "critique" } });
  await waitFor(() => expect(lastCall().capability).toBe("critique"));
  fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gemini-x" } });
  await waitFor(() => expect(lastCall()).toMatchObject({ capability: "critique", model: "gemini-x" }));
  const before = lastCall();
  fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
  await waitFor(() => expect(lastCall().from).not.toBe(before.from));
});

test("filter choices come from the server's list", async () => {
  show();
  await screen.findByRole("region", { name: "Summary" });
  const options = within(screen.getByLabelText("Prompt version")).getAllByRole("option").map((o) => o.textContent);
  expect(options).toEqual(["All", "coach.v1"]);
});

test("when the backend keeps no AI log it says so instead of showing zeros", async () => {
  api.getUsage.mockResolvedValue(usage({ available: false, note: "AI requests are only recorded when the backend runs against Supabase." }));
  show();
  expect(await screen.findByText(/only recorded when the backend runs against Supabase/)).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
});

test("an error (for example a forbidden or invalid range) is shown as an alert", async () => {
  api.getUsage.mockRejectedValue(new Error("insufficient permissions"));
  show();
  expect((await screen.findByRole("alert")).textContent).toContain("insufficient permissions");
});
