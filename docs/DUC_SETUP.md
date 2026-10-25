# Person 3: setup and verification

This branch implements US-01, US-02, US-10, US-11 and US-12 against Long_RAG commit `5e4e3e9`. Main and cloud-speech-trial are unchanged. Integration with the newer combined team main is still pending; see [TEAM_MERGE_AUDIT.md](TEAM_MERGE_AUDIT.md).

## Supabase and Google

1. Create/select the team's Supabase project and invite Khoa/Long yourself through the project organization. Do not share service keys in chat or source control.
2. Install the official Supabase CLI, run `supabase login`, `supabase link --project-ref <ref>`, then `supabase db push` from the repository root. Review the migration list before applying it to a shared project. The first three files reproduce Long_RAG's `backend/sql` baseline with `IF NOT EXISTS`; subsequent files add profiles, plans, actions/logs and RLS. Do not rerun old SQL files by hand after CLI tracking is established.
3. In Google Cloud create a Web OAuth client. Its authorized callback is `https://<project-ref>.supabase.co/auth/v1/callback`. Configure the consent screen/test users as required by your Google project.
4. Enable Google in Supabase Auth > Providers using that client ID/secret. Set Site URL to the frontend origin and allow `http://localhost:5173/login` plus `https://<frontend>.vercel.app/login` under redirect URLs. Client secrets stay in Supabase settings.
5. Copy `backend/.env.example` to `backend/.env`, and `frontend/.env.example` to `frontend/.env`. Populate public URL/anon key in both; database connection and service/Secret key only in backend. Never use a service key as a frontend anon key.
6. Use a Session pooler database connection or direct connection reachable from Render, as appropriate for your Supabase project. Existing SQL services run each user query inside a transaction with the verified JWT claims and `SET LOCAL ROLE authenticated`; new plans use `req.db` through PostgREST. Both enforce RLS. Background cleanup/indexing runs with backend privileges.

Updated cloud evidence is recorded in [CLOUD_VERIFICATION.md](CLOUD_VERIFICATION.md). Database schema/RLS, public-key email login, actual Express JWT/role/plan/interview/logout endpoints, Gemini function calling, embedding and log persistence have now been verified against real services. Public-key environment configuration is complete. Browser Google login and deployment remain pending.

## Run

Use Node 24 (Node 22.12+ is also compatible with the frontend tooling).

```powershell
npm.cmd ci --prefix backend
npm.cmd ci --prefix frontend
npm.cmd run dev --prefix backend
# In another terminal:
npm.cmd run dev --prefix frontend
```

Open `http://localhost:5173`. On Windows use `npm.cmd` if PowerShell execution policy blocks `npm.ps1`.

For a disposable preview without cloud credentials, set `STORE_BACKEND=memory` in backend and `VITE_AUTH_MODE=preview` in frontend, then run both dev servers. The preview account is `test@interviewai.dev` / `password123`. It is memory-only, does not use Google OAuth, cannot upload files and is forbidden in backend production. Production frontend builds ignore preview auth. Legacy auth/provider code exists only to preserve this explicit preview and historical unit tests.

## Real test account and administrator

Set `TEST_USER_EMAIL` and a unique `TEST_USER_PASSWORD` (12+ characters) in backend/.env. Run `npm.cmd run seed:auth` from backend. This creates a confirmed Supabase email/password account; it does not change an existing account or print its password. Record demo credentials privately, never in a public README.

After the first real admin has signed up and verified their email, set `ADMIN_EMAILS` to a comma-separated allowlist and run `npm.cmd run bootstrap:admins` from backend. It grants existing verified accounts admin through the trusted database connection. The HTTP API never accepts role edits. The Admin landing route and middleware are implemented; Khoa's usage dashboard is intentionally not implemented here.

Existing legacy `user_...` accounts are not automatically merged with OAuth accounts by matching email. New Auth UUIDs start with their own data. Preserving old accounts requires a separately reviewed mapping and migration covering sessions, documents, chunks and Storage paths.

## Agent and plans

`POST /api/coach/chat` emits `status`, `token`, `sources`, `tool`, `action`, `done`, `error` SSE events. Gemini model response parts and function-call IDs are preserved, including thought signatures. Tokens come from the provider stream, not simulated typing. There are seven declared tools and a five-round limit, at most eight calls per round. User identity is obtained from authentication, never tool arguments.

Write tools save only a proposal. `POST /api/coach/actions/:id/confirm` locks the proposal row and executes its write in the same transaction. `.../cancel` permanently cancels it; it otherwise expires after ten minutes. Other users get 404. Repeat confirmation gets 409. A failed database write rolls the transaction back. Supabase row policies and immutable proposal payloads protect direct database access too.

The Plans page supports create/rename/delete plan, add/edit/remove item, date/status changes and starting practice. It exposes item IDs in a details disclosure so the coach can update an existing item without inventing an ID. Its manual CRUD remains available without Gemini.

