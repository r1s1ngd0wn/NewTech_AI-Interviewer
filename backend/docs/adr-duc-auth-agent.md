# ADR: Supabase identities, bounded tools and confirmed writes

Date: 2026-10-24. Status: implemented locally; cloud validation pending.

## Context
PLAN assigns Person 3 Google OAuth/roles, agent tools, plans, logging, fallback and deployment. Long_RAG already persists JSON application tables and pgvector documents through trusted SQL. Renaming all of those tables would conflict with Long/Khoa's work.

## Decision
- Supabase Auth is the production identity provider. Express verifies access tokens with Auth, checks the `session_id` exists, then reads the authoritative profile role. RLS plus column grants prohibit client role changes. User metadata never grants admin.
- New user data uses a JWT-bound `req.db`. Preserve the existing SQL interfaces with transaction-local verified claims and the authenticated PostgreSQL role, enforcing the same RLS on old services. Maintenance/logging retain narrowly used privileged access. Document paths are checked in SQL and before privileged Storage operations.
- Do not infer ownership from matching legacy email. OAuth UUID migration is explicit, separately reviewed work.
- Gemini function calling has a fixed allowlist and validated arguments, five rounds and eight calls per round. Preserve entire model parts/signatures and function-call IDs. RAG/tool output is untrusted data; user identity cannot be supplied by the model.
- Tool writes produce immutable ten-minute pending proposals. Only an owner confirmation endpoint executes them. A row lock and transaction couple the domain write with action completion; cancellation/expiry never writes the plan. Ordinary manual plan CRUD expresses direct user intent and remains available without AI.
- Cloud Gemini is the production provider. Legacy local adapters exist only in explicit nonproduction memory preview/test mode. No GPU service is required for deployment.
- AI metadata logs omit user content/secrets. Failures never retry a confirmed tool. Unknown usage/pricing remains unknown. Health represents the last actual observation, not a paid probe on each poll.

## Alternatives
Keeping random-token auth would not satisfy JWT/OAuth. Replacing all Long_RAG services/tables at once would expand scope and merge risk. Executing writes directly from model calls would remove the required human confirmation. Client-side confirmation alone would not protect races or direct HTTP/DB access.

## Consequences
Every authenticated legacy SQL query has a small transaction overhead. Cloud migration requires the correct DB owner connection and verified Auth setup. Direct grants require defense in depth around privileged file access. Khoa can add the usage dashboard on ai_logs and replace legacy inline prompt labels with the shared registry; Long can replace the knowledge adapter with the agreed unified transcript retriever.

References: [Supabase sessions](https://supabase.com/docs/guides/auth/sessions), [column privileges](https://supabase.com/docs/guides/database/postgres/column-level-security), [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling), [thought signatures](https://ai.google.dev/gemini-api/docs/thought-signatures).
