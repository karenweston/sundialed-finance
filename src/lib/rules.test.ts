import { describe, expect, it } from "vitest";
import type { Tx } from "./budget";
import { accountBreakdown, applyRules, buildSnapshot, isMissingTable, normalizePattern, pickRule, previewMatches, uncategorizedGroups } from "./rules";
import type { MonthLock, Rule } from "./rules";

// Invented data only.
const tx = (id: string, date: string, name: string, category: string, amount: number, summary: string | null = null, account: string | null = null): Tx => ({
  id, posted_on: date, month: `${date.slice(0, 7)}-01`, name, summary, category, amount, account, pending: false,
});

const rules: Rule[] = [
  { id: 1, match_type: "contains", pattern: "amazon", category: "House", accounts: [] },
  { id: 2, match_type: "contains", pattern: "amazon prime", category: "Bills", accounts: [] },
  { id: 3, match_type: "exact", pattern: "amazon fresh", category: "Groceries", accounts: [] },
];
const noLocks = new Map<string, MonthLock>();

describe("pickRule", () => {
  it("prefers exact, then the most specific contains pattern", () => {
    expect(pickRule(rules, { name: "Amazon Fresh", summary: null, account: null })?.id).toBe(3);
    expect(pickRule(rules, { name: "Amazon Prime Video", summary: null, account: null })?.id).toBe(2);
    expect(pickRule(rules, { name: "Amazon", summary: null, account: null })?.id).toBe(1);
  });
  it("matches 'contains' on the raw bank description too", () => {
    expect(pickRule(rules, { name: "Marketplace", summary: "AMAZON MKTPL*AB12", account: null })?.id).toBe(1);
  });
  it("matches exact names case-insensitively and ignores near misses", () => {
    expect(pickRule([rules[2]], { name: "  AMAZON   fresh ", summary: null, account: null })?.id).toBe(3);
    expect(pickRule([rules[2]], { name: "Amazon Fresh Market", summary: null, account: null })).toBeUndefined();
    expect(pickRule(rules, { name: "Dunkin'", summary: "DUNKIN #1", account: null })).toBeUndefined();
  });
});

describe("applyRules", () => {
  const txs = [
    tx("a", "2026-11-02", "Amazon", "Uncategorized", -20, "AMAZON MKTPL*X"),
    tx("b", "2026-11-03", "Amazon", "Dining", -30), // the Sheet already categorized it: left alone
    tx("c", "2026-11-04", "Corner Cafe", "Uncategorized", -5),
  ];
  it("fills in only uncategorized transactions", () => {
    const out = applyRules(txs, rules, noLocks);
    expect(out.map((t) => t.category)).toEqual(["House", "Dining", "Uncategorized"]);
  });
  it("uses frozen categories in locked months and flags late arrivals", () => {
    const lock: MonthLock = {
      month: "2026-11-01", locked_at: "2026-12-01T00:00:00Z",
      snapshot: { summary: { month: "2026-11-01", rows: [], spent: 0, target: 0, daily: [] }, excluded: [], txCategories: { a: "Uncategorized", b: "Groceries" } },
    };
    const out = applyRules(txs, rules, new Map([["2026-11-01", lock]]));
    expect(out[0].category).toBe("Uncategorized"); // frozen, so the new rule doesn't change it
    expect(out[1].category).toBe("Groceries");
    expect(out[2].afterLock).toBe(true);
  });
});

describe("uncategorizedGroups and previewMatches", () => {
  const txs = [
    tx("a", "2026-11-02", "Corner Cafe", "Uncategorized", -5),
    tx("b", "2026-11-09", "corner cafe", "Uncategorized", -7),
    tx("c", "2026-11-04", "Big Store", "Uncategorized", -90),
    tx("d", "2026-11-05", "Gym", "Bills", -40),
    tx("e", "2026-10-05", "Old Place", "Uncategorized", -999),
  ];
  const locks = new Map<string, MonthLock>([["2026-10-01", { month: "2026-10-01", locked_at: "", snapshot: { summary: { month: "2026-10-01", rows: [], spent: 0, target: 0, daily: [] }, excluded: [], txCategories: {} } }]]);

  it("groups by merchant, biggest first, skipping categorized and locked rows", () => {
    const g = uncategorizedGroups(txs, locks);
    expect(g.map((x) => x.key)).toEqual(["big store", "corner cafe"]);
    expect(g[1]).toMatchObject({ count: 2, spent: 12, last: "2026-11-09" });
  });
  it("counts what a mapping would catch", () => {
    expect(previewMatches(txs, locks, "exact", "corner cafe")).toBe(2);
    expect(previewMatches(txs, locks, "contains", "store")).toBe(1);
    expect(previewMatches(txs, locks, "contains", "")).toBe(0);
  });
});

describe("buildSnapshot", () => {
  it("captures totals and per-transaction categories for the month", () => {
    const txs = [tx("a", "2026-10-02", "X", "Groceries", -100), tx("b", "2026-11-02", "Y", "Dining", -5)];
    const snap = buildSnapshot(txs, [], "2026-10-01", new Set(["Transfers"]));
    expect(snap.summary.spent).toBe(100);
    expect(snap.txCategories).toEqual({ a: "Groceries" });
    expect(snap.excluded).toEqual(["Transfers"]);
  });
});

describe("normalizePattern", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizePattern("  AmaZon   Prime ")).toBe("amazon prime");
  });
});

