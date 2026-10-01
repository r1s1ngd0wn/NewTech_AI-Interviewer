# InterviewAI

A simple, working slice of the system described in `InterviewAI_SRS.docx`: account/profile,
scenario selection, a live spoken interview session, rubric-based scoring, feedback report,
a post-interview chat, and progress tracking.

## Stack

- **Backend** - Node.js + Express, persisted with SQLite via Node's built-in `node:sqlite`
  module (`backend/src/db/connection.js`), no native compilation, no separate DB server to
  install. The data file lives at `backend/data/interviewai.sqlite` and survives restarts;
  delete it to reset all data. `backend/src/store/index.js` exposes a Map-like
  get/set/delete/values interface the services use, so swapping the database later means
  changing that one file, not the route/service layer. Scoring is deterministic and
  rubric-based. The AI Simulator (`backend/src/services/aiSimulator.js`) and the interview
  chat (`backend/src/services/chatService.js`) are scripted, grounded stand-ins for a local
  LLM (see "Planned: local models" below).
- **Frontend** - React + Vite, React Router, plain CSS (no build-time CSS framework). Uses the
  browser's Web Speech API (`SpeechRecognition` / `speechSynthesis`) for STT/TTS, with a text
  fallback if the browser doesn't support it (e.g. Firefox). The transcript is editable, so a
  misheard word can be corrected before submitting.

## Test account

Outside production, a fixed test account is seeded the first time the backend starts (see
`backend/src/db/seed.js`), profile already filled in and one completed practice session so
the dashboard isn't empty:

- Email: `test@interviewai.dev`
- Password: `password123`

It is **not** created when `NODE_ENV=production` unless `SEED_TEST_ACCOUNT=true`.

## Running locally

Requires Node.js 22.5+ (for the built-in `node:sqlite` module).

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

## Tests

```bash
cd backend
npm test
```

Uses Node's built-in test runner against an in-memory SQLite database (`DB_PATH=:memory:`),
so it never touches `backend/data/`. Covers the scoring rules (including filler-word
matching), auth validation and token expiry, session lifecycle, chat, stale-session cleanup,
and account deletion/export.

## Configuration (`backend/.env`, see `.env.example`)

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 4000) |
| `CORS_ORIGIN` | Allowed browser origin. Required in production, `*` in development |
| `NODE_ENV` | `production` disables the demo login and the open CORS default |
| `SEED_TEST_ACCOUNT` | `true` to force the demo login in production (demos only) |
| `TRUST_PROXY` | Number of reverse proxies in front (1 with the bundled nginx) so rate limiting sees real client IPs |
| `DB_PATH` | Alternative SQLite path, or `:memory:` |
| `GEMINI_API_KEY` | Optional. Enables Gemini for chat replies and interviewer reactions |
| `GEMINI_MODEL` | Gemini model name (default `gemini-flash-latest`) |
| `LLM_TIMEOUT_MS` | Per-call timeout for the model (default 15000; interviewer reactions use 8000) |
| `GEMINI_THINKING_BUDGET` | `0` (default) switches reasoning off for speed; `default` leaves it to the model |
| `LLM_REACTIONS` | `off` stops the model writing interviewer reactions (chat only) |
| `LLM_PROVIDER` | `local` uses a local server, `none` forces scripted replies; unset means Gemini if a key exists |
| `LOCAL_LLM_URL` / `LOCAL_LLM_MODEL` / `LOCAL_LLM_API_KEY` | Local server base URL (default LM Studio `http://localhost:1234/v1`), model id, optional key |
| `LLM_REACTION_TIMEOUT_MS` | How long an interview waits for a model-written reaction (8000 Gemini, 20000 local) |

## Optional: Gemini API for the LLM parts

The interviewer's short reaction after each answer and the post-interview chat can be written by
Google's Gemini API. Add these lines to `backend/.env` (git-ignored; never put the key in
`frontend/`), then restart the backend:

```
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-flash-latest
```

Without a key everything keeps using the scripted replies. With one:

