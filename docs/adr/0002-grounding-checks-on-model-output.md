# ADR 0002: Check the model's review against the question bank in code, not only in the prompt

Status: accepted. Owner: Khoa (structured output, evaluation). This is the AI-design ADR.

## Context

The per-answer review (see ADR 0001) is written by an LLM from the question, the question bank's
key points and the candidate's answer. The review must not contain facts that the question bank
does not contain, because the app presents it as feedback against the bank. Reading real output
showed two problems with relying on the prompt alone:

- Gemini "explained" concepts the key points only name (for the OOP question it wrote that
  encapsulation bundles data and methods, that polymorphism treats objects as instances of their
  parent class), although the prompt said to use only the sources.
- Gemma 4 E4B sometimes returned a list field as one string, or an empty reply, which the
  validation rejected twice in a row, so the user got the basic fallback review.

## Options

1. **Stronger prompt only.** Cheapest. Version 2 of the prompt tells the model to name, not
   explain, concepts the key points only name. It helped but did not stop the OOP case.
2. **Prompt plus deterministic checks on the output.** Covered and missing points are kept only if
   most of their content words appear in the key points. The stronger answer is kept only if at
   least 60% of its content words appear in the question, key points or the candidate's own
   answer; otherwise it is dropped and the page shows the key points instead.
3. **A second LLM call to verify the first.** Catches paraphrase, but doubles cost and latency,
   and the checker can hallucinate too.

For the format problems: make validation tolerant where the content is usable (a string for a list
field is split into lines) and retry an empty reply once, instead of falling back immediately.

## Decision

Options 1 and 2 together, plus tolerant list parsing and one retry on an empty reply. Option 3 was
rejected for cost and latency.

## Evidence

`npm run eval` runs 8 cases (`backend/eval/cases/critique.json`: 3 normal, 4 edge, 1 prompt
injection) three times each on the local Gemma 4 E4B model. A run passes only if every check passes.
Checks are deterministic (`backend/eval/checks.js`); two apply to every case: no score in the
output, and everything shown is traceable to the sources. Results are in `backend/eval/results/`.

| Configuration | Pass rate | Usable reviews | Failing runs and why |
|---|---|---|---|
| Before: prompt v1, no output checks | 19/24 (79%) | 21/24 | 3 unusable replies (list returned as a string, twice failed); 2 bad reviews on the injection case (an invented point, a stronger answer only 53% traceable) |
| After: prompt v2 + output checks | 21/24 (88%) | 21/24 | 0 bad reviews; 3 unusable replies (2 lists returned as strings, 1 empty reply) |
| After + tolerant lists + retry on empty | 24/24 (100%) | 24/24 | none |

One run of the final configuration on Gemini (`gemini-3.1-flash-lite`): 7/8 passed; the one failure
was a request timeout, and all 7 usable reviews passed every check.

Average time per review: 11.0 s, 10.3 s and 8.2 s on the local model (RTX 3060 Ti), about 6 s on
Gemini.

## Consequences and limits

- The user never sees a review point that is not in the question bank, whichever model wrote it.
  The cost is that a correct but differently worded point can be dropped, in which case the page
  shows the key points rather than a model answer.
- The word-overlap test measures vocabulary, not meaning. A review can reuse the right words and
  still say something wrong, and the evaluation would pass it.
- 100% is on 24 runs of 8 cases written by the same person who found the failures, so the checks
  target the problems already seen. Different cases, more runs, or another model can fail. The
  case list should grow (target is 20 or more across all capabilities).
- Three runs per case is a small sample for a non-deterministic model; the second row's 88% and the
  third row's 100% differ by 3 runs.
- The last step changed two things at once (list parsing and the empty retry), so their effects
  are not separated.
