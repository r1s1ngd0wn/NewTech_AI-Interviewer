const { Pool } = require("pg");

let pool;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required; use the connection string from Supabase > Connect");
  }
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return pool;
}

async function checkConnection() {
  await getPool().query("SELECT 1");
}

module.exports = { getPool, checkConnection };
