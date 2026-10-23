require("dotenv").config();
const scenarios = require("../src/data/scenarios.json");
const ragService = require("../src/services/ragService");
const { getPool } = require("../src/db/postgres");

async function main() {
  const count = await ragService.indexQuestionBank(scenarios);
  console.log(`Indexed ${count} question-bank entries.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => {
  await getPool().end();
});
