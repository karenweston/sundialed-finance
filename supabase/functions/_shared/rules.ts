// App-side vendor mappings and month locks. Pure logic: no React, no network.
import { summarize } from "./budget.ts";
import type { MonthSummary, Target, Tx } from "./budget.ts";

export const UNCATEGORIZED = "Uncategorized";

export type MatchType = "exact" | "contains";

export interface Rule {
  id: number;
  match_type: MatchType;
  pattern: string; // always lowercase, trimmed
  category: string;
  accounts: string[]; // only when paid with one of these accounts; empty = any account
  amount?: number | null; // only when the amount (in or out) is exactly this; null = any amount
}

/**
 * Built-in fallback: a charge nobody has categorized (neither the Sheet nor a saved mapping)
 * goes to whoever owns the card. Money coming in (payments, refunds) is left alone.
 */
export const CARD_DEFAULTS: { account: RegExp; accountLabel: string; category: string }[] = [
  { account: /^amex credit card$/i, accountLabel: "Amex Credit Card", category: "Sam Fun" },
  { account: /^(alex )?apple card$/i, accountLabel: "Apple Card", category: "Alex Fun" },
];

export function cardDefault(tx: Pick<Tx, "account" | "amount">): string | undefined {
  if (!tx.account || tx.amount >= 0) return undefined;
  return CARD_DEFAULTS.find((d) => d.account.test(tx.account!))?.category;
}

export interface LockSnapshot {
  summary: MonthSummary;
  excluded: string[];
  txCategories: Record<string, string>; // transaction id -> category when locked
}

export interface MonthLock {
  month: string;
  locked_at: string;
  snapshot: LockSnapshot;
}

/** PostgREST "table not in schema cache" or Postgres "undefined table": the migration isn't applied yet. */
export const isMissingTable = (e: unknown): boolean => {
  const code = (e as { code?: string } | null)?.code;
  // missing table, or missing column (database update not applied yet)
  return code === "PGRST205" || code === "42P01" || code === "PGRST204" || code === "42703";
};

/** What to tell the person when saving a rule fails. */
export function ruleErrorText(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  if (isMissingTable(e)) return "The latest database update hasn't been applied yet, so rules can't be saved.";
  if (code === "23505") return "You already have a rule for that.";
  if (code === "23514") return "That text is too short or not allowed.";
  return "Couldn't save. Check your connection and try again.";
}

/** "500", "$1,250.50" -> number; blank -> null (any amount); anything else -> NaN. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
  return n > 0 ? n : NaN;
}

export const normalizePattern = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

const nameOf = (t: Pick<Tx, "name">) => normalizePattern(t.name);
const summaryOf = (t: Pick<Tx, "summary">) => normalizePattern(t.summary ?? "");

const cents = (n: number) => Math.round(Math.abs(n) * 100);

export function ruleMatches(
  rule: { match_type: MatchType; pattern: string; accounts?: string[]; amount?: number | null },
  tx: Pick<Tx, "name" | "summary" | "account"> & { amount?: number },
): boolean {
  if (rule.amount != null && (tx.amount === undefined || cents(tx.amount) !== cents(rule.amount))) return false;
  const accounts = rule.accounts ?? [];
  if (accounts.length > 0 && !(tx.account && accounts.includes(tx.account))) return false;
  if (rule.match_type === "exact") return nameOf(tx) === rule.pattern;
  return nameOf(tx).includes(rule.pattern) || summaryOf(tx).includes(rule.pattern);
}

/**
 * Most specific mapping wins: one with an exact amount, then one limited to certain accounts beats one for any account,
 * then an exact name beats "contains", then the longest text wins. Ties go to the older one.
 */
