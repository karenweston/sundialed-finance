// "Sync now" for the app. The browser can't hold the sync secret, so it calls this instead:
// the gateway verifies the signed-in user's token, we confirm they're on the allow-list, then
// we trigger the real sync server-side. Rate-limited so it can't be hammered.

import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "http://localhost:5173";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("authorization") ?? "";

  // Is this signed-in user on the allow-list? (Same check the database uses for every table.)
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: allowed, error } = await asUser.rpc("is_allowed");
  if (error || allowed !== true) return json({ ok: false }, 403);

  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: last } = await db.from("sync_runs").select("started_at").order("id", { ascending: false }).limit(1);
  const started = last?.[0]?.started_at ? new Date(last[0].started_at).getTime() : 0;
  if (Date.now() - started < 45_000) return json({ ok: true, skipped: "just synced" });

  const res = await fetch(`${url}/functions/v1/sync-sheet`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("SYNC_SECRET") ?? ""}` },
  });
  return json({ ok: res.ok }, res.ok ? 200 : 502);
});
