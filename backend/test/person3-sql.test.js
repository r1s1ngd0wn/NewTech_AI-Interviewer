const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { vector } = require('@electric-sql/pglite-pgvector');
const ALICE = '00000000-0000-4000-8000-000000000001';
const BOB = '00000000-0000-4000-8000-000000000002';
const SESSIONS = {
  [ALICE]: '10000000-0000-4000-8000-000000000001',
  [BOB]: '10000000-0000-4000-8000-000000000002',
};

test('all migrations execute; database enforces roles, ownership and atomic confirmations', async t => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  // Minimal Supabase-owned schemas. Application SQL below is unmodified.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
    create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id));
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to authenticated,service_role;
    grant execute on function auth.uid(),auth.jwt() to authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
    create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
  `);
  const dir = path.resolve(__dirname, '../../supabase/migrations');
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) await db.exec(readFileSync(path.join(dir, file), 'utf8'));
  await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$3),($2,$3)', [ALICE, BOB, JSON.stringify({ name: 'Alice', role: 'admin' })]);
  assert.equal((await db.query('select role from profiles where id=$1', [ALICE])).rows[0].role, 'user');
  await db.query('insert into auth.sessions values($1,$2),($3,$4)', [SESSIONS[ALICE], ALICE, SESSIONS[BOB], BOB]);
  async function asUser(user, operation) {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, session_id: SESSIONS[user] })]);
    try { return await operation(); } finally { await db.exec('reset role'); }
  }
  const payload = { title: 'Week', items: [{ scenarioId: 'scn_swe_junior_behavioral', scheduledDate: '2026-11-01', status: 'scheduled' }] };
  const alicePlan = await asUser(ALICE, async () => (await db.query('select create_practice_plan($1) as plan', [JSON.stringify(payload)])).rows[0].plan);
  const bobPlan = await asUser(BOB, async () => (await db.query('select create_practice_plan($1) as plan', [JSON.stringify({ ...payload, title: 'Bob week' })])).rows[0].plan);
  await asUser(ALICE, async () => {
    assert.equal((await db.query('select public.is_session_active() as active')).rows[0].active, true);
    await assert.rejects(db.exec("update profiles set role='admin'"), /permission denied/);
    const profile = await db.exec("update profiles set target_industry='Technology',target_role='Engineer',experience_level='Junior' returning onboarding_complete");
    assert.equal(profile[0].rows[0].onboarding_complete, true);
  });
  const action = await asUser(ALICE, async () => (await db.query('select propose_coach_action($1,$2) as action', ['create_practice_plan', JSON.stringify(payload)])).rows[0].action);
  assert.equal((await db.query('select count(*)::int as count from practice_plans')).rows[0].count, 2);
  await asUser(BOB, async () => {
    assert.equal((await db.query('select public.is_session_active() as active')).rows[0].active, true);
    assert.equal((await db.query('select * from pending_actions')).rows.length, 0);
    assert.deepEqual((await db.query('select id from practice_plans')).rows.map(row => row.id), [bobPlan.id]);
    assert.deepEqual((await db.query('select id from practice_plans where id=$1', [alicePlan.id])).rows, []);
    assert.deepEqual((await db.query("update practice_plans set title='stolen' where id=$1 returning id", [alicePlan.id])).rows, []);
    assert.deepEqual((await db.query('delete from practice_plans where id=$1 returning id', [alicePlan.id])).rows, []);
    await assert.rejects(db.query('select confirm_coach_action($1)', [action.id]), error => error.code === 'P0002');
    assert.equal((await db.query('select title from practice_plans where id=$1', [bobPlan.id])).rows[0].title, 'Bob week');
    await db.query('insert into interviewai_sessions(id,value) values($1,$2)', ['owned-bob', JSON.stringify({ id: 'owned-bob', userId: BOB })]);
    assert.deepEqual((await db.query('select id from interviewai_sessions')).rows.map(row => row.id), ['owned-bob']);
  });
  await asUser(ALICE, async () => {
    await assert.rejects(db.query("update pending_actions set payload='{}' where id=$1", [action.id]), /permission denied/);
    const result = (await db.query('select confirm_coach_action($1) as answer', [action.id])).rows[0].answer;
    assert.equal(result.status, 'confirmed');
    assert.equal(result.result.items.length, 1);
    await assert.rejects(db.query('select confirm_coach_action($1)', [action.id]), /no longer pending/);
    const before = (await db.query('select count(*)::int as count from practice_plans')).rows[0].count;
    await assert.rejects(db.query('select create_practice_plan($1)', [JSON.stringify({ title: 'Invalid', items: [...payload.items, { ...payload.items[0], status: 'evil' }] })]));
    assert.equal((await db.query('select count(*)::int as count from practice_plans')).rows[0].count, before);
    await db.query('insert into interviewai_sessions(id,value) values($1,$2)', ['owned', JSON.stringify({ id: 'owned', userId: ALICE })]);
    await assert.rejects(db.query('insert into interviewai_sessions(id,value) values($1,$2)', ['forged', JSON.stringify({ id: 'forged', userId: BOB })]), /row-level security/);
    await assert.rejects(db.query(`insert into interviewai_user_documents(id,user_id,kind,filename,content_type,storage_path,extracted_text)
      values('forged-doc',$1,'cv','cv.txt','text/plain',$2,'private')`, [ALICE, `${BOB}/library/private.txt`]), /check constraint|row-level security/);
  });
  await asUser(BOB, async () => {
    assert.deepEqual((await db.query('select id from practice_plans')).rows.map(row => row.id), [bobPlan.id]);
    assert.deepEqual((await db.query('select id from interviewai_sessions')).rows.map(row => row.id), ['owned-bob']);
  });
  const expired = await asUser(ALICE, async () => (await db.query('select propose_coach_action($1,$2) as action', ['create_practice_plan', JSON.stringify(payload)])).rows[0].action);
  await db.query("update pending_actions set expires_at=now()-interval '1 second' where id=$1", [expired.id]);
  await asUser(ALICE, async () => { await assert.rejects(db.query('select confirm_coach_action($1)', [expired.id]), /expired/); });
  await db.query('delete from auth.sessions where id=$1', [SESSIONS[ALICE]]);
  await asUser(ALICE, async () => {
    assert.equal((await db.query('select is_session_active() as active')).rows[0].active, false);
    assert.equal((await db.query('select * from practice_plans')).rows.length, 0);
    assert.equal((await db.query('select * from profiles')).rows.length, 0);
  });
});
