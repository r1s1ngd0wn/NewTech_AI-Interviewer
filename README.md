# InterviewAI

## Person 3 implementation (Long_RAG integration)

For current Supabase Auth/Google login, roles, agent tools with confirmation,
practice plans, AI logging/fallback, test accounts and Render/Vercel setup, use
[DUC_SETUP.md](docs/DUC_SETUP.md). It supersedes the legacy token-auth and local-model
instructions below. Persistent environments now use Supabase Auth; the old fixed
login is only for explicit memory preview. New Auth users do not inherit legacy
account data by email. All schema changes are tracked in `supabase/migrations/`.

Verification: `npm test --prefix backend`, `npm run build --prefix frontend`,
`npm run eval:duc --prefix backend`. Cloud login/deploy and live eval require provider
configuration; local tests are not evidence that those external steps have run.

An interview practice app with account/profile, scenario selection, optional CV/job-description
upload before the interview, a live spoken session, rubric-based scoring, feedback report,
a post-interview chat, and progress tracking.

## Stack

- **Backend** - Node.js + Express with Supabase Postgres for application data, pgvector
  for interview/document retrieval, and private Supabase Storage for uploaded files.
  Scoring remains deterministic and rubric-based. The interview chat can use Gemini or
  a local OpenAI-compatible model, with scripted answers when no model is configured.
- **Frontend** - React + Vite, React Router, plain CSS (no build-time CSS framework). Uses the
  browser's Web Speech API (`SpeechRecognition` / `speechSynthesis`) for STT/TTS, with a text
  fallback if the browser doesn't support it (e.g. Firefox). The transcript is editable, so a
  misheard word can be corrected before submitting. With a `GROQ_API_KEY` the answer is recorded and
  transcribed by Groq's Whisper model instead (see "Optional: Groq Whisper speech").

## Test account

Outside production, a fixed test account is seeded the first time the backend starts (see
`backend/src/db/seed.js`), profile already filled in and one completed practice session so
the dashboard isn't empty:

- Email: `test@interviewai.dev`
- Password: `password123`

It is **not** created when `NODE_ENV=production` unless `SEED_TEST_ACCOUNT=true`.

## Running locally

Requires Node.js 22.5+ and a Supabase project. Before starting the backend:

1. Create a Supabase project. In its SQL Editor, run `backend/sql/001_app_store.sql`,
   then `backend/sql/002_rag.sql` (creates the private Storage bucket too), then
   `backend/sql/003_document_library.sql` (reusable CV/JD library and shared question index),
   then run `npm run migrate:followup` in `backend` for the session-owner index and AI request log table.
2. Copy `backend/.env.example` to `backend/.env`. From Supabase **Connect**, copy the
   Direct connection string (IPv6) or Session pooler string (IPv4) into `DATABASE_URL`.
   Replace its password placeholder locally; percent-encode reserved characters.
3. From Project Settings > API Keys, set `SUPABASE_URL` and the **Secret key**
   as `SUPABASE_SECRET_KEY` in `backend/.env` for file upload. Never put the secret key
   or database URL in frontend code or Git. Set `GEMINI_API_KEY` plus `EMBEDDING_PROVIDER=gemini`, or use
   local chat/embedding models as configured below.

