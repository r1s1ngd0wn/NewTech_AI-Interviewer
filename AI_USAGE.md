# AI usage log

Every part of the project that was generated or substantially written with an AI tool is listed
here: the tool, the key prompt, and what was checked or changed afterwards. Each member keeps their
own section so the branches merge cleanly. Two cases where AI output was wrong are required per
member; they are marked "AI got it wrong".

Tool used for all entries in Khoa's section: Claude Code (Anthropic) in the Claude desktop app.

---

## Khoa

Modules owned: interview flow and scoring, structured output (per-answer review), evaluation set,
prompt files, history, admin usage dashboard.

### 1. Per-answer review with structured output (`critiqueService.js`, `schemas/critique.js`, `utils/schema.js`)

- **Key prompt (paraphrased from the conversation):** "ground the LLM answer to the context of the
  questions and answers themselves, not the LLM completely generating the answer", later "start
  working on my part: prompt files, critique with Zod, evaluation runner".
- **Generated:** the Zod schema, the conversion of that schema to Gemini's `responseSchema`, the
  retry-once-on-invalid-JSON loop, the scripted fallback review, the feedback page component.
- **Checked / changed by me:**
  - Ran it against the real Gemini API and the local Gemma 4 E4B model, not only against stubbed
    `fetch` in tests. Read the outputs for each of: partial answer, off-topic answer, prompt
    injection inside an answer.
  - Confirmed that rubric scores are identical with the model on and off (test in
    `backend/test/critique.test.js`).
  - 106 backend tests pass (`npm test` in `backend/`).

### 2. Prompt files and registry (`backend/src/prompts/`)

- **Generated:** the registry (`index.js`), `reaction.md`, `critique.md` (version 2), and the
  archived `critique.v1.md` kept for the before/after evaluation.
- **Checked / changed:** a prompt placeholder with no value throws instead of sending
  `{{persona}}` to the model (test). Chat prompt left in `chatService.js` because Long is
  replacing it.

### 3. Evaluation runner and critique cases (`backend/eval/`)

- **Generated:** the runner (`run.js`), the pass/fail rules (`checks.js`), 8 critique cases.
- **Checked / changed:** the checks are deterministic (no second model grades the first), and the
  rules are unit tested (`backend/test/eval.test.js`). I wrote the expected results for each case
  by reading the question bank's key points myself.
- **What the runner found:** the first run on the local model failed 3 of 24 runs because Gemma
  returned a list as one string, which the generated schema rejected twice in a row. I changed the
  schema to split a string into lines and retried empty replies once. The pass rate went
  79% -> 88% -> 100% (`docs/adr/0002-grounding-checks-on-model-output.md`).

### AI got it wrong, case 1: invented explanations in the "stronger answer"

- **What happened:** the review prompt said "built only from what the candidate said plus the key
  points". Gemini still wrote definitions that are not in the question bank ("encapsulation
  bundles data and methods", "polymorphism lets objects be treated as instances of their parent
  class"), because the key point only names the four OOP principles.
- **How I found it:** reading real Gemini output side by side with the question's
  `referenceAnswer`; no unit test could show this because tests stub the model.
