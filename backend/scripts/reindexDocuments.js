require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { getPool } = require("../src/db/postgres");
const documents = require("../src/services/documentService");
const rag = require("../src/services/ragService");
const { sanitizeSourceText } = require("../src/guards/inputGuard");

function chunks(text, id, label, documentId) {
  return documents.searchableChunks(text).map((content, index) => ({
    id: `${id}-${index + 1}`, label, documentId, content,
  }));
}

async function main() {
  const pool = getPool();
  const library = await pool.query("SELECT id, user_id, kind, filename, extracted_text FROM interviewai_user_documents");
  const sessionFiles = await pool.query(
    "SELECT id, user_id, session_id, filename, content_type, storage_path FROM interviewai_documents"
  );
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (sessionFiles.rows.length && (!process.env.SUPABASE_URL || !key)) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required to reindex session documents");
  }
  const storage = sessionFiles.rows.length ? createClient(process.env.SUPABASE_URL, key,
    { auth: { persistSession: false, autoRefreshToken: false } }).storage.from("interviewai-private") : null;
  let indexed = 0;
  for (const row of library.rows) {
    await rag.indexKnowledgeChunks(row.user_id, row.id, "document",
      chunks(sanitizeSourceText(row.extracted_text), row.id, `${row.kind.toUpperCase()}: ${row.filename}`));
    indexed += 1;
  }
  for (const row of sessionFiles.rows) {
    const { data, error } = await storage.download(row.storage_path);
    if (error) throw new Error(`Could not download ${row.filename}: ${error.message}`);
    const file = { buffer: Buffer.from(await data.arrayBuffer()) };
    const text = sanitizeSourceText(await documents.extractText(file, row.content_type));
    await rag.indexChunks(row.user_id, row.session_id,
      chunks(text, `${row.session_id}-${row.id}`, row.filename, row.id));
    indexed += 1;
  }
  console.log(`Reindexed ${indexed} documents for the configured embedding model.`);
}

main().catch((error) => {
  console.error(`Reindex failed: ${error.message}`);
  process.exitCode = 1;
}).finally(async () => getPool().end());
