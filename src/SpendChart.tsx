import { useState } from "react";
import { dayLabel } from "./lib/budget";
import { money0, money2 } from "./lib/privacy";
import type { MonthSummary } from "./lib/budget";

interface Props {
  summary: MonthSummary;
  /** The tapped day (1-31), kept by the parent so it can filter the transactions list. */
  selected: number | null;
  onSelect: (day: number | null) => void;
  todayDay: number | null; // last day with data in the current month
}

const W = 340, H = 200;
const M = { l: 0, r: 38, b: 26 };
const PW = W - M.l - M.r;

function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

const compact = (n: number) => (n >= 1000 ? `$${+(n / 1000).toFixed(1)}K` : `$${n}`);

/** What was spent on each day (the summary stores a running total). */
export const dailySpend = (cumulative: number[]): number[] =>
  cumulative.map((v, i) => Math.round((v - (i ? cumulative[i - 1] : 0)) * 100) / 100);

/**
 * One very big day (the mortgage on the 1st) would flatten every other bar. If the biggest
 * days dwarf the rest (more than 2.5x the next one), the axis stops above the biggest day that
 * doesn't, and the taller bars are cut off (tap one to see its amount).
 */
export function axisCap(perDay: number[]): number | null {
  const s = perDay.filter((v) => v > 0).sort((a, b) => b - a);
  let i = 0;
  while (i < s.length - 1 && s[i] > 2.5 * s[i + 1]) i++;
  return i > 0 ? s[i] : null;
}

/** The middle day among days with any spending, so one huge day (the mortgage) doesn't skew it. */
export function typicalDay(perDay: number[]): number {
  const v = perDay.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return Math.round(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2);
}

const longDay = (month: string, day: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
};

export default function SpendChart({ summary, todayDay, selected, onSelect }: Props) {
  const dim = summary.daily.length;
  const last = todayDay ?? dim; // last day with actual data
  const perDay = dailySpend(summary.daily).slice(0, last);

  const cap = axisCap(perDay);
  const top = (cap ?? Math.max(...perDay, 1)) * 1.1;
  const step = niceStep(top / 4);
  const yMax = Math.ceil(top / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(v);

  const slot = PW / dim;
  const bw = Math.max(slot * 0.68, 2);
  const x = (d: number) => M.l + (d - 1) * slot + (slot - bw) / 2;
  const cut = (v: number) => v > yMax;
  const mt = 20;
  const PH = H - mt - M.b;
  const y = (v: number) => mt + PH - (Math.min(Math.max(v, 0), yMax) / yMax) * PH;
  const [hover, setHover] = useState<number | null>(null);
  const dayAt = (e: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    return Math.min(Math.max(Math.floor((px - M.l) / slot) + 1, 1), last);
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => { if (e.pointerType === "mouse") setHover(dayAt(e)); };
  const onTap = (e: React.MouseEvent<SVGSVGElement>) => { const d = dayAt(e); onSelect(selected === d ? null : d); };

  const xTicks = [1, 15, dim].filter((d, i, a) => a.indexOf(d) === i && (d === dim || dim - d >= 3));
  const active = hover ?? selected;
  const typical = typicalDay(perDay);
  const av = active != null ? perDay[active - 1] : null;

  return (
    <div className="chart">
      <div className="chart-head">
        <div className="chart-label">{active != null ? longDay(summary.month, active) : "Typical day"}</div>
        <div className="chart-big">{av != null ? money2(av) : money0(typical)}</div>
        <div className="chart-sub">
          {active != null ? `Typical day ${money0(typical)}${selected != null && hover == null ? " · transactions below" : ""}` : `${dayLabel(summary.month, 1)} – ${last}, middle value`}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Spending per day through ${dayLabel(summary.month, last)}, highest day ${money0(Math.max(...perDay, 0))}. Tap a bar to list that day’s transactions.`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={onTap}
        style={{ touchAction: "pan-y" }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className={v === 0 ? "baseline" : "grid"} />
            <text x={W} y={y(v) + 4} textAnchor="end" className="axis">{compact(v)}</text>
          </g>
        ))}
        {xTicks.map((d, i) => (
          <text
            key={d}
            x={i === 0 ? x(d) : d === dim ? x(d) + bw : x(d) + bw / 2}
            y={H - 6}
            textAnchor={i === 0 ? "start" : d === dim ? "end" : "middle"}
            className="axis"
          >{dayLabel(summary.month, d)}</text>
        ))}

        {perDay.map((v, i) => (
          v > 0 && (
            <g key={i}>
              <rect x={x(i + 1)} y={y(v)} width={bw} height={y(0) - y(v)} rx={Math.min(bw / 2, 3)} className={`bar ${active != null ? (active === i + 1 ? "on" : "dim") : ""}`} />
              {cut(v) && (
                <>
                  <path d={`M${x(i + 1) - 1},${y(v) + 9} l${bw + 2},-5`} className="cutmark" />
                </>
              )}
            </g>
          )
        ))}
      </svg>
      <details className="tableview">
        <summary>View as table</summary>
        <table>
          <thead><tr><th>Day</th><th>Spent</th></tr></thead>
          <tbody>
            {perDay.map((v, i) => (
              <tr key={i}><td>{dayLabel(summary.month, i + 1)}</td><td>{money2(v)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
