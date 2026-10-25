const { createClient } = require('@supabase/supabase-js');

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
function userClient(token) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw Object.assign(new Error('Supabase Auth is not configured'), { status: 503 });
  return createClient(url, key, { ...options, global: { headers: { Authorization: `Bearer ${token}` } } });
}
function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!process.env.SUPABASE_URL || !key) throw new Error('Supabase backend key is not configured');
  return createClient(process.env.SUPABASE_URL, key, options);
}
function memoryPreview() {
  return process.env.STORE_BACKEND === 'memory' && process.env.NODE_ENV !== 'production';
}
module.exports = { userClient, adminClient, memoryPreview };
