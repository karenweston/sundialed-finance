// A small in-browser stand-in for the Supabase client, used when VITE_DEMO=true.
// It implements only what the app calls: auth, a chainable table query builder, and two edge
// functions. Data lives in localStorage, seeded from ./seed.ts. Nothing leaves the browser.
import { buildSeed, DEMO_USER } from "./seed";
import type { Row, Tables } from "./seed";

const KEY = "sundialed-demo:v1";
const SIGNED_OUT = "sundialed-demo:signed-out";

// Primary key per table, used for upserts that don't name a conflict column.
const PK: Record<string, string> = {
  transactions: "id", targets: "category", sync_runs: "id", vendor_rules: "id", month_locks: "month",
  app_settings: "key", month_notes: "id", apple_imports: "id", push_subscriptions: "endpoint",
};
const AUTO_ID = new Set(["vendor_rules", "month_notes", "sync_runs"]);

let tables: Tables = load();

function load(): Tables {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const t = JSON.parse(raw) as Tables;
      if (t && t.transactions) return t;
    }
  } catch { /* fall through to a fresh seed */ }
  const t = buildSeed();
  persist(t);
  return t;
}
function persist(t: Tables = tables) {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* storage full or blocked: demo still works for this session */ }
}
export function resetDemoData() {
  tables = buildSeed();
  persist();
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const nextId = (table: string) => tables[table].reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;

interface Result { data: unknown; error: { code?: string; message: string } | null }
type Op = "select" | "insert" | "update" | "upsert" | "delete";

class Query implements PromiseLike<Result> {
  private op: Op = "select";
  private filters: ((r: Row) => boolean)[] = [];
  private sorts: { col: string; asc: boolean }[] = [];
  private from = 0;
  private to = Infinity;
  private cap = Infinity;
  private payload: Row | Row[] = {};
  private opts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private returning = false;
  private shape: "many" | "single" | "maybe" = "many";

  constructor(private table: string) {}

  select(_columns?: string) { if (this.op !== "select") this.returning = true; return this; }
  insert(row: Row | Row[]) { this.op = "insert"; this.payload = row; return this; }
  update(values: Row) { this.op = "update"; this.payload = values; return this; }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { this.op = "upsert"; this.payload = rows; this.opts = opts; return this; }
  delete() { this.op = "delete"; return this; }
  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  is(col: string, val: unknown) { this.filters.push((r) => (r[col] ?? null) === val); return this; }
  order(col: string, o: { ascending?: boolean } = {}) { this.sorts.push({ col, asc: o.ascending !== false }); return this; }
  range(a: number, b: number) { this.from = a; this.to = b; return this; }
  limit(n: number) { this.cap = n; return this; }
  single() { this.shape = "single"; return this; }
  maybeSingle() { this.shape = "maybe"; return this; }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, bad);
  }

  private fail(code: string, message: string): Result { return { data: null, error: { code, message } }; }

  private run(): Result {
    const rows = tables[this.table];
    if (!rows) return this.fail("PGRST205", `Could not find the table '${this.table}'`);
    const matches = (r: Row) => this.filters.every((f) => f(r));
    let out: Row[] = [];

    if (this.op === "select") {
      out = rows.filter(matches);
    } else if (this.op === "insert") {
      for (const p of ([] as Row[]).concat(this.payload)) {
        const row = { ...p };
        if (AUTO_ID.has(this.table) && row.id == null) row.id = nextId(this.table);
        if (this.table === "vendor_rules") { row.accounts ??= []; row.amount ??= null; }
        if (this.table === "month_notes") Object.assign(row, { author_id: DEMO_USER.id, author_email: DEMO_USER.email, created_at: new Date().toISOString() });
        if (this.table === "month_locks") row.locked_at = new Date().toISOString();
        rows.push(row);
        out.push(row);
      }
    } else if (this.op === "update") {
      for (const r of rows) if (matches(r)) { Object.assign(r, this.payload); out.push(r); }
    } else if (this.op === "upsert") {
      const key = this.opts.onConflict ?? PK[this.table];
      for (const p of ([] as Row[]).concat(this.payload)) {
        const hit = rows.find((r) => r[key] === p[key]);
        if (hit) { if (!this.opts.ignoreDuplicates) Object.assign(hit, p); if (!this.opts.ignoreDuplicates) out.push(hit); }
        else {
          const row = { ...p };
          if (this.table === "apple_imports") row.pushed_at ??= null;
          rows.push(row);
          out.push(row);
        }
      }
    } else if (this.op === "delete") {
      tables[this.table] = rows.filter((r) => { const hit = matches(r); if (hit) out.push(r); return !hit; });
    }

    if (this.op !== "select") persist();
    // Writes only hand rows back when .select() was chained on, like the real client.
    if (this.op !== "select" && !this.returning) return { data: null, error: null };

    for (const s of [...this.sorts].reverse()) {
      out = [...out].sort((a, b) => {
        const x = a[s.col], y = b[s.col];
        const c = x == null ? (y == null ? 0 : -1) : y == null ? 1 : x < y ? -1 : x > y ? 1 : 0;
        return s.asc ? c : -c;
      });
    }
    if (this.op === "select") out = out.slice(this.from, Number.isFinite(this.to) ? this.to + 1 : undefined).slice(0, this.cap);
    out = clone(out);

    if (this.shape === "single") return out.length === 1 ? { data: out[0], error: null } : this.fail("PGRST116", "Expected one row");
    if (this.shape === "maybe") return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
}

