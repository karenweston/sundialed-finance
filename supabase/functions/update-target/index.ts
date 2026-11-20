// Changes one target in the Google Sheet's Targets tab, for the app's "Targets in use" screen.
// The gateway verifies the signed-in user's token and we confirm they're on the allow-list.
// The write itself is planned by the unit-tested planTargetEdit, which touches only target cells
// (or starts one new month column) and refuses anything unexpected. A sync follows so the app shows it.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getAccessToken, readTabFormulas, WRITE_SCOPE, writeRanges } from "../_shared/google.ts";
import { planTargetEdit } from "../_shared/targets.ts";

const ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "http://localhost:5173";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const TARGETS_YEAR = Number(Deno.env.get("TARGETS_YEAR") ?? new Date().getFullYear());

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: allowed, error } = await asUser.rpc("is_allowed");
  if (error || allowed !== true) return json({ ok: false }, 403);

  let body: { category?: unknown; month?: unknown; amount?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const { category, month, amount } = body;
  if (typeof category !== "string" || !category.trim() || category.length > 60 || typeof month !== "string" || !(amount === null || typeof amount === "number")) {
    return json({ ok: false, error: "Bad request." }, 400);
  }

  const sheetId = Deno.env.get("SHEET_ID");
  const keyJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!sheetId || !keyJson) return json({ ok: false, error: "The server isn't set up for this yet." }, 500);

  try {
    const tab = await readTabFormulas(await getAccessToken(keyJson), sheetId, "Targets");
    const plan = planTargetEdit(tab, { category, month, amount }, TARGETS_YEAR);
    if ("error" in plan) return json({ ok: false, error: plan.error });
    await writeRanges(await getAccessToken(keyJson, WRITE_SCOPE), sheetId, plan.data);
    // Bring the app up to date with what was just written.
    const sync = await fetch(`${url}/functions/v1/sync-sheet`, {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("SYNC_SECRET") ?? ""}` },
    });
    return json({ ok: true, created: plan.created, column: plan.column, synced: sync.ok });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("update-target failed:", message);
    const denied = /PERMISSION_DENIED|\(403\)/.test(message);
    return json({ ok: false, error: denied ? "The Sheet isn't shared with edit access yet." : "Couldn't update the Sheet. Try again." });
  }
});
