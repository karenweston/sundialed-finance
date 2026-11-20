import { supabase } from "./supabase";
import type { Target, Tx } from "./budget";
import { isMissingTable } from "./rules";
import type { LockSnapshot, MatchType, MonthLock, Rule } from "./rules";

const PAGE = 1000; // PostgREST's default row cap per request

async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

interface TxRow {
  id: string;
  posted_on: string;
  month: string;
  summary: string | null;
  bank_category?: string | null;
  merchant: string | null;
  clean_merchant: string | null;
  category: string;
  amount: number;
  account: string | null;
  is_pending: boolean;
}

export interface Note {
  id: number;
  month: string; // first day of the month, like "2026-11-01"
  body: string;
  author_id: string;
  author_email: string | null;
  created_at: string;
}

export interface BudgetData {
  notes: Note[];
  names: Record<string, string>; // display name by user id, set by each person in Settings
  uid: string | null; // the signed-in user
  txs: Tx[];
  targets: Target[];
  rules: Rule[];
  locks: MonthLock[];
  hiddenMonths: string[];
  excludeChoices: { off: string[]; on: string[] } | null; // null = nothing saved yet
  tileCategories: string[] | null; // null = use the built-in six
  budgetOrder: string[]; // order of the Budget rows that are not pinned to the top
  lastSync: string | null;
  syncStatus: string | null;
}

export async function loadBudgetData(): Promise<BudgetData> {
  const uid = (await supabase.auth.getSession()).data.session?.user.id;
  const baseColumns = "id, posted_on, month, summary, merchant, clean_merchant, category, amount, account, is_pending";
  const [rows, targetRows, runs, ruleRows, lockRows, hiddenRow] = await Promise.all([
    // "bank_category" arrives with a database update; fall back to the old columns until then.
    fetchAll<TxRow>("transactions", `${baseColumns}, bank_category`).catch((e) => {
      if (!isMissingTable(e)) throw e;
      return fetchAll<TxRow>("transactions", baseColumns);
    }),
    supabase.from("targets").select("category, effective_month, amount"),
    supabase.from("sync_runs").select("status, finished_at").order("id", { ascending: false }).limit(1),
    supabase.from("vendor_rules").select("id, match_type, pattern, category, accounts, amount").order("id"),
    supabase.from("month_locks").select("month, locked_at, snapshot"),
    supabase.from("app_settings").select("key, value"),
  ]);
  if (targetRows.error) throw targetRows.error;
  if (runs.error) throw runs.error;
  // Until the latest migration is applied these two tables don't exist; the rest of the
  // app should keep working, and saving says what's missing (see isMissingTable).
  // Before the "accounts" update is applied, fall back to mappings that apply to any account.
  let ruleData = ruleRows.data as Rule[] | null;
  if (ruleRows.error && isMissingTable(ruleRows.error)) {
    // Database updates not applied yet: fall back to what exists (no amount, then no accounts).
    const noAmount = await supabase.from("vendor_rules").select("id, match_type, pattern, category, accounts").order("id");
    if (!noAmount.error) {
      ruleData = noAmount.data as unknown as Rule[];
    } else {
      const old = await supabase.from("vendor_rules").select("id, match_type, pattern, category").order("id");
      if (!old.error) ruleData = (old.data ?? []).map((r) => ({ ...(r as Rule), accounts: [] }));
    }
  } else if (ruleRows.error) {
    throw ruleRows.error;
  }
  if (lockRows.error && !isMissingTable(lockRows.error)) throw lockRows.error;
  if (hiddenRow.error && !isMissingTable(hiddenRow.error)) throw hiddenRow.error;
  const setting = (key: string): unknown => (hiddenRow.data ?? []).find((r) => r.key === key)?.value;
  // Pins and the Budget order belong to each person. Until someone changes theirs, they start from the shared one.
  const mine = (name: string): unknown => (uid ? setting(`${name}:${uid}`) : undefined) ?? setting(name);
  const noteRows = await supabase.from("month_notes").select("id, month, body, author_id, author_email, created_at").order("created_at").order("id");
  if (noteRows.error && !isMissingTable(noteRows.error)) throw noteRows.error;
  const names: Record<string, string> = {};
  for (const r of hiddenRow.data ?? []) {
    if (typeof r.key === "string" && r.key.startsWith("display_name:") && typeof r.value === "string" && r.value.trim()) names[r.key.slice(13)] = r.value.trim();
  }
  const hidden = setting("hidden_months");
  const ex = setting("exclude_choices") as { off?: unknown; on?: unknown } | undefined;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

  return {
    txs: rows.map((r) => ({
      id: r.id,
      posted_on: r.posted_on,
      month: r.month,
      name: r.clean_merchant ?? r.merchant ?? r.summary ?? "(no description)",
      summary: r.summary,
      bankCategory: r.bank_category ?? null,
      category: r.category,
      amount: Number(r.amount),
      account: r.account,
      pending: r.is_pending,
    })),
    targets: (targetRows.data ?? []).map((t) => ({
      category: t.category as string,
      effective_month: t.effective_month as string,
      amount: Number(t.amount),
    })),
    rules: (ruleData ?? []).map((r) => ({ ...r, accounts: r.accounts ?? [], amount: r.amount == null ? null : Number(r.amount) })),
    locks: (lockRows.error ? [] : lockRows.data ?? []) as MonthLock[],
    notes: noteRows.error ? [] : ((noteRows.data ?? []) as Note[]),
    names,
    uid: uid ?? null,
    hiddenMonths: strings(hidden),
    excludeChoices: ex && typeof ex === "object" ? { off: strings(ex.off), on: strings(ex.on) } : null,
    tileCategories: Array.isArray(mine("tile_categories")) ? strings(mine("tile_categories")) : null,
    budgetOrder: strings(mine("budget_order")),
    lastSync: runs.data?.[0]?.finished_at ?? null,
    syncStatus: runs.data?.[0]?.status ?? null,
  };
}

