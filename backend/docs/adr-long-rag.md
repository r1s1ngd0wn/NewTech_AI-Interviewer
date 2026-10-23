# ADR: RAG storage and retrieval (Long)

Status: implemented for the current Express/Postgres app; thresholds need live calibration.

## Decision

Use Supabase Postgres pgvector (`extensions.vector(768)`) and the existing private Storage bucket. Keep session-specific chunks in `interviewai_rag_chunks`; keep reusable CV/JD and shared question-bank chunks in `interviewai_knowledge_chunks`. A document belongs to one user; question-bank entries have no owner and are shared. Retrieval always filters private entries by authenticated user ID and session entries by both user and session ID. Use HNSW cosine indexes and at most five matches for chat. Default similarity threshold is 0.72; preparation uses 0.5.

Use roughly 2,000-character chunks with 200-character overlap for CV/JD, approximating 500/50 tokens without a provider tokenizer. Interview turn and question-bank entries are indexed as single units. The embedding model must return 768 dimensions. The question-bank index is refreshed with `npm run index:questions` after scenario changes.

## Why

Postgres already holds application data, so pgvector avoids a separate vector database and simplifies user-scoped deletion. A separate knowledge table lets the same CV/JD inform later sessions while preserving the older session-document flow. Matching by cosine similarity is simple to inspect and evaluate.

## Consequences

- Embedding each chunk costs time/quota. Uploads require a configured embedding provider.
- User documents and their embeddings are deleted together by a foreign-key cascade; session documents use the existing session cleanup path.
- No match above the threshold produces an explicit no-answer without an LLM call.
- Thresholds and chunk settings are provisional. Run a representative live eval before claiming retrieval accuracy or choosing a different chunk size/top-k.
- The current chat streams tokens before final citation validation; the saved reply removes unknown citation numbers and rejects unsupported uncited answers. Streaming previews are therefore provisional until `done`.
- On the current development setup, Gemini generation timed out for both streaming and non-streaming minimal requests at 15 seconds (also at 30 seconds for streaming). Source-grounded extractive fallback was verified live; this is not evidence that Gemini generation is healthy.
