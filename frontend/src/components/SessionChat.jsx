import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { SendIcon, AlertIcon } from "./icons.jsx";

// Chat scoped to one completed interview session. Grounded in that session's own
// transcript + rubric feedback (see backend/src/services/chatService.js) - not a
// general-purpose assistant, and not RAG (nothing is retrieved/searched, the one
// relevant document is already known: this session).
export default function SessionChat({ sessionId }) {
  const [messages, setMessages] = useState(null);
  const [llm, setLlm] = useState({ enabled: false });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const logRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getSessionChat(sessionId)
      .then((data) => {
        if (cancelled) return;
        setMessages(data.messages);
        setLlm(data.llm || { enabled: false });
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages, sending]);

  async function handleSend(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    setError("");
    setMessages((prev) => [...(prev || []), { role: "user", text, at: new Date().toISOString() }]);
    setDraft("");

    try {
      const data = await api.sendSessionChatMessage(sessionId, text);
      setMessages(data.messages);
      setLlm(data.llm || { enabled: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card card-pad chat-panel">
      <h3 className="mt-0">Ask about this interview</h3>
      <p className="muted chat-panel-caption">
        {llm.enabled
          ? `Answers are written by ${llm.model} from your transcript, the question bank's key points and your scores. The scores themselves are fixed by the rubric. ${
              llm.local ? "The model runs on this computer." : "Your transcript is sent to Google to generate each answer."
            }`
          : "Scripted responses grounded in your transcript and scores. Configure a model on the backend (Gemini key or a local LM Studio server) to have one write them."}
      </p>

      <div
        className="chat-log"
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation about this interview"
      >
        {messages === null && <p className="muted">Loading...</p>}
        {messages &&
          messages.map((m, i) => (
            <div key={i} className={`chat-msg chat-msg-${m.role}`}>
              {m.text}
              {m.fallbackReason && (
                <span className="chat-msg-note">
                  Scripted answer shown because {m.fallbackReason}.
                </span>
              )}
            </div>
          ))}
        {sending && (
          <div className="chat-msg chat-msg-assistant chat-msg-pending" role="status">
            {llm.enabled ? "Thinking..." : "..."}
          </div>
        )}
      </div>

      {error && (
        <div className="form-error" role="alert">
          <AlertIcon width={16} height={16} />
          <span>{error}</span>
        </div>
      )}

      <form className="chat-composer" onSubmit={handleSend}>
        <input
          type="text"
          value={draft}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. What should I improve on?"
          disabled={messages === null || sending}
          aria-label="Ask about this interview"
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={messages === null || sending || !draft.trim()}
        >
          <SendIcon width={16} height={16} />
          Send
        </button>
      </form>
    </div>
  );
}
