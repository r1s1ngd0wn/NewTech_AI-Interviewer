const { Pool } = require("pg");
const context = require('../context/requestContext');

let pool;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required; use the connection string from Supabase > Connect");
  }
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  const scope = context.getStore();
  if (!scope?.claims) return pool;
  // Existing RAG uses SQL, not PostgREST. Scope each pooled query with exactly
  // the verified JWT claims; transaction-local settings never leak to a borrower.
  return {
    async query(sql, values) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE authenticated');
        await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(scope.claims)]);
        const result = await client.query(sql, values);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
  };
}

async function checkConnection() {
  await getPool().query("SELECT 1");
}

module.exports = { getPool, checkConnection };
