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
  for (const [index, highlight] of (feedback.highlights || []).entries()) {
    const question = scenario?.questions.find((item) => item.id === highlight.questionId);
    sources.push({ id: `critique-${index + 1}`, label: `Question ${index + 1} feedback`,
      text: `Question: ${highlight.questionText || question?.text || ""}\n` +
        `Your answer: ${highlight.answerExcerpt || session.turns[index]?.answerText || ""}\n` +
        (question?.referenceAnswer ? `Question-bank key points: ${question.referenceAnswer}\n` : "") +
        `Rubric bands: ${(highlight.scores || []).map((score) => `${score.name}: ${score.label}`).join(", ")}` });
  }
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
  const modelKey = embeddingService.modelKey(model);
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
  const modelKey = embeddingService.modelKey(model);
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
    result = await query(`SELECT chunks.id, chunks.document_id, chunks.source_type, chunks.source_label, chunks.content,
      1 - (chunks.embedding OPERATOR(extensions.<=>) $3::extensions.vector) AS similarity
    FROM interviewai_knowledge_chunks AS chunks
    ${options.documentKind ? "JOIN interviewai_user_documents AS documents ON documents.id = chunks.document_id" : ""}
    WHERE (chunks.user_id = $1 OR (chunks.user_id IS NULL AND chunks.source_type = 'question')) AND chunks.model_key = $2
      ${options.documentOnly || options.documentKind ? "AND chunks.source_type = 'document'" : ""}
      ${options.sourceType === "question" ? "AND chunks.source_type = 'question'" : ""}
      ${options.documentKind ? "AND documents.kind = $6" : ""}
      AND 1 - (chunks.embedding OPERATOR(extensions.<=>) $3::extensions.vector) >= $4
    ORDER BY chunks.embedding OPERATOR(extensions.<=>) $3::extensions.vector LIMIT $5`,
    [userId, embeddingService.modelKey(model), JSON.stringify(vector), threshold, limit,
      ...(options.documentKind ? [options.documentKind] : [])]);
  } catch (error) {
    if (error.code === "42P01") return [];
    throw error;
  }
  return result.rows.map((row) => ({ id: row.id, documentId: row.document_id,
    sourceType: row.source_type, label: row.source_label,
    text: row.content, similarity: Number(row.similarity) }));
}

const COMMON_QUERY_WORDS = new Set(["what", "which", "where", "when", "who", "why", "how",
  "does", "did", "have", "with", "from", "about", "this", "that", "their", "your",
  "there", "them", "were", "will", "would", "could", "should", "into", "some", "the",
  "and", "for", "job", "description", "uploaded", "document", "question", "bank", "interview"]);

