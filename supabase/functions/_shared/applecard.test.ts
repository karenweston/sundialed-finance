import { describe, expect, it } from "vitest";
import { parseAppleCsv, parseCsv, planAppleCardWrite, plainText, previewImport, importRows } from "./applecard.ts";
import { buildVendorLookup, importedAppleRows, parseAppleCard } from "./parse.ts";

const CSV = [
  "Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By",
  '06/02/2026,06/03/2026,"NIKE.COM AP ONE BOWERMAN DR BEAVERTON 97005 OR USA",Nike.Com Ap,Shopping,Purchase,101.45,Alex',
  '06/02/2026,06/02/2026,DAILY CASH ADJUSTMENT,Daily Cash Adjustment,Rewards,Adjustment,-0.66,Alex',
  '06/04/2026,06/05/2026,"COFFEE, ""THE"" SHOP",Coffee,Food,Purchase,5.00,Alex',
  '06/04/2026,06/05/2026,"COFFEE, ""THE"" SHOP",Coffee,Food,Purchase,5.00,Alex',
  "bad,row,,,,,x,",
].join("\r\n");

const lookup = buildVendorLookup([]);
const header = ["ID", "Account ID", "Account", "Date", "Month", "Summary", "Merchant", "Amount"];

describe("parseCsv", () => {
  it("handles quotes, commas inside fields, doubled quotes and CRLF", () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n1,2,3\n')).toEqual([["a", "b,c", 'd "e"'], ["1", "2", "3"]]);
  });
});

describe("parseAppleCsv", () => {
  it("reads Apple's columns and skips unreadable rows", () => {
    const { lines, skipped } = parseAppleCsv(CSV);
    expect(lines).toHaveLength(4);
    expect(skipped).toBe(1);
    expect(lines[0]).toMatchObject({ transactionDate: "2026-06-02", clearingDate: "2026-06-03", amount: 101.45, merchant: "Nike.Com Ap" });
    expect(lines[2].summary).toBe('COFFEE, "THE" SHOP');
  });
  it("rejects a file that isn't an Apple Card export", () => {
    expect(() => parseAppleCsv("Date,Name,Total\n1/1/2026,x,5")).toThrow(/Apple Card/);
  });
});

describe("import ids", () => {
  it("match the ids the sync gives the same rows once they are in the AppleCard tab", async () => {
    const { lines } = parseAppleCsv(CSV);
    const rows = await importRows(lines, "transaction");
    const tab = [
      header,
      ...rows.map((r) => ["", "APC", "Apple Card", r.posted_on, "", r.summary, r.merchant, r.amount]),
    ];
    const fromSheet = await parseAppleCard(tab, lookup);
    expect(fromSheet.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(new Set(rows.map((r) => r.id)).size).toBe(4); // the repeated coffee gets two ids
  });

  it("an imported row shows as spending (sign flipped) and as Alex Fun via the account default", async () => {
    const rows = await importRows(parseAppleCsv(CSV).lines, "transaction");
    const tx = importedAppleRows(rows.slice(0, 1), lookup)[0];
    expect(tx.amount).toBe(-101.45);
    expect(tx.account).toBe("Apple Card");
    expect(tx.source).toBe("applecard");
  });
});

describe("previewImport", () => {
  it("counts rows already known and picks the clearing date when that is what matches", async () => {
    const { lines } = parseAppleCsv(CSV);
    const byClearing = await importRows(lines, "clearing");
    const known = new Set(byClearing.slice(0, 3).map((r) => r.id));
    const p = await previewImport(lines, known);
    expect(p.dateUsed).toBe("clearing");
    expect(p.existing).toBe(3);
    expect(p.fresh).toHaveLength(1);
  });
  it("uses the transaction date when nothing overlaps", async () => {
    const p = await previewImport(parseAppleCsv(CSV).lines, new Set());
    expect(p.dateUsed).toBe("transaction");
    expect(p.fresh).toHaveLength(4);
  });
});

describe("planAppleCardWrite", () => {
  const tab = [
    header,
    ["---", null, null, null, "", null, null, null],
    ["", "APC", "Apple Card", "03/30/2026", "3/1/2026", "X", "x", 5],
    ["", "APC", "Apple Card", "03/31/2026", "3/1/2026", "Y", "y", 6],
    ["", "", "", "", "", "", "", ""],
  ];
  const pending = [
    { id: "apc-" + "a".repeat(32), posted_on: "2026-06-02", summary: "=HYPERLINK(1)", merchant: "Shop", amount: 12.5 },
    { id: "apc-" + "b".repeat(32), posted_on: "2026-06-03", summary: "Normal", merchant: null, amount: -3 },
  ];
  it("writes below the last dated row, never touching the formula column E", () => {
    const plan = planAppleCardWrite(tab, pending);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.startRow).toBe(5);
    expect(plan.ranges.map((r) => r.range)).toEqual(["'AppleCard'!B5:D6", "'AppleCard'!F5:H6"]);
    expect(plan.ranges[0].values[0]).toEqual(["APC", "Apple Card", "2026-06-02"]);
    expect(plan.ranges[1].values[0]).toEqual(["'=HYPERLINK(1)", "Shop", 12.5]);
  });
  it("keeps text that looks like a formula as plain text", () => {
    expect(plainText("+1 555")).toBe("'+1 555");
    expect(plainText("Normal")).toBe("Normal");
  });
  it("refuses when something sits below the last transaction", () => {
    const messy = [...tab, ["", "", "", "", "", "note", "", ""]];
    expect("error" in planAppleCardWrite(messy, pending)).toBe(true);
  });
  it("refuses when columns have moved", () => {
    const moved = [["ID", "Account ID", "Date", "Account", "Month", "Summary", "Merchant", "Amount"], ...tab.slice(1)];
    expect("error" in planAppleCardWrite(moved, pending)).toBe(true);
  });
  it("does nothing when nothing is waiting", () => {
    expect(planAppleCardWrite(tab, [])).toMatchObject({ count: 0 });
  });
});
