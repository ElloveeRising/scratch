import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// These are PUBLIC client values. The publishable/anon key is designed to ship
// in the browser — security is enforced by Postgres row-level security, not by
// hiding this key. Environment variables win when present (local dev); the
// fallbacks let the deployed site connect with zero dashboard configuration.
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://qmwdvtkcesyipbbnxnbr.supabase.co";
const key =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_WwVfkxQ0h-3bH1kDqamRbA_oUmipUqQ";

export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key) : null;