- **Chat** (`chatService.js`): the model gets that session's transcript, the question bank's key
  points (`referenceAnswer`) for each question, and the final rubric result. It is told to use
  only those sources, to say when something is outside them, and that the scores are fixed.
  Anything it puts in quotation marks is checked against the transcript and key points; a reply
  with an invented quote is retried once, then replaced by the data-only scripted answer.
  Replies are labelled with the model name in the UI.
- **Reactions** (`aiSimulator.llmReaction`): one short acknowledgement per answer. The next
  question is always taken from the scenario list, and a generated line that asks a question or
  runs long is discarded, so the interviewer still cannot invent questions.
- **Scoring is never sent to the model**: it stays deterministic, and the per-question `keywords`
  never leave the backend.
- **Fallback**: on any error (bad key, quota, timeout) the scripted answer is used and the chat
  shows why, e.g. "Gemini returned 429: quota exceeded".
- **Privacy**: transcripts are sent to Google for each request. Check Google's terms for data use
  on your key's tier, and use practice data only.
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

The same two features can run on a model on your own computer, with nothing sent to Google. In LM
Studio, load a model, open the Developer tab and switch the server to Running. Then in
`backend/.env`:

```
LLM_PROVIDER=local
LOCAL_LLM_URL=http://localhost:1234/v1
LOCAL_LLM_MODEL=gemma-4
```

`LLM_PROVIDER=local` takes priority over a Gemini key. `LOCAL_LLM_MODEL` can be left empty to use
the first chat model the server lists. Any server with an OpenAI-style `/v1/chat/completions`
endpoint works (Ollama is `http://localhost:11434/v1`). Local calls wait up to 45 seconds (20 for
interviewer reactions) because a model may still be loading. Tested with Gemma 4 E4B (IQ4_NL) in LM
Studio: replies took 0.5 to 6 seconds on the chat, and the grounding checks behaved the same as
with Gemini. If the server is stopped, the app shows why and uses the scripted replies.

## Running with Docker (for later)

```bash
docker compose up --build
```

Frontend at http://localhost:5173 (nginx, proxies `/api` to the backend container), backend
at http://localhost:4000. The backend has a health check and its data lives in a named volume.

## What's implemented vs. mocked

| SRS component | Status |
|---|---|
| Onboarding / profile (FR-1.x) | Implemented (industry, job title, level) |
| Scenario library + filtering (FR-2.x) | Implemented, 16 scenarios in `backend/src/data/scenarios.json` (see "Question data" below) |
| Speech pipeline (FR-3.x) | Browser Web Speech API (STT/TTS), not a self-hosted engine |
| AI Simulator (FR-4.x) | Questions come only from the scenario's fixed list. Reactions are scripted, or written by Gemini when `GEMINI_API_KEY` is set. Local models are still planned |
| Rubric-based scoring (FR-5.x) | Deterministic text-metric rules in `backend/src/services/scoringService.js`, mapped through `backend/src/data/rubric.json`. Vocabulary is scored for range only; grammar is not checked automatically |
| Feedback report (FR-6.x) | Implemented, including partial sessions ended early |
| Progress tracking (FR-7.x) | Implemented (trend chart, per-criterion table, weakest criterion) |
| Interview chat | Answers grounded in one session's transcript and scores: written by Gemini when a key is set, scripted otherwise |
| Auth | Email/password + bearer token stored in SQLite; tokens expire after 7 days and are revoked on log out; login/register are rate limited |
| Data rights | Per-session delete, full data export, and account deletion from the Profile page |
| Persistence | SQLite file (`backend/data/interviewai.sqlite`), survives restarts |

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

## Planned: local models

The approved stack is ASR `qwen3-1.7b-asr`, LLM `gemma3n-e4b`, TTS `vibevoice-1.5b`, served
locally. Swap-out points: replace `aiSimulator.js` and `chatService.js`'s `generateReply` with
calls to the local inference server, keeping the same grounding data (scenario question list,
session transcript, deterministic feedback) as the prompt context so the model cannot
contradict or replace the rubric scores. The relevance criterion scores against each
question's `keywords`, so any questions imported from an external dataset need keywords too.
