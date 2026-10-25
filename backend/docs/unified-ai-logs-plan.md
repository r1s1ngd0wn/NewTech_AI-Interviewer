# Unified AI logs

Approved scope: keep RAG and agent, consolidate their request metadata into
`ai_logs`, preserve Long's logging API, and count each provider attempt once.

- Add provider/operation and legacy identity columns in a new migration. Copy
  Long's bigint IDs through a unique legacy key; preserve unmatched text owners
  separately instead of casting them to UUID or assigning them to another user.
  Keep the old table for verification; retire its writer in application code.
- Keep `aiRequestLogService.runForUser/logAiRequest/listForUser/deleteForUser`.
  Share request context and delegate writes to telemetry. Provider boundaries own
  logs; the compatibility logger suppresses an outer summary when that call was
  already instrumented. Export/delete use the shared table.
- Instrument chat, stream, JSON, tool and embedding attempts with operation and
  provider. Preserve usage, safe errors, prompt metadata and request correlation.
- Verify with failing then passing integration tests for shared request IDs,
  retries, duplicate summaries, concurrent owners, telemetry failures, and SQL
  backfill replay/access control; run the complete backend suite.

Execution: inline in existing `.worktrees/duc-agent`; no live database migration
or remote branch mutation. User already requested implementation of this design.

Completed: shared schema/clients, compatibility export and erasure, replay-safe
backfill, and rollout guide (`unified-ai-logs.md`). Independent code review found
overlapping-summary duplication and text-owner UUID incompatibility; both were
reproduced with failing tests, corrected, and verified. Retry invocations share
one compatibility-summary token while each provider attempt retains its own row.

Validation: `npm.cmd test` passed 131/131 backend tests, including migration
execution with and without the legacy table, backfill replay, access control,
overlapping calls, retries, streaming, shared correlation, and telemetry outage.
Live Supabase migration remains a deployment step; no remote changes were made.
