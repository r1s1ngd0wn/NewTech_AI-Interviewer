# Person 3 traceability

| Story | Code | Verification |
|---|---|---|
| US-01 | supabaseAuth, requireAuth, profiles migration; AuthContext, LoginPage, lib/supabase | person3-auth + SQL revoked-session tests; AuthContext deferred-response tests cover logout, expiry and account switch; Google login is user-reported, not rechecked in this run |
| US-02 | requireRole, /api/admin gate, ProtectedRoute role, profiles column grants, bootstrapAdmins | auth middleware tests + HTTP403 + SQL role edit denial |
| US-10 | agent/agent, agent/answerPolicy, agent/tools, geminiClient, actionService, pending_actions RPCs, ConfirmActionCard | person3-agent + agent-answer-policy + plans/SQL/HTTP tests; citations and tool completion checked before answer; live eval pending quota |
| US-11 | planService, routes/plans, plans migration, PlanPage | CRUD ownership/date validation tests + HTTP + SQL rollback |
| US-12 | aiHealth, aiTelemetry, llmService/geminiClient, AiStatusBanner | AI timeout/invalid JSON/disabled provider tests; real invalid-key fallback verified |
| AI logs | aiTelemetry, pricing.json, requestContext; existing chat/reaction/embedding hooks | unified-ai-logs tests; reconciliation verified in `MERGE_VERIFICATION_2026-10-25.md` (137/137 legacy rows copied, no missing IDs); real log persistence smoke passed |
| Deploy | render.yaml, frontend/vercel.json, Docker build args, .env.example, DUC_SETUP | frontend build; actual cloud/Docker deployment pending access/runtime |

Team boundary: usage dashboard/history/structured critique UI remain Khoa's modules; transcript retrieval/unified RAG and privacy remain Long's. The AI JSON helper is provided for Khoa to consume; it does not implement or claim his critique feature.
