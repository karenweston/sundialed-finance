import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDemoClient } from "./demo/client";

/** True in the public demo build (VITE_DEMO=true): data is fictional and stays in the browser. */
export const isDemo = import.meta.env.VITE_DEMO === "true";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function connect(): SupabaseClient {
  if (isDemo) return createDemoClient() as unknown as SupabaseClient;
  if (!url || !anonKey) throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
  return createClient(url, anonKey);
}

export const supabase = connect();
