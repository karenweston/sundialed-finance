import { describe, expect, it } from "vitest";
import { columnLetter, planTargetEdit } from "./targets.ts";

const tab = [
  ["TARGETS", "Jan", "Feb", "April", "May", "October"],
  ["Mortgage", 5550, 5550, 5650, 5650, 5650],
  ["Groceries", 500, 500, 500, 500, 500],
  ["AirBnb", "", "", 2000, 2000, ""],
  ["TOTAL", "=SUM(B2:B3)", "=SUM(C2:C3)", "=SUM(D2:D4)", "=SUM(E2:E4)", "=SUM(F2:F4)"],
  [],
  ["", "", "", "", "16075 is total available"],
];

describe("planTargetEdit", () => {
  it("writes one cell when the month has its own column", () => {
    const p = planTargetEdit(tab, { category: "groceries", month: "2026-10-01", amount: 650 }, 2026);
    expect(p).toEqual({ data: [{ range: "'Targets'!F3", values: [[650]] }], created: false, column: "October" });
  });
  it("clears the cell for 'no target'", () => {
    const p = planTargetEdit(tab, { category: "AirBnb", month: "2026-05-01", amount: null }, 2026);
    expect("data" in p && p.data[0]).toEqual({ range: "'Targets'!E4", values: [[""]] });
  });
  it("starts a new column for a later month, copying the latest column and totalling it", () => {
    const p = planTargetEdit(tab, { category: "Groceries", month: "2026-11-01", amount: 600 }, 2026);
    if ("error" in p) throw new Error(p.error);
    expect(p.created).toBe(true);
    expect(p.data).toEqual([{ range: "'Targets'!G1:G5", values: [["November"], [5650], [600], [""], ["=SUM(G2:G4)"]] }]);
  });
  it("won't add a column in the middle", () => {
    const p = planTargetEdit(tab, { category: "Groceries", month: "2026-03-01", amount: 600 }, 2026);
    expect("error" in p && p.error).toMatch(/March column/);
  });
  it("won't overwrite a formula, or edit a row that isn't there", () => {
    const withFormula = tab.map((r) => [...r]);
    withFormula[2][5] = "=B3*2";
    expect("error" in planTargetEdit(withFormula, { category: "Groceries", month: "2026-10-01", amount: 1 }, 2026)).toBe(true);
    expect("error" in planTargetEdit(tab, { category: "Dining", month: "2026-10-01", amount: 1 }, 2026)).toBe(true);
    expect("error" in planTargetEdit(tab, { category: "TOTAL", month: "2026-10-01", amount: 1 }, 2026)).toBe(true);
  });
  it("refuses a bad amount, another year, or a layout it doesn't know", () => {
    expect("error" in planTargetEdit(tab, { category: "Groceries", month: "2026-10-01", amount: -5 }, 2026)).toBe(true);
    expect("error" in planTargetEdit(tab, { category: "Groceries", month: "2025-10-01", amount: 5 }, 2026)).toBe(true);
    expect("error" in planTargetEdit([["nothing"]], { category: "Groceries", month: "2026-10-01", amount: 5 }, 2026)).toBe(true);
  });
  it("won't start a column if the next one isn't empty", () => {
    const messy = tab.map((r) => [...r]);
    messy[1][6] = "oops";
    expect("error" in planTargetEdit(messy, { category: "Groceries", month: "2026-11-01", amount: 1 }, 2026)).toBe(true);
  });
});

describe("columnLetter", () => {
  it("names columns like a spreadsheet", () => {
    expect([0, 6, 25, 26, 27].map(columnLetter)).toEqual(["A", "G", "Z", "AA", "AB"]);
  });
});
