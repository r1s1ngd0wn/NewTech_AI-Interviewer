export default function ScoreBar({ label, score, sublabel }) {
  return (
    <div className="score-row">
      <div className="row-between" style={{ marginBottom: "0.35rem" }}>
        <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{label}</span>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {sublabel ? `${sublabel} · ` : ""}
          {score}/100
        </span>
      </div>
      <div
        className="score-bar-track"
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="score-bar-fill" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
    </div>
  );
}
