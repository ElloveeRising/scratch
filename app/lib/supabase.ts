import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// These are PUBLIC client values. The publishable/anon key is designed to ship
// in the browser — security is enforced by Postgres row-level security, not by
// hiding this key. Environment variables win when present (local dev); the
// fallbacks let the deployed site connect with zero dashboard configuration.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://qmwdvtkcesyipbbnxnbr.supabase.co";
const key =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_WwVfkxQ0h-3bH1kDqamRbA_oUmipUqQ";

export const supabase: SupabaseClient | null =
  SUPABASE_URL && key ? createClient(SUPABASE_URL, key) : null;

// Public URL for an object in the (public) `media` bucket — used to read shared
// card snapshots without a login.
export function publicMediaUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/media/${path}`;
}
