# AI usage log

## Long - document RAG and streaming

- AI assistance: implemented and reviewed reusable document upload/list/preview/delete, pgvector retrieval, source handling, basic input guardrails, streaming stop control, automated tests and documentation.
- Human decisions required: run SQL migrations and question indexing against the group's Supabase project; verify the CV/JD flow in a live browser; measure retrieval quality, latency and cost before reporting evaluation results.
- Verification recorded in this repository: `backend/test/long.test.js` and the full backend test suite. No live Gemini/Supabase pass rate is claimed by this log.
# Person 3 implementation assistance — 2026-10-24

Codex assisted with Supabase auth/RLS migrations, bounded Gemini tools and atomic confirmation, practice plans API/UI, request telemetry/health/fallback, tests and deployment setup. Requirements came from the team's PLAN (1).md. Existing Long_RAG RAG/SSE/data contracts were preserved; scope and unresolved cloud integration are documented in docs/DUC_SETUP.md and docs/DUC_TRACEABILITY.md.

Verification uses offline fixtures, real local HTTP and embedded PostgreSQL/pgvector; these do not establish Google OAuth or live model quality. A separate read-only code review identified storage-path trust, revoked profile access, misleading AI telemetry and provider-disable handling; regression tests were added before the fixes. No user secrets were committed, no external messages were sent, and no production deployment was performed. Team members must review and understand generated code before submission.
