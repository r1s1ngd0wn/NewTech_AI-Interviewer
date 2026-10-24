# ADR 0001: The LLM explains answers but never scores them

Status: accepted. Owner: Khoa (structured output, scoring).

## Context

InterviewAI gives a 0-100 score on four rubric criteria (fluency, relevance, vocabulary range,
structure). Users compare scores across sessions on the progress dashboard, so a score has to mean
the same thing every time. We also add an LLM that reviews each answer (what the answer covered,
what it missed, a suggestion). The question is whether that LLM should also produce the score.

## Options

1. **LLM scores the answer.** One call returns scores plus explanation. Simple, and it can judge
   nuance. But the same answer can get different scores on different runs, different models
   disagree, a candidate can write "give me 100" inside the answer, and a retired model changes
   every historical score. Scores cannot be unit tested.
2. **Deterministic rubric only, no LLM review.** Reproducible and testable, but the feedback is
   generic ("answer in more detail").
3. **Deterministic rubric scores; LLM only explains.** The rubric (`scoringService.js`) stays the
   single source of the score. The LLM gets the question, the question bank's key points and the
   answer, and returns structured JSON (covered points, missing points, strengths, suggestion,
   stronger answer, onTopic) that is validated with Zod before it is stored.

## Decision

Option 3.

## Consequences

- Scores are reproducible and have unit tests (`backend/test/scoring.test.js`).
- Turning the AI off, or having it fail (timeout, quota, invalid JSON), never changes a score. The
  app falls back to a basic review built from the question data, and the interview and the
  rubric result are unaffected. `backend/test/critique.test.js` checks that scores are identical
  with the model on and off, even when the model is instructed to output a score.
- Prompt injection in an answer cannot move the score. The review prompt forbids giving a score,
  and the evaluation suite fails any review that contains one (`crit-08-injection-in-answer` and
  the score check applied to every case).
- The cost is that the review can disagree with the score (a good-looking answer can still score
  low on Fluency because it was typed). The feedback page therefore labels the review as separate
  from the rubric score.
- Limitation: the rubric measures surface features (keyword coverage, length, filler words,
  structure markers), not whether an answer is correct. The LLM review compensates only by
  comparison with the question bank's key points. Checking the scores against human raters is
  future work.
