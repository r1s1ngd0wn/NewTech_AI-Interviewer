import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { useSpeech } from "../hooks/useSpeech.js";
import { MicIcon, StopIcon, AlertIcon } from "../components/icons.jsx";

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
  const [manualAnswer, setManualAnswer] = useState("");
  const [status, setStatus] = useState("loading"); // loading | active | ready-to-finish | finishing | error
  const [error, setError] = useState("");
  const hasSpokenRef = useRef(null);

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

  const liveAnswer = speech.supported ? speech.transcript : manualAnswer;

  async function handleSubmitAnswer() {
    const answerText = liveAnswer.trim();
    if (!answerText) return;
    speech.stopRecording();
    setLog((prev) => [...prev, { role: "answer", text: answerText }]);
    speech.resetTranscript();
    setManualAnswer("");

    try {
      const { next } = await api.submitAnswer(sessionId, answerText);
      if (next.reaction) {
        setLog((prev) => [...prev, { role: "reaction", text: next.reaction }]);
      }
      if (next.done) {
        setStatus("ready-to-finish");
        setCurrentQuestion(null);
      } else {
        setCurrentQuestion({ questionId: next.questionId, text: next.text });
        setProgressIndex(next.index);
      }
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }

  async function handleFinish() {
    setStatus("finishing");
    try {
      await api.finishSession(sessionId);
      navigate(`/feedback/${sessionId}`);
    } catch (err) {
      setError(err.message);
      setStatus("error");
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
          {status === "ready-to-finish" ? (
            <div className="stack">
              <h2>That's all the questions for this scenario.</h2>
              <p>Finish the session to generate your rubric-based feedback report.</p>
              <button className="btn btn-primary" onClick={handleFinish} disabled={status === "finishing"}>
                {status === "finishing" && <span className="spinner" aria-hidden="true" />}
                Finish & see feedback
              </button>
            </div>
          ) : (
            <>
              <div className="speech-bubble" role="status" aria-live="polite">
                <strong>Interviewer{speech.isSpeaking ? " (speaking...)" : ""}:</strong>{" "}
                {currentQuestion?.text}
              </div>

              <div className="row" style={{ marginTop: "1.5rem", alignItems: "flex-start", gap: "1.25rem" }}>
                {speech.supported ? (
                  <div className="stack" style={{ alignItems: "center" }}>
                    <button
                      type="button"
                      className={`mic-button ${speech.isRecording ? "recording" : ""}`}
                      onClick={speech.isRecording ? speech.stopRecording : speech.startRecording}
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
                  {speech.supported ? (
                    <div className="transcript-box" aria-live="polite">
                      {liveAnswer || <span className="muted">Your transcribed answer will appear here.</span>}
                    </div>
                  ) : (
                    <div className="field" style={{ margin: 0 }}>
                      <label htmlFor="manual-answer">
                        Your browser doesn't support speech recognition, type your answer instead.
                      </label>
                      <textarea
                        id="manual-answer"
                        value={manualAnswer}
                        onChange={(e) => setManualAnswer(e.target.value)}
                      />
                    </div>
                  )}
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: "1rem" }}
                    onClick={handleSubmitAnswer}
                    disabled={!liveAnswer.trim()}
                  >
                    Submit answer
                  </button>
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
                  {entry.role === "answer" ? "You: " : entry.role === "reaction" ? "Interviewer: " : "Interviewer: "}
                  {entry.text}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
