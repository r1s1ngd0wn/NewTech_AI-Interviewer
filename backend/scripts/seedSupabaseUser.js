require('dotenv').config();
const { adminClient } = require('../src/db/supabase');
async function main() {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  if (!email || !password || password.length < 12) throw new Error('Set TEST_USER_EMAIL and TEST_USER_PASSWORD (at least 12 characters) in backend/.env');
  const db = adminClient();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: 'Test User' } });
  if (error) throw new Error('Could not create test user. It may already exist; no existing password was changed.');
  console.log(`Created Supabase test account: ${data.user.email}. Password remains only in your environment.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
