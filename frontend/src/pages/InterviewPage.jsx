import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { useSpeech } from "../hooks/useSpeech.js";
import { MicIcon, StopIcon, AlertIcon } from "../components/icons.jsx";
import { usePageMeta } from "../hooks/usePageMeta.js";

const MAX_ANSWER_LENGTH = 4000;

export default function InterviewPage() {
  const { scenarioId } = useParams();
  const navigate = useNavigate();
  const speech = useSpeech();

  const [scenario, setScenario] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [progressIndex, setProgressIndex] = useState(0);
  const [total, setTotal] = useState(0);
  const [log, setLog] = useState([]); // { role: 'question'|'reaction'|'answer', text }
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("loading"); // loading | active | ready-to-finish | finishing | error
  const [error, setError] = useState("");
  const hasSpokenRef = useRef(null);
  const draftBaseRef = useRef("");
  // True once the microphone has produced text for the current answer. Typed answers are sent as
  // "text" and score 0 for Fluency & Delivery, which measures spoken delivery.
  const usedMicRef = useRef(false);

  usePageMeta({
    title: scenario?.title || "Interview",
    description: "Live interview practice session with an AI interviewer.",
  });

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [{ scenario }, { session, question }] = await Promise.all([
          api.getScenario(scenarioId),
          api.startSession(scenarioId),
        ]);
        if (cancelled) return;
        setScenario(scenario);
        setSessionId(session.id);
        setCurrentQuestion(question);
        setProgressIndex(question.index);
        setTotal(question.total);
        setLog([{ role: "question", text: question.text }]);
        setStatus("active");
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setStatus("error");
        }
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [scenarioId]);

  useEffect(() => {
    if (currentQuestion?.text && hasSpokenRef.current !== currentQuestion.questionId) {
      hasSpokenRef.current = currentQuestion.questionId;
      speech.speak(currentQuestion.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  // Live speech results are appended after whatever was already in the box when the
  // microphone was switched on, so a second recording adds to the answer instead of
  // replacing it, and typed corrections are kept.
  useEffect(() => {
    if (speech.transcript) {
      setDraft(draftBaseRef.current + speech.transcript);
      usedMicRef.current = true;
    }
  }, [speech.transcript]);

  function handleToggleMic() {
    if (speech.isRecording) {
      speech.stopRecording();
      return;
    }
    draftBaseRef.current = draft.trim() ? `${draft.trimEnd()} ` : "";
    speech.startRecording();
  }

  async function handleSubmitAnswer() {
    const answerText = draft.trim();
    if (!answerText || submitting) return;
    speech.stopRecording();
    setSubmitting(true);
    setError("");

    try {
      const { next } = await api.submitAnswer(sessionId, answerText, usedMicRef.current ? "voice" : "text");
      usedMicRef.current = false;
      setLog((prev) => {
        const entries = [...prev, { role: "answer", text: answerText }];
        if (next.reaction) {
          entries.push({ role: "reaction", text: next.reaction, generatedBy: next.reactionSource });
        }
        if (!next.done) entries.push({ role: "question", text: next.text });
        return entries;
      });
      speech.resetTranscript();
      draftBaseRef.current = "";
      setDraft("");
      if (next.done) {
        setStatus("ready-to-finish");
        setCurrentQuestion(null);
        setProgressIndex(total);
      } else {
        setCurrentQuestion({ questionId: next.questionId, text: next.text });
        setProgressIndex(next.index);
      }
    } catch (err) {
      setError(err.message);
      setStatus("error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFinish() {
    speech.stopRecording();
    setStatus("finishing");
    try {
      await api.finishSession(sessionId);
      navigate(`/feedback/${sessionId}`);
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }

  function handleEndEarly() {
    const answered = progressIndex;
    if (
      window.confirm(
        `End the interview now? Only your ${answered} answered question${answered === 1 ? "" : "s"} will be scored.`
      )
    ) {
      handleFinish();
    }
  }

  if (status === "loading") {
    return (
      <div className="page container">
        <p>Setting up your interview session...</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="page container">
        <div className="form-error" role="alert">
          <AlertIcon width={16} height={16} />
          <span>{error}</span>
        </div>
        <button className="btn btn-secondary" onClick={() => navigate("/scenarios")}>
          Back to scenarios
        </button>
      </div>
    );
  }

  const percent = total ? Math.round((progressIndex / total) * 100) : 0;
  const tooLong = draft.length > MAX_ANSWER_LENGTH;

  return (
    <div className="page container">
      <span className="eyebrow">{scenario?.industry} / {scenario?.seniority} / {scenario?.questionType}</span>
      <h1>{scenario?.title}</h1>

      <div className="progress-track" aria-hidden="true">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="muted" style={{ marginTop: "-0.75rem" }}>
        Question {Math.min(progressIndex + 1, total)} of {total}
      </p>

      <div className="interview-layout">
        <div className="card card-pad">
          {status === "finishing" ? (
            <div className="stack" role="status">
              <h2>Scoring your interview...</h2>
              <p>Checking your answers against the rubric.</p>
              <span className="spinner" aria-hidden="true" />
            </div>
          ) : status === "ready-to-finish" ? (
            <div className="stack">
              <h2>That's all the questions for this scenario.</h2>
              <p>Finish the session to generate your rubric-based feedback report.</p>
              <button className="btn btn-primary" onClick={handleFinish}>
                Finish & see feedback
              </button>
            </div>
          ) : (
            <>
              <div className="speech-bubble" role="status" aria-live="polite">
                <strong>Interviewer{speech.isSpeaking ? " (speaking...)" : ""}:</strong>{" "}
                {currentQuestion?.text}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginTop: "0.5rem" }}
                onClick={() => speech.speak(currentQuestion?.text)}
              >
                Repeat question
              </button>

              {speech.error && (
                <div className="form-error" role="alert" style={{ marginTop: "1rem", marginBottom: 0 }}>
                  <AlertIcon width={16} height={16} />
                  <span>{speech.error}</span>
                </div>
              )}

              <div className="row" style={{ marginTop: "1.5rem", alignItems: "flex-start", gap: "1.25rem" }}>
                {speech.supported ? (
                  <div className="stack" style={{ alignItems: "center" }}>
                    <button
                      type="button"
                      className={`mic-button ${speech.isRecording ? "recording" : ""}`}
                      onClick={handleToggleMic}
                      aria-label={speech.isRecording ? "Stop recording your answer" : "Start recording your answer"}
                    >
                      {speech.isRecording ? <StopIcon /> : <MicIcon />}
                    </button>
                    <span className="muted" style={{ fontSize: "0.8rem" }}>
                      {speech.isRecording ? "Listening..." : "Tap to speak"}
                    </span>
                  </div>
                ) : null}

                <div style={{ flex: 1 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="answer">
                      {speech.supported
                        ? "Your answer (edit it if the transcript got something wrong)"
                        : "Your browser doesn't support speech recognition, type your answer instead."}
                    </label>
                    <textarea
                      id="answer"
                      value={draft}
                      readOnly={speech.isRecording}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={speech.supported ? "Tap the microphone and speak, or type here." : ""}
                    />
                  </div>
                  <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "var(--text-caption)" }}>
                    {speech.supported
                      ? "Answers you type score 0 for Fluency & Delivery, which measures spoken delivery. Use the microphone to be scored on it; you can still edit the transcript."
                      : "Your browser can't record speech, so typed answers score 0 for Fluency & Delivery."}
                  </p>
                  {tooLong && (
                    <p className="muted" role="alert" style={{ margin: "0.5rem 0 0" }}>
                      Answers are limited to {MAX_ANSWER_LENGTH} characters.
                    </p>
                  )}
                  <div className="row wrap" style={{ marginTop: "1rem" }}>
                    <button
                      className="btn btn-primary"
                      onClick={handleSubmitAnswer}
                      disabled={!draft.trim() || submitting || tooLong}
                    >
                      {submitting && <span className="spinner" aria-hidden="true" />}
                      Submit answer
                    </button>
                    {progressIndex >= 1 && (
                      <button type="button" className="btn btn-ghost" onClick={handleEndEarly}>
                        End session early
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {log.length > 0 && (
          <div className="card card-pad">
            <h3>Transcript so far</h3>
            <div className="transcript-log">
              {log.map((entry, i) => (
                <div key={i} className={`transcript-turn ${entry.role === "answer" ? "answer" : "question"}`}>
                  {entry.role === "answer" ? "You: " : "Interviewer: "}
                  {entry.text}
                  {entry.generatedBy && entry.generatedBy !== "scripted" && (
                    <span className="muted"> (written by {entry.generatedBy === "local" ? "the local model" : "Gemini"})</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