```bash
cd backend
npm install
npm run dev
```

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api/*` to the backend on port 4000
(see `frontend/vite.config.js`), so no CORS setup is needed in development.

The **Coach** page works before an interview. It retrieves your CV/JD library and indexed
question-bank entries, streams answers with citations, and refuses off-topic requests.
The chat on a completed feedback page still answers about that particular interview.
To refresh question-bank embeddings after editing scenarios, run `npm run index:questions`
from `backend` (one embedding request per question; check your provider quota first).
After changing embedding model or enabling a Nomic local model, run `npm run index:questions`
and `npm run reindex:documents`. Nomic queries and documents use different prefixes; existing
vectors are re-embedded under a new model key.

To try document-grounded questions, open **Documents** and upload a CV or job
description (PDF, DOCX, TXT or Markdown, up to 5 MB, 100,000 extracted characters and
80 searchable chunks of up to about 1,200 characters, split by section). Each account can keep 10 library documents and each interview
can hold 3 session documents. Documents in the library are
available to your future interviews. You can also upload a document only for one
interview on its preparation screen. Then select **Start interview**. A matching excerpt
is available under **Context from...** while the interviewer speaks only the scenario question;
the original question and its scoring keywords remain intact. Without a matching document,
the scenario question is shown as written. After scoring,
the same documents are available to the interview chat. Delete session files from that
chat or library files from **Documents**. Deletion removes their search chunks and any
saved question excerpts derived from the file. Chat history is cleared only for sessions
that included the deleted file as question context or cited it in a reply.

## Tests

```bash
cd backend
npm test
```

Uses Node's built-in test runner against isolated in-memory tables, so it never touches
Supabase. Covers the scoring rules (including filler-word
matching), auth validation and token expiry, session lifecycle, chat, stale-session cleanup,
  account deletion/export, RAG source isolation, document limits, selective chat deletion,
  no-match replies, input guardrails and SSE framing.

`npm run eval:long` runs guardrail cases without a database. To evaluate retrieval, upload
`test-fixtures/sample-cv-long-test.txt` and `test-fixtures/sample-jd-long-test.txt` to a
dedicated test account, index the question bank, then run `npm run eval:long:live` when
only one account has both fixtures. With several accounts, set
`$env:EVAL_EMAIL="your-test-email@example.com"` and run `npm run eval:long` in PowerShell. The runner
checks 23 retrieval questions and reports source selection, not factual correctness of
generated prose. Review failed cases before changing the similarity threshold.
On 2026-10-24 the supplied synthetic fixtures passed 23/23 source-selection cases and
11/11 guard cases with Gemini embeddings at local threshold 0.55. This is a small
fixture result, not a general answer-accuracy claim.

For a temporary UI preview before creating a Supabase project, start the backend with
`STORE_BACKEND=memory`. This mode is disabled in production, never uses SQLite, does not
persist data and cannot upload files. Normal development uses Supabase.

### AI evaluation

`npm run eval` (in `backend/`) calls the configured model on the cases in `backend/eval/cases/`,
applies deterministic checks, prints the pass rate and average time, and saves the result to
`backend/eval/results/`. It makes real API calls. Useful options: `--provider local` (LM Studio, no
quota), `--model NAME`, `--runs 3` (the model is not deterministic), `--prompt-file
src/prompts/archive/critique.v1.md --no-grounding` (reproduce the behaviour before a change). See
`docs/adr/0002-grounding-checks-on-model-output.md` for the first before/after results.

## Configuration (`backend/.env`, see `.env.example`)

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 4000) |
| `CORS_ORIGIN` | Allowed browser origin. Required in production, `*` in development |
| `NODE_ENV` | `production` disables the demo login and the open CORS default |
| `SEED_TEST_ACCOUNT` | `true` to force the demo login in production (demos only) |
| `TRUST_PROXY` | Number of reverse proxies in front (1 with the bundled nginx) so rate limiting sees real client IPs |
| `DATABASE_URL` | Supabase Postgres connection string; required to start the backend |
| `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | Server-only access to the private upload bucket; legacy service-role key is also accepted |
| `STORE_BACKEND` | `memory` for a temporary local preview without Supabase; never for production |
| `EMBEDDING_PROVIDER` | `gemini` or `local` to enable pgvector RAG |
| `GEMINI_EMBEDDING_MODEL` | Gemini embedding model (default `gemini-embedding-001`) |
| `LOCAL_EMBEDDING_MODEL` | Local embedding model ID; must return 768 dimensions |
| `RAG_MATCH_THRESHOLD` | Optional global cosine-similarity override; unset uses provider defaults |
| `RAG_MATCH_THRESHOLD_GEMINI` / `RAG_MATCH_THRESHOLD_LOCAL` | Optional provider overrides (defaults 0.60 / 0.65); validate with `eval:long` |
| `RAG_PREP_THRESHOLD` | Minimum document similarity for interview question context (default 0.5) |
| `GEMINI_API_KEY` | Optional. Enables Gemini for chat replies and interviewer reactions |
| `GEMINI_MODEL` | Gemini model name (default `gemini-flash-latest`) |
| `LLM_TIMEOUT_MS` | Per-call timeout for the model (default 15000; interviewer reactions use 8000) |
| `GEMINI_THINKING_BUDGET` | `0` (default) switches reasoning off for speed; `default` leaves it to the model |
| `LLM_REACTIONS` | `off` stops the model writing interviewer reactions |
| `LLM_CRITIQUE` | `off` stops the model writing the per-answer review on the feedback page (a basic review is shown instead) |
| `LLM_PROVIDER` | Providers in the order they are tried: `local,gemini` (Gemma first, Gemini if it fails), `local`, `gemini`, or `none` for scripted replies. Unset means Gemini if a key exists |
| `LOCAL_LLM_URL` / `LOCAL_LLM_MODEL` / `LOCAL_LLM_API_KEY` | Local server base URL (default LM Studio `http://localhost:1234/v1`), model id, optional key |
| `GROQ_API_KEY` / `GROQ_SPEECH_LANGUAGE` | Optional. Turns on Groq Whisper transcription of spoken answers (language code, default `en`) |
| `LLM_REACTION_TIMEOUT_MS` | How long an interview waits for a model-written reaction (8000 Gemini, 20000 local) |

AI request metadata (user ID, provider, model, operation, prompt version, duration, status)
is saved in `interviewai_ai_request_logs` after migration 005. Prompts, document text,
model responses and keys are not saved in this log. The Coach and completed-interview
chat use versioned prompts in `backend/src/prompts/`. Account export includes these
metadata rows, and account deletion removes them. Migration 006 makes late-arriving logs
subject to the same deletion rule; it does not alter existing orphan rows.

## Optional: Gemini API for the LLM parts

The interviewer's short reaction after each answer, the per-answer review on the feedback page and the post-interview chat can be written by
Google's Gemini API. Add these lines to `backend/.env` (git-ignored; never put the key in
`frontend/`), then restart the backend:

```
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-flash-latest
```

Without a key everything keeps using the scripted replies. With one:

- **Chat without embeddings**: the model gets that session's transcript, question-bank key
  points and final rubric result. Invented quotes are retried, then replaced by a scripted answer.
- **Chat with embeddings**: questions/answers, feedback, shared question-bank entries and
  uploaded documents are searched in pgvector. Private matches are filtered by user; interview
  matches are filtered by user and session. Cited source excerpts are shown in chat. If nothing
  clears the threshold, chat says it could not find an
  answer. The stream endpoint displays model output incrementally via SSE.
- **Preparation**: document embeddings select relevant excerpts before the interview. Each
  excerpt is shown separately from the spoken scenario question. The fixed question and its
  rubric keywords are saved with the session.
- **Reactions** (`aiSimulator.llmReaction`): one short acknowledgement per answer. A generated
  line that asks a question or runs long is discarded.
- **Scoring stays deterministic**: the model may read final scores to explain them, but cannot
  recalculate them. Per-question scoring `keywords` are not sent to the model.
- **Fallback**: on any error (bad key, quota, timeout) the scripted answer is used and the chat
  shows why, e.g. "Gemini returned 429: quota exceeded".
- **Privacy**: with Gemini chat/embeddings, relevant transcript and uploaded text is sent to
  Google; with local models inference stays on your computer, while application data and files
  remain in Supabase. Uploaded
  originals are kept in a private bucket and deleted with their session/library entry/account. Use practice
  data only and do not upload sensitive real CVs without consent.
- **Free-tier limits**: Google's free tier can be as low as 20 requests per day per model
  (`gemini-3.5-flash` was), and one interview uses up to 5 reaction calls plus every chat message.
  A model that answers in 1 to 3 seconds without hitting the limit (`gemini-3.1-flash-lite` did) is
  a better fit, or set `LLM_REACTIONS=off` so only the chat uses the model.
- **Speed**: reasoning models can take 5 to 10 seconds for a one-line reply, so thinking is turned
  off by default (`GEMINI_THINKING_BUDGET=0`; use `default` to leave it to the model).
- **Model names**: Google retires old versions for new keys (`gemini-2.5-flash` returns 404), which
  is why the default is the `gemini-flash-latest` alias.
- **Cost guard**: chat is limited to 20 messages per minute per IP, and `LLM_TIMEOUT_MS` (default
  15000) bounds each call.
- **Swapping to a local model**: `backend/src/services/llmService.js` is the only file that talks to
  a provider. Keep its `generate({ system, messages })` contract and point it at Ollama or
  llama.cpp.

## Optional: a local model (LM Studio, Ollama, llama.cpp)

Every AI feature (interviewer reactions, the per-answer review, the debrief chat, and the Coach with
its tools) can run on a model on your own computer. In LM Studio, load a model, open the Developer
tab and switch the server to Running. Then in `backend/.env`:

```
LLM_PROVIDER=local,gemini
LOCAL_LLM_URL=http://localhost:1234/v1
LOCAL_LLM_MODEL=gemma-4
```

`local,gemini` tries Gemma first and calls Gemini only when the local call fails (server stopped,
timeout, invalid JSON); with `LLM_PROVIDER=local` there is no cloud fallback and nothing leaves your
computer except embeddings. Without a `GEMINI_API_KEY` the Gemini entry is ignored. A reply that has
already started streaming is never restarted on another provider. The chain works with the Supabase
backend, not only in memory preview mode. Embeddings stay on Gemini (see ADR 0003). `LOCAL_LLM_MODEL` can be left empty to use
the first chat model the server lists. Any server with an OpenAI-style `/v1/chat/completions`
endpoint works (Ollama is `http://localhost:11434/v1`). Local calls wait up to 45 seconds (20 for
interviewer reactions) because a model may still be loading. Tested with Gemma 4 E4B (IQ4_NL) in LM
Studio: replies took 0.5 to 6 seconds on the chat, and the grounding checks behaved the same as
with Gemini. If the server is stopped, the app shows why and uses the scripted replies.

## Optional: Groq Whisper speech

The browser's own speech recognition (Chrome and Edge send the audio to Google and Microsoft) often
mishears accented English. Set a key in `backend/.env` and spoken answers are transcribed by Groq's
hosted `whisper-large-v3-turbo` instead:

```
GROQ_API_KEY=your-key-from-console.groq.com
```

Restart the backend. On the interview page the microphone then records the answer, shows
"Transcribing..." and puts the text into the answer box, where it can be edited before submitting.
Without a key nothing changes and the browser recogniser is used. Details:

- Only speech to text uses Groq; the interviewer's voice is still the browser's.
- The recording (up to 10 MB, about 10 minutes) goes browser -> backend -> Groq and is not stored.
  Requests need a logged-in user, are limited to 120 an hour per address, and appear in the AI request
  log as capability `speech` (cost unknown: Groq bills per audio hour, not per token).
- A Groq failure or quota error shows a short message and the user can type the answer.
- Use `GROQ_SPEECH_LANGUAGE=vi` (or another code) to transcribe another language.

## Running with Docker (for later)

```bash
docker compose up --build
```

Set `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and optional model variables in
the environment or a repo-root `.env` before `docker compose up --build`. Keep that file out of
Git. Frontend is at http://localhost:5173; backend at http://localhost:4000. Data is in Supabase,
not a Docker volume. For local LLMs in Docker, use a host address reachable from the container.
Admin scenario metadata and availability are stored in the `scenario_data` Docker volume; keep
that volume attached when recreating the backend container. A multi-replica deployment needs a
shared persistent store before scenario edits are enabled across replicas.

## What's implemented vs. mocked

| SRS component | Status |
|---|---|
| Onboarding / profile (FR-1.x) | Implemented (industry, job title, level) |
| Scenario library + filtering (FR-2.x) | Implemented, 16 scenarios in `backend/src/data/scenarios.json` (see "Question data" below) |
| Speech pipeline (FR-3.x) | Browser Web Speech API (STT/TTS), not a self-hosted engine |
| AI Simulator (FR-4.x) | Questions come only from the scenario's fixed list. Reactions are scripted or written by Gemini/local LLM when configured |
| Rubric-based scoring (FR-5.x) | Deterministic text-metric rules in `backend/src/services/scoringService.js`, mapped through `backend/src/data/rubric.json`. Vocabulary is scored for range only; grammar is not checked automatically |
| Feedback report (FR-6.x) | Implemented, including partial sessions ended early |
| Progress tracking (FR-7.x) | Implemented (trend chart, per-criterion table, weakest criterion) |
| Interview chat | Optional pgvector RAG with sources/no-match and SSE; non-RAG/model-free fallback remains |
| Auth | Email/password + bearer token stored in Supabase Postgres; OAuth2/roles belong to Person 3 |
| Data rights | Per-file/session delete, full data export, and account deletion; associated vectors and Storage objects are removed |
| Persistence | Supabase Postgres + private Supabase Storage; no SQLite runtime |

The old local `backend/data/interviewai.sqlite` file is not read by this version and is **not
automatically imported**. Keep a backup if that demo data matters.

Abandoned interviews (started but never finished) are deleted after 2 hours.

## Question data

`backend/src/data/scenarios.json` holds 16 scenarios (76 questions): four hand-written ones
(behavioral, situational, finance, mid-level technical) and twelve technical ones built from the
Kaggle dataset
[Software Engineering Interview Questions](https://www.kaggle.com/datasets/syedmharis/software-engineering-interview-questions-dataset).
Check that dataset's license on Kaggle before making the repository public.

How the dataset was used:

- The dataset's `Difficulty` labels are inconsistent (2FA is "Hard", the CAP theorem is "Easy"), and
  about a quarter of the rows are repeats. Questions were chosen by content instead, de-duplicated,
  and grouped into Junior (fundamentals, web basics), Mid-level (backend, frontend, DevOps,
  security, engineering practices, system-design basics) and Senior (system design, distributed
  systems, security design, data pipelines) scenarios of five questions each.
- Rows that ask for code or a full build ("implement a garbage collector", "build a compiler") were
  skipped because they don't work as spoken answers. A few "Build/Create ... system" prompts were
  reworded to "Design ...".
- The relevance criterion scores an answer against each question's `keywords`, so every question
  has 7 to 8 hand-written stems (substring-matched, lowercase). Avoid short stems that occur inside
  common words ("edge" is in "knowledge"); `backend/test/scenarios.test.js` checks the structure.
- The dataset's reference answers are stored as `referenceAnswer` on the 60 dataset questions. They
  are one-line outlines ("key points"), not full answers. The chat uses them as its source for what
  a strong answer should cover; they are never sent to the browser through the scenario API.

## Planned: local speech models

The approved stack is ASR `qwen3-1.7b-asr`, LLM `gemma3n-e4b`, TTS `vibevoice-1.5b`, served
locally. The chat/reaction LLM already supports an OpenAI-compatible local server. ASR and TTS
still use the browser Web Speech API; the approved self-hosted ASR/TTS models are not integrated.
The relevance criterion scores against each question's `keywords`, so any questions imported
from an external dataset need keywords too.
