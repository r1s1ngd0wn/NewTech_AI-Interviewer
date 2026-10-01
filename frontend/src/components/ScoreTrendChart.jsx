import { useState } from "react";

const W = 640;
const H = 240;
const PAD = { top: 20, right: 28, bottom: 36, left: 40 };
const GRID = [0, 25, 50, 75, 100];

function shortDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "-";
}

// Overall score per completed session, oldest to newest, on a fixed 0-100 scale.
// One series, so no legend: the card title names it. The per-criterion numbers stay in
// the table below, which doubles as the chart's data view.
export default function ScoreTrendChart({ history }) {
  const [active, setActive] = useState(null);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (history.length === 1 ? plotW / 2 : (i / (history.length - 1)) * plotW);
  const y = (score) => PAD.top + plotH - (score / 100) * plotH;

  const points = history.map((h, i) => ({ ...h, cx: x(i), cy: y(h.overallScore) }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.cx},${p.cy}`).join(" ");
  const last = points[points.length - 1];
  const labelEvery = Math.ceil(points.length / 8);
  const summary = points.map((p) => `${shortDate(p.date)}: ${p.overallScore}`).join(", ");

  return (
    <div className="trend-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Overall score by session, from ${points[0].overallScore} to ${last.overallScore} out of 100. ${summary}`}
      >
        {GRID.map((g) => (
          <g key={g}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(g)}
              y2={y(g)}
              className="trend-grid"
            />
            <text x={PAD.left - 8} y={y(g) + 4} textAnchor="end" className="trend-axis">
              {g}
            </text>
          </g>
        ))}

        {points.length > 1 && <path d={path} className="trend-line" />}

        {points.map((p, i) => (
          <g key={p.sessionId}>
            {i % labelEvery === 0 && (
              <text x={p.cx} y={H - 12} textAnchor="middle" className="trend-axis">
                {shortDate(p.date)}
              </text>
            )}
            <circle cx={p.cx} cy={p.cy} r={p === last ? 6 : 4.5} className={p === last ? "trend-dot trend-dot-last" : "trend-dot"} />
            <circle
              cx={p.cx}
              cy={p.cy}
              r={16}
              className="trend-hit"
              tabIndex={0}
              role="img"
              aria-label={`${p.scenarioTitle}, ${shortDate(p.date)}: ${p.overallScore} out of 100`}
              onMouseEnter={() => setActive(p)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(p)}
              onBlur={() => setActive(null)}
            />
          </g>
        ))}

        <text x={last.cx} y={last.cy - 14} textAnchor="middle" className="trend-value">
          {last.overallScore}
        </text>
      </svg>

      {active && (
        <div
          className="trend-tooltip"
          style={{ left: `${(active.cx / W) * 100}%`, top: `${(active.cy / H) * 100}%` }}
          role="status"
        >
          <strong>{active.overallScore}/100</strong>
          <span>{active.scenarioTitle}</span>
          <span>{active.date ? new Date(active.date).toLocaleString() : "-"}</span>
        </div>
      )}
    </div>
  );
}