// ----------------------------------------------------------------------------- auth
type Session = { user: { id: string; email: string } } | null;
const listeners = new Set<(event: string, s: Session) => void>();
let session: Session = localStorage.getItem(SIGNED_OUT) ? null : { user: DEMO_USER };
const setSession = (s: Session, event: string) => { session = s; listeners.forEach((fn) => fn(event, s)); };

const auth = {
  async getSession() { return { data: { session }, error: null }; },
  onAuthStateChange(fn: (event: string, s: Session) => void) {
    listeners.add(fn);
    return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } };
  },
  // Demo: any email and password works.
  async signInWithPassword(_creds: { email: string; password: string }) {
    localStorage.removeItem(SIGNED_OUT);
    setSession({ user: DEMO_USER }, "SIGNED_IN");
    return { data: { session }, error: null };
  },
  async signOut() {
    localStorage.setItem(SIGNED_OUT, "1");
    setSession(null, "SIGNED_OUT");
    return { error: null };
  },
};

// ------------------------------------------------------------------ edge functions
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stands in for the sync function: copies imported Apple Card rows into transactions. */
function runSync() {
  const run = nextId("sync_runs");
  tables.sync_runs.push({ id: run, status: "ok", finished_at: new Date().toISOString() });
  let copied = 0;
  for (const imp of tables.apple_imports) {
    if (imp.pushed_at) continue;
    tables.transactions.push({
      id: imp.id, source: "applecard", account: "Apple Card", posted_on: imp.posted_on, month: `${String(imp.posted_on).slice(0, 7)}-01`,
      summary: imp.summary, merchant: imp.merchant, clean_merchant: imp.merchant, category: "Uncategorized",
      amount: -Number(imp.amount), is_pending: false, last_seen_run: run,
    });
    imp.pushed_at = new Date().toISOString();
    copied++;
  }
  if (copied) {
    const note = { ok: true, message: `Copied ${copied} row${copied === 1 ? "" : "s"} to the sheet (demo: no real sheet involved).` };
    const hit = tables.app_settings.find((r) => r.key === "applecard_writeback");
    if (hit) hit.value = note; else tables.app_settings.push({ key: "applecard_writeback", value: note, updated_at: new Date().toISOString() });
  }
  persist();
}

/** Stands in for update-target. A month with no column yet starts as a copy of the latest earlier one. */
function updateTarget({ category, month, amount }: { category: string; month: string; amount: number | null }) {
  const t = tables.targets;
  if (!t.some((r) => r.effective_month === month)) {
    const earlier = t.map((r) => r.effective_month).filter((m) => m <= month).sort().pop();
    if (earlier) for (const r of t.filter((x) => x.effective_month === earlier)) t.push({ ...r, effective_month: month });
  }
  tables.targets = tables.targets.filter((r) => !(r.category === category && r.effective_month === month));
  if (amount !== null) tables.targets.push({ category, effective_month: month, amount });
  persist();
}

const functions = {
  async invoke(name: string, opts: { body?: Record<string, unknown> } = {}) {
    await sleep(name === "sync-now" ? 700 : 250);
    if (name === "sync-now") { runSync(); return { data: { ok: true }, error: null }; }
    if (name === "update-target") {
      updateTarget(opts.body as { category: string; month: string; amount: number | null });
      return { data: { ok: true }, error: null };
    }
    return { data: null, error: new Error(`Unknown function ${name}`) };
  },
};

export function createDemoClient() {
  return { auth, functions, from: (table: string) => new Query(table) };
}
