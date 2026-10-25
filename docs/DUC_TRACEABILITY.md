# Person 3 traceability

| Story | Code | Verification |
|---|---|---|
| US-01 | supabaseAuth, requireAuth, profiles migration; AuthContext, LoginPage, lib/supabase | person3-auth + SQL revoked-session tests; real Google login pending |
| US-02 | requireRole, /api/admin gate, ProtectedRoute role, profiles column grants, bootstrapAdmins | auth middleware tests + HTTP403 + SQL role edit denial |
| US-10 | agent/agent, agent/tools, geminiClient, actionService, pending_actions RPCs, ConfirmActionCard | agent/plans/SQL/HTTP tests; real confirmation checks pass; full live eval pending quota |
| US-11 | planService, routes/plans, plans migration, PlanPage | CRUD ownership/date validation tests + HTTP + SQL rollback |
| US-12 | aiHealth, aiTelemetry, llmService/geminiClient, AiStatusBanner | AI timeout/invalid JSON/disabled provider tests; real invalid-key fallback verified |
| AI logs | aiTelemetry, pricing.json, requestContext; existing chat/reaction/embedding hooks | AI tests; database migration; real log persistence verified; reconciliation with main's log table pending |
| Deploy | render.yaml, frontend/vercel.json, Docker build args, .env.example, DUC_SETUP | frontend build; actual cloud/Docker deployment pending access/runtime |

Team boundary: usage dashboard/history/structured critique UI remain Khoa's modules; transcript retrieval/unified RAG and privacy remain Long's. The AI JSON helper is provided for Khoa to consume; it does not implement or claim his critique feature.
