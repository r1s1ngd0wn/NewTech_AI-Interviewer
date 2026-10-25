require("dotenv").config();
const cases = require("./long-cases.json");
const inputGuard = require("../src/guards/inputGuard");
const ragService = require("../src/services/ragService");
const embeddingService = require("../src/services/embeddingService");
const { getPool } = require("../src/db/postgres");

function sourceKinds(matches) {
  const kinds = new Set();
  for (const match of matches) {
    if (match.sourceType === "question") kinds.add("question");
    if (/^CV:/i.test(match.label) && match.label.includes("sample-cv-long-test.txt")) kinds.add("cv");
    if (/^JD:/i.test(match.label) && match.label.includes("sample-jd-long-test.txt")) kinds.add("jd");
  }
  return kinds;
}

async function evalUser() {
  const email = process.env.EVAL_EMAIL?.trim().toLowerCase();
  const live = process.argv.includes("--live");
  if (!email && !live) return null;
  const pool = getPool();
  let userId;
  if (email) {
    const user = await pool.query("SELECT id FROM interviewai_users WHERE value->>'email' = $1", [email]);
    if (!user.rows[0]) throw new Error("EVAL_EMAIL does not match a registered user");
    userId = user.rows[0].id;
  } else {
    const owners = await pool.query(`SELECT user_id FROM interviewai_user_documents
      WHERE filename IN ('sample-cv-long-test.txt', 'sample-jd-long-test.txt')
      GROUP BY user_id HAVING count(DISTINCT filename) = 2`);
    if (owners.rows.length !== 1) {
      throw new Error("live eval needs exactly one account with both fixtures; set EVAL_EMAIL if there are several");
    }
    userId = owners.rows[0].user_id;
  }
  const docs = await pool.query("SELECT filename FROM interviewai_user_documents WHERE user_id = $1", [userId]);
  for (const fixture of ["sample-cv-long-test.txt", "sample-jd-long-test.txt"]) {
    if (!docs.rows.some((row) => row.filename === fixture)) {
      throw new Error(`upload ${fixture} to the EVAL_EMAIL account before running retrieval cases`);
    }
  }
  return userId;
}

async function main() {
  const userId = await evalUser();
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7).split(",");
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const item of cases) {
    if (only && !only.includes(item.id)) continue;
    if (item.type === "retrieval" && !userId) {
      skipped += 1;
      continue;
    }
    let actual;
    if (item.type === "guard") actual = inputGuard.classifyInput(item.input);
    else if (item.type === "retrieval") {
      const matches = await ragService.retrieveKnowledge(userId, item.input, 5);
      actual = [...sourceKinds(matches)].sort().join("+") || "none";
      if (item.expect === "cv+jd") actual = actual.includes("cv") && actual.includes("jd") ? "cv+jd" : actual;
      else actual = sourceKinds(matches).has(item.expect) ? item.expect : actual;
    } else throw new Error(`unknown eval case type: ${item.type}`);
    const ok = actual === item.expect;
    if (ok) passed += 1;
    else failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"} ${item.id}: expected ${item.expect}; got ${actual}`);
    if (!ok && item.type === "retrieval" && process.argv.includes("--diagnose")) {
      const vector = await embeddingService.embed(item.input, "RETRIEVAL_QUERY");
      const documents = await ragService.searchKnowledge(userId, vector, 0, 3, { documentOnly: true });
      console.log(`  document scores: ${documents.map((match) =>
        `${match.label} ${match.similarity.toFixed(3)}`).join(", ") || "none"}`);
    }
  }
  console.log(`Long eval: ${passed} passed, ${failed} failed, ${skipped} skipped. ` +
    "Retrieval checks source selection, not whether a generated answer is factually correct.");
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Long eval failed: ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  if (process.env.EVAL_EMAIL || process.argv.includes("--live")) {
    try { await getPool().end(); } catch { /* The pool may not have opened. */ }
  }
});
