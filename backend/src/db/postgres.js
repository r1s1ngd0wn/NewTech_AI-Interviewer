const { Pool } = require("pg");
const context = require('../context/requestContext');

let pool;

function basePool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required; use the connection string from Supabase > Connect");
  }
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return pool;
}

async function withTransaction(operation) {
  const client = await basePool().connect();
  const scope = context.getStore();
  try {
    await client.query('BEGIN');
    if (scope?.claims) {
      await client.query('SET LOCAL ROLE authenticated');
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(scope.claims)]);
    }
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

function getPool() {
  const pool = basePool();
  const scope = context.getStore();
  if (!scope?.claims) return pool;
  // Existing RAG uses SQL, not PostgREST. Scope each pooled query with exactly
  // the verified JWT claims; transaction-local settings never leak to a borrower.
  return {
    query: (sql, values) => withTransaction(client => client.query(sql, values)),
  };
}

// Runs a query with the backend's own database role, ignoring the signed-in user's row-level security.
// Only for admin-only reads of tables no user may touch (ai_logs), and only after requireRole('admin').
function privilegedQuery(sql, values) {
  return basePool().query(sql, values);
}

async function checkConnection() {
  await getPool().query("SELECT 1");
}

module.exports = { getPool, withTransaction, privilegedQuery, checkConnection };
