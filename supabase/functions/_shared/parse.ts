// Pure parsing helpers for the "Family Budget 2026" Google Sheet.
// No Deno- or Node-specific APIs here so the same code runs in the edge
// function and in the unit tests.

export type Row = (string | number | null | undefined)[];

export interface AccountRow {
  id: string;
  name: string;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  credit_limit: number | null;
  interest_rate: number | null;
  last_payment_amount: number | null;
  last_payment_date: string | null;
  next_payment_due: string | null;
  last_statement_balance: number | null;
  minimum_payment: number | null;
}

export interface VendorRow {
  merchant_name: string;
  clean_name: string | null;
  category: string | null;
  memo: string | null;
}

export interface TransactionRow {
  id: string;
  source: "transactions" | "applecard";
  account: string | null;
  posted_on: string;
  month: string;
  summary: string | null;
  merchant: string | null;
  clean_merchant: string | null;
  category: string;
  bank_category: string | null;
  amount: number;
  is_pending: boolean;
}

export interface TargetRow {
  category: string;
  effective_month: string;
  amount: number;
}

const text = (v: unknown): string => (v == null ? "" : String(v).trim());

/** "1,509.38", "$12", "(45.10)", "-10.86", "18.99%" -> number; blank/#REF! -> null. */
export function parseMoney(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = text(v);
  if (!s || s.startsWith("#")) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,%\s]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+$|^\d+\.?$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

