// Pure budget math. No React, no network: everything here is unit-tested.

export interface Tx {
  id: string;
  posted_on: string; // YYYY-MM-DD
  month: string; // YYYY-MM-01
  name: string;
  summary: string | null; // raw bank description, used by "contains" mappings
  bankCategory?: string | null; // the bank's own label, when the sync has stored it
  category: string;
  amount: number; // negative = money out
  account: string | null;
  pending: boolean;
  afterLock?: boolean; // arrived after its month was locked, so not in the locked totals
}

export interface Target {
  category: string;
  effective_month: string; // YYYY-MM-01; applies until a later row for the same category
  amount: number;
}

export interface CategoryRow {
  category: string;
  spent: number; // positive = money spent (refunds net out)
  target: number | null;
}

export interface MonthSummary {
  month: string;
  rows: CategoryRow[];
  spent: number;
  target: number;
  daily: number[]; // cumulative spend at the end of each day, length = days in month
}

// Categories that are movement of money rather than spending. A starting guess the
// user can change in the app.
export const DEFAULT_EXCLUDED = /transfer|payment|credit card|income|deposit|paycheck|salary|shopping|^omit$/i;

/** What the person has explicitly turned off or on; anything not listed follows the default. */
export interface ExcludeChoices {
  off: string[]; // categories the person excluded from spending
  on: string[]; // categories the person kept in spending even though the default would exclude them
}

export function effectiveExcluded(categories: string[], choices: ExcludeChoices): Set<string> {
  const off = new Set(choices.off);
  const on = new Set(choices.on);
  return new Set(categories.filter((c) => (off.has(c) ? true : on.has(c) ? false : DEFAULT_EXCLUDED.test(c))));
}

const pad = (n: number) => String(n).padStart(2, "0");

export const monthKeyOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// The Targets tab has its own "Total" row; it is a sum of the other rows, not a category.
const TOTAL_ROW = /^(grand\s+)?totals?$/i;

/**
 * The targets for `month`: the whole column of the latest month at or before it that has targets.
 * A category left blank in that column has no target, even if an earlier month had one.
 */
export function targetsForMonth(targets: Target[], month: string): Map<string, number> {
  const rows = targets.filter((t) => t.effective_month <= month && !TOTAL_ROW.test(t.category.trim()));
  const column = rows.reduce((m, t) => (t.effective_month > m ? t.effective_month : m), "");
  const out = new Map<string, number>();
  for (const t of rows) if (t.effective_month === column) out.set(t.category, (out.get(t.category) ?? 0) + Number(t.amount));
  return out;
}

export interface TargetLine { category: string; amount: number; counted: boolean; raws: string[] /* row names in the Sheet */ }

/** Every target in force for `month` (Bills and Subscription merged), and whether it counts toward the total. */
export function targetBreakdown(targets: Target[], month: string, excluded: Set<string>): { lines: TargetLine[]; total: number } {
  const skip = new Set([...excluded].map((c) => c.toLowerCase()));
  const merged = new Map<string, TargetLine>();
  for (const [raw, amount] of targetsForMonth(targets, month)) {
    const label = canonical(raw);
    const counted = !skip.has(raw.toLowerCase()) && !skip.has(label.toLowerCase());
    const cur = merged.get(label.toLowerCase());
    merged.set(label.toLowerCase(), { category: label, amount: (cur?.amount ?? 0) + amount, counted: (cur?.counted ?? false) || counted, raws: [...(cur?.raws ?? []), raw] });
  }
  const lines = [...merged.values()].filter((l) => !RETIRED.test(l.category)).sort((a, b) => a.category.localeCompare(b.category));
  return { lines, total: lines.reduce((n, l) => n + (l.counted ? l.amount : 0), 0) };
}

export function summarize(
  txs: Tx[],
  targets: Target[],
  month: string,
  excluded: Set<string>,
): MonthSummary {
  const dim = daysInMonth(month);
  const skip = new Set([...excluded].map((c) => c.toLowerCase()));
  const spent = new Map<string, { label: string; amount: number }>();
  const perDay = new Array<number>(dim).fill(0);

  for (const t of txs) {
    const label = canonical(t.category);
    if (t.month !== month || skip.has(t.category.toLowerCase()) || skip.has(label.toLowerCase())) continue;
    const key = label.toLowerCase();
    const cur = spent.get(key) ?? { label, amount: 0 };
    cur.amount += -t.amount;
    spent.set(key, cur);
    const day = Number(t.posted_on.slice(8, 10));
    if (day >= 1 && day <= dim) perDay[day - 1] += -t.amount;
  }

  const targetFor = new Map<string, { label: string; amount: number }>();
  for (const [raw, amount] of targetsForMonth(targets, month)) {
    const label = canonical(raw);
    if (skip.has(raw.toLowerCase()) || skip.has(label.toLowerCase())) continue;
    const cur = targetFor.get(label.toLowerCase());
    targetFor.set(label.toLowerCase(), { label, amount: (cur?.amount ?? 0) + amount });
  }

  const keys = new Set([...spent.keys(), ...targetFor.keys()]);
  const rows: CategoryRow[] = [...keys].map((k) => ({
    category: spent.get(k)?.label ?? targetFor.get(k)!.label,
    spent: spent.get(k)?.amount ?? 0,
    target: targetFor.get(k)?.amount ?? null,
  }));
  rows.sort((a, b) => Math.max(b.spent, b.target ?? 0) - Math.max(a.spent, a.target ?? 0));

  let run = 0;
  const daily = perDay.map((d) => (run += d));
  return {
    month,
    rows,
    spent: rows.reduce((s, r) => s + r.spent, 0),
    target: rows.reduce((s, r) => s + (r.target ?? 0), 0),
    daily,
  };
}