// ------------------------------------------------------------------ writes
// Row-level security allows these only for allowed users, and only on these two tables.

export async function insertRule(
  match_type: MatchType,
  pattern: string,
  category: string,
  accounts: string[] = [],
  amount: number | null = null,
): Promise<Rule> {
  // Leave "accounts" and "amount" out when empty so this also works before those updates are applied.
  const row: Record<string, unknown> = { match_type, pattern, category };
  if (accounts.length) row.accounts = accounts;
  if (amount != null) row.amount = amount;
  const { data, error } = await supabase
    .from("vendor_rules")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  const r = data as Rule;
  return { ...r, accounts: r.accounts ?? [], amount: r.amount == null ? null : Number(r.amount) };
}

export async function updateRule(
  id: number,
  match_type: MatchType,
  pattern: string,
  category: string,
  accounts: string[] = [],
  amount: number | null = null,
): Promise<Rule> {
  const { data, error } = await supabase
    .from("vendor_rules")
    .update({ match_type, pattern, category, accounts, amount })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  const r = data as Rule;
  return { ...r, accounts: r.accounts ?? [], amount: r.amount == null ? null : Number(r.amount) };
}

export async function deleteRule(id: number): Promise<void> {
  const { error } = await supabase.from("vendor_rules").delete().eq("id", id);
  if (error) throw error;
}

export async function insertLock(month: string, snapshot: LockSnapshot): Promise<MonthLock> {
  const { data, error } = await supabase
    .from("month_locks")
    .insert({ month, snapshot })
    .select("month, locked_at, snapshot")
    .single();
  if (error) throw error;
  return data as MonthLock;
}

export async function deleteLock(month: string): Promise<void> {
  const { error } = await supabase.from("month_locks").delete().eq("month", month);
  if (error) throw error;
}

async function saveSetting(key: string, value: unknown): Promise<void> {
  const { error } = await supabase.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export const saveHiddenMonths = (months: string[]) => saveSetting("hidden_months", months);
async function saveMine(name: string, value: unknown): Promise<void> {
  const uid = (await supabase.auth.getSession()).data.session?.user.id;
  if (!uid) throw new Error("Not signed in");
  return saveSetting(`${name}:${uid}`, value);
}
export async function insertNote(month: string, body: string): Promise<Note> {
  const { data, error } = await supabase.from("month_notes").insert({ month, body: body.trim() }).select("id, month, body, author_id, author_email, created_at").single();
  if (error) throw error;
  return data as Note;
}
export async function deleteNote(id: number): Promise<void> {
  const { error } = await supabase.from("month_notes").delete().eq("id", id);
  if (error) throw error;
}
export const saveMyName = (name: string) => saveMine("display_name", name.trim());
export const saveTileCategories = (categories: string[]) => saveMine("tile_categories", categories);
export const saveBudgetOrder = (names: string[]) => saveMine("budget_order", names);
export const saveExcludeChoices = (choices: { off: string[]; on: string[] }) => saveSetting("exclude_choices", choices);

// ------------------------------------------------------------------- targets
/** Changes one target in the Sheet's Targets tab (null = no target). The server checks and writes it. */
export async function saveTarget(category: string, month: string, amount: number | null): Promise<void> {
  const { data, error } = await supabase.functions.invoke("update-target", { body: { category, month, amount } });
  if (error) throw new Error("Couldn't reach the server. Try again.");
  if (!data?.ok) throw new Error(typeof data?.error === "string" ? data.error : "Couldn't update the Sheet.");
}

// ------------------------------------------------------------- Apple Card import
export interface AppleState {
  known: Set<string>; // Apple Card rows already in the budget
  waiting: number; // imported, not yet copied to the Sheet
  note: { ok: boolean; message: string } | null; // result of the last copy to the Sheet
}

export async function loadAppleState(): Promise<AppleState> {
  const known = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id")
      .eq("source", "applecard")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    (data ?? []).forEach((r) => known.add(r.id as string));
    if (!data || data.length < PAGE) break;
  }
  // Rows waiting for the Sheet are not in "transactions" until the next sync, so count them as known too.
  const waiting = await supabase.from("apple_imports").select("id").is("pushed_at", null).limit(5000);
  if (waiting.error) throw waiting.error;
  (waiting.data ?? []).forEach((r) => known.add(r.id as string));
  const note = await supabase.from("app_settings").select("value").eq("key", "applecard_writeback").maybeSingle();
  const v = note.data?.value as { ok?: boolean; message?: string } | undefined;
  return { known, waiting: waiting.data?.length ?? 0, note: v ? { ok: v.ok !== false, message: String(v.message ?? "") } : null };
}

export async function saveAppleImport(rows: { id: string; posted_on: string; summary: string | null; merchant: string | null; amount: number }[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    // Rows already imported are skipped, not overwritten.
    const { error } = await supabase.from("apple_imports").upsert(rows.slice(i, i + 500), { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
  }
}

/** Take back imports the sync hasn't copied to the Sheet yet. */
export async function undoAppleImport(): Promise<void> {
  const { error } = await supabase.from("apple_imports").delete().is("pushed_at", null);
  if (error) throw error;
}
