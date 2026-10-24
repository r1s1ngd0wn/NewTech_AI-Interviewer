// Review of one answer, shown under its transcript excerpt. `critique` comes from the backend and
// is either written by the model (source "gemini" / "local") or a scripted fallback built from the
// question data (source "scripted"). It never changes the rubric score.

const FALLBACK_REASONS = {
  timeout: "the AI took too long",
  rate_limited: "the AI service is out of quota right now",
  invalid_json: "the AI reply could not be used",
  unreachable: "the AI service could not be reached",
};

function List({ title, items, tone }) {
  if (!items?.length) return null;
  return (
    <div className="critique-group">
      <div className={`critique-label ${tone || ""}`}>{title}</div>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function CritiqueBlock({ critique }) {
  if (!critique) return null;
  const isModel = critique.source !== "scripted";
  const reason = FALLBACK_REASONS[critique.fallbackReason];

  return (
    <details className="critique">
      <summary>
        Review of this answer
        <span className="critique-source">{isModel ? "AI review" : "Basic review"}</span>
      </summary>

      {!isModel && reason && <p className="muted critique-note">Basic review shown because {reason}.</p>}
      {!critique.onTopic && <p className="critique-warning">This answer may not address the question.</p>}

      <List title="Covered" items={critique.coveredPoints} tone="good" />
      <List title="Missing" items={critique.missingPoints} tone="warn" />
      <List title="What worked" items={critique.strengths} />

      <div className="critique-group">
        <div className="critique-label">Suggestion</div>
        <p>{critique.suggestion}</p>
      </div>

      {critique.improvedAnswer && (
        <div className="critique-group">
          <div className="critique-label">A stronger version</div>
          <p>&ldquo;{critique.improvedAnswer}&rdquo;</p>
        </div>
      )}

      {critique.referencePoints && !critique.improvedAnswer && (
        <div className="critique-group">
          <div className="critique-label">Key points from the question bank</div>
          <p>{critique.referencePoints}</p>
        </div>
      )}
    </details>
  );
}
