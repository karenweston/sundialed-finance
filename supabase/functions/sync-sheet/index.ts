// Reads the household budget Google Sheet (read-only) and mirrors it into Postgres.
// Invoked on a schedule (see README) or manually. Never called from the browser.
//
// Required secrets (set with `supabase secrets set`, never committed):
//   GOOGLE_SERVICE_ACCOUNT_JSON  service-account key file contents
//   SHEET_ID                     the Google Sheet's ID
//   SYNC_SECRET                  long random string the caller must send as a Bearer token
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  (optional) phone notification keys
// Provided automatically by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendNotifications, sendTestNotification } from "./notify.ts";
import { isLevel, milestoneTitle } from "../_shared/alerts.ts";
import { getAccessToken, listTabNames, readTabs, readTabsRaw, WRITE_SCOPE, writeRanges } from "../_shared/google.ts";
import { planAppleCardWrite } from "../_shared/applecard.ts";
import {
  applyMonthlyCategories,
  buildVendorLookup,
  importedAppleRows,
  isMonthTab,
  parseMonthlyCategories,
  parseAccounts,
  parseAppleCard,
  parseTargets,
  markTransfers,
  parseTransactions,
  parseVendorMap,
} from "../_shared/parse.ts";

const TARGETS_YEAR = Number(Deno.env.get("TARGETS_YEAR") ?? new Date().getFullYear());

interface Pending {
  id: string;
  posted_on: string;
  summary: string | null;
  merchant: string | null;
  amount: number;
}

/**
 * Marks imports already found in the Sheet as done, then appends the rest to the AppleCard tab.
 * The result is recorded in app_settings so the app can say what is waiting and why.
 */
