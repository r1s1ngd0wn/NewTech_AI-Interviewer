const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('legacy backfill preserves metadata, is replay safe, and keeps logs private', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table profiles(id uuid primary key);
    create table ai_logs(id uuid primary key default gen_random_uuid(), created_at timestamptz default now(),
      request_id uuid, user_id uuid references profiles(id), capability text not null, prompt_name text,
      prompt_version text, model text, tools text[] default '{}', tokens_in bigint, tokens_out bigint,
      latency_ms integer not null, cost_usd numeric, status text, error_code text, provider_status integer);
    alter table ai_logs enable row level security;
    grant all on ai_logs to service_role;
    create table interviewai_ai_request_logs(id bigint generated always as identity primary key,
      user_id text, provider text, model text, operation text, prompt_version text,
      duration_ms integer, status text, created_at timestamptz default now());
    insert into profiles values('00000000-0000-4000-8000-000000000001');
    insert into interviewai_ai_request_logs(user_id,provider,model,operation,prompt_version,duration_ms,status) values
      ('00000000-0000-4000-8000-000000000001','gemini','m','chat','long-v1',10,'ok'),
      ('old-text-owner','gemini','e','embed_query','long-v1',20,'cancelled');`);
  const sql = readFileSync(path.resolve(__dirname, '../../supabase/migrations/20261025000100_unified_ai_logs.sql'), 'utf8');
  await db.exec(sql); await db.exec(sql);
  const rows = (await db.query('select * from ai_logs order by legacy_id')).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].user_id, '00000000-0000-4000-8000-000000000001');
  assert.equal(rows[1].user_id, null); assert.equal(rows[1].legacy_user_id, 'old-text-owner');
  assert.equal(rows[1].capability, 'embed'); assert.equal(rows[1].status, 'error');
  assert.equal(rows[1].error_code, 'cancelled'); assert.equal(rows[1].cost_usd, null);
  assert.equal(rows[0].provider, 'gemini'); assert.equal(rows[0].prompt_version, 'long-v1');
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from ai_logs'), /permission denied/);
  await db.exec('reset role; set role service_role');
  await assert.rejects(db.exec("insert into interviewai_ai_request_logs(provider) values('gemini')"), /permission denied/);
  await db.exec('reset role');
  // Deletion must also remove the archived source; otherwise a replay resurrects it.
  await db.exec('delete from ai_logs where legacy_id=2');
  await db.exec(sql);
  assert.equal((await db.query('select * from ai_logs')).rows.length, 1);
  assert.equal((await db.query('select * from interviewai_ai_request_logs')).rows.length, 1);
});