The RAG adapter currently calls Long_RAG's `retrieveKnowledge(userId, query, 5)` (CV/JD + question bank). Long's planned unified transcript retriever is not part of this change. Swap that adapter when Long exports the agreed retriever contract. Missing critique data produces an empty missingPoints list, not invented weaknesses.

## Logging and health

Generation, tool calls, streaming, JSON and embeddings record request metadata in `ai_logs`. Request context supplies user/request ID; each prompt is labelled/versioned. No prompts, transcripts, CV content, keys or raw provider errors are persisted. Refusals are logged even when no provider call occurs.

`pricing.json` contains externally verified standard paid-tier text rates for exact supported model IDs. `cost_usd` is a list-price estimate, not an invoice. Unknown model/alias rates or missing usage are `null`. Update this configuration for the actual model and billing tier; dashboard aggregation must retain unknown costs rather than present them as free. Output usage includes reasoning tokens.

`GET /api/health/ai` returns `state`, `available` (true/false/null), `reason`, `checkedAt`. It reports configuration and the most recent observed AI request; an untested configured key reports `unknown`, not healthy. Polling health never makes paid probe requests. A later successful AI request recovers the state. The banner refreshes periodically and after coach requests. HTTP200 empty output is an error; JSON validation failures are `invalid_json`, timeout is `timeout`, quota/HTTP failures preserve the provider status. Setting `LLM_PROVIDER=none` prevents coach generation even with a key present.

An invalid-key backend smoke check has verified fallback and observed AI unavailability. The public-key Express smoke check verifies interviews/scoring/progress/plans with all model calls disabled. The browser banner and manual UI flow during an outage still need browser verification.

## Verification and eval

```powershell
npm.cmd test --prefix backend
npm.cmd test --prefix frontend
npm.cmd run build --prefix frontend
npm.cmd run eval:duc --prefix backend
```

Backend tests include real HTTP calls and an embedded PostgreSQL/pgvector execution of every migration with a minimal test implementation of Supabase-owned auth/storage schemas. They cover RLS, profile privilege escalation, revoked sessions, forged Storage paths, transactional rollback, expired/duplicate/cross-user actions, streaming/function signatures and fallback. This is not a replacement for testing Supabase Auth, Storage and OAuth against a real project.

Latest local verification: backend 122/122 tests, frontend 15/15 tests, and the production Vite build pass. Frontend DOM tests cover session expiry/refresh, action confirmation/expiry, Google initiation, JWT-backed account loading, onboarding/returning-user navigation, callback errors, missing PKCE verifier, account-service failure, and recovery after a fresh sign-in. Separate tests exercise the installed Supabase SDK with intercepted HTTP to verify PKCE authorization, callback code exchange, persisted Google session, and denied callbacks. These tests send no requests to Google or hosted Supabase.

Google sign-in code is ready for hosted provider configuration; there is no separate application callback exchange route because the Supabase SDK handles PKCE at `/login`. Someone with project permissions must complete steps 3–4 above, including both Google and Supabase redirect configuration. The local CLI configuration also leaves Google disabled until its credentials are supplied. A browser runtime was not connected, so visual/mobile QA and actual Google consent/login remain pending.

`eval/duc-cases.json` defines six agent and two fallback cases in the team's `{id, capability, input, expect, type}` shape. The offline runner reuses their real behavioral tests and writes `eval/results/<date>-duc-v1-offline.json`. It is labelled offline: latency measures the test harness and cloud usage is zero. It does not claim to evaluate live model quality.

After configuring a key, run `npm.cmd run eval:duc:live` from backend to evaluate six model-selection/refusal/proposal cases using synthetic application data. It makes paid Gemini requests, never modifies cloud application data, and writes separate live results including observed usage. Live checks have now run; see CLOUD_VERIFICATION.md for results and the current HTTP429 limitation. No full live pass or before/after model improvement is claimed. Set LIVE_EVAL_INTERVAL_MS to pace requests before starting their provider timeout when needed.

## Deployment

Render: create a Blueprint from `render.yaml`, select this branch, fill the secret environment values and set `CORS_ORIGIN` to the exact frontend origin. `/api/health` is the process health check. Do not enable memory preview on hosting.

Vercel: import this branch with root directory `frontend`, Vite framework, build `npm run build`, output `dist`. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_API_BASE_URL=https://<backend>.onrender.com/api`, then rebuild. `frontend/vercel.json` enables SPA deep links. Add that frontend login URL to Supabase allowed redirects.

Docker: put required variables in an ignored repo-root `.env` and use `docker compose up --build`. Compose passes only public Supabase settings into the frontend build. Backend service/database/Gemini secrets stay in the backend. Docker requires a running daemon; it was unavailable during this session. `supabase start` is an optional local cloud-service replacement after Docker is running; enable its Google provider only after configuring a local OAuth callback.

Final live checks: Google login → onboarding → interview → coach real tool → pending proposal → confirm once → plans page → normal-user admin denial → signed-out-token rejection → invalid-key fallback → deployed SPA refresh. Invite teammates and complete Google account/consent configuration through the provider interfaces.
