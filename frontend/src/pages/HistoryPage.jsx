import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { AlertIcon } from "../components/icons.jsx";
import { usePageMeta } from "../hooks/usePageMeta.js";

const PAGE_SIZE = 10;
const STATUS_LABELS = { scored: "Completed", in_progress: "In progress", awaiting_finish: "Waiting to finish" };
const SORT_OPTIONS = [
  { value: "date:desc", label: "Newest first" },
  { value: "date:asc", label: "Oldest first" },
  { value: "score:desc", label: "Highest score" },
  { value: "score:asc", label: "Lowest score" },
];
const FILTER_KEYS = ["q", "scenario", "status", "from", "to"];

function formatWhen(iso) {
  return iso
    ? new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "-";
}

// Everything the user chose lives in the address bar, so a filtered list can be reloaded or shared.
function readParams(params) {
  const page = Number.parseInt(params.get("page"), 10);
  return {
    q: params.get("q") || "",
    scenario: params.get("scenario") || "",
    status: params.get("status") || "",
    from: params.get("from") || "",
    to: params.get("to") || "",
    sort: params.get("sort") || "date",
    order: params.get("order") || "desc",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export default function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const applied = readParams(params);
  const [draft, setDraft] = useState(applied);
  const [scenarios, setScenarios] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  usePageMeta({
    title: "History",
    description: "Search, filter and sort every interview you have practised.",
  });

  useEffect(() => {
    api.listScenarios().then((data) => setScenarios(data.scenarios || [])).catch(() => {});
  }, []);

  const queryKey = params.toString();
  // Keep the form in step with the address bar (browser Back/Forward, a shared link).
  useEffect(() => {
    setDraft(readParams(new URLSearchParams(queryKey)));
  }, [queryKey]);

  useEffect(() => {
    let current = true;
    const wanted = readParams(new URLSearchParams(queryKey));
    setLoading(true);
    setError("");
    api
      .searchSessions({ ...wanted, limit: PAGE_SIZE })
      .then((data) => current && setResult(data))
      .catch((err) => current && setError(err.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [queryKey]);

  function change(patch) {
    const next = { ...applied, ...patch };
    const query = {};
    for (const key of FILTER_KEYS) if (next[key]) query[key] = next[key];
    if (next.sort !== "date" || next.order !== "desc") {
      query.sort = next.sort;
      query.order = next.order;
    }
    if (next.page > 1) query.page = String(next.page);
    setParams(query);
  }

  function submit(event) {
    event.preventDefault();
    change({ ...draft, page: 1 });
  }

  function clear() {
    const empty = { q: "", scenario: "", status: "", from: "", to: "", sort: "date", order: "desc", page: 1 };
    setDraft(empty);
    setParams({});
  }

  const filtering = FILTER_KEYS.some((key) => applied[key]);
  const first = result && result.total ? (result.page - 1) * result.limit + 1 : 0;
  const last = result ? Math.min(result.total, result.page * result.limit) : 0;

  return (
    <div className="page container">
      <span className="eyebrow">History</span>
      <h1>All your interviews</h1>
      <p>Search, filter and sort every session you have started.</p>

      <form className="history-form card card-pad" role="search" aria-label="Filter your interview history" onSubmit={submit}>
        <div className="field history-search">
          <label htmlFor="history-q">Search</label>
          <input
            id="history-q"
            type="search"
            maxLength={80}
            placeholder="Scenario, industry, level or type"
            value={draft.q}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="history-scenario">Scenario</label>
          <select id="history-scenario" value={draft.scenario} onChange={(e) => setDraft({ ...draft, scenario: e.target.value })}>
            <option value="">All scenarios</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="history-status">Status</label>
          <select id="history-status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
            <option value="">Any status</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="history-from">From</label>
          <input id="history-from" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="history-to">To</label>
          <input id="history-to" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="history-sort">Sort by</label>
          <select
            id="history-sort"
            value={`${draft.sort}:${draft.order}`}
            onChange={(e) => {
              const [sort, order] = e.target.value.split(":");
              setDraft({ ...draft, sort, order });
            }}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="history-actions row">
          <button type="submit" className="btn btn-primary btn-sm">Apply</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={clear}>Clear</button>
        </div>
      </form>

      {error && (
        <div className="form-error" role="alert">
          <AlertIcon width={16} height={16} />
          <span>{error}</span>
        </div>
      )}

      <p className="muted history-summary" role="status" aria-live="polite">
        {loading ? "Loading your sessions..." : result ? (result.total ? `Showing ${first}-${last} of ${result.total} sessions` : "") : ""}
      </p>

      {!loading && result && result.total === 0 && (
        <div className="empty-state card card-pad">
          {filtering ? (
            <>
              <p>No sessions match those filters.</p>
              <button className="btn btn-secondary" onClick={clear}>Clear filters</button>
            </>
          ) : (
            <>
              <p>You haven't started an interview yet.</p>
              <button className="btn btn-primary" onClick={() => navigate("/scenarios")}>Start your first interview</button>
            </>
          )}
        </div>
      )}

      {result && result.items.length > 0 && (
        <ul className="history-list" aria-label="Interview sessions">
          {result.items.map((item) => (
            <li key={item.sessionId} className="history-item card card-pad">
              <div className="history-main">
                <h3 className="mt-0 mb-0">{item.scenarioTitle}</h3>
                <p className="muted mb-0">
                  {formatWhen(item.startedAt)} · {item.answered}
                  {item.totalQuestions ? ` of ${item.totalQuestions}` : ""} questions answered
                </p>
              </div>
              <div className="history-side row wrap">
                <span className={item.status === "scored" ? "tag tag-active" : "tag"}>{STATUS_LABELS[item.status] || item.status}</span>
                {item.overallScore !== null && <span className="tag tag-active">{item.overallScore}/100</span>}
                {item.status === "scored" && (
                  <Link className="btn btn-secondary btn-sm" to={`/feedback/${item.sessionId}`}>View feedback</Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {result && result.totalPages > 1 && (
        <nav className="history-pager row" aria-label="Pagination">
          <button className="btn btn-secondary btn-sm" disabled={result.page <= 1 || loading} onClick={() => change({ page: result.page - 1 })}>
            Previous
          </button>
          <span className="muted">Page {result.page} of {result.totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={result.page >= result.totalPages || loading} onClick={() => change({ page: result.page + 1 })}>
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