describe("account-scoped mappings", () => {
  const scoped: Rule[] = [
    { id: 1, match_type: "contains", pattern: "amazon", category: "House", accounts: ["Sapphire", "SW Card"] },
    { id: 2, match_type: "contains", pattern: "amazon", category: "Alex Fun", accounts: ["Apple Card"] },
    { id: 3, match_type: "contains", pattern: "amazon", category: "Sam Fun", accounts: ["Amex"] },
  ];
  const amazon = (id: string, account: string | null) => tx(id, "2026-11-03", "Amazon", "Uncategorized", -10, "AMAZON MKTPL*1", account);

  it("maps the same merchant to different categories by account", () => {
    const out = applyRules([amazon("a", "Sapphire"), amazon("b", "SW Card"), amazon("c", "Apple Card"), amazon("d", "Amex")], scoped, noLocks);
    expect(out.map((t) => t.category)).toEqual(["House", "House", "Alex Fun", "Sam Fun"]);
  });
  it("leaves other accounts and unknown accounts uncategorized", () => {
    const out = applyRules([amazon("e", "Checking"), amazon("f", null)], scoped, noLocks);
    expect(out.map((t) => t.category)).toEqual(["Uncategorized", "Uncategorized"]);
  });
  it("lets an account-specific mapping beat an any-account one", () => {
    const all: Rule[] = [{ id: 9, match_type: "exact", pattern: "amazon", category: "Fallback", accounts: [] }, ...scoped];
    expect(pickRule(all, { name: "Amazon", summary: null, account: "Amex" })?.category).toBe("Sam Fun");
    expect(pickRule(all, { name: "Amazon", summary: null, account: "Checking" })?.category).toBe("Fallback");
  });
  it("previews only the chosen accounts and breaks down where transactions came from", () => {
    const txs = [amazon("a", "Sapphire"), amazon("b", "Sapphire"), amazon("c", "Apple Card")];
    expect(previewMatches(txs, noLocks, "contains", "amazon", ["Apple Card"])).toBe(1);
    expect(previewMatches(txs, noLocks, "contains", "amazon", [])).toBe(3);
    expect(accountBreakdown(txs, noLocks, "contains", "amazon")).toEqual([
      { account: "Sapphire", count: 2 }, { account: "Apple Card", count: 1 },
    ]);
  });
});

describe("isMissingTable", () => {
  it("recognizes a database that hasn't had the latest update", () => {
    for (const code of ["PGRST205", "42P01", "PGRST204", "42703"]) expect(isMissingTable({ code })).toBe(true);
    expect(isMissingTable({ code: "23505" })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});

describe("card defaults", () => {
  const base = { id: "x", posted_on: "2026-10-05", month: "2026-10-01", name: "Some Shop", summary: null, category: "Uncategorized", pending: false };
  it("sends uncategorized charges to the card owner's category, but not money in or categorized rows", () => {
    const out = applyRules([
      { ...base, id: "1", account: "Amex Credit Card", amount: -20 },
      { ...base, id: "2", account: "Alex Apple Card", amount: -30 },
      { ...base, id: "3", account: "Alex Apple Card", amount: 30 },
      { ...base, id: "4", account: "Amex Credit Card", amount: -5, category: "Groceries" },
      { ...base, id: "5", account: "Checking", amount: -9 },
    ], [], new Map());
    expect(out.map((t) => t.category)).toEqual(["Sam Fun", "Alex Fun", "Uncategorized", "Groceries", "Uncategorized"]);
  });
  it("treats the Apple Card tab's plain \"Apple Card\" account as Alex Fun too", () => {
    const out = applyRules([{ ...base, account: "Apple Card", amount: -14 }, { ...base, id: "2", account: "Apple Card", amount: 14 }], [], new Map());
    expect(out.map((t) => t.category)).toEqual(["Alex Fun", "Uncategorized"]);
  });
  it("a saved mapping beats the card default", () => {
    const rules = [{ id: 1, match_type: "contains" as const, pattern: "amazon", category: "House", accounts: ["Amex Credit Card"] }];
    const out = applyRules([{ ...base, name: "Amazon", account: "Amex Credit Card", amount: -12 }], rules, new Map());
    expect(out[0].category).toBe("House");
  });
});

describe("amount rules", () => {
  const t = (id: string, account: string, amount: number): Tx => ({ id, posted_on: "2026-10-05", month: "2026-10-01", name: "Online Transfer", summary: null, category: "Uncategorized", amount, account, pending: false });
  const rule = (over: Partial<Rule>): Rule => ({ id: 1, match_type: "contains", pattern: "online transfer", category: "Transfer", accounts: [], amount: null, ...over });
  it("matches money in or out of exactly that size, and nothing else", () => {
    const out = applyRules([t("a", "Checking", -500), t("b", "Savings", 500), t("c", "Checking", -500.01), t("d", "Checking", -50)], [rule({ amount: 500 })], new Map());
    expect(out.map((x) => x.category)).toEqual(["Transfer", "Transfer", "Uncategorized", "Uncategorized"]);
  });
  it("an amount rule beats a general one for the same text", () => {
    const general = rule({ id: 1, category: "Other" });
    const exact = rule({ id: 2, category: "Transfer", amount: 500 });
    expect(pickRule([general, exact], t("a", "Checking", -500))?.category).toBe("Transfer");
    expect(pickRule([general, exact], t("b", "Checking", -20))?.category).toBe("Other");
  });
  it("previews respect the amount", () => {
    const txs = [t("a", "Checking", -500), t("b", "Checking", -20)];
    expect(previewMatches(txs, new Map(), "contains", "online transfer", [], 500)).toBe(1);
    expect(previewMatches(txs, new Map(), "contains", "online transfer", [], null)).toBe(2);
  });
});
