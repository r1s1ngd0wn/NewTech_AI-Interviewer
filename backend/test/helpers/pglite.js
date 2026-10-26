// A real PostgreSQL (PGlite, in process) with the project's actual migrations applied, so SQL tests
// exercise the real tables, constraints and row-level security. Only the Supabase-owned pieces
// (auth, storage, roles) are minimal stand-ins; the application SQL is read from supabase/migrations
// unchanged.

const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { vector } = require("@electric-sql/pglite-pgvector");

const ALICE = "00000000-0000-4000-8000-000000000001";
const BOB = "00000000-0000-4000-8000-000000000002";
const ALICE_SESSION = "10000000-0000-4000-8000-000000000001";
const BOB_SESSION = "10000000-0000-4000-8000-000000000002";

async function createDatabase() {
  const db = new PGlite({ extensions: { vector } });
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
  const dir = path.resolve(__dirname, "../../../supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(dir, file), "utf8"));
  }
  await db.query("insert into auth.users(id) values($1),($2)", [ALICE, BOB]);
  await db.query("insert into auth.sessions values($1,$2),($3,$4)", [ALICE_SESSION, ALICE, BOB_SESSION, BOB]);
  return db;
}

// A query runner that behaves like the backend does for a signed-in user: the `authenticated` role with
// that user's verified claims, so row-level security applies.
function asUser(db, userId, sessionId) {
  return async (sql, values) => {
    await db.exec("begin");
    try {
      await db.exec("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, session_id: sessionId })]);
      const result = await db.query(sql, values);
      await db.exec("commit");
      return result;
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
  };
}

module.exports = { createDatabase, asUser, ALICE, BOB, ALICE_SESSION, BOB_SESSION };
