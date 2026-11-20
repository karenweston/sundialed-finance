import { beforeEach, describe, expect, it, vi } from "vitest";

// The demo client reads localStorage when it loads, so give it an in-memory one first.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const { createDemoClient, resetDemoData } = await import("./client");
const db = createDemoClient();

beforeEach(() => resetDemoData());

describe("demo client: queries", () => {
  it("seeds six months of transactions, none in the future", async () => {
    const { data } = (await db.from("transactions").select("*")) as { data: { month: string; posted_on: string }[] };
    expect(new Set(data.map((t) => t.month)).size).toBe(6);
    const today = new Date().toISOString().slice(0, 10);
    expect(data.every((t) => t.posted_on <= today)).toBe(true);
  });

  it("filters, orders and pages like PostgREST", async () => {
    const { data } = (await db.from("transactions").select("id").eq("category", "Groceries").order("posted_on", { ascending: false }).range(0, 2)) as { data: { posted_on: string }[] };
    expect(data).toHaveLength(3);
    expect(data[0].posted_on >= data[1].posted_on).toBe(true);
  });

  it("insert + select + single returns the new row with an id", async () => {
    const { data, error } = (await db.from("vendor_rules").insert({ match_type: "exact", pattern: "x", category: "House" }).select("*").single()) as { data: { id: number; accounts: string[] }; error: unknown };
    expect(error).toBeNull();
    expect(data.id).toBeGreaterThan(3);
    expect(data.accounts).toEqual([]);
  });

  it("upsert with ignoreDuplicates keeps the existing row", async () => {
    await db.from("apple_imports").upsert({ id: "a", amount: 5 }, { onConflict: "id", ignoreDuplicates: true });
    await db.from("apple_imports").upsert({ id: "a", amount: 99 }, { onConflict: "id", ignoreDuplicates: true });
    const { data } = (await db.from("apple_imports").select("*").eq("id", "a").maybeSingle()) as { data: { amount: number } };
    expect(data.amount).toBe(5);
  });

  it("delete removes only matching rows, and unknown tables report a missing table", async () => {
    await db.from("month_notes").delete().eq("id", 1);
    const { data } = (await db.from("month_notes").select("id")) as { data: unknown[] };
    expect(data).toHaveLength(1);
    const bad = (await db.from("nope").select("*")) as { error: { code: string } };
    expect(bad.error.code).toBe("PGRST205");
  });
});

describe("demo client: functions", () => {
  it("update-target starts a new month as a copy of the latest column, then applies the change", async () => {
    const next = "2030-01-01";
    await db.functions.invoke("update-target", { body: { category: "Groceries", month: next, amount: 999 } });
    const { data } = (await db.from("targets").select("*").eq("effective_month", next)) as { data: { category: string; amount: number }[] };
    expect(data.length).toBeGreaterThan(5);
    expect(data.find((t) => t.category === "Groceries")?.amount).toBe(999);
    await db.functions.invoke("update-target", { body: { category: "Pets", month: next, amount: null } });
    const after = (await db.from("targets").select("*").eq("effective_month", next)) as { data: { category: string }[] };
    expect(after.data.some((t) => t.category === "Pets")).toBe(false);
  });

  it("sync-now moves pending Apple Card imports into transactions", async () => {
    await db.from("apple_imports").upsert({ id: "imp1", posted_on: "2026-11-02", summary: "TEST", merchant: "Test Shop", amount: 12.5 }, { onConflict: "id", ignoreDuplicates: true });
    const res = await db.functions.invoke("sync-now");
    expect(res.data).toEqual({ ok: true });
    const { data } = (await db.from("transactions").select("*").eq("id", "imp1").maybeSingle()) as { data: { amount: number; source: string } };
    expect(data.source).toBe("applecard");
    expect(data.amount).toBe(-12.5);
  });
});
