const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const mammoth = require("mammoth");
const { newId } = require("../utils/id");
const { getPool } = require("../db/postgres");
const ragService = require("./ragService");
const embeddingService = require("./embeddingService");
const { httpError } = require("./authService");
const { sanitizeSourceText } = require("../guards/inputGuard");

const BUCKET = "interviewai-private";
const MAX_PAGES = 20;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
let storageClient;

function assertStorageOwner(userId, storagePath) {
  if (typeof storagePath !== 'string' || storagePath.split('/')[0] !== userId ||
      storagePath.split('/').some(segment => !segment || segment === '.' || segment === '..') || storagePath.includes('\\')) {
    throw httpError(404, 'document not found');
  }
}

function storage() {
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!process.env.SUPABASE_URL || !secretKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required for file storage");
  }
  if (!storageClient) {
    storageClient = createClient(process.env.SUPABASE_URL, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage.from(BUCKET);
  }
  return storageClient;
}

function fileType(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  if (extension === ".pdf" && file.buffer?.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (extension === ".docx" && file.buffer?.subarray(0, 4).toString("hex") === "504b0304") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (extension === ".txt") return "text/plain";
  if (extension === ".md") return "text/markdown";
  throw httpError(400, "upload a PDF, DOCX, TXT or Markdown file (PDFs must contain selectable text)");
}

async function extractText(file, contentType) {
  if (contentType.includes("wordprocessingml.document")) {
    return (await mammoth.extractRawText({ buffer: file.buffer })).value.trim();
  }
  if (contentType !== "application/pdf") return file.buffer.toString("utf8").trim();
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(file.buffer), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > MAX_PAGES) throw httpError(400, `PDFs are limited to ${MAX_PAGES} pages`);
    const pages = [];
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      pages.push(content.items.map((item) => item.str || "").join(" "));
    }
    return pages.join("\n").trim();
  } finally {
    await task.destroy();
  }
}

async function listDocuments(userId, sessionId) {
  if (process.env.STORE_BACKEND === "memory") return [];
  const result = await getPool().query(`SELECT id, filename, content_type AS "contentType", created_at AS "createdAt"
    FROM interviewai_documents WHERE user_id = $1 AND session_id = $2 ORDER BY created_at DESC`, [userId, sessionId]);
  return result.rows;
}

async function exportDocuments(userId, sessionId) {
  const result = await getPool().query(`SELECT id, filename, content_type, storage_path, created_at
    FROM interviewai_documents WHERE user_id = $1 AND session_id = $2 ORDER BY created_at`, [userId, sessionId]);
  const documents = [];
  for (const row of result.rows) {
    assertStorageOwner(userId, row.storage_path);
    const { data, error } = await storage().download(row.storage_path);
    if (error) throw new Error(`Could not export ${row.filename}: ${error.message}`);
    documents.push({
      id: row.id, filename: row.filename, contentType: row.content_type,
      createdAt: row.created_at, base64: Buffer.from(await data.arrayBuffer()).toString("base64"),
    });
  }
  return documents;
}

