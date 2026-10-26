# ADR: RAG storage and retrieval (Long)

Status: implemented for the current Express/Postgres app; thresholds need live calibration.

## Decision

Use Supabase Postgres pgvector (`extensions.vector(768)`) and the existing private Storage bucket. Keep session-specific chunks in `interviewai_rag_chunks`; keep reusable CV/JD and shared question-bank chunks in `interviewai_knowledge_chunks`. A document belongs to one user; question-bank entries have no owner and are shared. Retrieval always filters private entries by authenticated user ID and session entries by both user and session ID. Use HNSW cosine indexes and at most five matches for chat. Defaults are 0.60 for Gemini and 0.65 for local embeddings; preparation uses 0.5. These are starting values pending live evaluation.

Split CV/JD text by section (a heading in capitals starts a chunk; see ADR 0004), with chunks of at most about 1,200 characters and 100 characters of overlap when a long paragraph must be cut. A document is limited to 100,000 extracted characters and 80 chunks; each user can store 10 library documents and each session 3 files. Interview turn and question-bank entries are indexed as single units. The embedding model must return 768 dimensions. Nomic local models use `search_document:` and `search_query:` prefixes and a distinct model key. Reindex documents and question-bank entries after changing the embedding model.

## Why

Postgres already holds application data, so pgvector avoids a separate vector database and simplifies user-scoped deletion. A separate knowledge table lets the same CV/JD inform later sessions while preserving the older session-document flow. Matching by cosine similarity is simple to inspect and evaluate. Coach reserves source slots for user documents and the question bank in separate searches; CV/JD comparisons search each kind separately.

## Consequences

- Embedding each chunk costs time/quota. Uploads require a configured embedding provider.
- User documents and their embeddings are deleted together by a foreign-key cascade; session documents use the existing session cleanup path.
- No match above the threshold produces an explicit no-answer without an LLM call.
- Thresholds and chunk settings are provisional. On 2026-10-24, 23/23 source-selection cases and 11/11 guard cases passed with Gemini embeddings, the supplied synthetic CV/JD fixtures, and local threshold 0.55. Four document questions scored below 0.55; a document-only rescue accepts those when similarity is at least 0.50 and at least two distinctive query words overlap the source. This small set does not establish answer accuracy or a production threshold.
- The current chat streams tokens before final citation validation; the saved reply removes unknown citation numbers and rejects unsupported uncited answers. Streaming previews are therefore provisional until `done`.
- Source-grounded extractive fallback remains available when generation fails. Gemini latency and availability depend on the configured model and quota and must be tested in the target environment.
