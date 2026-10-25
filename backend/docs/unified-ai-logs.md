# Shared AI request metadata

RAG, agent and structured output use `public.ai_logs`. Instrumentation belongs
at the outbound provider attempt. Do not add another summary row in coach,
retrieval or agent orchestration. An input guard refusal is a separate local
event (`operation=guardrail`, no provider/model); exclude it from provider-call
counts. An unconfigured provider does not generate a provider-call row.

| operation | capability | caller |
| --- | --- | --- |
| chat | coach | grounded RAG/session chat/reactions |
| chat_stream | coach | streaming RAG/session chat |
| tools | coach | each agent model round, streaming or non-streaming |
| json | critique (default) | structured output, one row per retry |
| embed_query / embed_document | embed | each embedding request |

`provider` is `gemini` or `local`. HTTP request context supplies `request_id`,
owner and prompt metadata, including when an agent calls retrieval/embedding.
`tools` describes function calls returned by the model for that round, not tool
execution success. Tool execution events still belong to the agent stream.
Tokens include Gemini reasoning output; missing usage or an unpriced model
keeps usage/cost unknown (`NULL`). No prompt, document, answer, tool arguments,
API key or raw error message is stored.

## Compatibility for Long_RAG

`aiRequestLogService` preserves `runForUser`, `logAiRequest`, `listForUser` and
`deleteForUser`. Camel-case `promptVersion`/`durationMs` and `cancelled` are
translated to the shared schema. Exports retain those camel-case fields.
Old text owner IDs use `legacy_user_id`; authenticated Supabase UUIDs use
`user_id`. These helpers are internal backend APIs, not public client queries.

The current clients own attempt logs. During merge, keep these versions of
`llmService`, `embeddingService` and `geminiClient`; resolve changes to their
business behavior separately. Do not restore the old outer log wrappers.
For transitional wrappers that still call the old summary API, request-scoped
invocation counts suppress completed instrumented calls, including overlaps
and the thinking-configuration retry. Do not mix instrumented and raw provider
implementations for the same operation inside one request: the old summary
API has no invocation ID to distinguish them. Migrate a raw implementation to
`trackAiRequest` before combining it with the shared clients.

## Database rollout

1. Pause old backend writers. Apply existing Supabase migrations in order, then
   `supabase/migrations/20261025000100_unified_ai_logs.sql` using the database
   owner/migration role. Apply the schema before deploying this backend.
2. If Long's `interviewai_ai_request_logs` table exists, the migration copies
   it under a table lock. The bigint source ID is retained in unique
   `legacy_id`; replaying the migration does not duplicate rows. Unknown token,
   cost and request IDs stay NULL. Original timestamps/metadata are preserved.
3. Verify as the database owner:

   ```sql
   select count(*) from public.interviewai_ai_request_logs;
   select count(*) from public.ai_logs where legacy_id is not null;
   select count(*) from public.interviewai_ai_request_logs l
   left join public.ai_logs a on a.legacy_id=l.id where a.id is null;
   ```

   Skip these source-table queries when no legacy table exists. The final count
   must be zero. The old source is retained for reconciliation; app roles lose
   access. A privileged database owner can still write it, so keep old backend
   writers stopped and deploy the compatibility adapter together with clients.
4. Deploy this backend and resume requests. Dashboard queries use only
   `ai_logs`, behind backend admin authorization. Keep existing RLS/client
   revokes. Do not sum the archived source with the shared table.

Historical text owners are retained without guessing account identity from
email. Linking them to new Auth UUIDs needs a separately verified owner mapping.
Account export/delete includes matching canonical and legacy owners, with
pagination for export. Deleting a migrated row also erases its archived source
through a database trigger so replay cannot resurrect it. Keep the archive
until reconciliation is accepted; it is not needed by the runtime adapter.

## Verification

From `backend`: `npm.cmd test` (Windows) or `npm test`. The SQL tests execute
the migrations in PGlite, including the optional legacy table and replay.
Provider integration tests stub HTTP and persistence; they make no paid calls.
These checks do not apply migrations to a live Supabase project.
