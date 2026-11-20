import { useId } from "react";
import { percentOf, tone } from "./lib/budget";

// Literal colors, not CSS variables: some browsers keep a gradient's old variable colors when only a class changes
// (switching months), which painted the wrong color. Each ring also gets its own gradient id.
const COLORS = {
  ok: ["#7fd6b8", "#3fae97"],
  warn: ["#f6d27a", "#f0a35a"],
  crit: ["#f59a8a", "#dd5a76"],
} as const;

export default function Ring({ spent, target, size = 84 }: { spent: number; target: number; size?: number }) {
  const t = tone(spent, target);
  const pct = percentOf(spent, target);
  const r = 34, c = 2 * Math.PI * r;
  const id = `ring-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const fill = Math.max(Math.min(Math.max(spent / target, 0), 1) * c, 0.01); // at 0% a small dot marks the start
  return (
    <div className={`ring ${t}`} style={{ width: size, height: size }} role="img" aria-label={`${pct}% of targets used`}>
      <svg key={t} viewBox="0 0 80 80" width={size} height={size}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={COLORS[t][0]} />
            <stop offset="1" stopColor={COLORS[t][1]} />
          </linearGradient>
        </defs>
        <circle cx="40" cy="40" r={r} className="ring-track" />
        <circle cx="40" cy="40" r={r} className="ring-fill" stroke={`url(#${id})`} strokeDasharray={`${fill} ${c}`} transform="rotate(-90 40 40)" />
      </svg>
      <span>{pct}%</span>
    </div>
  );
}
