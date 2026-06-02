import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Null when env vars are missing, so the app still runs locally without sync.
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key) : null;