function evidenceWords(value) {
  return new Set((String(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter((word) => word.length >= 4 && !COMMON_QUERY_WORDS.has(word))
    .map((word) => word.length > 5 && word.endsWith("s") ? word.slice(0, -1) : word));
}

function hasLexicalEvidence(query, source) {
  const queryWords = evidenceWords(query);
  const sourceWords = evidenceWords(source);
  const overlap = [...queryWords].filter((word) => sourceWords.has(word)).length;
  return overlap >= 2 && overlap / queryWords.size >= 0.4;
}

// A Gemini match below the threshold is still kept when the question shares concrete words with the
// passage (see hasLexicalEvidence). The floor is how low that rescue may look: measured on real
// CV/JD fixtures the right passage for "How did I prevent duplicate orders?" scored 0.48, under the
// old 0.50, while off-topic questions never reached 0.46 on documents.
const GEMINI_RESCUE_FLOOR = 0.45;

async function searchDocuments(userId, message, vector, threshold, limit, options = {}) {
  const model = embeddingService.config();
  const floor = model?.provider === "gemini" ? Math.min(threshold, GEMINI_RESCUE_FLOOR) : threshold;
  const matches = await searchKnowledge(userId, vector, floor, limit, options);
  return matches.filter((match) => match.similarity >= threshold ||
    (model?.provider === "gemini" && hasLexicalEvidence(message, match.text)));
}

async function retrieveKnowledge(userId, message, limit = 5, options = {}) {
  if (!userId || typeof message !== "string" || !message.trim()) return [];
  const model = embeddingService.config();
  if (!model) return [];
  const embed = options.embed || embeddingService.embed;
  const vector = await embed(message, "RETRIEVAL_QUERY");
  const threshold = matchThreshold(model);
  const count = Math.max(1, Math.min(10, Number(limit) || 5));
  return selectKnowledge(userId, message, vector, threshold, count, options);
}

// A question that names the user's own CV or job description is searched inside that document with
// a low floor instead of the normal match threshold: broad questions ("what is my CV about") score
// just under it, and the answer is still cited and checked like any other.
const DOCUMENT_QUESTION_FLOOR = 0.40;

async function retrieveDocumentChunks(userId, message, kind, limit = 3, options = {}) {
  const model = embeddingService.config();
  if (!userId || !model || !["cv", "jd"].includes(kind) || typeof message !== "string" || !message.trim()) return [];
  const embed = options.embed || embeddingService.embed;
  const vector = await embed(message, "RETRIEVAL_QUERY");
  return searchKnowledge(userId, vector, DOCUMENT_QUESTION_FLOOR, Math.max(1, Math.min(5, limit)), { ...options, documentKind: kind });
}

async function selectKnowledge(userId, message, vector, threshold, count, options = {}) {
  const intent = knowledgeIntent(message);
  if (options.documentOnly) return searchDocuments(userId, message, vector, threshold, count, options);
  if (intent === "comparison") {
    const cv = await searchDocuments(userId, message, vector, threshold, count, { ...options, documentKind: "cv" });
    const jd = await searchDocuments(userId, message, vector, threshold, count, { ...options, documentKind: "jd" });
    return [...cv.slice(0, Math.ceil(count / 2)), ...jd.slice(0, Math.floor(count / 2))];
  }
  const documents = await searchDocuments(userId, message, vector, threshold, count,
    { ...options, documentOnly: true });
  const questions = await searchKnowledge(userId, vector, threshold, count, { ...options, sourceType: "question" });
  const documentQuota = intent === "question" ? Math.min(2, count) : Math.min(3, count);
  const selected = [...documents.slice(0, documentQuota), ...questions.slice(0, count - documentQuota)];
  for (const match of [...documents, ...questions]) {
    if (selected.length >= count) break;
    if (!selected.some((item) => item.id === match.id)) selected.push(match);
  }
  return selected;
}

function matchThreshold(model = embeddingService.config()) {
  const configured = process.env.RAG_MATCH_THRESHOLD ||
    (model?.provider === "gemini" ? process.env.RAG_MATCH_THRESHOLD_GEMINI : process.env.RAG_MATCH_THRESHOLD_LOCAL);
  const value = configured ? Number(configured) : (model?.provider === "gemini" ? 0.60 : 0.65);
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("RAG match threshold must be between 0 and 1");
  return value;
}

function knowledgeIntent(message) {
  if (/\b(compare|match|fit|align|gap|suitable)\b|so sánh|phù hợp/i.test(message) &&
      /\b(cv|resume|curriculum vitae|experience|skills?)\b|kinh nghiệm|kỹ năng/i.test(message) &&
      /\b(jd|job description|job posting|job requirements?|requirements?)\b|\b(the|this|that|target|advertised) (job|role|position)\b|công việc|vị trí|yêu cầu/i.test(message)) {
    return "comparison";
  }
  if (/\b(question bank|reference answer|model answer|sample question)\b|đáp án mẫu|câu hỏi mẫu/i.test(message)) {
    return "question";
  }
  return "document";
}

const ORDINAL_NUMBERS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10 };

// The interview chunks are labelled "Question 2 ..." so a message that says "the first question" or
// "question two" is rewritten to "question 1" / "question 2" before it is embedded. "last"/"final"
// needs the number of answered questions.
const ORDINAL_ITEM = "(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\\d{1,2}(?:st|nd|rd|th))";
const ORDINAL_LIST = new RegExp(
  `\\b(?:the\\s+)?(${ORDINAL_ITEM}(?:\\s*(?:,|and|&)\\s*(?:the\\s+)?${ORDINAL_ITEM})*)\\s+(?:questions?|answers?|q)\\b`, "gi");

function ordinalToNumber(item) {
  const word = item.toLowerCase();
  return ORDINAL_NUMBERS[word] || Number.parseInt(word, 10);
}

function normalizeQuestionReferences(message, totalQuestions) {
  return String(message)
    // "the first question", "2nd answer", "the first and second answers", "first, third questions"
    .replace(ORDINAL_LIST, (_, list) => list.split(/\s*(?:,|and|&)\s*(?:the\s+)?/i)
      .map((item) => `question ${ordinalToNumber(item)}`).join(" and "))
    .replace(/\b(?:question|answer|q)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi,
      (_, word) => `question ${ORDINAL_NUMBERS[word.toLowerCase()]}`)
    .replace(/\b(?:the\s+)?(?:last|final)\s+(?:question|answer)s?\b/gi,
      (match) => (Number.isInteger(totalQuestions) && totalQuestions > 0 ? `question ${totalQuestions}` : match));
}

const MAX_PINNED_QUESTIONS = 2;

function referencedQuestionNumbers(normalizedMessage) {
  return [...new Set([...String(normalizedMessage).matchAll(/\bquestion (\d{1,2})\b/gi)].map((m) => Number(m[1])))]
    .filter((n) => n >= 1).slice(0, MAX_PINNED_QUESTIONS);
}

async function pinnedQuestionChunks(query, userId, sessionId, modelKey, normalizedMessage) {
  const numbers = referencedQuestionNumbers(normalizedMessage);
  if (!numbers.length) return [];
  // Chunk ids are `<session>-critique-<n>-<part>` (rubric bands + key points) and `<session>-turn-<n>-<part>`.
  const ids = numbers.flatMap((n) => [1, 2].flatMap((part) =>
    [`${sessionId}-critique-${n}-${part}`, `${sessionId}-turn-${n}-${part}`]));
  const result = await query(`SELECT id, source_label, content FROM interviewai_rag_chunks
    WHERE user_id = $1 AND session_id = $2 AND model_key = $3 AND id = ANY($4::text[])
    ORDER BY id`, [userId, sessionId, modelKey, ids]);
  return result.rows.map((row) => ({ id: row.id, label: row.source_label, text: row.content, similarity: 1 }));
}

async function retrieve(userId, context, message, options = {}) {
  await indexSession(userId, context, options);
  const model = embeddingService.config();
  const query = options.query || ((sql, values) => getPool().query(sql, values));
  const embed = options.embed || embeddingService.embed;
  const searchText = normalizeQuestionReferences(message, context.session?.turns?.length);
  const vector = await embed(searchText, "RETRIEVAL_QUERY");
  const threshold = matchThreshold(model);
  const result = await query(`SELECT id, source_label, content,
      1 - (embedding OPERATOR(extensions.<=>) $4::extensions.vector) AS similarity
    FROM interviewai_rag_chunks
    WHERE user_id = $1 AND session_id = $2 AND model_key = $3
      AND 1 - (embedding OPERATOR(extensions.<=>) $4::extensions.vector) >= $5
    ORDER BY embedding OPERATOR(extensions.<=>) $4::extensions.vector LIMIT 5`,
    [userId, context.session.id, embeddingService.modelKey(model), JSON.stringify(vector), threshold]);
  const sessionMatches = result.rows.map((row) => ({ id: row.id, label: row.source_label,
    text: row.content, similarity: Number(row.similarity) }));
  const knowledgeMatches = process.env.STORE_BACKEND === "memory" && !options.query ? []
    : await selectKnowledge(userId, searchText, vector, threshold, 5, options);
  // Embeddings barely tell "question 1" from "question 2", so a message that names a question gets
  // that question's own chunks looked up by id (still only this user's, this session's).
  const pinned = await pinnedQuestionChunks(query, userId, context.session.id, embeddingService.modelKey(model), searchText);
  const selected = [...pinned];
  for (const match of [...sessionMatches.slice(0, 3), ...knowledgeMatches.slice(0, 2)]) {
    if (selected.length >= 5) break;
    if (!selected.some((item) => item.id === match.id)) selected.push(match);
  }
  for (const match of [...sessionMatches, ...knowledgeMatches]) {
    if (selected.length >= 5) break;
    if (!selected.some((item) => item.id === match.id)) selected.push(match);
  }
  return selected;
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
    [userId, sessionId, embeddingService.modelKey(model), JSON.stringify(vector),
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
  deleteSessionIndex, deleteInterviewIndex, matchThreshold, knowledgeIntent, hasLexicalEvidence,
  normalizeQuestionReferences, referencedQuestionNumbers, retrieveDocumentChunks, GEMINI_RESCUE_FLOOR, DOCUMENT_QUESTION_FLOOR };
