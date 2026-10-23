import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { SendIcon, AlertIcon, TrashIcon, StopIcon } from "./icons.jsx";

// Chat is scoped to one completed interview session. When RAG is enabled, the
// backend also returns the source excerpts used for each answer.
export default function SessionChat({ sessionId }) {
  const [messages, setMessages] = useState(null);
  const [llm, setLlm] = useState({ enabled: false });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [pendingSources, setPendingSources] = useState([]);
  const [interruptedText, setInterruptedText] = useState("");
  const [error, setError] = useState("");
  const [documents, setDocuments] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [busyDocument, setBusyDocument] = useState(false);
  const logRef = useRef(null);
  const streamController = useRef(null);
  const partialReply = useRef("");

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
    api.listSessionDocuments(sessionId)
      .then((data) => !cancelled && setDocuments(data.documents))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
      streamController.current?.abort();
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
    setPendingText("");
    setPendingSources([]);
    setInterruptedText("");
    partialReply.current = "";
    setError("");
    setMessages((prev) => [...(prev || []), { role: "user", text, at: new Date().toISOString() }]);
    setDraft("");
    const controller = new AbortController();
    streamController.current = controller;

    try {
      await api.streamSessionChatMessage(sessionId, text, (event) => {
        if (event.type === "token") {
          partialReply.current += event.text;
          setPendingText(partialReply.current);
        }
        if (event.type === "sources") setPendingSources(event.sources);
        if (event.type === "done") setMessages(event.messages);
      }, controller.signal);
    } catch (err) {
      setError(err.name === "AbortError" ? "Reply stopped. Partial text was not saved." : err.message);
      setInterruptedText(partialReply.current);
      try {
        setMessages((await api.getSessionChat(sessionId)).messages);
      } catch {
        // Keep the error from the failed stream visible.
      }
    } finally {
      if (streamController.current === controller) streamController.current = null;
      setSending(false);
      setPendingText("");
      setPendingSources([]);
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!selectedFile || busyDocument) return;
    setBusyDocument(true);
    setError("");
    try {
      await api.uploadSessionDocument(sessionId, selectedFile);
      setDocuments((await api.listSessionDocuments(sessionId)).documents);
      setSelectedFile(null);
      form.reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyDocument(false);
    }
  }

  async function handleDeleteDocument(id) {
    setBusyDocument(true);
    setError("");
    try {
      await api.deleteSessionDocument(sessionId, id);
      setDocuments((items) => items.filter((item) => item.id !== id));
      setMessages((await api.getSessionChat(sessionId)).messages);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyDocument(false);
    }
  }

  return (
    <div className="card card-pad chat-panel">
      <h3 className="mt-0">Ask about this interview</h3>
      <p className="muted chat-panel-caption">
        {llm.enabled
          ? `Answers are written by ${llm.model} from your interview and, when configured, retrieved documents. Scores stay fixed by the rubric. ${
              llm.local ? "Inference runs locally; data is stored in Supabase." : "Relevant interview and document text may be sent to Google."
            }`
          : "Scripted responses grounded in your transcript and scores. Configure a model on the backend (Gemini key or a local LM Studio server) to have one write them."}
      </p>

      <div className="chat-documents">
        <h4>Session documents</h4>
        <p className="muted">CVs and job descriptions saved in your <a href="/documents">document library</a> are also available to this chat.</p>
        {documents.length > 0 && (
          <ul className="chat-document-list">
            {documents.map((document) => (
              <li key={document.id}>
                <span>{document.filename}</span>
                <button type="button" className="btn btn-sm" title={`Delete ${document.filename}`}
                  aria-label={`Delete ${document.filename}`} disabled={busyDocument}
                  onClick={() => handleDeleteDocument(document.id)}>
                  <TrashIcon width={16} height={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="chat-document-form" onSubmit={handleUpload}>
          <input type="file" accept=".pdf,.docx,.txt,.md" aria-label="Choose a PDF, DOCX, TXT or Markdown document"
            onChange={(event) => setSelectedFile(event.target.files?.[0] || null)} disabled={busyDocument} />
          <button type="submit" className="btn btn-sm" disabled={!selectedFile || busyDocument}>Upload</button>
        </form>
      </div>

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
              {m.sources?.length > 0 && <details className="chat-msg-note"><summary>Sources ({m.sources.length})</summary>
                <ul>{m.sources.map((item) => <li key={item.id}>{item.label}{item.excerpt && <>: {item.excerpt}</>}</li>)}</ul>
              </details>}
              {m.fallbackReason && (
                <span className="chat-msg-note">
                  Scripted answer shown because {m.fallbackReason}.
                </span>
              )}
            </div>
          ))}
        {sending && (
          <div className="chat-msg chat-msg-assistant chat-msg-pending" role="status">
            {pendingText || (llm.enabled ? "Thinking..." : "...")}
            {pendingSources.length > 0 && <details className="chat-msg-note"><summary>Sources ({pendingSources.length})</summary>
              <ul>{pendingSources.map((item) => <li key={item.id}>{item.label}{item.excerpt && <>: {item.excerpt}</>}</li>)}</ul>
            </details>}
          </div>
        )}
        {!sending && interruptedText && <div className="chat-msg chat-msg-assistant chat-msg-pending">
          {interruptedText}<span className="chat-msg-note">Incomplete reply</span>
        </div>}
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
        {sending ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => streamController.current?.abort()}>
          <StopIcon width={16} height={16} /> Stop
        </button> : <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={messages === null || sending || !draft.trim()}
        >
          <SendIcon width={16} height={16} />
          Send
        </button>}
      </form>
    </div>
  );
}
