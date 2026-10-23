require("dotenv").config();
const { getPool } = require("../src/db/postgres");

async function main() {
  const pool = getPool();
  try {
    const result = await pool.query(`SELECT
      to_regclass('public.interviewai_sessions') IS NOT NULL AS sessions,
      to_regclass('public.interviewai_rag_chunks') IS NOT NULL AS session_chunks,
      to_regclass('public.interviewai_user_documents') IS NOT NULL AS library,
      to_regclass('public.interviewai_knowledge_chunks') IS NOT NULL AS knowledge_chunks`);
    console.log(result.rows[0]);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Schema check failed:", error.code || error.message);
  process.exitCode = 1;
});
