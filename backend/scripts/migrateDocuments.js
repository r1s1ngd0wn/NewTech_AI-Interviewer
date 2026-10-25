require("dotenv").config();
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { getPool } = require("../src/db/postgres");

async function main() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const prerequisites = await client.query(`SELECT
      to_regclass('public.interviewai_sessions') IS NOT NULL AS sessions,
      to_regclass('public.interviewai_rag_chunks') IS NOT NULL AS rag_chunks`);
    if (!prerequisites.rows[0].sessions || !prerequisites.rows[0].rag_chunks) {
      throw new Error("Run 001_app_store.sql and 002_rag.sql before 003_document_library.sql");
    }
    const sql = await readFile(path.join(__dirname, "../sql/003_document_library.sql"), "utf8");
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("Document library migration applied.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error.code || error.message);
  process.exitCode = 1;
});
