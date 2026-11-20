import { describe, expect, it } from "vitest";
import { localParts, thresholdNotice, weeklyNotice } from "./alerts.ts";
import type { Input } from "./alerts.ts";
import type { Tx } from "./budget.ts";

const tx = (id: string, category: string, amount: number, month = "2026-11-01"): Tx => ({
  id, posted_on: `${month.slice(0, 7)}-05`, month, name: id, summary: null, category, amount, account: "Checking", pending: false,
});
const base = (txs: Tx[], now: string): Input => ({
  txs,
  targets: [
    { category: "Groceries", effective_month: "2026-01-01", amount: 500 },
    { category: "House", effective_month: "2026-01-01", amount: 1000 },
    { category: "Mortgage", effective_month: "2026-01-01", amount: 5650 },
    { category: "Travel", effective_month: "2026-01-01", amount: 500 },
  ],
  rules: [], locks: [], choices: { off: [], on: [] }, hiddenMonths: [], tileCategories: ["Groceries", "House", "Mortgage", "Travel"], now: new Date(now),
});

describe("localParts", () => {
  it("uses New York time, including the Sunday evening cutoff", () => {
    expect(localParts(new Date("2026-11-08T23:30:00Z"))).toMatchObject({ date: "2026-11-08", weekday: 0, hour: 18 }); // EST
    expect(localParts(new Date("2026-11-09T04:30:00Z"))).toMatchObject({ date: "2026-11-08", weekday: 0, hour: 23 });
    expect(localParts(new Date("2026-12-01T04:30:00Z")).month).toBe("2026-11-01");
  });
});

describe("thresholdNotice", () => {
  const now = "2026-11-10T15:00:00Z";
  const key = (c: string, m: string) => `thr:2026-11-01:${c}:${m}`;
  it("announces each category's milestone, in words only", () => {
    const n = thresholdNotice(
      base([tx("a", "Groceries", -600), tx("b", "House", -920), tx("c", "Travel", -400), tx("d", "Mortgage", -2900)], now),
      new Set(),
    )!;
    expect(n.title).toBe("Budget update");
    expect(n.body).toBe("Over target: Groceries. Almost at target: House. Three-quarters of the way: Travel. Halfway: Mortgage. Open the app for details.");
    expect(n.body).not.toMatch(/\$|\d/);
    expect(n.keys).toContain(key("Groceries", "over"));
  });
  it("lists several categories in one headline", () => {
    const n = thresholdNotice(base([tx("a", "House", -920), tx("b", "Travel", -460)], now), new Set())!;
    expect(n.title).toBe("Almost at target: House, Travel");
  });
  it("only announces the highest milestone reached, and marks the lower ones done", () => {
    const n = thresholdNotice(base([tx("a", "House", -800)], now), new Set())!; // 80%
    expect(n.title).toBe("Three-quarters of the way: House");
    expect(n.body).toBe("Open the app for details.");
    expect(n.keys).toEqual([key("House", "50"), key("House", "75")]);
  });
  it("announces the next milestone later, but never repeats one", () => {
    const sent = new Set([key("House", "50"), key("House", "75")]);
    expect(thresholdNotice(base([tx("a", "House", -800)], now), sent)).toBeNull();
    const n = thresholdNotice(base([tx("a", "House", -950)], now), sent)!;
    expect(n.title).toBe("Almost at target: House");
  });
  it("sends the 'over' alert even if lower milestones were already sent", () => {
    const sent = new Set([key("Groceries", "50"), key("Groceries", "75"), key("Groceries", "90")]);
    expect(thresholdNotice(base([tx("a", "Groceries", -600)], now), sent)!.title).toBe("Over target: Groceries");
  });
  it("ignores a category that is exactly at its target, or under halfway", () => {
    expect(thresholdNotice(base([tx("m", "Mortgage", -5650), tx("t", "Travel", -100)], now), new Set())).toBeNull();
  });
  it("is quiet for a locked month and for spending in other months", () => {
    const input = base([tx("a", "Groceries", -600)], now);
    input.locks = [{ month: "2026-11-01", locked_at: "x", snapshot: { summary: { month: "2026-11-01", rows: [], spent: 0, target: 0, daily: [] }, excluded: [], txCategories: { a: "Groceries" } } }];
    expect(thresholdNotice(input, new Set())).toBeNull();
    expect(thresholdNotice(base([tx("o", "Groceries", -900, "2026-10-01")], now), new Set())).toBeNull();
  });
  it("only covers the pinned categories", () => {
    const input = base([tx("a", "Groceries", -600), tx("b", "House", -920)], now);
    input.tileCategories = ["House"];
    expect(thresholdNotice(input, new Set())!.title).toBe("Almost at target: House");
    input.tileCategories = ["Travel"];
    expect(thresholdNotice(input, new Set())).toBeNull();
  });
  it("respects categories switched off", () => {
    const input = base([tx("a", "Groceries", -600)], now);
    input.choices = { off: ["Groceries"], on: [] };
    expect(thresholdNotice(input, new Set())).toBeNull();
  });
});

describe("weeklyNotice", () => {
  const sunday = "2026-11-08T23:30:00Z"; // 6:30pm New York
  it("sends on Sunday evening only, once", () => {
    const input = base([tx("a", "Groceries", -600), tx("u", "Uncategorized", -5), tx("v", "Uncategorized", -7)], sunday);
    const n = weeklyNotice(input, new Set())!;
    expect(n.title).toBe("Weekly check-in");
    expect(n.body).toBe("Over target: Groceries. 2 transactions need a category.");
    expect(weeklyNotice(input, new Set(n.keys))).toBeNull();
    expect(weeklyNotice({ ...input, now: new Date("2026-11-08T20:00:00Z") }, new Set())).toBeNull(); // 3pm
    expect(weeklyNotice({ ...input, now: new Date("2026-11-09T23:30:00Z") }, new Set())).toBeNull(); // Monday
  });
  it("says things are on track when they are", () => {
    expect(weeklyNotice(base([tx("a", "Groceries", -50)], sunday), new Set())!.body).toBe("Your key categories are on track.");
  });
});
