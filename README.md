# InterviewAI

A simple, working slice of the system described in `InterviewAI_SRS.docx`: account/profile,
scenario selection, a live spoken interview session, rubric-based scoring, feedback report,
and progress tracking.

## Stack

- **Backend** - Node.js + Express, persisted with SQLite via Node's built-in `node:sqlite`
  module (`backend/src/db/connection.js`), no native compilation, no separate DB server to
  install. The data file lives at `backend/data/interviewai.sqlite` and survives restarts;
  delete it to reset all data. `backend/src/store/index.js` exposes the same Map-like
  get/set/delete/values interface the services use, so swapping to PostgreSQL later (per SRS
  4.2) means changing that one file, not the route/service layer. Deterministic, rubric-based
  scoring, the LLM/AI Simulator is a scripted, scenario-bounded mock
  (see `backend/src/services/aiSimulator.js`); swap in a real LLM call there when you have an
  API key, the rest of the pipeline is unchanged.
- **Frontend** - React + Vite, React Router, plain CSS (no build-time CSS framework). Uses the
  browser's Web Speech API (`SpeechRecognition` / `speechSynthesis`) for STT/TTS, with a text
  fallback if the browser doesn't support it (e.g. Firefox). The login hero is a crossfading
  photo carousel (`frontend/src/components/HeroCarousel.jsx`) built from the images in
  `frontend/public/images/`; scenario cards reuse the same photos.

## Test account

A fixed test account is seeded automatically the first time the backend starts (see
`backend/src/db/seed.js`), profile already filled in and one completed practice session so
the dashboard isn't empty:

- Email: `test@interviewai.dev`
- Password: `password123`

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

## Running with Docker (for later)

```bash
docker compose up --build
```

Frontend at http://localhost:5173 (nginx, proxies `/api` to the backend container), backend
at http://localhost:4000.

## What's implemented vs. mocked

| SRS component | Status |
|---|---|
| Onboarding / profile (FR-1.x) | Implemented |
| Scenario library + filtering (FR-2.x) | Implemented, 4 seed scenarios in `backend/src/data/scenarios.json` |
| Speech pipeline (FR-3.x) | Browser Web Speech API (STT/TTS), not a self-hosted Whisper/TTS engine |
| AI Simulator (FR-4.x) | Scripted reactions bounded to the scenario's fixed questions, not a real LLM call yet |
| Rubric-based scoring (FR-5.x) | Implemented as deterministic text-metric rules in `backend/src/services/scoringService.js`, mapped through `backend/src/data/rubric.json` |
| Feedback report (FR-6.x) | Implemented |
| Progress tracking (FR-7.x) | Implemented |
| Auth | Simple email/password + bearer token, persisted in SQLite (no session/token expiry, no email verification) |
| Persistence | SQLite file (`backend/data/interviewai.sqlite`), survives restarts |

Swap-out points for the full SRS scope: replace `backend/src/store/index.js`'s SQLite tables
with PostgreSQL, replace `aiSimulator.js`'s scripted reactions with a real LLM API call (still
scenario-bounded), and replace the browser Web Speech API with a self-hosted STT/TTS service
if offline/accuracy requirements demand it.
