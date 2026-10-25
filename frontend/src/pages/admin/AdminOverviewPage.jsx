import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';

const number = new Intl.NumberFormat();
const money = value => value == null ? 'Unknown' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value);
const duration = value => value == null ? '—' : `${Math.round(value).toLocaleString()} ms`;

export default function AdminOverviewPage() {
  const [range, setRange] = useState(30);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setSummary(null);
    setError('');
    api.getAdminAiUsage(range).then(value => { if (active) setSummary(value); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [range]);

  const maxRequests = useMemo(() => Math.max(1, ...(summary?.trend || []).map(day => day.requests)), [summary]);

  return (
    <section aria-labelledby="usage-title">
      <div className="admin-toolbar">
        <div><h2 id="usage-title">Usage overview</h2><p className="muted">Request and provider usage for the selected period.</p></div>
        <label className="admin-field">Period
          <select value={range} onChange={event => setRange(Number(event.target.value))}>
            <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
          </select>
        </label>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}
      {!error && !summary && <p className="admin-loading" role="status">Loading AI usage…</p>}
      {summary && <>
        <div className="admin-metrics">
          <Metric label="AI requests" value={number.format(summary.requests)} note={`${number.format(summary.failedRequests)} failed · ${number.format(summary.refusedRequests)} refused`} />
          <Metric label="Tokens processed" value={number.format((summary.tokensIn || 0) + (summary.tokensOut || 0))} note={`${number.format(summary.tokensIn || 0)} in · ${number.format(summary.tokensOut || 0)} out`} />
          <Metric label="Estimated cost" value={money(summary.knownCostUsd)} note={`${number.format(summary.pricedRequests || 0)} requests with known cost`} />
          <Metric label="Average latency" value={duration(summary.avgLatencyMs)} note="Across all recorded AI operations" />
        </div>

        {summary.unknownCostRequests > 0 && <p className="admin-note">
          Cost is unknown for {number.format(summary.unknownCostRequests)} request(s) because token usage or model pricing was unavailable. Those requests are not counted as free.
        </p>}

        <div className="card card-pad admin-chart-card">
          <div className="admin-section-heading"><div><h3>Requests over time</h3><p className="muted">Daily request volume in the selected period.</p></div><span className="admin-chart-total">{number.format(summary.requests)} total</span></div>
          {summary.trend?.some(day => day.requests > 0) ? <div className="admin-bars" role="img" aria-label={`Daily AI request counts for the last ${range} days`}>
            {summary.trend.map((day, index) => <div className="admin-bar-column" key={day.date} title={`${day.date}: ${day.requests} requests`}>
              <div className="admin-bar-track"><span className="admin-bar" style={{ height: `${Math.max(day.requests ? 5 : 0, (day.requests / maxRequests) * 100)}%` }} /></div>
              {(range === 7 || index % (range === 30 ? 5 : 15) === 0 || index === summary.trend.length - 1) && <span className="admin-bar-label">{new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
            </div>)}
          </div> : <p className="admin-empty">No AI requests in this period.</p>}
        </div>

        <div className="admin-secondary-metrics">
          <Metric label="Average cost per priced request" value={money(summary.avgKnownCostUsd)} note="Estimated list-price cost" />
          <Metric label="Failed requests" value={number.format(summary.failedRequests)} note="Errors, timeouts and invalid JSON" />
          <Metric label="Refused requests" value={number.format(summary.refusedRequests)} note="Guardrail or provider refusal" />
        </div>
      </>}
    </section>
  );
}

function Metric({ label, value, note }) {
  return <article className="card card-pad admin-metric"><span className="admin-metric-label">{label}</span><strong>{value}</strong><span className="muted">{note}</span></article>;
}
