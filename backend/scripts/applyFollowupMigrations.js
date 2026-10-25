require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { getPool } = require("../src/db/postgres");

async function main() {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const name of ["004_session_owner_index.sql", "005_ai_request_logs.sql", "006_ai_request_log_owner.sql"]) {
      await client.query(fs.readFileSync(path.join(__dirname, "../sql", name), "utf8"));
      console.log(`Applied ${name}`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(`Migration failed: ${error.code || error.message}`);
  process.exitCode = 1;
}).finally(async () => getPool().end());
