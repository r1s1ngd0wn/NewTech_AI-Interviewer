# Cloud verification — 2026-10-25 (Asia/Saigon)

## Current status note — 2026-10-26

The user reported that Google sign-in now succeeds in their app after the provider setup. This is user-reported evidence only: this run did not inspect the hosted Supabase/Google settings or repeat the browser flow. Keep the 2026-10-25 checks below as historical observations, not the current provider state. A fresh browser/cloud check should record the project and date without exposing credentials.

Credentials were read only from ignored local environment files. No keys or passwords are included here.

## Verified against actual services

| Check | Result |
|---|---|
| Supabase PostgreSQL connection | Passed |
| profiles, plans, pending_actions, ai_logs and active-session function present | Passed |
| Ownership policies for profiles, plans, pending actions and existing sessions present | Passed |
| Gemini model access | Passed; configured model resolved to Gemini 3.6 Flash |
| Real Gemini function call | Passed with synthetic connection_check tool |
| AI request persisted in ai_logs | Passed, status ok |
| Real Gemini embedding | Passed, 768 dimensions |
| Invalid-key fallback | Passed; agent returned fallback and observed AI health became unavailable |
| Supabase test email/password login and profile trigger | Passed; default role user |
| Pending plan proposal does not create a plan | Passed |
| Other user confirming proposal | Passed, 404 |
| Owner confirmation creates actual plan | Passed |
| Repeated confirmation | Passed, 409 |
| Plan item update and cross-user visibility | Passed |
| Cancelled action cannot execute | Passed |
| Signed-out access token rejected by authentication service | Passed |
| Public publishable key and frontend URL/key synchronization | Passed |
| Email/password login using the public key | Passed |
| Actual Express JWT API, invalid-token 401, user/admin 403 | Passed |
| Express confirmation endpoint, duplicate 409, plans CRUD | Passed |
| Interview answering/scoring and progress through Express with all model calls disabled | Passed |
| Express logout revokes old token | Passed |

Initial auth/plan checks used server-only diagnostic clients and actual user sessions. A subsequent public-key test exercised the actual Express endpoints successfully; reproduce from backend with `node scripts/smokeCloudAuth.js`. This script disables generation/embedding only inside its own process and removes its temporary records. Temporary plans, proposals and the disposable second account were removed; the configured test account is retained. Its password remains in backend/.env. Browser OAuth and visual interaction are still not verified.

## Still required

- Public-key setup is complete. Secret/private keys remain backend-only; both .env files are ignored by Git.
- As of the 2026-10-25 inspection, Google Auth was reported disabled. The user later reported a successful Google login (see the 2026-10-26 status note); independently inspect current provider/redirect settings only if fresh cloud evidence is required.
- Browser Google login, admin/user UI checks and mobile/visual QA.
- Render/Vercel deployment, final CORS and redirect URLs, and deployed end-to-end checks.
- Initial live eval was 5/6; the failed planning case passed when retried separately. A diagnostic rerun finished 2/6: the other four cases received HTTP429 from Gemini and correctly returned fallback. Further cloud model requests were stopped. The initial report and the intermediate run affected by harness delay are preserved separately in backend/eval/results; the latest report records safe transport error codes and unknown usage as null. No full live pass rate is claimed.

## Local Google readiness checks

Backend 122/122 tests, frontend 15/15 tests, and the production frontend build pass. Google UI tests cover authorization initiation, JWT account requests, new/returning-user navigation, visible callback/account-loading errors, missing verifier, and recovery. Installed-SDK tests intercept HTTP and verify PKCE authorization/code exchange, Google session persistence, and denied callbacks without contacting cloud services. Callback failures now show a generic retry message; account lookup failures also show an explanation. These checks establish code readiness and do not replace a real Google browser login after provider/redirect configuration by a project administrator.

The eval result filenames use UTC dates; a 2026-10-24 UTC timestamp can correspond to 2026-10-25 in Asia/Saigon. Unknown rates for the actual model remain null cost estimates rather than fabricated zero costs.

## Eval runner correction

The interval between live requests now occurs before entering the provider helper. A diagnostic wrapper that delayed fetch itself consumed the provider timeout and was removed. Transport failures now record only the error code/status (no response body or secrets), so rate limits can be distinguished from wrong tool selection. Run again after quota permits, optionally with LIVE_EVAL_INTERVAL_MS for pacing appropriate to the project's quota. Pacing does not solve a daily request limit.
