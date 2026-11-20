// Sends phone notifications after a sync. Deno-only (not part of the browser build).
// Needs secrets VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY; without them this quietly does nothing.
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { thresholdNotice, weeklyNotice } from "../_shared/alerts.ts";
import type { Input, Notice } from "../_shared/alerts.ts";
import type { Tx } from "../_shared/budget.ts";

interface TxRow {
  id: string; posted_on: string; month: string; summary: string | null; merchant: string | null;
  clean_merchant: string | null; category: string; amount: number | string; account: string | null; is_pending: boolean;
}

async function fetchAll<T>(db: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

type Sub = { endpoint: string; p256dh: string; auth: string };

/** Configures web push. Returns false when the keys aren't set. */
function configurePush(): boolean {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return false;
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:you@example.com", pub, priv);
  return true;
}

const push = (s: Sub, title: string, body: string, ttl: number) =>
  webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body }), { TTL: ttl });

/** Sends one plain test notification to every subscribed phone (for checking the setup). */
export async function sendTestNotification(db: SupabaseClient, title = "Sundialed", body = "Test. Everything is working."): Promise<{ phones: number; delivered: number; error?: string }> {
  if (!configurePush()) return { phones: 0, delivered: 0, error: "VAPID keys are not set" };
  const { data: subs, error } = await db.from("push_subscriptions").select("endpoint, p256dh, auth");
  if (error) return { phones: 0, delivered: 0, error: error.message };
  let delivered = 0;
  for (const s of subs ?? []) {
    try {
      await push(s, title, body, 300);
      delivered++;
    } catch (e) {
      console.error("test push failed:", (e as { statusCode?: number }).statusCode ?? (e as Error).message);
    }
  }
  return { phones: subs?.length ?? 0, delivered };
}

export async function sendNotifications(db: SupabaseClient, now = new Date()): Promise<{ sent: number; notices: number }> {
  if (!configurePush()) return { sent: 0, notices: 0 };

  const { data: subs, error: subErr } = await db.from("push_subscriptions").select("endpoint, p256dh, auth");
  if (subErr) throw new Error(`push_subscriptions: ${subErr.message}`);
  if (!subs?.length) return { sent: 0, notices: 0 };

  const [txRows, targets, rules, locks, settings, sentRows] = await Promise.all([
    fetchAll<TxRow>(db, "transactions", "id, posted_on, month, summary, merchant, clean_merchant, category, amount, account, is_pending"),
    db.from("targets").select("category, effective_month, amount"),
    db.from("vendor_rules").select("id, match_type, pattern, category, accounts, amount"),
    db.from("month_locks").select("month, locked_at, snapshot"),
    db.from("app_settings").select("key, value"),
    db.from("alerts_sent").select("key"),
  ]);
  for (const r of [targets, rules, locks, settings, sentRows]) if (r.error) throw new Error(r.error.message);

  const setting = (key: string): unknown => (settings.data ?? []).find((s: { key: string }) => s.key === key)?.value;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const ex = setting("exclude_choices") as { off?: unknown; on?: unknown } | undefined;

  const txs: Tx[] = txRows.map((r) => ({
    id: r.id, posted_on: r.posted_on, month: r.month, summary: r.summary,
    name: r.clean_merchant ?? r.merchant ?? r.summary ?? "(no description)",
    category: r.category, amount: Number(r.amount), account: r.account, pending: r.is_pending,
  }));
  const input: Input = {
    txs,
    targets: (targets.data ?? []).map((t: { category: string; effective_month: string; amount: number }) => ({ ...t, amount: Number(t.amount) })),
    rules: (rules.data ?? []).map((r: { accounts?: string[]; amount?: number | string | null }) => ({ ...r, accounts: r.accounts ?? [], amount: r.amount == null ? null : Number(r.amount) })) as Input["rules"],
    locks: (locks.data ?? []) as Input["locks"],
    choices: { off: strings(ex?.off), on: strings(ex?.on) },
    hiddenMonths: strings(setting("hidden_months")),
    tileCategories: Array.isArray(setting("tile_categories")) ? strings(setting("tile_categories")) : null,
    now,
  };

  const sent = new Set((sentRows.data ?? []).map((r: { key: string }) => r.key));
  const notices = [thresholdNotice(input, sent), weeklyNotice(input, sent)].filter((n): n is Notice => n != null);
  if (!notices.length) return { sent: 0, notices: 0 };

  let delivered = 0;
  const dead: string[] = [];
  for (const n of notices) {
    let ok = 0;
    await Promise.all(subs.map(async (s: Sub) => {
      try {
        await push(s, n.title, n.body, 60 * 60 * 12);
        ok++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint); // phone turned notifications off
        else console.error("push failed:", code ?? (e as Error).message);
      }
    }));
    delivered += ok;
    // Only remember it once someone actually received it, so a failed send is retried.
    if (ok > 0) await db.from("alerts_sent").upsert(n.keys.map((key) => ({ key })));
  }
  if (dead.length) await db.from("push_subscriptions").delete().in("endpoint", dead);
  return { sent: delivered, notices: notices.length };
}
