import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({ searchSessions: vi.fn(), listScenarios: vi.fn() }));
vi.mock("../lib/api.js", () => ({ api }));
import HistoryPage from "./HistoryPage.jsx";

const scored = { sessionId: "s1", scenarioId: "scn_a", scenarioTitle: "Junior Engineer - Behavioral", status: "scored",
  startedAt: "2026-10-20T09:00:00.000Z", endedAt: "2026-10-20T09:20:00.000Z", answered: 4, totalQuestions: 4, overallScore: 82 };
const unfinished = { sessionId: "s2", scenarioId: "scn_b", scenarioTitle: "Senior Analyst - Finance", status: "in_progress",
  startedAt: "2026-10-21T09:00:00.000Z", endedAt: null, answered: 1, totalQuestions: 5, overallScore: null };
const page = (overrides = {}) => ({ items: [scored, unfinished], page: 1, limit: 10, total: 2, totalPages: 1, sort: "date", order: "desc", ...overrides });

function show(path = "/history") {
  return render(<MemoryRouter initialEntries={[path]}><HistoryPage /></MemoryRouter>);
}
const lastCall = () => api.searchSessions.mock.calls.at(-1)[0];

beforeEach(() => {
  api.listScenarios.mockResolvedValue({ scenarios: [{ id: "scn_a", title: "Junior Engineer - Behavioral" }, { id: "scn_b", title: "Senior Analyst - Finance" }] });
  api.searchSessions.mockResolvedValue(page());
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

test("lists the sessions with status, score and a feedback link only for completed ones", async () => {
  show();
  expect(await screen.findByText("Junior Engineer - Behavioral", { selector: "h3" })).toBeTruthy();
  expect(screen.getByText("Senior Analyst - Finance", { selector: "h3" })).toBeTruthy();
  expect(screen.getByText("82/100")).toBeTruthy();
  const list = within(screen.getByRole("list", { name: "Interview sessions" }));
  expect(list.getByText("Completed")).toBeTruthy();
  expect(list.getByText("In progress")).toBeTruthy();
  expect(screen.getByText(/1 of 5 questions answered/)).toBeTruthy();
  const links = screen.getAllByRole("link", { name: "View feedback" });
  expect(links).toHaveLength(1);
  expect(links[0].getAttribute("href")).toBe("/feedback/s1");
  expect(screen.getByRole("status").textContent).toBe("Showing 1-2 of 2 sessions");
  expect(lastCall()).toMatchObject({ page: 1, limit: 10, sort: "date", order: "desc", q: "", status: "" });
});

test("filters in the address bar are applied, shown in the form, and sent to the server", async () => {
  show("/history?q=finance&status=scored&scenario=scn_b&from=2026-10-01&to=2026-10-31&sort=score&order=asc&page=2");
  await waitFor(() => expect(api.searchSessions).toHaveBeenCalled());
  expect(lastCall()).toMatchObject({ q: "finance", status: "scored", scenario: "scn_b", from: "2026-10-01", to: "2026-10-31", sort: "score", order: "asc", page: 2 });
  expect(screen.getByLabelText("Search").value).toBe("finance");
  expect(screen.getByLabelText("Status").value).toBe("scored");
  expect(screen.getByLabelText("From").value).toBe("2026-10-01");
  expect(screen.getByLabelText("Sort by").value).toBe("score:asc");
});

test("applying new filters searches again from page 1", async () => {
  show("/history?page=3");
  await waitFor(() => expect(lastCall().page).toBe(3));
  fireEvent.change(screen.getByLabelText("Search"), { target: { value: "analyst" } });
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "scored" } });
  fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "score:desc" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(lastCall()).toMatchObject({ q: "analyst", status: "scored", sort: "score", order: "desc", page: 1 }));
});

test("the pager moves through pages and keeps the filters", async () => {
  api.searchSessions.mockResolvedValue(page({ total: 25, totalPages: 3 }));
  show("/history?status=scored");
  expect(await screen.findByText("Page 1 of 3")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Previous" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(lastCall()).toMatchObject({ status: "scored", page: 2 }));
});

test("the last page cannot go further", async () => {
  api.searchSessions.mockResolvedValue(page({ page: 3, total: 25, totalPages: 3 }));
  show("/history?page=3");
  expect(await screen.findByText("Page 3 of 3")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Next" }).disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toBe("Showing 21-25 of 25 sessions");
});

test("clearing the filters goes back to the unfiltered list", async () => {
  show("/history?status=scored&q=x");
  await waitFor(() => expect(lastCall().status).toBe("scored"));
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  await waitFor(() => expect(lastCall()).toMatchObject({ q: "", status: "", page: 1 }));
  expect(screen.getByLabelText("Search").value).toBe("");
});

test("no match with filters offers to clear them; no sessions at all offers to start", async () => {
  api.searchSessions.mockResolvedValue(page({ items: [], total: 0 }));
  show("/history?q=zzz");
  expect(await screen.findByText("No sessions match those filters.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Clear filters" })).toBeTruthy();
  cleanup();
  show("/history");
  expect(await screen.findByText("You haven't started an interview yet.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Start your first interview" })).toBeTruthy();
});

test("a server error is shown as an alert", async () => {
  api.searchSessions.mockRejectedValue(new Error("page must be between 1 and 10000"));
  show("/history?page=0");
  expect((await screen.findByRole("alert")).textContent).toContain("page must be between 1 and 10000");
});

test("a slow older response cannot overwrite a newer one", async () => {
  let release;
  api.searchSessions.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(page({ items: [{ ...scored, scenarioTitle: "STALE RESULT" }] })); }));
  show();
  api.searchSessions.mockResolvedValue(page({ items: [{ ...scored, scenarioTitle: "FRESH RESULT" }] }));
  fireEvent.change(screen.getByLabelText("Search"), { target: { value: "new" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByText("FRESH RESULT", { selector: "h3" })).toBeTruthy();
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByText("STALE RESULT")).toBeNull();
  expect(screen.getByText("FRESH RESULT", { selector: "h3" })).toBeTruthy();
});