// The numbers to keep tabs on, shown first. Matched ignoring case and "&" vs "and".
export const KEY_CATEGORIES = ["Food and Drink", "Groceries", "House", "Travel", "Alex Fun", "Sam Fun"];
export const norm = (c: string) => c.toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ").trim();
// The Sheet's Vendor Mapping has separate "Bills" and "Subscription" categories, but the
// Targets tab tracks them together as "Bills + Subscription", so the tracker does too.
// One old transfer category is just a Transfer.
const ALIASES: [RegExp, string][] = [
  [/^(bills|subscriptions?)(\s*(\+|&|and)\s*subscriptions?)?$/i, "Bills + Subscription"],
  [/^transfer from savings to joint checking$/i, "Transfer"],
];
/** Categories that are retired: never offered in pickers or listed as targets. */
export const RETIRED = /^shopping\b/i;
export const canonical = (c: string): string => ALIASES.find(([re]) => re.test(c.trim()))?.[1] ?? c;

const SAVINGS = /saving|invest|retire/i;

/** Split a month's rows into the key categories (always all of them, in order) and everything else. */
export function splitKey(rows: CategoryRow[], keys: string[] = KEY_CATEGORIES): { key: CategoryRow[]; other: CategoryRow[] } {
  const byName = new Map(rows.map((r) => [norm(r.category), r]));
  const key = keys.map((k) => byName.get(norm(k)) ?? { category: k, spent: 0, target: null });
  const used = new Set(keys.map(norm));
  const other = rows.filter((r) => !used.has(norm(r.category)) && !/shopping/i.test(r.category)).sort(budgetOrder);
  return { key, other };
}

// Uncategorized first, savings last, otherwise biggest spend first.
const budgetOrder = (a: CategoryRow, b: CategoryRow): number =>
  Number(SAVINGS.test(a.category)) - Number(SAVINGS.test(b.category)) ||
  Number(/^uncategorized$/i.test(b.category)) - Number(/^uncategorized$/i.test(a.category)) ||
  b.spent - a.spent;

export interface BudgetRow extends CategoryRow { featured: boolean }

/** Every category for the Budget table. `featured` marks the ones already shown as tiles at the top. */
export function budgetRows(rows: CategoryRow[], keys: string[] = KEY_CATEGORIES): { rows: BudgetRow[]; total: number } {
  const { key, other } = splitKey(rows, keys);
  const all: BudgetRow[] = [...other.map((r) => ({ ...r, featured: false })), ...key.map((r) => ({ ...r, featured: true }))].sort(budgetOrder);
  return { rows: all, total: all.reduce((n, r) => n + r.spent, 0) };
}

/**
 * How full a target is, as a color: under 50% is fine, 50% up to the target is a heads-up,
 * at or over the target is red. Used for the rings and bars.
 */
export type Tone = "ok" | "warn" | "crit";
/** Whole percent of the target used, rounded down so the label and the color never disagree (99.8% reads 99%, not 100%). */
/**
 * The percent shown on a ring or tile. It rounds down, but never shows a number on the wrong side of a color
 * change: over the target always reads 101% or more, and past 75% always reads 76% or more.
 */
export const percentOf = (spent: number, target: number): number => {
  if (!(target > 0)) return 0;
  const p = Math.floor((spent / target) * 100);
  if (spent > target) return Math.max(p, 101);
  if (spent * 100 > target * 75) return Math.max(p, 76);
  return p;
};
/** Up to 75% is green, past 75% up to and including 100% is yellow, anything over the target is red. */
export const tone = (spent: number, target: number): Tone =>
  !(target > 0) ? "ok" : spent > target ? "crit" : spent * 100 > target * 75 ? "warn" : "ok";
/** 110% of the target or more: the category is treated as off limits. */
export const isOffLimits = (spent: number, target: number): boolean => target > 0 && spent * 100 >= target * 110;

// ---------------------------------------------------------------- formatting
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const money0 = (n: number): string => usd0.format(Math.round(n) || 0);
export const money2 = (n: number): string => usd2.format(n === 0 ? 0 : n);

export const monthLabel = (month: string): string =>
  new Date(`${month}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function dayLabel(month: string, day: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
