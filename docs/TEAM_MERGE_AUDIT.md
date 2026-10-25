# Team merge audit — 2026-10-25

Audited remote `origin/main` at `2cc72d6`, after fetching origin. It contains Long's `40d755f`, Khoa's RAG review fixes `3c35202`, and structured critique `8c9f0bf`. Đức's working tree is based on `5e4e3e9`; its new implementation was still uncommitted when this audit began. Remote `duc-agent` still pointed at that old base. The screenshots therefore describe the remote branch accurately, but cannot see the local implementation.

## Checks actually run

An isolated Git archive of main was installed and tested without reading local credentials or invoking cloud models:

| Check | Result |
|---|---|
| Merged main backend | 194/194 tests pass |
| Merged main frontend | 5/5 tests pass |
| Merged main production frontend build | Pass |
| Long offline eval | 11 guard cases pass; 23 retrieval cases skipped because no live account/fixtures were supplied |
| Đức local verification before this audit | Backend 122/122, frontend 15/15, frontend build pass |

These are separate trees, not evidence that the combined application works. No live evaluation was rerun: earlier Gemini checks reached HTTP429.

## Tasks in the screenshots

| Item | Evidence and status |
|---|---|
| Rebase critique onto async store | Done on main: sessionService uses async calls; routes await them; store/table implements atomic setTurnCritique. Keep its concurrency regression tests during integration. |
| Debrief chat: full transcript/key points, document-only RAG | Partial. RAG fixes normalize question references and pin requested question chunks. When embeddings are configured, both postMessage and streamMessage still use retrieve over session/document knowledge and a debrief-rag prompt, rather than always passing the complete transcript. The exact requested design has not been implemented. A targeted end-to-end regression remains necessary. |
| Prompt registry and prompt files | Long/Khoa registry is merged: coach, debrief, debrief-rag, reaction, critique and archive files exist. Đức's agent prompt already lives in agent/prompts/coach.v1.md, loaded by coachPrompt.js; unify its loader with the shared registry during integration. |
| US-05 SQL history search/filter/sort/pagination | Not found. sessions routes have no collection GET query; DashboardPage renders progress.history in the browser. No HistoryPage exists. |
| US-13 admin AI dashboard | Not found on main. Đức has role enforcement and an Admin placeholder, not the actual statistics dashboard. |
| Cost/latency report | Partial. Main logs duration but has no tokens/cost/tools columns. Đức implements richer ai_logs and pricing, but it is not integrated with main. Unknown model pricing remains null. |
| More evaluation cases | Case count is sufficient on disk: 8 critique + 34 Long cases; Đức adds 8. Long's runner now exists and runs. Critique runner accepts only the critique suite, Long has a separate runner, and Đức has separate runners; a shared runner/report is not finished. Do not count skipped retrieval cases as passes. |
| Independent critique review | Existing tests cover schema, grounding, retries, scripted fallback, scoring invariance, ownership and asynchronous writes. No new independent live critique evaluation was performed in this audit. Stored Gemini report is 7/8, with one call failure; local-model reports are historical evidence rather than validation of the final cloud-only system. |
| Architecture diagram | No updated architecture artifact found in the audited remote tree. If held outside Git, review it separately. |
| Slides <=15 | No slide deck found in the audited remote tree. Cannot verify the screenshot's 18-slide deck or its contents from repository evidence. |
| Report, stories, traceability, AI_USAGE | ADRs and AI_USAGE exist; Đức has traceability/setup documentation locally. A complete report and all team story mappings were not found/verified. |
| Defense practice/live change | Requires the team to rehearse; code/test passes do not establish completion. |
| Agent with tools and confirmation | Present locally: seven declarations, bounded loop, pending action ownership/expiry, confirmation and cancellation API/UI. Not yet integrated into main. Reuse Long's searchKnowledge adapter when resolving the tool contract. |
| Supabase Google login and roles | Present locally: Google button/PKCE/session handling, profile trigger, JWT and role checks, RLS. Hosted Google provider remains disabled and the invited account lacks permission to configure it; actual Google browser login is pending. Main still uses legacy token auth. |
| Fallback health endpoint/banner | Present locally: /api/health/ai, AiStatusBanner, fallback tests. Not on main. Local cloud evidence includes invalid-key fallback; combined-system behavior still needs verification. |
| Groq speech polish | Separate cloud-speech-trial work; not included in this Person 3 integration or audited for completion here. Do not include it accidentally with the auth/agent merge. |

## Integration blockers

1. **One logging contract.** Main uses interviewai_ai_request_logs/aiRequestLogService; Đức uses ai_logs/aiTelemetry. Main lacks tokens, cost and tools. Its 006 migration ties user_id to legacy interviewai_users, which cannot simply be assumed to exist for Supabase Auth UUID users. Choose one canonical schema and write a compatible migration/adapter; preserve account export/deletion and request attribution. Do not keep two disconnected dashboards/log streams or silently double-log requests.
2. **One LLM contract.** Both sides implement generateJson. Khoa expects responseSchema, promptVersion, timeoutMs, temperature and maxOutputTokens and owns the validation retry. Đức's helper has a different metadata/retry interface. Reconcile explicitly to avoid lost metadata/settings and multiplied retry calls. Retain Gemini signed function-call parts, streaming cancellation and telemetry.
3. **Auth and database access.** Keep Đức's verified JWT, active-session checks, role protection, user-scoped db/SQL context and Storage path checks. Keep Khoa's asynchronous store and atomic critique writes. Main's logging context must migrate with the new authentication middleware.
4. **Coach and guardrails.** Keep Long's latest guard/retrieval/privacy fixes, Khoa's prompt registry/critique, and Đức's bounded tool loop/action SSE. ConfirmActionCard and all source/tool events must survive the CoachPage merge.
5. **Migration history.** Main adds backend/sql/004–006 while Đức introduces supabase/migrations with its own schema/RLS. Inventory the real database and CLI history before applying a consolidated migration; do not rerun baseline SQL blindly or weaken RLS to fix conflicts.
6. **Both frontend test suites.** Main runs node tests in frontend/test, while Đức runs Vitest tests under src. Merge scripts so neither suite disappears. Regenerate lockfiles after combining dependencies.

A read-only three-way file merge simulation used base 5e4e3e9, local working files and origin/main, with CRLF normalized to LF. Seventeen tracked files overlap; twelve have content conflicts: AI_USAGE.md, backend/.env.example, backend/package.json, requireAuth.js, accountService.js, aiSimulator.js, chatService.js, coachService.js, embeddingService.js, llmService.js, frontend/package.json and CoachPage.jsx. This is a file-level simulation, not an attempted Git merge; even automatically merged files still require behavioral review.

## Completion order

Preserve/publish Đức's implementation branch first so teammates can review it. Integrate into a separate branch based on 2cc72d6; resolve the six contracts above, then run the union of all backend and frontend suites, the production build and offline evals. Verify real JWT/RLS/confirmation/account privacy flows against the combined migration set. Complete US-05, US-13, the final eval/report/architecture/slides, and actual Google/deployment verification before declaring the entire PLAN complete. Publishing a review branch does not establish merge readiness or deployment completion.