/** Accepts "2025-12-26 15:08:04", "2026-10-28", "03/30/2026", "3/1/2026". Returns YYYY-MM-DD or null. */
export function parseDate(v: unknown): string | null {
  const s = text(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

export const monthOf = (isoDate: string): string => `${isoDate.slice(0, 7)}-01`;

/**
 * Find the header row: the first row with a cell equal to `first`, in any column
 * (some tabs start in column B). Returns a name->index map and the data rows below it.
 */
export function readTable(
  rows: Row[],
  first: string,
): { headers: Map<string, number>; data: Row[] } {
  const want = first.toLowerCase();
  const idx = rows.findIndex((r) => r.some((c) => text(c).toLowerCase() === want));
  if (idx < 0) throw new Error(`Header row starting with "${first}" not found`);
  const headers = new Map<string, number>();
  rows[idx].forEach((h, i) => {
    const name = text(h).toLowerCase();
    if (name && !headers.has(name)) headers.set(name, i);
  });
  return { headers, data: rows.slice(idx + 1) };
}

const cell = (row: Row, headers: Map<string, number>, name: string): unknown => {
  const i = headers.get(name.toLowerCase());
  return i == null ? undefined : row[i];
};

const orNull = (v: unknown): string | null => text(v) || null;

// ------------------------------------------------------------------ accounts
export function parseAccounts(rows: Row[]): AccountRow[] {
  const { headers, data } = readTable(rows, "ID");
  const out: AccountRow[] = [];
  for (const r of data) {
    const id = text(cell(r, headers, "ID"));
    if (!id || id.startsWith("-")) continue; // blank row or the "---" placeholder
    const name = text(cell(r, headers, "Name"));
    if (!name) continue;
    out.push({
      id,
      name,
      mask: orNull(cell(r, headers, "Mask")),
      type: orNull(cell(r, headers, "Account Type")),
      subtype: orNull(cell(r, headers, "Account Subtype")),
      current_balance: parseMoney(cell(r, headers, "Current Balance")),
      available_balance: parseMoney(cell(r, headers, "Available Balance")),
      credit_limit: parseMoney(cell(r, headers, "Account Limit")),
      interest_rate: parseMoney(cell(r, headers, "Liability Interest Rate")),
      last_payment_amount: parseMoney(cell(r, headers, "Last Payment Amount")),
      last_payment_date: parseDate(cell(r, headers, "Last Payment Date")),
      next_payment_due: parseDate(cell(r, headers, "Next Payment Due Date")),
      last_statement_balance: parseMoney(cell(r, headers, "Last Statement Balance")),
      minimum_payment: parseMoney(cell(r, headers, "Minimum Payment Amount")),
    });
  }
  return out;
}

// -------------------------------------------------------------- vendor mapping
export function parseVendorMap(rows: Row[]): VendorRow[] {
  const { headers, data } = readTable(rows, "Merchant Name");
  const seen = new Set<string>();
  const out: VendorRow[] = [];
  for (const r of data) {
    const merchant_name = text(cell(r, headers, "Merchant Name"));
    if (!merchant_name) continue;
    const key = merchant_name.toLowerCase();
    if (seen.has(key)) continue; // first mapping wins
    seen.add(key);
    out.push({
      merchant_name,
      clean_name: orNull(cell(r, headers, "Clean Merchant Name")),
      category: orNull(cell(r, headers, "Simple")),
      memo: orNull(cell(r, headers, "Memo")),
    });
  }
  return out;
}

export function buildVendorLookup(vendors: VendorRow[]): Map<string, VendorRow> {
  return new Map(vendors.map((v) => [v.merchant_name.toLowerCase(), v]));
}


// ------------------------------------------------------- transfers & card payments
export const TRANSFERS = "Transfers";
export const CARD_PAYMENTS = "Credit Card Payment";

// Money moving between your own accounts or into savings/investments, and paying off a
// card, is not spending. Deliberately narrow: transfers to other people, deposits, cash
// advances and mortgage or car payments are left alone, so they land in the Inbox (or a
// real category) for a person to decide.
const BANK_TRANSFER = /^TRANSFER_(IN|OUT)_(ACCOUNT_TRANSFER|SAVINGS|INVESTMENT_AND_RETIREMENT_FUNDS)$/;
const BANK_CARD_PAYMENT = /^LOAN_PAYMENTS_CREDIT_CARD_PAYMENT$/;
// The pasted Apple Card export has no bank label; its payments from your bank read like this.
const TEXT_TRANSFER = /ach deposit internet transf/i;

export function classifyTransfer(bankCategory: string | null, texts: (string | null)[]): string | null {
  const bank = (bankCategory ?? "").trim().toUpperCase();
  if (BANK_CARD_PAYMENT.test(bank)) return CARD_PAYMENTS;
  if (BANK_TRANSFER.test(bank)) return TRANSFERS;
  if (texts.some((t) => t && TEXT_TRANSFER.test(t))) return TRANSFERS;
  return null;
}

const PAIR_WINDOW_DAYS = 5;
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);

/**
 * Label a transfer or card payment only when BOTH halves are on the Sheet: a row that looks
 * like one, with an equal and opposite row in a different account within a few days.
 * Unpaired rows (a Zelle to a friend, an account not on the Sheet) stay as they were.
 * Rows a Vendor Mapping already categorized are never touched.
 */
export function markTransfers(rows: TransactionRow[]): TransactionRow[] {
  const kind = new Map<number, string>();
  rows.forEach((r, i) => {
    if (r.category !== "Uncategorized") return;
    const k = classifyTransfer(r.bank_category, [r.summary, r.merchant]);
    if (k) kind.set(i, k);
  });
  const cents = (r: TransactionRow) => Math.round(r.amount * 100);
  const used = new Set<number>();
  const out = rows.map((r) => ({ ...r }));
  for (const [i, k] of kind) {
    if (used.has(i)) continue;
    const a = rows[i];
    if (!a.account) continue;
    let best = -1;
    let bestGap = Infinity;
    for (const j of kind.keys()) {
      if (j === i || used.has(j)) continue;
      const b = rows[j];
      if (!b.account || b.account === a.account || cents(b) !== -cents(a)) continue;
      const gap = Math.abs(dayNumber(b.posted_on) - dayNumber(a.posted_on));
      if (gap <= PAIR_WINDOW_DAYS && gap < bestGap) {
        best = j;
        bestGap = gap;
      }
    }
    if (best < 0) continue;
    used.add(i).add(best);
    const label = k === CARD_PAYMENTS || kind.get(best) === CARD_PAYMENTS ? CARD_PAYMENTS : k;
    out[i].category = label;
    out[best].category = label;
  }
  return out;
}

// ---------------------------------------------------------------- transactions
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function categorize(
  lookup: Map<string, VendorRow>,
  candidates: string[],
): { clean: string | null; category: string } {
  for (const c of candidates) {
    const hit = c ? lookup.get(c.toLowerCase()) : undefined;
    if (hit) return { clean: hit.clean_name, category: hit.category ?? "Uncategorized" };
  }
  return { clean: null, category: "Uncategorized" };
}

/** The bank-synced "Transactions" tab. Expenses are already negative here. */
export async function parseTransactions(
  rows: Row[],
  lookup: Map<string, VendorRow>,
): Promise<TransactionRow[]> {
  const { headers, data } = readTable(rows, "ID");
  const out: TransactionRow[] = [];
  for (const r of data) {
    const id = text(cell(r, headers, "ID"));
    if (!id || id.startsWith("-")) continue;
    const posted_on = parseDate(cell(r, headers, "Date"));
    const amount = parseMoney(cell(r, headers, "Amount"));
    if (!posted_on || amount == null) continue;
    const summary = orNull(cell(r, headers, "Summary"));
    const merchant = orNull(cell(r, headers, "Merchant"));
    const original = orNull(cell(r, headers, "Original Description"));
    const bank_category = orNull(cell(r, headers, "Category ID"));
    const { clean, category: mapped } = categorize(lookup, [summary ?? "", merchant ?? "", original ?? ""]);
    const category = mapped;
    out.push({
      id,
      source: "transactions",
      account: orNull(cell(r, headers, "Account")),
      posted_on,
      month: monthOf(posted_on),
      summary,
      merchant,
      clean_merchant: clean ?? merchant,
      category,
      bank_category,
      amount,
      is_pending: text(cell(r, headers, "Is Pending?")).toLowerCase() === "true",
    });
  }
  return out;
}

/** The stable id of an Apple Card transaction: its date, description and amount (Apple's sign), plus which repeat it is. */
export const appleId = async (posted_on: string, summary: string | null, raw: number, n: number): Promise<string> =>
  `apc-${await sha256Hex(`${posted_on}|${summary ?? ""}|${raw}|${n}`)}`;

function appleTxn(
  id: string,
  posted_on: string,
  summary: string | null,
  merchant: string | null,
  raw: number,
  account: string | null,
  pending: boolean,
  lookup: Map<string, VendorRow>,
): TransactionRow {
  const { clean, category } = categorize(lookup, [summary ?? "", merchant ?? ""]);
  return {
    id,
    source: "applecard",
    account: account ?? "Apple Card",
    posted_on,
    month: monthOf(posted_on),
    summary,
    merchant,
    clean_merchant: clean ?? merchant,
    category,
    bank_category: null,
    amount: raw === 0 ? 0 : -raw,
    is_pending: pending,
  };
}

/**
 * The "AppleCard" tab (pasted by hand, or appended by the app's import). Apple's export has
 * purchases POSITIVE and payments NEGATIVE, the opposite of the Transactions tab, so the sign
 * is flipped to keep one convention (expenses negative). Rows have no ID, so one is derived
 * from the row contents plus an occurrence counter for genuine duplicates.
 */
export async function parseAppleCard(
  rows: Row[],
  lookup: Map<string, VendorRow>,
): Promise<TransactionRow[]> {
  const { headers, data } = readTable(rows, "ID");
  const out: TransactionRow[] = [];
  const counts = new Map<string, number>();
  for (const r of data) {
    const posted_on = parseDate(cell(r, headers, "Date"));
    const raw = parseMoney(cell(r, headers, "Amount"));
    if (!posted_on || raw == null) continue;
    const summary = orNull(cell(r, headers, "Summary"));
    const merchant = orNull(cell(r, headers, "Merchant"));
    const key = `${posted_on}|${summary ?? ""}|${raw}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    out.push(
      appleTxn(
        await appleId(posted_on, summary, raw, n),
        posted_on,
        summary,
        merchant,
        raw,
        orNull(cell(r, headers, "Account")),
        text(cell(r, headers, "Is Pending?")).toLowerCase() === "true",
        lookup,
      ),
    );
  }
  return out;
}

/** A row imported in the app (not yet in the Sheet), shaped like a parsed AppleCard row. */
export interface AppleImport {
  id: string;
  posted_on: string;
  summary: string | null;
  merchant: string | null;
  amount: number; // Apple's sign: purchases positive
}

export const importedAppleRows = (imports: AppleImport[], lookup: Map<string, VendorRow>): TransactionRow[] =>
  imports.map((i) => appleTxn(i.id, i.posted_on, i.summary, i.merchant, Number(i.amount), null, false, lookup));

// ---------------------------------------------------------------------- targets
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The "Targets" tab: first row is TARGETS | Jan | Feb | April | ...; each later row
 * is a category followed by the monthly target that takes effect from that column's
 * month and stays in force until the next column.
 */
export function parseTargets(rows: Row[], year: number): TargetRow[] {
  const headerIdx = rows.findIndex((r) => text(r[0]).toLowerCase() === "targets");
  if (headerIdx < 0) throw new Error('Header row "TARGETS" not found');
  const header = rows[headerIdx];
  const columns: { col: number; month: string }[] = [];
  header.forEach((h, col) => {
    if (col === 0) return;
    const m = MONTHS.indexOf(text(h).slice(0, 3).toLowerCase());
    if (m >= 0) columns.push({ col, month: `${year}-${String(m + 1).padStart(2, "0")}-01` });
  });
  const out: TargetRow[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const category = text(r[0]);
    if (!category || /^(grand\s+)?totals?$/i.test(category)) continue;
    for (const { col, month } of columns) {
      const amount = parseMoney(r[col]);
      if (amount != null) out.push({ category, effective_month: month, amount });
    }
  }
  return out;
}

// ------------------------------------------------------------ monthly-tab categories
const MONTH_NAMES = ["january","february","march","april","may","june","july","august","september","october","november","december"];

/** Month tabs are named like "October2026". Other tabs (Avgs2026, Targets, ...) are not. */
export const isMonthTab = (name: string): boolean => {
  const m = /^([A-Za-z]+)(\d{4})$/.exec(name.trim());
  return !!m && MONTH_NAMES.includes(m[1].toLowerCase());
};

const serialToDate = (n: number): string => new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
const overrideKey = (account: unknown, summary: unknown, date: string, amount: number): string =>
  `${text(account)}|${text(summary)}|${date}|${Math.round(amount * 100)}`;

/**
 * Each month tab lists that month's transactions (columns P-S: account, summary, date, amount) with the
 * household's own category typed per row in column E. Returns those categories keyed by transaction,
 * in order, so duplicate-looking rows line up one to one. Read with raw (unformatted) values.
 */
export function parseMonthlyCategories(tabs: Record<string, Row[]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [name, rows] of Object.entries(tabs)) {
    if (!isMonthTab(name)) continue;
    const head = rows.findIndex((r) => text(r[15]) === "Account" && text(r[16]) === "Summary");
    if (head < 0) continue;
    for (const r of rows.slice(head + 1)) {
      const date = typeof r[17] === "number" ? serialToDate(r[17]) : null;
      const amount = typeof r[18] === "number" ? r[18] : null;
      if (!date || amount == null) continue;
      const category = text(r[4]);
      const key = overrideKey(r[15], r[16], date, amount);
      (out.get(key) ?? out.set(key, []).get(key)!).push(category.startsWith("#") ? "" : category);
    }
  }
  return out;
}

/** The household's per-row category from the month tabs wins over the Vendor Mapping. */
export function applyMonthlyCategories(rows: TransactionRow[], cats: Map<string, string[]>): TransactionRow[] {
  const seen = new Map<string, number>();
  return rows.map((t) => {
    if (t.source !== "transactions") return t;
    const key = overrideKey(t.account, t.summary, t.posted_on, t.amount);
    const i = seen.get(key) ?? 0;
    seen.set(key, i + 1);
    const c = cats.get(key)?.[i];
    return c ? { ...t, category: c } : t;
  });
}
