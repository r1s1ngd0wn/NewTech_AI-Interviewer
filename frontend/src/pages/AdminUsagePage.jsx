import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { AlertIcon } from "../components/icons.jsx";
import { usePageMeta } from "../hooks/usePageMeta.js";
import { formatCost, formatCount, formatLatency, formatTokenPair, formatTokens, lastDays, plural, pricedCount, successRate } from "../lib/usageFormat.js";

const PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

function Kpi({ label, value, note }) {
  return (
    <div className="card card-pad usage-kpi">
      <span className="eyebrow">{label}</span>
      <strong className="usage-kpi-value">{value}</strong>
      {note && <span className="muted usage-kpi-note">{note}</span>}
    </div>
  );
}

function BreakdownTable({ title, rows, nameLabel }) {
  return (
    <div className="card card-pad usage-table-card">
      <h3 className="mt-0">{title}</h3>
      {rows.length === 0 ? (
        <p className="muted mb-0">No requests in this range.</p>
      ) : (
        <table className="usage-table">
          <thead>
            <tr>
              <th scope="col">{nameLabel}</th>
              <th scope="col">Requests</th>
              <th scope="col">Failed</th>
              <th scope="col" className="hide-sm">Refused</th>
              <th scope="col">Avg time</th>
              <th scope="col" className="hide-sm">p95 time</th>
              <th scope="col" className="hide-sm">Tokens in / out</th>
              <th scope="col">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                <td>{formatCount(row.requests)}</td>
                <td>{formatCount(row.failed)}</td>
                <td className="hide-sm">{formatCount(row.refused)}</td>
                <td>{formatLatency(row.avgLatencyMs)}</td>
                <td className="hide-sm">{formatLatency(row.p95LatencyMs)}</td>
                <td className="hide-sm">{formatTokenPair(row)}</td>
                <td>{row.modelCalls === 0 ? "-" : row.unknownCost === row.modelCalls ? "unknown" : formatCost(row.costUsd)}{row.unknownCost > 0 && row.unknownCost < row.modelCalls ? "*" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DayBars({ days }) {
  const peak = Math.max(1, ...days.map((day) => day.requests));
  return (
    <ol className="usage-days" aria-label="Requests per day">
      {days.map((day) => (
        <li key={day.name} className="usage-day">
          <span className="usage-day-name">{day.name}</span>
          <span className="usage-bar" aria-hidden="true">
            <span className="usage-bar-ok" style={{ width: `${((day.requests - day.failed) / peak) * 100}%` }} />
            <span className="usage-bar-failed" style={{ width: `${(day.failed / peak) * 100}%` }} />
          </span>
          <span className="usage-day-count">
            {formatCount(day.requests)}
            {day.failed > 0 ? ` (${formatCount(day.failed)} failed)` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function AdminUsagePage() {
  const [range, setRange] = useState(() => lastDays(30));
  const [filters, setFilters] = useState({ capability: "", model: "", prompt: "" });
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  usePageMeta({
    title: "AI usage",
    description: "Requests, failures, latency, tokens and estimated cost of every AI call.",
  });

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    api
      .getUsage({ ...range, ...filters })
      .then((result) => current && setData(result))
      .catch((err) => current && setError(err.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [range, filters]);

  const totals = data?.totals;
  const priced = totals ? pricedCount(totals) : 0;

  return (
    <div className="page container">
      <span className="eyebrow">Admin</span>
      <h1>AI usage</h1>
      <p>
        Every AI request the app makes is logged without its prompt or answer. <Link to="/admin">Back to administration</Link>
      </p>

      <div className="card card-pad usage-filters" role="group" aria-label="Usage filters">
        <div className="field usage-period">
          <span className="usage-label">Period (UTC)</span>
          <div className="row wrap">
            {PRESETS.map((preset) => (
              <button key={preset.days} type="button" className="filter-btn" onClick={() => setRange(lastDays(preset.days))}>
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="usage-from">From</label>
          <input id="usage-from" type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="usage-to">To</label>
          <input id="usage-to" type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} />
        </div>
        {[
          ["capability", "Capability", data?.facets.capabilities],
          ["model", "Model", data?.facets.models],
          ["prompt", "Prompt version", data?.facets.prompts],
        ].map(([key, label, options]) => (
          <div className="field" key={key}>
            <label htmlFor={`usage-${key}`}>{label}</label>
            <select id={`usage-${key}`} value={filters[key]} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}>
              <option value="">All</option>
              {(options || []).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {error && (
        <div className="form-error" role="alert">
          <AlertIcon width={16} height={16} />
          <span>{error}</span>
        </div>
      )}
      {loading && <p role="status">Loading usage...</p>}

      {data && !data.available && <div className="form-error" role="status"><span>{data.note}</span></div>}

      {totals && data.available && (
        <>
          <section aria-label="Summary" className="grid grid-3 usage-kpis">
            <Kpi label="Requests" value={formatCount(totals.requests)} note={`${formatCount(totals.modelCalls)} reached a model`} />
            <Kpi
              label="Succeeded"
              value={successRate(totals)}
              note={`${formatCount(totals.ok)} ok, ${formatCount(totals.failed)} failed`}
            />
            <Kpi
              label="Failed"
              value={formatCount(totals.failed)}
              note={`${plural(totals.errors, "error")}, ${plural(totals.timeouts, "timeout")}, ${formatCount(totals.invalidJson)} invalid JSON`}
            />
            <Kpi label="Refused" value={formatCount(totals.refused)} note="Stopped by the guard before any model call" />
            <Kpi label="Average time" value={formatLatency(totals.avgLatencyMs)} note={`95th percentile ${formatLatency(totals.p95LatencyMs)} (model calls)`} />
            <Kpi
              label="Tokens in / out"
              value={`${formatTokens(totals.tokensIn)} / ${formatTokens(totals.tokensOut)}`}
              note={totals.unknownTokens ? `${plural(totals.unknownTokens, "request")} reported no usage` : "Reported by the provider"}
            />
            <Kpi
              label="Estimated cost"
              value={priced > 0 ? formatCost(totals.costUsd) : "unknown"}
              note={
                priced > 0
                  ? `${formatCost(totals.avgCostPerRequestUsd)} per priced request, list prices`
                  : "No price is configured for the models used"
              }
            />
          </section>
          {totals.unknownCost > 0 && priced > 0 && (
            <p className="muted usage-footnote">
              Cost covers {formatCount(priced)} of {formatCount(totals.modelCalls)} model requests. The other{" "}
              {formatCount(totals.unknownCost)} have no price configured (config/pricing.json), so they are left out, not counted as free.
            </p>
          )}
          {(totals.unknownTokens > 0 || (totals.unknownCost > 0 && priced > 0)) && (
            <p className="muted usage-footnote">
              A * in the tables means some of that row's requests reported no token usage or have no price; they are left out of the figure, not counted as zero.
            </p>
          )}

          <div className="card card-pad usage-table-card">
            <h3 className="mt-0">Requests per day</h3>
            {data.byDay.length ? <DayBars days={data.byDay} /> : <p className="muted mb-0">No requests in this range.</p>}
          </div>

          <BreakdownTable title="By capability" nameLabel="Capability" rows={data.byCapability} />
          <BreakdownTable title="By model" nameLabel="Model" rows={data.byModel} />
          <BreakdownTable title="By prompt version" nameLabel="Prompt" rows={data.byPrompt} />
        </>
      )}
    </div>
  );
}
