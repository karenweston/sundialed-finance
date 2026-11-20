import { describe, expect, it } from "vitest";
import { DEFAULT_EXCLUDED, canonical, effectiveExcluded, budgetRows, splitKey, summarize, targetBreakdown, targetsForMonth, tone, percentOf, isOffLimits } from "./budget";
import type { Target, Tx } from "./budget";

// Invented data only.
const tx = (id: string, posted_on: string, category: string, amount: number): Tx => ({
  id, posted_on, month: `${posted_on.slice(0, 7)}-01`, name: id, summary: null, category, amount, account: null, pending: false,
});

const targets: Target[] = [
  { category: "Groceries", effective_month: "2026-01-01", amount: 500 },
  { category: "Groceries", effective_month: "2026-04-01", amount: 450 },
  { category: "House", effective_month: "2026-04-01", amount: 1000 },
];

describe("targetsForMonth", () => {
  it("carries a target forward until a later row replaces it", () => {
    expect(targetsForMonth(targets, "2026-03-01").get("Groceries")).toBe(500);
    expect(targetsForMonth(targets, "2026-10-01").get("Groceries")).toBe(450);
  });
  it("ignores targets that haven't started yet", () => {
    expect(targetsForMonth(targets, "2026-03-01").has("House")).toBe(false);
  });
  it("uses the whole latest column: a blank category has no target, even if an earlier month had one", () => {
    const t: Target[] = [
      { category: "Airbnb", effective_month: "2026-05-01", amount: 2000 },
      { category: "Groceries", effective_month: "2026-05-01", amount: 500 },
      { category: "Groceries", effective_month: "2026-10-01", amount: 600 },
    ];
    expect(targetsForMonth(t, "2026-11-01").has("Airbnb")).toBe(false);
    expect(targetsForMonth(t, "2026-11-01").get("Groceries")).toBe(600);
    expect(targetsForMonth(t, "2026-07-01").get("Airbnb")).toBe(2000);
  });
});

describe("summarize", () => {
  const txs = [
    tx("a", "2026-10-02", "Groceries", -100),
    tx("b", "2026-10-02", "Groceries", -50),
    tx("c", "2026-10-05", "Groceries", 20), // refund nets out
    tx("d", "2026-10-05", "Dining", -30),
    tx("e", "2026-10-06", "Credit Card Payment", -999), // excluded
    tx("f", "2026-09-30", "Groceries", -77), // other month
  ];
  const s = summarize(txs, targets, "2026-10-01", new Set(["Credit Card Payment"]));

  it("totals spend by category, netting refunds and skipping excluded categories", () => {
    expect(s.rows.find((r) => r.category === "Groceries")).toMatchObject({ spent: 130, target: 450 });
    expect(s.rows.find((r) => r.category === "Dining")).toMatchObject({ spent: 30, target: null });
    expect(s.rows.some((r) => r.category === "Credit Card Payment")).toBe(false);
    expect(s.spent).toBe(160);
  });
  it("includes categories that have a target but no spending yet", () => {
    expect(s.rows.find((r) => r.category === "House")).toMatchObject({ spent: 0, target: 1000 });
    expect(s.target).toBe(1450);
  });
  it("builds a cumulative daily series of the right length", () => {
    expect(s.daily).toHaveLength(31);
    expect(s.daily[0]).toBe(0);
    expect(s.daily[1]).toBe(150);
    expect(s.daily[4]).toBe(160);
    expect(s.daily[30]).toBe(160);
  });
  it("matches category names case-insensitively", () => {
    const r = summarize([tx("x", "2026-10-03", "groceries", -10)], targets, "2026-10-01", new Set());
    expect(r.rows.filter((row) => row.category.toLowerCase() === "groceries")).toHaveLength(1);
  });
});

describe("effectiveExcluded", () => {
  const cats = ["Groceries", "Transfers", "Credit Card Payment", "Dining"];
  it("excludes transfer-like categories by default, including ones that appear later", () => {
    expect([...effectiveExcluded(cats, { off: [], on: [] })]).toEqual(["Transfers", "Credit Card Payment"]);
  });
  it("lets explicit choices override the default in both directions", () => {
    const s = effectiveExcluded(cats, { off: ["Dining"], on: ["Transfers"] });
    expect(s.has("Dining")).toBe(true);
    expect(s.has("Transfers")).toBe(false);
    expect(s.has("Credit Card Payment")).toBe(true);
  });
});

describe("splitKey", () => {
  it("returns the key categories in order, and the rest by size with savings last and Shopping hidden", () => {
    const rows = [
      { category: "Dining", spent: 50, target: null },
      { category: "Food & Drink", spent: 300, target: 400 },
      { category: "Savings", spent: 900, target: null },
      { category: "Bills", spent: 120, target: null },
      { category: "Shopping", spent: 80, target: null },
    ];
    const s = splitKey(rows);
    expect(s.key.map((r) => r.category)).toEqual(["Food & Drink", "Groceries", "House", "Travel", "Alex Fun", "Sam Fun"]);
    expect(s.key[1].spent).toBe(0);
    expect(s.other.map((r) => r.category)).toEqual(["Bills", "Dining", "Savings"]);
  });
});

