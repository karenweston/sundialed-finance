// Apple Card CSV import and the plan for appending imported rows to the Sheet's AppleCard tab.
// Pure functions only (no Deno/Node APIs) so the app, the edge function and the tests share them.

import { appleId, parseDate, parseMoney } from "./parse.ts";
import type { AppleImport, Row } from "./parse.ts";

export const MAX_CSV_BYTES = 2_000_000;
export const MAX_CSV_ROWS = 5000;

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF/LF, optional BOM. */
export function parseCsv(input: string): string[][] {
  const s = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export interface CsvLine {
  transactionDate: string; // YYYY-MM-DD
  clearingDate: string | null;
  summary: string | null; // Apple's "Description"
  merchant: string | null;
  amount: number; // Apple's sign: purchases positive, payments negative
}

export interface ParsedCsv {
  lines: CsvLine[];
  skipped: number;
}

const clean = (v: string | undefined): string | null => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t || null;
};

/** Reads Apple's "Transaction Date, Clearing Date, Description, Merchant, Category, Type, Amount (USD), Purchased By" export. */
export function parseAppleCsv(input: string): ParsedCsv {
  const table = parseCsv(input);
  if (table.length > MAX_CSV_ROWS + 1) throw new Error("This file has too many rows to be an Apple Card export.");
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.startsWith(`${n} (`)));
  const iDate = col("transaction date");
  const iClear = col("clearing date");
  const iDesc = col("description");
  const iMerch = col("merchant");
  const iAmt = col("amount");
  if (iDate < 0 || iDesc < 0 || iAmt < 0) {
    throw new Error("This doesn't look like an Apple Card export. Expected columns: Transaction Date, Description, Amount.");
  }
  const lines: CsvLine[] = [];
  let skipped = 0;
  for (const r of table.slice(1)) {
    const transactionDate = parseDate(r[iDate]);
    const amount = parseMoney(r[iAmt]);
    if (!transactionDate || amount == null || Math.abs(amount) >= 1e7) {
      skipped++;
      continue;
    }
    lines.push({
      transactionDate,
      clearingDate: iClear >= 0 ? parseDate(r[iClear]) : null,
      summary: clean(r[iDesc]),
      merchant: iMerch >= 0 ? clean(r[iMerch]) : null,
      amount,
    });
  }
  return { lines, skipped };
}

/**
 * Give every line its stable id, the same one the sync derives for that row once it is in the
 * AppleCard tab. `which` picks the date used. Repeated identical lines get 1, 2, 3...
 */
export async function importRows(lines: CsvLine[], which: "transaction" | "clearing"): Promise<AppleImport[]> {
  const seen = new Map<string, number>();
  const out: AppleImport[] = [];
  for (const l of lines) {
    const posted_on = which === "clearing" ? l.clearingDate ?? l.transactionDate : l.transactionDate;
    const key = `${posted_on}|${l.summary ?? ""}|${l.amount}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    out.push({ id: await appleId(posted_on, l.summary, l.amount, n), posted_on, summary: l.summary, merchant: l.merchant, amount: l.amount });
  }
  return out;
}

export interface CsvPreview {
  rows: AppleImport[];
  fresh: AppleImport[]; // not in the budget yet
  existing: number; // already there
  dateUsed: "transaction" | "clearing";
}

/**
 * Apple's two date columns can differ by a few days and the Sheet may have been pasted with
 * either. Use whichever date matches more of what is already known, so an overlapping file
 * is recognised instead of counted twice. With no overlap, the transaction date is used.
 */
export async function previewImport(lines: CsvLine[], knownIds: Set<string>): Promise<CsvPreview> {
  const t = await importRows(lines, "transaction");
  const c = lines.some((l) => l.clearingDate) ? await importRows(lines, "clearing") : t;
  const hits = (rows: AppleImport[]) => rows.reduce((n, r) => n + (knownIds.has(r.id) ? 1 : 0), 0);
  const useClearing = hits(c) > hits(t);
  const rows = useClearing ? c : t;
  return {
    rows,
    fresh: rows.filter((r) => !knownIds.has(r.id)),
    existing: rows.filter((r) => knownIds.has(r.id)).length,
    dateUsed: useClearing ? "clearing" : "transaction",
  };
}

// ------------------------------------------------------------ write to the Sheet

/** Text typed into a Sheet could run as a formula (=, +, -, @). A leading apostrophe keeps it plain text. */
export const plainText = (v: string | null): string => {
  const s = v ?? "";
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

export interface WritePlan {
  startRow: number;
  ranges: { range: string; values: (string | number)[][] }[];
  count: number;
}

const filled = (v: unknown) => v != null && String(v).trim() !== "";

/**
 * Where and what to write so the imported rows land under the last row of the AppleCard tab.
 * Writes only columns B-D and F-H (Account ID, Account, Date, Summary, Merchant, Amount);
 * column E is a formula that fills itself in. Refuses if anything is below the last dated row.
 */
export function planAppleCardWrite(tab: Row[], pending: AppleImport[], tabName = "AppleCard"): WritePlan | { error: string } {
  if (!pending.length) return { startRow: 0, ranges: [], count: 0 };
  const header = tab.findIndex((r) => r.some((c) => String(c ?? "").trim().toLowerCase() === "id"));
  if (header < 0) return { error: "AppleCard tab: header row not found" };
  const cols = new Map<string, number>();
  tab[header].forEach((h, i) => {
    const k = String(h ?? "").trim().toLowerCase();
    if (k && !cols.has(k)) cols.set(k, i);
  });
  const need = ["account id", "account", "date", "summary", "merchant", "amount"];
  if (need.some((k) => !cols.has(k))) return { error: "AppleCard tab: expected columns not found" };
  const idx = (k: string) => cols.get(k)!;
  // The block is written in two contiguous runs, so the columns must sit where they do today.
  const same = [idx("account id"), idx("account"), idx("date")];
  const rest = [idx("summary"), idx("merchant"), idx("amount")];
  const run = (a: number[]) => a.every((v, i) => v === a[0] + i);
  if (!run(same) || !run(rest) || idx("date") + 2 !== idx("summary")) {
    return { error: "AppleCard tab: columns have moved; not writing" };
  }

  let last = header;
  tab.forEach((r, i) => {
    if (i > header && filled(r[idx("date")])) last = i;
  });
  const startRow = last + 2; // 0-based index -> 1-based row, then the next row
  // Everything below the last dated row must be empty, apart from the formula column.
  for (let i = last + 1; i < tab.length; i++) {
    if (tab[i].some((c, j) => j !== idx("date") + 1 && filled(c))) {
      return { error: "AppleCard tab: rows below the last transaction aren't empty; not writing" };
    }
  }
  const letter = (i: number) => String.fromCharCode(65 + i); // tab is far narrower than 26 columns
  const endRow = startRow + pending.length - 1;
  const quoted = `'${tabName.replace(/'/g, "''")}'`;
  const a = pending.map((p) => ["APC", "Apple Card", p.posted_on]);
  const b = pending.map((p) => [plainText(p.summary), plainText(p.merchant), p.amount]);
  return {
    startRow,
    count: pending.length,
    ranges: [
      { range: `${quoted}!${letter(same[0])}${startRow}:${letter(same[2])}${endRow}`, values: a },
      { range: `${quoted}!${letter(rest[0])}${startRow}:${letter(rest[2])}${endRow}`, values: b },
    ],
  };
}