- **Fix:** prompt version 2 (explicit "if a key point only names a concept, name it, do not explain
  it") and, because the prompt change alone still failed on the OOP question, a deterministic check
  in `critiqueService.js` that drops the stronger answer when under 60% of its words come from the
  question, key points and the candidate's answer. Measured in `docs/adr/0002-grounding-checks-on-model-output.md`.

### AI got it wrong, case 2: finishing blocked on the model

- **What happened:** the first design started the per-answer reviews in the background and made
  "Finish" wait up to 20 seconds for them.
- **How I found it:** a real run through the browser. The answers returned in 74 ms but Finish took
  20 seconds and 3 of 5 reviews had timed out, because Gemini's free tier took 5 to 20 seconds
  per review. The stubbed tests had passed.
- **Fix:** Finish waits at most 6 seconds; the result carries `critiquesPending` and the feedback
  page refreshes itself until the reviews arrive. A test holds the model response back and checks
  that a late review replaces the basic one.

### AI got it wrong, case 3: filler-word counting (earlier work on the scoring module)

- **What happened:** the generated filler detector used a plain substring search, so "um" matched
  inside "documentation", "number" and "columns", and a clean answer scored 0 for Fluency.
- **Found by:** testing a clean answer end to end and seeing the score.
- **Fix:** word-boundary regexes in `backend/src/utils/text.js` and a regression test in
  `backend/test/scoring.test.js`.

### 4. Review of Long's RAG branch and the fixes (`khoa/rag-fixes`)

- **Key prompt (paraphrased):** "check Long's branch and test run it", then "fix it directly" after
  the group agreed in chat.
- **Generated:** trial-merge and live test scripts (Supabase, local Gemma and Gemini), and the fixes:
  narrower input-guard patterns, a lower Gemini rescue floor, question-number lookup for the debrief
  chat, and a `plainText` helper for chat replies.
- **Checked / changed by me:** every claim was measured, not assumed. The guard was tried on 14
  phrasings Long had not seen (it caught none), the false positives on real questions ("I built a
  weather app...") were reproduced, and each fix was re-tested live against the shared Supabase
  project with temporary accounts that were deleted afterwards.
- **AI got it wrong, case 4:** my first guard rewrite used one pattern list for both chat messages
  and uploaded CVs. Reading it back, `Override system defaults...` and a CV line `Developer: Java`
  would have been deleted from users' CVs by `sanitizeSourceText`. Split into a document list and a
  chat list, with tests for both.
- **AI got it wrong, case 5:** rewriting "the first question" to "question 1" before the embedding
  search did not help, because embeddings barely tell "question 1" from "question 2" (the chunk for
  question 2 ranked above question 1's own). Found by printing the similarity scores; fixed by
  looking the numbered chunks up by id, scoped to the user and session.

### 5. Merging the critique onto Long's async Postgres store (`khoa/critique-on-main`)

- **Generated:** the merge of 8 conflicting files (`sessionService`, `llmService`, prompt registry,
  routes, package files, this file) and a new `setTurnCritique` store method.
- **Checked / changed:** 194 backend tests, plus a real run on Supabase (reviews written while later
  answers are submitted, request log rows, debrief chat). Finish went from 16 s to about 10 s once the
  wait for reviews ran alongside scoring.
- **AI got it wrong, case 6:** converting Long's prompt files to the new header format, my script read
  them from the wrong merge stage and wrote three prompts with empty bodies, then deleted the
  originals. I noticed the empty `prompt("coach")` in the check output, restored them from `main`,
  and added a test that the three prompts are identical to Long's originals.
- **AI got it wrong, case 7:** the first version of the merged critique code wrote each review by
  reading the whole session and saving it back. With Long's async database that can overwrite an
  answer submitted a moment earlier. Caught while designing the merge; replaced with a single-field
  `jsonb_set` update, with a test that two answers survive a review landing between them.

### 6. History search and the admin AI usage dashboard (US-05, US-13)

- **Key prompt (paraphrased):** "can we do 05 and 13".
- **Generated:** `GET /api/sessions` (validation in `historyService.js`, SQL and an in-memory twin in
  `store/sessionSearch.js`), `GET /api/admin/usage` (`usageService.js`, aggregation SQL over `ai_logs`),
  the History and Admin usage pages, and their tests.
- **Checked / changed by me:** the SQL is tested on a real PostgreSQL (PGlite) with the project's actual
  migrations and row-level security, and the memory search must return exactly what the SQL returns. The usage
  figures were checked against totals calculated by hand from seed rows, and against a plain `count(*)` on the
  live `ai_logs` table (140 = 140). Pages were opened in a real browser at desktop and 375 px width.
- **Design choices that were mine to check:** a refused request (no model called) is left out of latency and
  cost; an unknown price is shown as "unknown" and counted, never as 0; filters travel in the URL; every value
  reaches SQL as a bound parameter and the only text built into a statement comes from two whitelists.
- **AI got it wrong, case 8:** a test file I wrote (`usageFormat.test.js`) never ran. The Vitest config only
  includes `*.test.jsx`, so my `.js` file was silently skipped and the suite still said "passed". I noticed the
  count (33) equalled the old 16 plus only the two page suites, widened the pattern, and the 6 hidden tests ran.
- **AI got it wrong, case 9:** `beforeEach(() => api.getUsage.mockResolvedValue(...))` returns the mock, and
  Vitest runs a function returned from `beforeEach` as a cleanup hook, so after the "error" test it called the
  mock again, got a rejected promise and failed the test with an error that pointed at the wrong line. Fixed with
  braces; the same trap is why the History test used braces.
- **AI got it wrong, case 10:** my first run of the pages in a browser showed a blank screen. The cause was not my
  code but `AuthContext.jsx` in the documented preview-auth mode: `false?.data.subscription` throws when
  `subscription` is `false`. One-character fix (`?.data?.subscription?.`), reported to Đức. Only a real browser
  run could have found it, because the unit tests never mount the provider in preview mode.
---

## Long

Written by Long (copied unchanged from his branch):

- AI assistance: implemented and reviewed reusable document upload/list/preview/delete, pgvector retrieval, source handling, basic input guardrails, streaming stop control, automated tests and documentation.
- Human decisions required: verify the CV/JD experience in a live browser after merging with teammates' work, and review retrieval quality, latency and provider quota on a larger evaluation set. Migrations 004/005 and the 76 question-bank entries were applied to the currently configured Supabase project on 2026-10-24.
- Verification recorded in this repository: `backend/test/long.test.js` and the full backend test suite. On 2026-10-24, `npm run eval:long:live` with Gemini embeddings and the two synthetic fixtures passed 23/23 source-selection cases and 11/11 guard cases at the local `RAG_MATCH_THRESHOLD=0.55`. This does not measure factual correctness of generated answers or performance on a larger real-world set.
- Review follow-up: added per-file and per-user upload limits, bounded DOCX expansion, source-balanced retrieval, provider-specific threshold defaults, Nomic query/document prefixes, selective chat deletion, versioned Coach/debrief prompts, and metadata-only AI request logging. The `backend/eval/long-cases.json` cases can now be run with `npm run eval:long`; live retrieval requires sample documents in a dedicated test account.

---

## Đức

_(to be filled in by Đức: agent tools, authentication, logging, fallback)_

# Person 3 implementation assistance — 2026-10-24

Codex assisted with Supabase auth/RLS migrations, bounded Gemini tools and atomic confirmation, practice plans API/UI, request telemetry/health/fallback, tests and deployment setup. Requirements came from the team's PLAN (1).md. Existing Long_RAG RAG/SSE/data contracts were preserved; scope and unresolved cloud integration are documented in docs/DUC_SETUP.md and docs/DUC_TRACEABILITY.md.

Verification uses offline fixtures, real local HTTP and embedded PostgreSQL/pgvector; these do not establish Google OAuth or live model quality. A separate read-only code review identified storage-path trust, revoked profile access, misleading AI telemetry and provider-disable handling; regression tests were added before the fixes. No user secrets were committed, no external messages were sent, and no production deployment was performed. Team members must review and understand generated code before submission.