describe("Bills + Subscription", () => {
  it("adds Bills and Subscription together against the combined target", () => {
    const tx = (id: string, category: string, amount: number): Tx => ({ id, posted_on: "2026-10-05", month: "2026-10-01", name: "x", summary: null, category, amount, account: "A", pending: false });
    const s = summarize(
      [tx("1", "Bills", -100), tx("2", "Subscription", -20), tx("3", "Bills + Subscription", -5), tx("4", "Dining", -7)],
      [{ category: "Bills + Subscription", effective_month: "2026-01-01", amount: 2190 }],
      "2026-10-01",
      new Set(),
    );
    expect(s.rows.find((r) => r.category === "Bills + Subscription")).toEqual({ category: "Bills + Subscription", spent: 125, target: 2190 });
    expect(s.rows).toHaveLength(2);
  });
});

describe("Total rows and Shopping", () => {
  it("ignores a Total row in the targets, and leaves Shopping out by default", () => {
    const targets = [
      { category: "Groceries", effective_month: "2026-01-01", amount: 500 },
      { category: "TOTAL", effective_month: "2026-01-01", amount: 9000 },
    ];
    expect([...targetsForMonth(targets, "2026-11-01").keys()]).toEqual(["Groceries"]);
    expect(["Shopping", "Groceries"].filter((c) => DEFAULT_EXCLUDED.test(c))).toEqual(["Shopping"]);
  });
});

describe("budgetRows", () => {
  const rows = [
    { category: "Mortgage", spent: 2000, target: 2000 },
    { category: "Groceries", spent: 500, target: 450 },
    { category: "Uncategorized", spent: 40, target: null },
    { category: "Savings", spent: 300, target: 300 },
  ];
  const b = budgetRows(rows);
  it("lists every category, featured ones included and marked", () => {
    expect(b.rows.find((r) => r.category === "Groceries")?.featured).toBe(true);
    expect(b.rows.find((r) => r.category === "Mortgage")?.featured).toBe(false);
    expect(b.rows.some((r) => r.category === "House")).toBe(true); // key tile with no spend still listed
  });
  it("puts Uncategorized first and savings last, and totals everything shown", () => {
    expect(b.rows[0].category).toBe("Uncategorized");
    expect(b.rows[b.rows.length - 1].category).toBe("Savings");
    expect(b.total).toBe(2840);
  });
});

import { dailySpend } from "./../SpendChart";
describe("dailySpend", () => {
  it("turns a running total into what was spent each day", () => {
    expect(dailySpend([10, 10, 35.5, 30])).toEqual([10, 0, 25.5, -5.5]);
  });
});

describe("tone", () => {
  it("is green up to 75%, yellow up to 100%, red over", () => {
    expect(tone(0, 100)).toBe("ok");
    expect(tone(75, 100)).toBe("ok");
    expect(tone(75.1, 100)).toBe("warn");
    expect(tone(100, 100)).toBe("warn");
    expect(tone(100.01, 100)).toBe("crit");
    expect(tone(150, 100)).toBe("crit");
    expect(tone(5, 0)).toBe("ok");
    expect(tone(-20, 500)).toBe("ok");
  });
  it("the percent shown never contradicts the color", () => {
    expect(percentOf(499, 500)).toBe(99);
    expect(percentOf(375, 500)).toBe(75);
    expect(tone(375, 500)).toBe("ok");
    expect(percentOf(375.5, 500)).toBe(76); // yellow, so it can't read 75%
    expect(tone(375.5, 500)).toBe("warn");
    expect(percentOf(500, 500)).toBe(100);
    expect(percentOf(502, 500)).toBe(101); // red, so it can't read 100%
    expect(tone(502, 500)).toBe("crit");
    expect(percentOf(907.9, 2000)).toBe(45);
    expect(percentOf(5, 0)).toBe(0);
  });
  it("is off limits from 110%", () => {
    expect(isOffLimits(549, 500)).toBe(false);
    expect(isOffLimits(550, 500)).toBe(true);
    expect(isOffLimits(1000, 500)).toBe(true);
    expect(isOffLimits(100, 0)).toBe(false);
  });
});

import { axisCap, typicalDay } from "./../SpendChart";
describe("axisCap", () => {
  it("cuts the axis above the biggest day that doesn't dwarf the rest", () => {
    expect(axisCap([5650, 40, 120, 300, 90])).toBe(300);
    expect(axisCap([5650, 2200, 40, 120, 300, 90])).toBe(300);
  });
  it("leaves an ordinary month alone", () => {
    expect(axisCap([100, 40, 120, 300, 90])).toBeNull();
    expect(axisCap([0, 0])).toBeNull();
  });
});

describe("retired categories", () => {
  it("treats the old Savings transfer category as Transfer", () => {
    expect(canonical("Transfer From Savings to Joint Checking")).toBe("Transfer");
    expect(canonical("Transfer")).toBe("Transfer");
  });
  it("keeps Shopping out of the target lines", () => {
    const lines = targetBreakdown([{ category: "Shopping (retired)", effective_month: "2026-01-01", amount: 100 }], "2026-10-01", new Set());
    expect(lines.lines.map((l: { category: string }) => l.category)).not.toContain("Shopping (retired)");
  });
});

describe("typicalDay", () => {
  it("is the middle of days with spending, ignoring a huge outlier", () => {
    expect(typicalDay([5735, 182, 78, 188, 0, 173])).toBe(182);
    expect(typicalDay([100, 200, 0])).toBe(150);
    expect(typicalDay([0, 0])).toBe(0);
  });
});
