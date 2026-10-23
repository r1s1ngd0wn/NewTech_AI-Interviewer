const { createHash } = require("node:crypto");
const { getPool } = require("../db/postgres");
const embeddingService = require("./embeddingService");
const { sanitizeSourceText } = require("../guards/inputGuard");

function chunkText(text, maxChars = 600, overlapChars = 80) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = [];
  for (const word of words) {
    if (current.length && current.join(" ").length + word.length + 1 > maxChars) {
      chunks.push(current.join(" "));
      const tail = [];
      while (current.length && tail.join(" ").length < overlapChars) tail.unshift(current.pop());
      current = tail;
    }
    current.push(word);
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

function sessionSources({ session, scenario, feedback }) {
  const sources = session.turns.map((turn, index) => {
    const question = scenario?.questions.find((item) => item.id === turn.questionId);
    return {
      id: `turn-${index + 1}`,
      label: `Question ${index + 1} and answer`,
      text: `Question: ${question?.text || ""}\nYour answer: ${turn.answerText}` +
        (question?.referenceAnswer ? `\nQuestion-bank reference: ${question.referenceAnswer}` : ""),
    };
  });
  sources.push({
    id: "feedback", label: "Rubric feedback",
    text: `Overall score: ${feedback.overallScore}/100. ` +
      feedback.criteria.map((item) => `${item.name}: ${item.averageScore}/100. ${item.description}`).join(" ") +
      " Strengths: " + feedback.strengths.map((item) => item.note).join(" ") +
      " Improvements: " + feedback.improvements.map((item) => item.note).join(" "),
  });
  return sources;
}

function chunksFor(source, documentId = null) {
  return chunkText(source.text).map((content, index) => ({
    id: `${source.id}-${index + 1}`, documentId,
    label: source.label, content,
  }));
}

async function indexChunks(userId, sessionId, chunks, options = {}) {
  const model = embeddingService.config();
  if (!model) throw new Error("embedding provider is not configured");
  const query = options.query || ((sql, values) => getPool().query(sql, values));
  const embed = options.embed || embeddingService.embed;
  const modelKey = `${model.provider}:${model.model}`;
  for (const chunk of chunks) {
    const hash = createHash("sha256").update(chunk.content).digest("hex");
    const existing = await query("SELECT content_hash, model_key FROM interviewai_rag_chunks WHERE id = $1 AND user_id = $2 AND session_id = $3", [chunk.id, userId, sessionId]);
    if (existing.rows[0]?.content_hash === hash && existing.rows[0]?.model_key === modelKey) continue;
    const vector = await embed(chunk.content, "RETRIEVAL_DOCUMENT");
    await query(`INSERT INTO interviewai_rag_chunks
      (id, user_id, session_id, document_id, source_label, content, content_hash, model_key, embedding)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::extensions.vector)
      ON CONFLICT (user_id, session_id, id) DO UPDATE SET source_label = EXCLUDED.source_label, content = EXCLUDED.content,
        content_hash = EXCLUDED.content_hash, model_key = EXCLUDED.model_key, embedding = EXCLUDED.embedding`,
      [chunk.id, userId, sessionId, chunk.documentId, chunk.label, chunk.content, hash, modelKey, JSON.stringify(vector)]);
  }
}

async function indexSession(userId, context, options = {}) {
  const chunks = sessionSources(context).flatMap((source) => chunksFor({
    ...source, id: `${context.session.id}-${source.id}`,
  }));
  await indexChunks(userId, context.session.id, chunks, options);
}

async function indexKnowledgeChunks(userId, documentId, sourceType, chunks, options = {}) {
  const model = embeddingService.config();
  if (!model) throw new Error("embedding provider is not configured");
  const query = options.query || ((sql, values) => getPool().query(sql, values));
  const embed = options.embed || embeddingService.embed;
  const modelKey = `${model.provider}:${model.model}`;
  for (const chunk of chunks) {
    const hash = createHash("sha256").update(chunk.content).digest("hex");
    const existing = await query("SELECT content_hash, model_key FROM interviewai_knowledge_chunks WHERE id = $1", [chunk.id]);
    if (existing.rows[0]?.content_hash === hash && existing.rows[0]?.model_key === modelKey) continue;
    const vector = await embed(chunk.content, "RETRIEVAL_DOCUMENT");
    await query(`INSERT INTO interviewai_knowledge_chunks
      (id, user_id, document_id, source_type, source_label, content, content_hash, model_key, embedding)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::extensions.vector)
      ON CONFLICT (id) DO UPDATE SET source_label = EXCLUDED.source_label,
        content = EXCLUDED.content, content_hash = EXCLUDED.content_hash,
        model_key = EXCLUDED.model_key, embedding = EXCLUDED.embedding`,
      [chunk.id, userId, documentId, sourceType, chunk.label, chunk.content, hash, modelKey, JSON.stringify(vector)]);
  }
}

async function indexQuestionBank(scenarios, options = {}) {
  const chunks = scenarios.flatMap((scenario) => scenario.questions.map((question) => ({
    id: `question-${scenario.id}-${question.id}`,
    label: `${scenario.title} / ${question.id}`,
    content: `Question: ${question.text}` +
      (question.referenceAnswer ? `\nReference answer: ${question.referenceAnswer}` : "") +
      (question.keywords?.length ? `\nKeywords: ${question.keywords.join(", ")}` : ""),
  })));
  await indexKnowledgeChunks(null, null, "question", chunks, options);
  return chunks.length;
}

async function searchKnowledge(userId, vector, threshold, limit, options = {}) {
  const model = embeddingService.config();
  const query = options.query || ((sql, values) => getPool().query(sql, values));
  let result;
  try {
    result = await query(`SELECT id, document_id, source_type, source_label, content,
      1 - (embedding OPERATOR(extensions.<=>) $3::extensions.vector) AS similarity
    FROM interviewai_knowledge_chunks
    WHERE (user_id = $1 OR (user_id IS NULL AND source_type = 'question')) AND model_key = $2
      ${options.documentOnly ? "AND source_type = 'document'" : ""}
      AND 1 - (embedding OPERATOR(extensions.<=>) $3::extensions.vector) >= $4
    ORDER BY embedding OPERATOR(extensions.<=>) $3::extensions.vector LIMIT $5`,
    [userId, `${model.provider}:${model.model}`, JSON.stringify(vector), threshold, limit]);
  } catch (error) {
    if (error.code === "42P01") return [];
    throw error;
  }
  return result.rows.map((row) => ({ id: row.id, documentId: row.document_id,
    sourceType: row.source_type, label: row.source_label,
    text: row.content, similarity: Number(row.similarity) }));
}

async function retrieveKnowledge(userId, message, limit = 5, options = {}) {
  if (!userId || typeof message !== "string" || !message.trim()) return [];
  const model = embeddingService.config();
  if (!model) return [];
  const embed = options.embed || embeddingService.embed;
  const vector = await embed(message, "RETRIEVAL_QUERY");
  return searchKnowledge(userId, vector, Number(process.env.RAG_MATCH_THRESHOLD || 0.72),
    Math.max(1, Math.min(10, Number(limit) || 5)), options);
}

async function retrieve(userId, context, message, options = {}) {
  await indexSession(userId, context, options);
  const model = embeddingService.config();
  const query = options.query || ((sql, values) => getPool().query(sql, values));
  const embed = options.embed || embeddingService.embed;
  const vector = await embed(message, "RETRIEVAL_QUERY");
  const threshold = Number(process.env.RAG_MATCH_THRESHOLD || 0.72);
  const result = await query(`SELECT id, source_label, content,
      1 - (embedding OPERATOR(extensions.<=>) $4::extensions.vector) AS similarity
    FROM interviewai_rag_chunks
    WHERE user_id = $1 AND session_id = $2 AND model_key = $3
      AND 1 - (embedding OPERATOR(extensions.<=>) $4::extensions.vector) >= $5
    ORDER BY embedding OPERATOR(extensions.<=>) $4::extensions.vector LIMIT 5`,
    [userId, context.session.id, `${model.provider}:${model.model}`, JSON.stringify(vector), threshold]);
  const sessionMatches = result.rows.map((row) => ({ id: row.id, label: row.source_label,
    text: row.content, similarity: Number(row.similarity) }));
  const knowledgeMatches = process.env.STORE_BACKEND === "memory" && !options.query ? []
    : await searchKnowledge(userId, vector, threshold, 5, options);
  return [...sessionMatches, ...knowledgeMatches]
    .sort((a, b) => b.similarity - a.similarity).slice(0, 5);
}

async function retrieveDocumentContext(userId, sessionId, question, options = {}) {
  const model = embeddingService.config();
  if (!model) return null;
  const query = options.query || ((sql, values) => getPool().query(sql, values));
  const embed = options.embed || embeddingService.embed;
  const vector = await embed(question, "RETRIEVAL_QUERY");
  const result = await query(`SELECT document_id, source_label, content,
      1 - (embedding OPERATOR(extensions.<=>) $4::extensions.vector) AS similarity
    FROM interviewai_rag_chunks
    WHERE user_id = $1 AND session_id = $2 AND model_key = $3 AND document_id IS NOT NULL
      AND 1 - (embedding OPERATOR(extensions.<=>) $4::extensions.vector) >= $5
    ORDER BY embedding OPERATOR(extensions.<=>) $4::extensions.vector LIMIT 1`,
    [userId, sessionId, `${model.provider}:${model.model}`, JSON.stringify(vector),
      Number(process.env.RAG_PREP_THRESHOLD || 0.5)]);
  const row = result.rows[0];
  const sessionMatch = row ? { documentId: row.document_id, label: row.source_label,
    text: sanitizeSourceText(row.content), similarity: Number(row.similarity) } : null;
  const knowledgeMatches = process.env.STORE_BACKEND === "memory" && !options.query ? []
    : await searchKnowledge(userId, vector, Number(process.env.RAG_PREP_THRESHOLD || 0.5), 1,
      { ...options, documentOnly: true });
  const libraryMatch = knowledgeMatches[0] || null;
  return !libraryMatch || (sessionMatch && sessionMatch.similarity >= libraryMatch.similarity)
    ? sessionMatch : { ...libraryMatch, text: sanitizeSourceText(libraryMatch.text) };
}

async function deleteSessionIndex(sessionId, query = (sql, values) => getPool().query(sql, values)) {
  await query("DELETE FROM interviewai_rag_chunks WHERE session_id = $1", [sessionId]);
}

async function deleteInterviewIndex(sessionId, query = (sql, values) => getPool().query(sql, values)) {
  await query("DELETE FROM interviewai_rag_chunks WHERE session_id = $1 AND document_id IS NULL", [sessionId]);
}

module.exports = { chunkText, sessionSources, chunksFor, indexChunks, indexKnowledgeChunks,
  indexQuestionBank, indexSession, searchKnowledge, retrieveKnowledge, retrieve, retrieveDocumentContext,
  deleteSessionIndex, deleteInterviewIndex };
