// Plans an edit to the Sheet's "Targets" tab. Pure: given the tab as it is now (formulas shown as
// text, so nothing is overwritten by mistake), says exactly which cells to write, or why it won't.
//
// The tab is: TARGETS | Jan | Feb | April | ...   one column per month a target changes, then one row per
// category and a TOTAL row. A column holds the targets that start that month and stay until the next column.

import type { Row } from "./parse.ts";

export interface TargetEdit {
  category: string; // the row's name in the Sheet
  month: string; // YYYY-MM-01: the month being viewed
  amount: number | null; // null = no target (clears the cell)
}

export type TargetPlan =
  | { data: { range: string; values: (string | number)[][] }[]; created: boolean; column: string }
  | { error: string };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const TOTAL = /^(grand\s+)?totals?$/i;

const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const isBlank = (v: unknown): boolean => str(v) === "";
const isFormula = (v: unknown): boolean => typeof v === "string" && v.trim().startsWith("=");

export function columnLetter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function planTargetEdit(tab: Row[], edit: TargetEdit, year: number, tabName = "Targets"): TargetPlan {
  if (edit.amount != null && (!Number.isFinite(edit.amount) || edit.amount < 0 || edit.amount >= 1e7)) return { error: "That amount isn't valid." };
  const amount = edit.amount == null ? null : Math.round(edit.amount * 100) / 100;
  if (!/^\d{4}-\d{2}-01$/.test(edit.month) || Number(edit.month.slice(0, 4)) !== year) {
    return { error: `Targets are kept for ${year} only.` };
  }
  const monthIdx = Number(edit.month.slice(5, 7)) - 1;

  const head = tab.findIndex((r) => str(r[0]).toLowerCase() === "targets");
  if (head < 0) return { error: "The Targets tab doesn't look as expected, so nothing was changed." };
  const columns: { col: number; month: number }[] = [];
  tab[head].forEach((h, col) => {
    const m = MONTHS.indexOf(str(h).slice(0, 3).toLowerCase());
    if (col > 0 && m >= 0) columns.push({ col, month: m });
  });
  if (!columns.length) return { error: "The Targets tab has no month columns, so nothing was changed." };

  let totalRow = -1;
  for (let i = head + 1; i < tab.length; i++) if (TOTAL.test(str(tab[i][0]))) { totalRow = i; break; }
  const lastCat = totalRow >= 0 ? totalRow - 1 : tab.reduce((n, r, i) => (i > head && !isBlank(r[0]) ? i : n), head);

  const want = edit.category.trim().toLowerCase();
  const rows: number[] = [];
  for (let i = head + 1; i <= lastCat; i++) if (str(tab[i][0]).toLowerCase() === want) rows.push(i);
  if (rows.length === 0) return { error: `“${edit.category}” isn't a row in your Targets tab. Add the row in the Sheet first.` };
  if (rows.length > 1) return { error: `“${edit.category}” appears more than once in your Targets tab.` };
  const row = rows[0];
  const quoted = `'${tabName.replace(/'/g, "''")}'`;

  const own = columns.find((c) => c.month === monthIdx);
  if (own) {
    if (isFormula(tab[row][own.col])) return { error: "That cell holds a formula, so it was left alone." };
    return {
      data: [{ range: `${quoted}!${columnLetter(own.col)}${row + 1}`, values: [[amount ?? ""]] }],
      created: false,
      column: str(tab[head][own.col]),
    };
  }

  // No column for this month yet. Start one just after the last, copying what is in force now.
  const latest = columns.reduce((a, c) => (c.month > a.month ? c : a));
  if (monthIdx < latest.month) {
    return { error: `The Targets tab has no ${FULL[monthIdx]} column, and adding one in the middle has to be done in the Sheet.` };
  }
  const col = Math.max(...columns.map((c) => c.col)) + 1;
  const bottom = totalRow >= 0 ? totalRow : lastCat;
  for (let i = head; i <= bottom; i++) {
    if (!isBlank(tab[i]?.[col])) return { error: "The column next to your last month isn't empty, so nothing was added." };
  }
  const L = columnLetter(col);
  const values: (string | number)[][] = [[FULL[monthIdx]]];
  for (let i = head + 1; i <= lastCat; i++) {
    const cur = tab[i]?.[latest.col];
    if (isFormula(cur)) return { error: "A target in your latest column is a formula, so a new column can't be copied from it." };
    if (i === row) values.push([amount ?? ""]);
    else values.push([typeof cur === "number" ? cur : isBlank(cur) ? "" : Number.isFinite(Number(cur)) ? Number(cur) : ""]);
  }
  if (totalRow >= 0) values.push([`=SUM(${L}${head + 2}:${L}${lastCat + 1})`]);
  return {
    data: [{ range: `${quoted}!${L}${head + 1}:${L}${head + values.length}`, values }],
    created: true,
    column: FULL[monthIdx],
  };
}
