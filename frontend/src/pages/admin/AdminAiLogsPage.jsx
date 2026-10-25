import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

const number = new Intl.NumberFormat();
const money = value => value == null ? 'Unknown' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 5 }).format(value);
const time = value => new Date(value).toLocaleString();

export default function AdminAiLogsPage() {
  const [range, setRange] = useState('30');
  const [status, setStatus] = useState('');
  const [capability, setCapability] = useState('');
  const [provider, setProvider] = useState('');
  const [modelDraft, setModelDraft] = useState('');
  const [requestDraft, setRequestDraft] = useState('');
  const [filters, setFilters] = useState({ model: '', requestId: '' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setResult(null);
    setError('');
    api.listAdminAiLogs({ range, status, capability, provider, ...filters, page })
      .then(value => { if (active) setResult(value); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [range, status, capability, provider, filters, page]);

  function applySearch(event) {
    event.preventDefault();
    setPage(1);
    setFilters({ model: modelDraft.trim(), requestId: requestDraft.trim() });
  }

  const pages = Math.max(1, Math.ceil((result?.total || 0) / 25));
  return (
    <section aria-labelledby="logs-title">
      <div className="admin-toolbar">
        <div><h2 id="logs-title">AI Logs</h2><p className="muted">One row per recorded AI operation. Prompts and user documents are not shown.</p></div>
        <label className="admin-field">Period
          <select value={range} onChange={event => { setPage(1); setRange(event.target.value); }}>
            <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
          </select>
        </label>
      </div>

      <form className="admin-filters" onSubmit={applySearch}>
        <label className="admin-field">Capability
          <select value={capability} onChange={event => { setPage(1); setCapability(event.target.value); }}>
            <option value="">All capabilities</option><option value="coach">Coach</option><option value="critique">Critique</option><option value="embed">Embedding</option>
          </select>
        </label>
        <label className="admin-field">Provider
          <select value={provider} onChange={event => { setPage(1); setProvider(event.target.value); }}>
            <option value="">All providers</option><option value="gemini">Gemini</option><option value="local">Local</option>
          </select>
        </label>
        <label className="admin-field">Status
          <select value={status} onChange={event => { setPage(1); setStatus(event.target.value); }}>
            <option value="">All statuses</option><option value="ok">Success</option><option value="error">Error</option><option value="timeout">Timeout</option><option value="invalid_json">Invalid JSON</option><option value="refused">Refused</option>
          </select>
        </label>
        <label className="admin-field admin-search-field">Model contains
          <input value={modelDraft} onChange={event => setModelDraft(event.target.value)} maxLength="80" placeholder="e.g. flash" />
        </label>
        <label className="admin-field admin-search-field">Request ID
          <input value={requestDraft} onChange={event => setRequestDraft(event.target.value)} maxLength="36" placeholder="Search a request ID" />
        </label>
        <button className="btn btn-secondary admin-search-button" type="submit">Search</button>
      </form>

      {error && <div className="form-error" role="alert">{error}</div>}
      {!error && !result && <p className="admin-loading" role="status">Loading AI logs…</p>}
      {result && <>
        <div className="admin-log-count">{number.format(result.total)} matching request(s)</div>
        <div className="card admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th scope="col">Time</th><th scope="col">Capability</th><th scope="col">Model</th><th scope="col">Tokens</th><th scope="col">Cost</th><th scope="col">Latency</th><th scope="col">Status</th><th scope="col">Details</th></tr></thead>
            <tbody>{result.logs.length ? result.logs.map(log => <tr key={log.id}>
              <td>{time(log.created_at)}</td>
              <td><strong>{log.capability}</strong><span className="admin-cell-subtitle">{log.operation}</span></td>
              <td>{log.model || '—'}<span className="admin-cell-subtitle">{log.provider || 'provider unknown'}</span></td>
              <td>{log.tokens_in == null && log.tokens_out == null ? 'Unknown' : `${number.format(log.tokens_in || 0)} in / ${number.format(log.tokens_out || 0)} out`}</td>
              <td>{money(log.cost_usd)}</td>
              <td>{number.format(log.latency_ms)} ms</td>
              <td><span className={`admin-status status-${log.status}`}>{log.status.replace('_', ' ')}</span></td>
              <td><details className="admin-log-details"><summary>View</summary><dl>
                <dt>Request ID</dt><dd>{log.request_id || '—'}</dd>
                <dt>Tools</dt><dd>{log.tools?.length ? log.tools.join(', ') : 'None recorded'}</dd>
                <dt>Error</dt><dd>{log.error_code || '—'}{log.provider_status ? ` · provider HTTP ${log.provider_status}` : ''}</dd>
              </dl></details></td>
            </tr>) : <tr><td colSpan="8" className="admin-empty">No logs match these filters.</td></tr>}</tbody>
          </table>
        </div>
        <div className="admin-pagination">
          <span className="muted">Page {page} of {pages}</span>
          <div><button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next</button></div>
        </div>
      </>}
    </section>
  );
}