async function uploadDocument(userId, sessionId, file) {
  if (process.env.STORE_BACKEND === "memory") throw httpError(503, "file uploads require Supabase configuration");
  if (!file?.buffer?.length) throw httpError(400, "file is required");
  if (file.buffer.length > MAX_FILE_BYTES) throw httpError(400, "files are limited to 5 MB");
  if (!embeddingService.config()) throw httpError(503, "configure an embedding model before uploading RAG documents");
  const contentType = fileType(file);
  let text;
  try {
    text = await extractText(file, contentType);
  } catch (error) {
    if (error.status) throw error;
    throw httpError(400, "could not read this file; use a text-based PDF, DOCX, TXT or Markdown file");
  }
  if (text.length < 20) throw httpError(400, "the file contains too little searchable text");
  const id = newId("doc");
  const filename = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const storagePath = `${userId}/${sessionId}/${id}/${filename}`;
  const { error: uploadError } = await storage().upload(storagePath, file.buffer, { contentType, upsert: false });
  if (uploadError) throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
  try {
    await getPool().query(`INSERT INTO interviewai_documents
      (id, user_id, session_id, filename, content_type, storage_path) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, userId, sessionId, filename, contentType, storagePath]);
    const chunks = ragService.chunkText(sanitizeSourceText(text), 2000, 200)
      .map((content, index) => ({
        id: `${sessionId}-${id}-${index + 1}`, documentId: id, label: filename, content,
      }));
    await ragService.indexChunks(userId, sessionId, chunks);
  } catch (error) {
    await getPool().query("DELETE FROM interviewai_rag_chunks WHERE document_id = $1", [id]);
    await getPool().query("DELETE FROM interviewai_documents WHERE id = $1", [id]);
    await storage().remove([storagePath]);
    throw error;
  }
  return { id, filename, contentType };
}

async function deleteDocument(userId, sessionId, documentId) {
  const result = await getPool().query(`SELECT storage_path FROM interviewai_documents
    WHERE id = $1 AND user_id = $2 AND session_id = $3`, [documentId, userId, sessionId]);
  const storagePath = result.rows[0]?.storage_path;
  if (!storagePath) throw httpError(404, "document not found");
  assertStorageOwner(userId, storagePath);
  const { error } = await storage().remove([storagePath]);
  if (error) throw new Error(`Supabase Storage deletion failed: ${error.message}`);
  await getPool().query("DELETE FROM interviewai_rag_chunks WHERE document_id = $1", [documentId]);
  await getPool().query("DELETE FROM interviewai_documents WHERE id = $1 AND user_id = $2 AND session_id = $3", [documentId, userId, sessionId]);
}

async function deleteForSession(sessionId) {
  const result = await getPool().query("SELECT id, user_id FROM interviewai_documents WHERE session_id = $1", [sessionId]);
  for (const row of result.rows) await deleteDocument(row.user_id, sessionId, row.id);
  await ragService.deleteSessionIndex(sessionId);
}

async function listUserDocuments(userId) {
  if (process.env.STORE_BACKEND === "memory") return [];
  const result = await getPool().query(`SELECT id, kind, filename, content_type AS "contentType",
    created_at AS "createdAt" FROM interviewai_user_documents
    WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
  return result.rows;
}

async function getUserDocument(userId, documentId) {
  const result = await getPool().query(`SELECT id, kind, filename, content_type AS "contentType",
    extracted_text AS "extractedText", created_at AS "createdAt"
    FROM interviewai_user_documents WHERE user_id = $1 AND id = $2`, [userId, documentId]);
  if (!result.rows[0]) throw httpError(404, "document not found");
  return result.rows[0];
}

async function uploadUserDocument(userId, kind, file) {
  if (process.env.STORE_BACKEND === "memory") throw httpError(503, "file uploads require Supabase configuration");
  if (kind !== "cv" && kind !== "jd") throw httpError(400, "kind must be cv or jd");
  if (!file?.buffer?.length) throw httpError(400, "file is required");
  if (file.buffer.length > MAX_FILE_BYTES) throw httpError(400, "files are limited to 5 MB");
  if (!embeddingService.config()) throw httpError(503, "configure an embedding model before uploading documents");
  const contentType = fileType(file);
  let text;
  try {
    text = await extractText(file, contentType);
  } catch (error) {
    if (error.status) throw error;
    throw httpError(400, "could not read this file; use a text-based PDF, DOCX or TXT file");
  }
  if (text.length < 20) throw httpError(400, "the file contains too little searchable text");
  const id = newId("doc");
  const filename = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const storagePath = `${userId}/library/${id}/${filename}`;
  const { error: uploadError } = await storage().upload(storagePath, file.buffer, { contentType, upsert: false });
  if (uploadError) throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
  try {
    await getPool().query(`INSERT INTO interviewai_user_documents
      (id, user_id, kind, filename, content_type, storage_path, extracted_text)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, userId, kind, filename, contentType, storagePath, text]);
    const chunks = ragService.chunkText(sanitizeSourceText(text), 2000, 200).map((content, index) => ({
      id: `${id}-${index + 1}`, label: `${kind.toUpperCase()}: ${filename}`,
      content,
    }));
    await ragService.indexKnowledgeChunks(userId, id, "document", chunks);
  } catch (error) {
    await getPool().query("DELETE FROM interviewai_user_documents WHERE id = $1 AND user_id = $2", [id, userId]);
    await storage().remove([storagePath]);
    throw error;
  }
  return { id, kind, filename, contentType };
}

async function deleteUserDocument(userId, documentId) {
  const result = await getPool().query(`SELECT storage_path FROM interviewai_user_documents
    WHERE id = $1 AND user_id = $2`, [documentId, userId]);
  const storagePath = result.rows[0]?.storage_path;
  if (!storagePath) throw httpError(404, "document not found");
  assertStorageOwner(userId, storagePath);
  const { error } = await storage().remove([storagePath]);
  if (error) throw new Error(`Supabase Storage deletion failed: ${error.message}`);
  await getPool().query("DELETE FROM interviewai_user_documents WHERE id = $1 AND user_id = $2", [documentId, userId]);
}

async function deleteAllUserDocuments(userId) {
  for (const document of await listUserDocuments(userId)) await deleteUserDocument(userId, document.id);
}

async function exportUserDocuments(userId) {
  const result = await getPool().query(`SELECT id, kind, filename, content_type, storage_path,
    extracted_text, created_at FROM interviewai_user_documents WHERE user_id = $1`, [userId]);
  const documents = [];
  for (const row of result.rows) {
    assertStorageOwner(userId, row.storage_path);
    const { data, error } = await storage().download(row.storage_path);
    if (error) throw new Error(`Could not export ${row.filename}: ${error.message}`);
    documents.push({ id: row.id, kind: row.kind, filename: row.filename,
      contentType: row.content_type, extractedText: row.extracted_text,
      createdAt: row.created_at, base64: Buffer.from(await data.arrayBuffer()).toString("base64") });
  }
  return documents;
}

module.exports = { fileType, extractText, listDocuments, exportDocuments, uploadDocument,
  deleteDocument, deleteForSession, listUserDocuments, getUserDocument,
  uploadUserDocument, deleteUserDocument, deleteAllUserDocuments, exportUserDocuments,
  MAX_FILE_BYTES };
