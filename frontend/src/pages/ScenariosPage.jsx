import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { usePageMeta } from "../hooks/usePageMeta.js";

export default function ScenariosPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("title-asc");
  const [page, setPage] = useState(1);
  const [resultCount, setResultCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [filters, setFilters] = useState({ industries: [], seniorities: [], questionTypes: [] });
  const [activeFilters, setActiveFilters] = useState({});
  const [recommendedIds, setRecommendedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  usePageMeta({
    title: "Scenarios",
    description: "Browse interview scenarios by industry, seniority, and question type.",
  });

  useEffect(() => {
    api.scenarioFilters().then(setFilters).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    let current = true;
    api.browseScenarios({ ...activeFilters, q: search.trim(), sort, page })
      .then((data) => {
        if (!current) return;
        setScenarios(data.scenarios);
        setResultCount(data.total);
        setTotalPages(data.totalPages);
        if (data.page !== page) setPage(data.page);
      })
      .catch((err) => { if (current) setError(err.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [activeFilters, search, sort, page]);

  useEffect(() => {
    if (!user?.profile?.targetIndustry) {
      setRecommendedIds(new Set());
      return;
    }
    api
      .recommendedScenarios()
      .then((data) => setRecommendedIds(new Set(data.scenarios.map((s) => s.id))))
      .catch(() => setRecommendedIds(new Set()));
  }, [user]);

  function toggleFilter(key, value) {
    setActiveFilters((prev) => ({ ...prev, [key]: prev[key] === value ? undefined : value }));
    setPage(1);
  }

  return (
    <div className="page container">
      <span className="eyebrow">Scenario Library</span>
      <h1>Choose an interview scenario</h1>
      <p>
        Choose a scenario, then add your CV or job description before the interview to put its questions in context.
      </p>

      <div className="scenario-toolbar">
        <label className="scenario-search">
          <span>Search scenarios</span>
          <input
            type="search"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder="Name, industry, level or question type"
            maxLength={100}
          />
          <span className="muted">Searches scenario details, not interview question text.</span>
        </label>
        <label className="scenario-sort">
          Sort by
          <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
            <option value="title-asc">Name A–Z</option>
            <option value="title-desc">Name Z–A</option>
            <option value="questions-desc">Most questions</option>
          </select>
        </label>
      </div>

      <div className="filter-bar" aria-label="Filter scenarios">
        <FilterGroup
          label="Industry"
          options={filters.industries}
          value={activeFilters.industry}
          onSelect={(v) => toggleFilter("industry", v)}
        />
        <FilterGroup
          label="Level"
          options={filters.seniorities}
          value={activeFilters.seniority}
          onSelect={(v) => toggleFilter("seniority", v)}
        />
        <FilterGroup
          label="Type"
          options={filters.questionTypes}
          value={activeFilters.questionType}
          onSelect={(v) => toggleFilter("questionType", v)}
        />
      </div>

      <div className="scenario-results" aria-live="polite">
        <span>{loading ? "Searching scenarios…" : `${resultCount} ${resultCount === 1 ? "scenario" : "scenarios"} found`}</span>
        {!loading && resultCount > 0 && <span>Page {page} of {totalPages}</span>}
      </div>

      {error && <div className="form-error">{error}</div>}
      {loading ? (
        <p>Loading scenarios...</p>
      ) : scenarios.length === 0 ? (
        <div className="empty-state">No scenarios match those filters.</div>
      ) : (
        <div className="grid grid-2">
          {scenarios.map((scenario, i) => (
            <div key={scenario.id} className="card stack" style={{ padding: "var(--spacing-16)" }}>
              <img
                className="scenario-photo"
                src={`/images/interview-${(i % 3) + 1}.jpg`}
                alt=""
              />
              <div
                className="stack"
                style={{ padding: "0 var(--spacing-8) var(--spacing-8)", flex: 1 }}
              >
                {recommendedIds.has(scenario.id) && <span className="tag tag-active">Recommended for you</span>}
                <h3 className="mt-0">{scenario.title}</h3>
                <div className="row wrap" style={{ marginBottom: "0.25rem" }}>
                  <span className="tag">{scenario.industry}</span>
                  <span className="tag">{scenario.seniority}</span>
                  <span className="tag">{scenario.questionType}</span>
                </div>
                <p className="mb-0">{scenario.questionCount} questions, spoken interview</p>
                <button
                  className="btn btn-primary"
                  style={{ marginTop: "auto" }}
                  onClick={() => navigate(`/interview/${scenario.id}`)}
                >
                  Start interview
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && totalPages > 1 && <nav className="scenario-pagination" aria-label="Scenario pages">
        <button className="btn btn-secondary" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>
          Previous
        </button>
        <span>Page {page} of {totalPages}</span>
        <button className="btn btn-secondary" type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>
          Next
        </button>
      </nav>}
    </div>
  );
}

function FilterGroup({ label, options, value, onSelect }) {
  if (!options?.length) return null;
  return (
    <div className="scenario-filter-group">
      <span>{label}</span>
      <div className="row wrap" style={{ gap: "0.4rem" }}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`filter-btn ${value === option ? "active" : ""}`}
            onClick={() => onSelect(option)}
            aria-pressed={value === option}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
