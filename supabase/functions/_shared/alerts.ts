// Decides which phone notifications to send. Pure logic: no network, so it is unit-tested.
// Notification text is words only (no dollar amounts), because it can show on a lock screen.
import { KEY_CATEGORIES, effectiveExcluded, splitKey, summarize } from "./budget.ts";
import type { ExcludeChoices, Target, Tx } from "./budget.ts";
import { applyRules, uncategorizedGroups } from "./rules.ts";
import type { MonthLock, Rule } from "./rules.ts";

const TZ = "America/New_York";
// Milestones, highest first. Each is announced once per category per month.
const MILESTONES: { id: "90" | "75" | "50"; at: number }[] = [
  { id: "90", at: 0.9 },
  { id: "75", at: 0.75 },
  { id: "50", at: 0.5 },
];
const OVER = 1.0005; // matches the dashboard: red only when actually over

export interface Input {
  txs: Tx[];
  targets: Target[];
  rules: Rule[];
  locks: MonthLock[];
  choices: ExcludeChoices;
  hiddenMonths: string[];
  /** The categories pinned as tiles on the dashboard. Falls back to the built-in list. */
  tileCategories?: string[] | null;
  now: Date;
}

export interface Notice {
  title: string;
  body: string;
  /** Keys to remember once this has been sent, so it never repeats. */
  keys: string[];
}

/** The date and time in the household's time zone. */
export function localParts(now: Date): { date: string; month: string; weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    month: `${get("year")}-${get("month")}-01`,
    weekday,
    hour: Number(get("hour")),
  };
}

type State = "over" | "90" | "75" | "50" | "ok";
interface Status { category: string; state: State }

function statuses(input: Input, month: string, only?: string[]): Status[] {
  const locks = new Map(input.locks.map((l) => [l.month, l]));
  const eff = applyRules(input.txs, input.rules, locks);
  const categories = [...new Set([...eff.map((t) => t.category), ...input.targets.map((t) => t.category), ...input.rules.map((r) => r.category)])];
  const excluded = effectiveExcluded(categories, input.choices);
  let rows = summarize(eff, input.targets, month, excluded).rows;
  if (only) rows = splitKey(rows, only).key;
  return rows
    .filter((r) => r.target != null && r.target > 0)
    .map((r) => {
      const pct = r.spent / r.target!;
      // A category sitting exactly at its target (a mortgage, say) is done, not a milestone.
      const state: State = pct > OVER ? "over" : pct >= 1 ? "ok" : (MILESTONES.find((m) => pct >= m.at)?.id ?? "ok");
      return { category: r.category, state };
    });
}

const list = (xs: string[]) => xs.join(", ");

/** Pinned categories (the tiles at the top) that newly reached halfway, three-quarters, 90% of target, or went over it this month. */
export function thresholdNotice(input: Input, sent: Set<string>): Notice | null {
  const { month } = localParts(input.now);
  if (input.locks.some((l) => l.month === month)) return null;
  const groups: Record<string, string[]> = { over: [], "90": [], "75": [], "50": [] };
  const keys: string[] = [];
  for (const s of statuses(input, month, input.tileCategories ?? KEY_CATEGORIES)) {
    if (s.state === "ok") continue;
    const base = `thr:${month}:${s.category}`;
    const ladder = ["50", "75", "90", "over"];
    const reached = ladder.slice(0, ladder.indexOf(s.state) + 1);
    // Only announce the highest milestone reached, and mark the lower ones as done too.
    if (sent.has(`${base}:${s.state}`)) continue;
    groups[s.state].push(s.category);
    keys.push(...reached.map((m) => `${base}:${m}`));
  }
  const levels = ["over", "90", "75", "50"].filter((l) => groups[l].length);
  if (!levels.length) return null;
  // One kind of news: it is the headline. Several kinds in one sync: one "Budget update" listing them.
  if (levels.length === 1) return { title: milestoneTitle(levels[0], groups[levels[0]]), body: "Open the app for details.", keys };
  const body = levels.map((l) => milestoneText(l, groups[l])).join(" ");
  return { title: "Budget update", body: `${body} Open the app for details.`, keys };
}

const PHRASES: Record<string, string> = { over: "Over target", "90": "Almost at target", "75": "Three-quarters of the way", "50": "Halfway" };
/** One line of a notification, e.g. "Halfway: Food and Drink." Undefined for an unknown level. */
export function milestoneText(level: string, categories: string[]): string {
  return `${PHRASES[level]}: ${list(categories)}.`;
}
/** The headline form, e.g. "Halfway: Food and Drink". */
export const milestoneTitle = (level: string, categories: string[]): string => `${PHRASES[level]}: ${list(categories)}`;
export const isLevel = (l: string): boolean => l in PHRASES;

/** Sunday evening (6pm or later, household time) summary of the key categories, once a week. */
export function weeklyNotice(input: Input, sent: Set<string>): Notice | null {
  const { date, month, weekday, hour } = localParts(input.now);
  if (weekday !== 0 || hour < 18) return null;
  const key = `weekly:${date}`;
  if (sent.has(key)) return null;
  const locks = new Map(input.locks.map((l) => [l.month, l]));
  const keyStatus = statuses(input, month, input.tileCategories ?? KEY_CATEGORIES);
  const over = keyStatus.filter((s) => s.state === "over").map((s) => s.category);
  const near = keyStatus.filter((s) => s.state === "90").map((s) => s.category);
  const eff = applyRules(input.txs, input.rules, locks).filter((t) => !input.hiddenMonths.includes(t.month));
  const inbox = uncategorizedGroups(eff, locks).reduce((n, g) => n + g.count, 0);
  const parts = [
    over.length ? `Over target: ${list(over)}.` : "",
    near.length ? `Close to target: ${list(near)}.` : "",
    !over.length && !near.length ? "Your key categories are on track." : "",
    inbox > 0 ? `${inbox} transactions need a category.` : "",
  ].filter(Boolean);
  return { title: "Weekly check-in", body: parts.join(" "), keys: [key] };
}
