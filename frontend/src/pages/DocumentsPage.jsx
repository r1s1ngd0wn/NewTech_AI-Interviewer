import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { AlertIcon, TrashIcon } from "../components/icons.jsx";

export default function DocumentsPage() {
  const [documents, setDocuments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [file, setFile] = useState(null);
  const [kind, setKind] = useState("cv");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Documents - InterviewAI";
    let active = true;
    api.listDocuments().then((data) => active && setDocuments(data.documents))
      .catch((err) => active && setError(err.message));
    return () => { active = false; };
  }, []);

  async function upload(event) {
    event.preventDefault();
    if (!file) return;
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    try {
      await api.uploadDocument(kind, file);
      setDocuments((await api.listDocuments()).documents);
      setFile(null);
      form.reset();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function preview(id) {
    setError("");
    try { setSelected((await api.getDocument(id)).document); }
    catch (err) { setError(err.message); }
  }

  async function remove(id) {
    if (!window.confirm("Delete this document and its search index?")) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteDocument(id);
      setDocuments((items) => items.filter((item) => item.id !== id));
      if (selected?.id === id) setSelected(null);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <div className="page container documents-page">
    <span className="eyebrow">Your library</span>
    <h1>Documents</h1>
    <p>CVs and job descriptions here can inform future interview questions and follow-up answers. Files are private to your account. Relevant excerpts may be sent to the configured AI provider.</p>
    <form className="document-upload" onSubmit={upload}>
      <label>Type <select value={kind} onChange={(event) => setKind(event.target.value)} disabled={busy}>
        <option value="cv">CV</option><option value="jd">Job description</option>
      </select></label>
      <label>File <input type="file" accept=".pdf,.docx,.txt,.md" disabled={busy}
        onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
      <button className="btn btn-primary btn-sm" type="submit" disabled={!file || busy}>{busy ? "Working..." : "Upload"}</button>
    </form>
    <p className="muted">PDF, DOCX, TXT or Markdown, up to 5 MB and 100,000 extracted characters. PDFs need selectable text. Maximum 10 documents.</p>
    {error && <div className="form-error" role="alert"><AlertIcon width={16} height={16} />{error}</div>}
    {documents.length === 0 ? <p className="muted">No documents uploaded yet.</p> :
      <ul className="document-library-list">{documents.map((document) => <li key={document.id}>
        <span className="document-kind">{document.kind.toUpperCase()}</span>
        <button type="button" className="document-title" onClick={() => preview(document.id)}>{document.filename}</button>
        <time>{new Date(document.createdAt).toLocaleDateString()}</time>
        <button type="button" className="btn btn-sm" aria-label={`Delete ${document.filename}`}
          title={`Delete ${document.filename}`} disabled={busy} onClick={() => remove(document.id)}>
          <TrashIcon width={16} height={16} />
        </button>
      </li>)}</ul>}
    {selected && <section className="document-preview" aria-label="Document text preview">
      <div className="document-preview-header"><h2>{selected.filename}</h2>
        <button type="button" className="btn btn-sm" onClick={() => setSelected(null)}>Close</button></div>
      <pre>{selected.extractedText}</pre>
    </section>}
  </div>;
}
