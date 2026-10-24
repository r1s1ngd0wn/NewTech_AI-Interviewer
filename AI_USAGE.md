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

---

## Long

_(to be filled in by Long: RAG, upload, streaming, input guard)_

---

## Đức

_(to be filled in by Đức: agent tools, authentication, logging, fallback)_
