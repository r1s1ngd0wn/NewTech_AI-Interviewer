import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { AlertIcon } from "../components/icons.jsx";

export default function DashboardPage() {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.getProgress().then(setProgress).catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="page container">
        <div className="form-error">
          <AlertIcon width={16} height={16} />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!progress) {
    return (
      <div className="page container">
        <p>Loading your progress...</p>
      </div>
    );
  }

  if (progress.history.length === 0) {
    return (
      <div className="page container">
        <span className="eyebrow">Progress</span>
        <h1>Your practice history</h1>
        <div className="empty-state card card-pad">
          <p>You haven't completed a scored session yet.</p>
          <button className="btn btn-primary" onClick={() => navigate("/scenarios")}>
            Start your first interview
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page container">
      <span className="eyebrow">Progress</span>
      <h1>Your practice history</h1>
      <p>Session history and score trends across every completed interview (FR-7.1 / FR-7.2).</p>

      {progress.weakestCriterion && (
        <div className="card card-pad" style={{ marginBottom: "1.5rem" }}>
          <h3 className="mt-0">Most persistent area to work on</h3>
          <p className="mb-0">
            Across your sessions, <strong>{criterionLabel(progress.weakestCriterion.criterionId)}</strong> has
            averaged {progress.weakestCriterion.averageScore}/100, your lowest scoring criterion overall.
          </p>
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: "1.5rem", overflowX: "auto" }}>
        <h3 className="mt-0">Score trend</h3>
        <TrendTable trend={progress.trend} history={progress.history} />
      </div>

      <h2>Session history</h2>
      <div className="grid grid-2">
        {progress.history
          .slice()
          .reverse()
          .map((h) => (
            <div key={h.sessionId} className="card card-pad">
              <div className="row-between">
                <h3 className="mt-0 mb-0">{h.scenarioTitle}</h3>
                <span className="tag tag-active">{h.overallScore}/100</span>
              </div>
              <p className="muted">{h.date ? new Date(h.date).toLocaleString() : "-"}</p>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/feedback/${h.sessionId}`)}>
                View feedback
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}

function criterionLabel(id) {
  const labels = {
    fluency: "Fluency & Delivery",
    relevance: "Relevance",
    vocabulary_grammar: "Vocabulary & Grammar",
    structure: "Structure",
  };
  return labels[id] || id;
}

function TrendTable({ trend, history }) {
  if (!trend.length) return <p className="muted">Not enough data yet.</p>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Criterion</th>
          {history.map((h) => (
            <th key={h.sessionId} style={{ textAlign: "center", padding: "0.5rem 0.75rem" }} className="muted">
              {new Date(h.date).toLocaleDateString()}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {trend.map((row) => (
          <tr key={row.criterionId} style={{ borderTop: "1px solid var(--color-hairline)" }}>
            <td style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>{criterionLabel(row.criterionId)}</td>
            {row.points.map((p, i) => (
              <td key={i} style={{ textAlign: "center", padding: "0.5rem 0.75rem" }}>
                {p.score ?? "-"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
