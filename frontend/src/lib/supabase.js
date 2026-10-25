import { createClient } from '@supabase/supabase-js';
export const previewAuth = import.meta.env.DEV && import.meta.env.VITE_AUTH_MODE === 'preview';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key, {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;
export function requireSupabase() {
  if (!supabase) throw new Error('Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to sign in.');
  return supabase;
}
