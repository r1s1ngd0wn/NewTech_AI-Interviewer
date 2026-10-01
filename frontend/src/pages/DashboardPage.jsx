import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { AlertIcon } from "../components/icons.jsx";
import ScoreTrendChart from "../components/ScoreTrendChart.jsx";
import { usePageMeta } from "../hooks/usePageMeta.js";

function formatSessionDate(iso) {
  return iso
    ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "-";
}

export default function DashboardPage() {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  usePageMeta({
    title: "Progress",
    description: "Score trends and session history across every completed interview.",
  });

  useEffect(() => {
    api.getProgress().then(setProgress).catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="page container">
        <div className="form-error" role="alert">
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
      <p>Session history and score trends across every completed interview.</p>

      {progress.weakestCriterion && (
        <div className="card card-pad" style={{ marginBottom: "1.5rem" }}>
          <h3 className="mt-0">Most persistent area to work on</h3>
          <p className="mb-0">
            Across your sessions, <strong>{progress.weakestCriterion.name}</strong> has averaged{" "}
            {progress.weakestCriterion.averageScore}/100, your lowest scoring criterion overall.
          </p>
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: "1.5rem" }}>
        <h3 className="mt-0">Overall score by session</h3>
        <ScoreTrendChart history={progress.history} />
      </div>

      <div className="card card-pad" style={{ marginBottom: "1.5rem", overflowX: "auto" }}>
        <h3 className="mt-0">Score by criterion</h3>
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
              <p className="muted">{formatSessionDate(h.date)}</p>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/feedback/${h.sessionId}`)}>
                View feedback
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}

function TrendTable({ trend, history }) {
  if (!trend.length) return <p className="muted">Not enough data yet.</p>;
  return (
    <table className="trend-table">
      <thead>
        <tr>
          <th scope="col">Criterion</th>
          {history.map((h) => (
            <th key={h.sessionId} scope="col" className="muted">
              {formatSessionDate(h.date)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {trend.map((row) => (
          <tr key={row.criterionId}>
            <th scope="row">{row.name}</th>
            {row.points.map((p, i) => (
              <td key={i}>{p.score ?? "-"}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