async function pushAppleCard(
  db: SupabaseClient,
  sheetId: string,
  keyJson: string,
  tab: (string | number | null)[][],
  alreadyThere: Pending[],
  waiting: Pending[],
): Promise<{ pushed: number; error?: string }> {
  const now = new Date().toISOString();
  const done = async (ids: string[]) => {
    for (let i = 0; i < ids.length; i += 200) {
      await db.from("apple_imports").update({ pushed_at: now }).in("id", ids.slice(i, i + 200));
    }
  };
  const note = (value: Record<string, unknown>) =>
    db.from("app_settings").upsert({ key: "applecard_writeback", value: { ...value, at: now }, updated_at: now });
  try {
    await done(alreadyThere.map((r) => r.id));
    if (!waiting.length) {
      await note({ ok: true, message: "" });
      return { pushed: 0 };
    }
    const plan = planAppleCardWrite(tab, waiting);
    if ("error" in plan) throw new Error(plan.error);
    const writeToken = await getAccessToken(keyJson, WRITE_SCOPE);
    await writeRanges(writeToken, sheetId, plan.ranges);
    await done(waiting.map((r) => r.id));
    await note({ ok: true, message: "" });
    return { pushed: plan.count };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("apple card write-back failed:", message);
    // Only a short, fixed hint reaches the app; the detail stays in the function logs.
    const hint = /PERMISSION_DENIED|\(403\)/.test(message)
      ? "The Sheet isn't shared with edit access yet."
      : "Couldn't add them to the Sheet yet.";
    await note({ ok: false, message: hint }).catch(() => {});
    return { pushed: 0, error: hint };
  }
}

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("SYNC_SECRET") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !safeEqual(bearer, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // `?test=push` just sends a test notification to every subscribed phone; no sync.
  // Add `&category=Food and Drink&level=50` (level: 50, 75, 90 or over) to preview that exact alert.
  // It sends the same wording but records nothing, so the real alert still goes out later.
  const q = new URL(req.url).searchParams;
  if (q.get("test") === "push") {
    const category = (q.get("category") ?? "").slice(0, 60);
    const level = q.get("level") ?? "";
    const preview = category && isLevel(level);
    return Response.json(
      await sendTestNotification(db, preview ? milestoneTitle(level, [category]) : undefined, preview ? "Open the app for details." : undefined),
    );
  }

  const { data: run, error: runErr } = await db.from("sync_runs").insert({}).select("id").single();
  if (runErr || !run) {
    // Visible in Edge Functions > Logs; never echoed to the caller.
    console.error("could not start sync run:", runErr?.code, runErr?.message);
    return new Response("Could not start sync run", { status: 500 });
  }
  const runId = run.id as number;

  try {
    const sheetId = Deno.env.get("SHEET_ID");
    const keyJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!sheetId || !keyJson) throw new Error("Missing SHEET_ID or GOOGLE_SERVICE_ACCOUNT_JSON");

    const token = await getAccessToken(keyJson);
    const tabs = await readTabs(token, sheetId, [
      "Transactions",
      "AppleCard",
      "Accounts",
      "Vendor Mapping",
      "Targets",
    ]);

    const vendors = parseVendorMap(tabs["Vendor Mapping"]);
    const lookup = buildVendorLookup(vendors);
    // The household types a category per row in each month tab; those win over the Vendor Mapping.
    const monthTabs = (await listTabNames(token, sheetId)).filter(isMonthTab);
    const monthly = parseMonthlyCategories(await readTabsRaw(token, sheetId, monthTabs));
    // Apple Card rows imported in the app. Once a row is in the Sheet's AppleCard tab it is read
    // from there like any other; until then it is shown from the import so nothing is missing.
    const sheetApple = await parseAppleCard(tabs["AppleCard"], lookup);
    const inSheet = new Set(sheetApple.map((r) => r.id));
    const { data: imported, error: impErr } = await db
      .from("apple_imports")
      .select("id, posted_on, summary, merchant, amount")
      .is("pushed_at", null)
      .order("posted_on")
      .order("id");
    // Until the database update that adds this table is applied, the sync carries on without it.
    const imports = impErr ? [] : imported ?? [];
    if (impErr) console.error("apple_imports unavailable:", impErr.code, impErr.message);
    const alreadyThere = imports.filter((i) => inSheet.has(i.id));
    const waiting = imports.filter((i) => !inSheet.has(i.id));
    const transactions = applyMonthlyCategories(
      markTransfers([
        ...(await parseTransactions(tabs["Transactions"], lookup)),
        ...sheetApple,
        ...importedAppleRows(waiting, lookup),
      ]),
      monthly,
    );
    const accounts = parseAccounts(tabs["Accounts"]);
    const targets = parseTargets(tabs["Targets"], TARGETS_YEAR);

    const plan: [string, string, Record<string, unknown>[]][] = [
      ["vendor_map", "merchant_name", vendors],
      ["accounts", "id", accounts],
      ["transactions", "id", transactions],
      ["targets", "category,effective_month", targets],
    ];

    const counts: Record<string, number> = {};
    for (const [table, conflict, rows] of plan) {
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, last_seen_run: runId }));
        const { error } = await db.from(table).upsert(chunk, { onConflict: conflict });
        if (error) throw new Error(`${table}: ${error.message}`);
      }
      // Rows that vanished from the Sheet are removed, but never wipe a table
      // just because a read came back empty.
      if (rows.length > 0) {
        const { error } = await db.from(table).delete().neq("last_seen_run", runId);
        if (error) throw new Error(`${table} cleanup: ${error.message}`);
      }
      counts[table] = rows.length;
    }

    // Add the waiting Apple Card rows to the Sheet. This must never make a good sync look failed.
    const writeback = await pushAppleCard(db, sheetId, keyJson, tabs["AppleCard"], alreadyThere, waiting);
    counts.apple_pushed = writeback.pushed;

    await db
      .from("sync_runs")
      .update({ status: "ok", finished_at: new Date().toISOString(), counts })
      .eq("id", runId);

    // Alerts must never make a good sync look like a failure.
    let alerts = { sent: 0, notices: 0 };
    try {
      alerts = await sendNotifications(db);
    } catch (e) {
      console.error("notifications failed:", e instanceof Error ? e.message : e);
    }
    return Response.json({ ok: true, counts, alerts, writeback });
  } catch (e) {
    // Log the reason server-side and store it for the app's status line.
    // Never echo the underlying error to the caller.
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("sync failed:", message);
    await db
      .from("sync_runs")
      .update({ status: "error", finished_at: new Date().toISOString(), error: message })
      .eq("id", runId);
    return new Response("Sync failed", { status: 500 });
  }
});
