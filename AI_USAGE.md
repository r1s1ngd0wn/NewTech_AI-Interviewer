# AI usage log

## Long - document RAG and streaming

- AI assistance: implemented and reviewed reusable document upload/list/preview/delete, pgvector retrieval, source handling, basic input guardrails, streaming stop control, automated tests and documentation.
- Human decisions required: verify the CV/JD experience in a live browser after merging with teammates' work, and review retrieval quality, latency and provider quota on a larger evaluation set. Migrations 004/005 and the 76 question-bank entries were applied to the currently configured Supabase project on 2026-10-24.
- Verification recorded in this repository: `backend/test/long.test.js` and the full backend test suite. On 2026-10-24, `npm run eval:long:live` with Gemini embeddings and the two synthetic fixtures passed 23/23 source-selection cases and 11/11 guard cases at the local `RAG_MATCH_THRESHOLD=0.55`. This does not measure factual correctness of generated answers or performance on a larger real-world set.
- Review follow-up: added per-file and per-user upload limits, bounded DOCX expansion, source-balanced retrieval, provider-specific threshold defaults, Nomic query/document prefixes, selective chat deletion, versioned Coach/debrief prompts, and metadata-only AI request logging. The `backend/eval/long-cases.json` cases can now be run with `npm run eval:long`; live retrieval requires sample documents in a dedicated test account.