export function pickRule(rules: Rule[], tx: Pick<Tx, "name" | "summary" | "account"> & { amount?: number }): Rule | undefined {
  let best: Rule | undefined;
  let bestScore = -1;
  for (const r of rules) {
    if (!ruleMatches(r, tx)) continue;
    const score = (r.amount != null ? 2_000_000 : 0) + (r.accounts.length > 0 ? 1_000_000 : 0) + (r.match_type === "exact" ? 500_000 : 0) + r.pattern.length;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The categories the app actually uses:
 *  - locked months use the categories frozen at lock time;
 *  - otherwise a mapping fills in transactions the Sheet left uncategorized.
 */
export function applyRules(txs: Tx[], rules: Rule[], locks: Map<string, MonthLock>): Tx[] {
  return txs.map((t) => {
    const lock = locks.get(t.month);
    if (lock) {
      const frozen = lock.snapshot.txCategories[t.id];
      if (frozen === undefined) return { ...t, afterLock: true };
      return frozen === t.category ? t : { ...t, category: frozen };
    }
    if (t.category !== UNCATEGORIZED) return t;
    const r = pickRule(rules, t);
    if (r) return { ...t, category: r.category };
    const d = cardDefault(t);
    return d ? { ...t, category: d } : t;
  });
}

export interface Group {
  key: string;
  name: string;
  count: number;
  spent: number; // positive = money out
  last: string; // most recent date
  bank: string | null; // the bank's own label for this merchant, if known
  amounts: number[]; // distinct sizes seen (always positive), up to 6, for suggesting an amount rule
}

/** Merchants that still have no category, in months that aren't locked. Biggest first. */
export function uncategorizedGroups(effectiveTxs: Tx[], locks: Map<string, MonthLock>): Group[] {
  const map = new Map<string, Group>();
  for (const t of effectiveTxs) {
    if (t.category !== UNCATEGORIZED || locks.has(t.month)) continue;
    const key = nameOf(t);
    const g = map.get(key) ?? { key, name: t.name.trim(), count: 0, spent: 0, last: t.posted_on, bank: null, amounts: [] };
    const size = Math.round(Math.abs(t.amount) * 100) / 100;
    if (g.amounts.length < 6 && !g.amounts.includes(size)) g.amounts.push(size);
    if (!g.bank && t.bankCategory) g.bank = t.bankCategory;
    g.count += 1;
    g.spent += -t.amount;
    if (t.posted_on > g.last) g.last = t.posted_on;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => Math.abs(b.spent) - Math.abs(a.spent) || b.count - a.count);
}

/** How many still-uncategorized transactions a mapping would catch (for the preview). */
export function previewMatches(
  effectiveTxs: Tx[],
  locks: Map<string, MonthLock>,
  match_type: MatchType,
  pattern: string,
  accounts: string[] = [],
  amount: number | null = null,
): number {
  const p = normalizePattern(pattern);
  if (!p) return 0;
  let n = 0;
  for (const t of effectiveTxs) {
    if (t.category !== UNCATEGORIZED || locks.has(t.month)) continue;
    if (ruleMatches({ match_type, pattern: p, accounts, amount }, t)) n += 1;
  }
  return n;
}

/** Which accounts the still-uncategorized transactions for a mapping came from, most first. */
export function accountBreakdown(
  effectiveTxs: Tx[],
  locks: Map<string, MonthLock>,
  match_type: MatchType,
  pattern: string,
  amount: number | null = null,
): { account: string; count: number }[] {
  const p = normalizePattern(pattern);
  const counts = new Map<string, number>();
  if (p) {
    for (const t of effectiveTxs) {
      if (t.category !== UNCATEGORIZED || locks.has(t.month) || !t.account) continue;
      if (ruleMatches({ match_type, pattern: p, amount }, t)) counts.set(t.account, (counts.get(t.account) ?? 0) + 1);
    }
  }
  return [...counts].map(([account, count]) => ({ account, count })).sort((a, b) => b.count - a.count || a.account.localeCompare(b.account));
}

export function buildSnapshot(
  effectiveTxs: Tx[],
  targets: Target[],
  month: string,
  excluded: Set<string>,
): LockSnapshot {
  const txCategories: Record<string, string> = {};
  for (const t of effectiveTxs) if (t.month === month) txCategories[t.id] = t.category;
  return {
    summary: summarize(effectiveTxs, targets, month, excluded),
    excluded: [...excluded],
    txCategories,
  };
}
