# AI usage log

## Long - document RAG and streaming

- AI assistance: implemented and reviewed reusable document upload/list/preview/delete, pgvector retrieval, source handling, basic input guardrails, streaming stop control, automated tests and documentation.
- Human decisions required: run SQL migrations and question indexing against the group's Supabase project; verify the CV/JD flow in a live browser; measure retrieval quality, latency and cost before reporting evaluation results.
- Verification recorded in this repository: `backend/test/long.test.js` and the full backend test suite. No live Gemini/Supabase pass rate is claimed by this log.
