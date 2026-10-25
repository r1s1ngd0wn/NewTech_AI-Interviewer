import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { AlertIcon, SendIcon, StopIcon } from "../components/icons.jsx";
import ConfirmActionCard from '../components/ConfirmActionCard.jsx';
import { plainText } from "../lib/plainText.js";

export default function CoachPage() {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState("");
  const [sources, setSources] = useState([]);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [actions, setActions] = useState([]);
  const [tools, setTools] = useState([]);
  const controllerRef = useRef(null);
  const partialRef = useRef("");
  const logRef = useRef(null);

  useEffect(() => {
    document.title = "Preparation coach - InterviewAI";
    return () => controllerRef.current?.abort();
  }, []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [messages, pending]);

  async function send(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setMessages((items) => [...items, { role: "user", text }]);
    setDraft("");
    setBusy(true);
    setPending("");
    setSources([]);
    setError("");
    setTools([]);
    setStage("searching");
    partialRef.current = "";
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await api.streamCoachMessage(text, (item) => {
        if (item.type === "status") setStage(item.status);
        if (item.type === 'tool') { setStage('tool'); setTools(t => [...t, item]); }
        if (item.type === 'action') setActions(a => [...a, item.action]);
        if (item.type === "sources") setSources(item.sources);
        if (item.type === "token") { partialRef.current += item.text; setPending(partialRef.current); }
        if (item.type === "done") {
          setMessages((items) => [...items, { role: "assistant", ...item.answer }]);
          setPending("");
        }
      }, controller.signal);
    } catch (err) {
      setError(err.name === "AbortError" ? "Reply stopped. Partial text was not saved." : err.message);
      if (partialRef.current) setMessages((items) => [...items, {
        role: "assistant", text: partialRef.current, incomplete: true,
      }]);
      setPending("");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setBusy(false);
      setStage("");
      setSources([]);
      window.dispatchEvent(new Event('interviewai:ai-health'));
    }
  }

  return <div className="page container coach-page">
    <span className="eyebrow">Before your interview</span>
    <h1>Preparation coach</h1>
    <div className="coach-toolbar"><Link to="/documents">Your documents</Link></div>
    {tools.length > 0 && <div className="chat-msg-note" aria-live="polite">{tools.map((tool, i) => <span key={i} className="tool-label">{tool.name}: {tool.status} </span>)}</div>}
    <div className="coach-log" ref={logRef} role="log" aria-live="polite" aria-label="Coach conversation">
      {messages.map((message, index) => <div key={index} className={`chat-msg chat-msg-${message.role}`}>
        {plainText(message.text)}
        {message.incomplete && <span className="chat-msg-note">Incomplete reply</span>}
        {message.fallbackReason && <span className="chat-msg-note">Source excerpt shown because {message.fallbackReason}.</span>}
        {message.sources?.length > 0 && <details className="chat-msg-note"><summary>Sources ({message.sources.length})</summary>
          <ul>{message.sources.map((source) => <li key={source.id}>{source.label}: {source.excerpt}</li>)}</ul>
        </details>}
      </div>)}
      {busy && <div className="chat-msg chat-msg-assistant chat-msg-pending" role="status">
        {plainText(pending) || (stage === 'tool' ? 'Calling tool...' : stage === "searching" ? "Searching sources..." : "Writing answer...")}
        {sources.length > 0 && <span className="chat-msg-note">{sources.length} sources found</span>}
      </div>}
    </div>
    {actions.map(action => <ConfirmActionCard key={action.id} action={action} />)}
    {error && <div className="form-error" role="alert"><AlertIcon width={16} height={16} />{error}</div>}
    <form className="chat-composer" onSubmit={send}>
      <input type="text" value={draft} maxLength={500} onChange={(event) => setDraft(event.target.value)}
        aria-label="Ask the coach" placeholder="Ask about your CV, job description or interview questions" disabled={busy} />
      {busy ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => controllerRef.current?.abort()}>
        <StopIcon width={16} height={16} /> Stop
      </button> : <button className="btn btn-primary btn-sm" type="submit" disabled={!draft.trim()}>
        <SendIcon width={16} height={16} /> Send
      </button>}
    </form>
  </div>;
}
