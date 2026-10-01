import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { usePageMeta } from "../hooks/usePageMeta.js";

export default function ScenariosPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState([]);
  const [filters, setFilters] = useState({ industries: [], seniorities: [], questionTypes: [] });
  const [activeFilters, setActiveFilters] = useState({});
  const [recommendedIds, setRecommendedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  usePageMeta({
    title: "Scenarios",
    description: "Browse fixed interview scenarios by industry, seniority, and question type.",
  });

  useEffect(() => {
    api.scenarioFilters().then(setFilters).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    api
      .listScenarios(activeFilters)
      .then((data) => setScenarios(data.scenarios))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [activeFilters]);

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
  }

  return (
    <div className="page container">
      <span className="eyebrow">Scenario Library</span>
      <h1>Choose an interview scenario</h1>
      <p>
        Every scenario is a fixed set of questions for one industry, seniority and question type.
        The interviewer only asks from that list.
      </p>

      <div className="filter-bar">
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
    </div>
  );
}

function FilterGroup({ label, options, value, onSelect }) {
  if (!options?.length) return null;
  return (
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
  );
}
