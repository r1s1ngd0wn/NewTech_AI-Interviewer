# ADR 0004: Read PDFs by position and chunk CVs by section

Status: accepted. Owner: Khoa (with Long, whose RAG code this changes).

## Context

On real CVs the Coach answered "I couldn't find an answer in your documents" to ordinary questions
(education, most recent experience, "what is my CV about"). Two real CVs reproduced it: a Canva-style
two-column CV and a CV with a strip of section headings beside the text.

- PDF text was joined in file order. Design-tool exports write headings before their text and one
  column after the other, so headings came out in a row ("SUMMARY PROJECTS CERTIFICATIONS EDUCATION")
  and words were split ("Co-d eveloped"). The text also had no line breaks, so the injection filter,
  which works line by line, could have deleted a whole document for one flagged phrase.
- Chunks were 2,000 characters. A chunk that mixes contact details, profile, experience and skills
  matches no question strongly. Broad questions scored 0.50 to 0.57 against a threshold of 0.55.
- The model chooses its own search words and sometimes does not search at all, so a correct document
  was not enough.

## Options

1. Lower the global match threshold. Rejected: it was calibrated on 13 questions and 7 off-topic ones
   (ADR long-rag) and a lower value lets unrelated questions through for every user.
2. Send the PDF to a layout-aware or OCR service. Rejected for now: another cloud provider receives
   the CV, and it adds cost and a key.
3. Rebuild the text from coordinates, chunk by section, search the user's own document for questions
   that name it, and run the search in code.

## Decision

Option 3.

- `pdfText.js` rebuilds lines from text positions, joins touching pieces without a space, detects a
  vertical gutter, reads columns in order, and reads a strip of headings row by row.
- `documentChunks.js` starts a chunk at every capitalised heading, repeats the heading on continuation
  chunks, cuts long sections between paragraphs, keeps a short title with the text below it, and merges
  very small sections. Chunks are at most about 1,200 characters; the limit is now 80 chunks per file.
- A question about the user's CV or JD ("my education", "where did I intern", "which roles suit me")
  also searches that document with a floor of 0.40. The answer is still cited and checked.
- For document questions the agent runs `search_knowledge` itself and puts the numbered sources in the
  first message; the model may still call tools. If nothing is found the user gets the no-data reply
  without a model call.
- "Compare" needs an explicit job-description reference, so "which job roles fit my CV" is a CV question.

## Consequences

- Documents uploaded before this change keep their old chunks; re-upload (or run
  `scripts/reindexDocuments.js`) to get the new ones.
- More chunks per file means more embedding calls per upload (a typical CV goes from 2 to 4 to 6).
- Coach prompt is now `duc-v3`; it tells the model that sources are included and to summarize them.
- Limits: a scanned PDF still has no text, a layout with three or more columns is read as two, and a
  small model can still stretch a source in its wording; the citation check does not catch every
  paraphrase.
