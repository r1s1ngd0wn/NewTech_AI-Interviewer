import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import ScoreBar from "../components/ScoreBar.jsx";
import SessionChat from "../components/SessionChat.jsx";
import CritiqueBlock from "../components/CritiqueBlock.jsx";
import { CheckIcon, AlertIcon, TrashIcon } from "../components/icons.jsx";
import { usePageMeta } from "../hooks/usePageMeta.js";

export default function FeedbackPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [feedback, setFeedback] = useState(null);
  const [error, setError] = useState("");

  usePageMeta({
    title: feedback ? `Feedback - ${feedback.scenarioTitle}` : "Feedback",
    description: "Rubric-based feedback report for a completed interview session.",
  });

  useEffect(() => {
    let cancelled = false;
    api
      .getFeedback(sessionId)
      .then((data) => !cancelled && setFeedback(data.feedback))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Reviews written by the model can arrive after scoring; refresh until none are pending.
  useEffect(() => {
    if (!feedback?.critiquesPending) return undefined;
    const timer = setTimeout(() => {
      api
        .getFeedback(sessionId)
        .then((data) => setFeedback(data.feedback))
        .catch(() => {});
    }, 3000);
    return () => clearTimeout(timer);
  }, [feedback, sessionId]);

  async function handleDelete() {
    if (!window.confirm("Delete this session and its transcript? This can't be undone.")) return;
    await api.deleteSession(sessionId);
    navigate("/dashboard");
  }

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

  if (!feedback) {
    return (
      <div className="page container">
        <p>Scoring your session against the rubric...</p>
      </div>
    );
  }

  return (
    <div className="page container">
      <span className="eyebrow">Feedback report</span>
      <h1>{feedback.scenarioTitle}</h1>
      <p>Rubric v{feedback.rubricVersion}, generated {new Date(feedback.generatedAt).toLocaleString()}</p>
      {feedback.typedAnswers > 0 && (
        <p className="muted">
          {feedback.typedAnswers === feedback.questionsAnswered
            ? "All of your answers were typed, so Fluency & Delivery scored 0. It measures spoken delivery."
            : `${feedback.typedAnswers} of your ${feedback.questionsAnswered} answers were typed and scored 0 for Fluency & Delivery, which measures spoken delivery.`}
        </p>
      )}
      {feedback.questionsTotal > feedback.questionsAnswered && (
        <p className="muted">
          You ended this session early: {feedback.questionsAnswered} of {feedback.questionsTotal} questions
          were answered and scored.
        </p>
      )}

      <div className="grid grid-2" style={{ marginBottom: "1.5rem" }}>
        <div className="card card-pad text-center">
          <div className="muted" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
            OVERALL SCORE
          </div>
          <div className="score-overall">{feedback.overallScore}</div>
          <div className="muted">out of 100</div>
        </div>
        <div className="card card-pad">
          <h3 className="mt-0">Per-criterion scores</h3>
          {feedback.criteria.map((c) => (
            <ScoreBar key={c.criterionId} label={c.name} score={c.averageScore} sublabel={c.label} />
          ))}
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: "1.5rem" }}>
        <div className="card card-pad">
          <h3 className="mt-0">Strengths</h3>
          <div className="stack">
            {feedback.strengths.map((s) => (
              <div key={s.criterionId} className="feature-item">
                <span className="icon-badge" aria-hidden="true">
                  <CheckIcon />
                </span>
                <span>{s.note}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card card-pad">
          <h3 className="mt-0">Areas to improve</h3>
          <div className="stack">
            {feedback.improvements.map((s) => (
              <div key={s.criterionId} className="feature-item">
                <span className="icon-badge" aria-hidden="true">
                  <AlertIcon />
                </span>
                <span>{s.note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: "1.5rem" }}>
        <h3 className="mt-0">Transcript highlights</h3>
        {feedback.critiquesPending && (
          <p className="muted" role="status">
            The AI is still writing reviews of your answers. They will appear here by themselves.
          </p>
        )}
        <div className="stack">
          {feedback.highlights.map((h) => (
            <div key={h.questionId} className="speech-bubble">
              <strong>{h.questionText}</strong>
              <p style={{ margin: "0.5rem 0 0" }}>&ldquo;{h.answerExcerpt}&rdquo;</p>
              <CritiqueBlock critique={h.critique} />
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: "1.5rem" }}>
        <SessionChat sessionId={sessionId} />
      </div>

      <div className="row wrap">
        <button className="btn btn-primary" onClick={() => navigate("/dashboard")}>
          View progress
        </button>
        <button className="btn btn-secondary" onClick={() => navigate("/scenarios")}>
          Practice another scenario
        </button>
        <button className="btn btn-ghost" onClick={handleDelete}>
          <TrashIcon width={16} height={16} />
          Delete this session
        </button>
      </div>
    </div>
  );
}
