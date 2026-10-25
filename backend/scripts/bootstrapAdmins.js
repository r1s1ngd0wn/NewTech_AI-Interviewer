require('dotenv').config();
const { Pool } = require('pg');
async function main() {
  const emails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!emails.length || !process.env.DATABASE_URL) throw new Error('Set ADMIN_EMAILS and DATABASE_URL in backend/.env first');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const result = await pool.query(`update public.profiles p set role='admin' from auth.users u
      where p.id=u.id and u.email_confirmed_at is not null and lower(u.email)=any($1::text[]) returning p.id`, [emails]);
    console.log(`Granted admin to ${result.rowCount} existing, verified account(s). No accounts were created.`);
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
