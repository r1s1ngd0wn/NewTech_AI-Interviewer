# Auth, agent, RAG and critique integration

Integrated `origin/main` at `2cc72d6` with `duc-agent` at `8e82a57`.
Kept Long's retrieval/guard/privacy fixes, Khoa's async atomic critiques and
prompt registry, and Duc's verified JWT/RLS, tools, confirmations and plans.
All AI provider attempts now use the canonical `ai_logs` schema.

Final integration checks:

- Backend: 236/236 tests passed.
- Frontend: Node 5/5 and Vitest 16/16 passed; production build passed.
- Live database, read only: all 137 legacy log rows have canonical copies;
  no missing source IDs. Required columns and erasure trigger exist; RLS is on;
  authenticated clients cannot select/insert logs; backend can insert.
- `node scripts/smokeCloudAuth.js`: real Auth/JWT, revoked sessions, role denial,
  atomic plan confirmation, manual CRUD, interview scoring and progress passed.
- `node scripts/smokeUnifiedAiLogs.js`: real JWT-scoped SQL transaction and
  Supabase persistence passed; three synthetic model operations produced exactly
  three rows with one request ID/owner. Only model HTTP was stubbed, so no paid
  provider requests were made. Temporary rows and Auth sessions were cleaned.

Integration regressions reproduced and fixed before merging:

- Document quota transactions now preserve verified JWT claims and rollback.
- Structured critique owns its two-attempt retry limit; provider JSON validation
  stays inside telemetry, including parseable schema-invalid outputs.
- Structured Gemini retains configured thinking budget and a separately logged
  corrective attempt when the provider rejects that configuration.
- Active coach agent requires CV and JD evidence/citations for comparisons,
  buffers comparison tokens until validation, and retains cited extracts when
  generation fails after retrieval. Tool proposals still require confirmation.
- Both frontend test suites run through `npm test`; tool/action/source SSE and
  plain text presentation remain covered.

These checks establish integration behavior, not live Gemini answer quality.
Google OAuth is still disabled in the connected project; password/JWT Auth was
verified. Historical legacy owner IDs are retained without guessing identity
from email. No Groq/cloud-speech-trial changes are part of this merge.
