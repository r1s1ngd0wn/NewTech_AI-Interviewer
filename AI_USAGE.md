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


### 8. Reading real CVs and answering questions about them (`pdfText.js`, `documentChunks.js`, `agent.js`)

- **Key prompt (paraphrased):** "its kinda broken isnt it" (screenshots of the Coach refusing CV questions), then "i tried a groupmate's cv".
- **Generated:** the position-based PDF text reader, the section-based chunker, the "search the user's own CV with a lower floor" retrieval, the search-first step in the Coach, Coach prompt v3, a synthetic two-column and a heading-strip CV generator, ADR 0004 and 13 tests.
- **Checked / changed by me:** I reproduced the failure before changing anything (a synthetic CV scored 2/8 on the questions a candidate would ask, a real group member's CV 2/6) and measured after each change (8/8 and 6/6). The groupmate's CV was only read locally and through a temporary account that was deleted afterwards. I broke the sidebar rule and the search-first step on purpose to confirm the tests go red.
- **AI got it wrong, case 13:** my first column reader put every left-hand item before every right-hand item. On the groupmate's CV the section headings sit in a narrow strip beside their text, so all five headings came out first, exactly like the old extractor. Found by printing the line structure of the real file, not by the synthetic fixture, which had a different layout. Fixed with a row-by-row rule for a strip that holds only headings, and a second fixture.
- **AI got it wrong, case 14:** I assumed the model would call `search_knowledge` for CV questions because the prompt says so. With the small local model it often did not call any tool for "which role should I interview for?", and the Coach then said it found nothing. Found from the event log of one request. The search now runs in code first for document questions.

- **AI got it wrong, case 17:** after the merge the user's own CV still produced a source chunk with the left column mixed into the right ("SPOKEN LANGUAGES: Developed an end-to-end Android shopping application, Vietnamese: Native managing..."). My column detector assumed a gutter of at least 18 points; this template has 10 points between the columns, with a few header lines crossing it, so no columns were found. Found by reading the source box in the app, then measuring the coordinates of the real file. Fixed by accepting gutters of about 7 points and requiring each side to hold a real text column (so dates at the right edge of a one-column CV are not mistaken for one); two fixtures (10-point gutter, one column with dates) and a deliberate-breakage check back it.

### 9. Groq Whisper speech-to-text (`speechService.js`, `routes/speech.js`, `useSpeech.js`)

- **Key prompt (paraphrased):** "is this using webrtc or grok api?" (it is the browser's Web Speech API), then "can you do the groq whisper speech model? i have faith in you".
- **Generated:** the backend transcription service and route, the recording version of the speech hook (ported from the unmerged `cloud-speech-trial` branch, speech-to-text only), the page changes, 8 backend and 6 frontend tests, README and privacy notes.
- **Checked / changed by me:** I rebuilt it on current `main` instead of merging the 15-day-old branch, added the login check, size limit and rate limit, kept speech failures out of the AI health banner, and broke the hook on purpose to confirm its tests go red.
- **AI got it wrong, case 15:** I told you the old trial's speech endpoints had no login check. They did (`requireAuth`); I had not read the file when I said it. Found when I opened it to port the code.
- **AI got it wrong, case 16:** my first test file stacked several mocks of `fetch` in one test, which left a broken mock behind and made the next test fail with a misleading "fetch failed". Found because the failing test passed on its own; fixed with a single mock whose behaviour is switched.

### 7. Local model first, Gemini as the fallback (`llmProviders.js`, `localToolClient.js`, `llmService.js`)

- **Key prompt (paraphrased):** "if I want to run local, do we have to rewrite some of the code to use
  gemma as main llm with gemini as fallback?", then "yeah please do".
- **Generated:** the ordered provider list (`LLM_PROVIDER=local,gemini`), the fallback rules in
  `llmService`, the OpenAI-format tool-calling client for LM Studio, health/pricing/eval changes,
  `test/local-first.test.js` (19 tests), ADR 0003.
- **Checked / changed by me:** I first ran the Coach against LM Studio on unchanged code and saw every
  reply fall back (the agent was Gemini-only and the local provider was memory-mode only), then ran the
  same questions after the change: weak areas, session list and a plan proposal all worked on Gemma, and
  the live agent eval passed 6/6 (`backend/eval/results/*duc-live.json`, model `gemma-4`). The critique
  eval passed 24/24 runs on the local-first setup. To check the new tests can fail, I broke the fallback
  on purpose twice and confirmed 5 and 1 tests went red.
- **AI got it wrong, case 11:** I told you earlier that the Gemma tests covered "the app". They covered
  only the critique and plain chat; the Coach and agent had never run on Gemma, and with Supabase the
  local provider was switched off. Found by starting the server with `LLM_PROVIDER=local` and reading the
  fallback text in the Coach replies, not by a test.
- **AI got it wrong, case 12:** my first `generateWithTools` retried on Gemini even after Gemma had
  already streamed text to the user, which would have shown two different answers glued together. Found
  by rereading the draft before running it; replaced with a `noFallback` flag set once text has been
  shown, plus a test that fails if the flag is removed.

---

## Long

Written by Long (copied unchanged from his branch):

- AI assistance: implemented and reviewed reusable document upload/list/preview/delete, pgvector retrieval, source handling, basic input guardrails, streaming stop control, automated tests and documentation.
- Human decisions required: verify the CV/JD experience in a live browser after merging with teammates' work, and review retrieval quality, latency and provider quota on a larger evaluation set. Migrations 004/005 and the 76 question-bank entries were applied to the currently configured Supabase project on 2026-10-24.
- Verification recorded in this repository: `backend/test/long.test.js` and the full backend test suite. On 2026-10-24, `npm run eval:long:live` with Gemini embeddings and the two synthetic fixtures passed 23/23 source-selection cases and 11/11 guard cases at the local `RAG_MATCH_THRESHOLD=0.55`. This does not measure factual correctness of generated answers or performance on a larger real-world set.
- Review follow-up: added per-file and per-user upload limits, bounded DOCX expansion, source-balanced retrieval, provider-specific threshold defaults, Nomic query/document prefixes, selective chat deletion, versioned Coach/debrief prompts, and metadata-only AI request logging. The `backend/eval/long-cases.json` cases can now be run with `npm run eval:long`; live retrieval requires sample documents in a dedicated test account.

---

## Đức

# Person 3 implementation assistance — 2026-10-24

Codex assisted with Supabase auth/RLS migrations, bounded Gemini tools and atomic confirmation, practice plans API/UI, request telemetry/health/fallback, tests and deployment setup. Requirements came from the team's PLAN (1).md. Existing Long_RAG RAG/SSE/data contracts were preserved; scope and unresolved cloud integration are documented in docs/DUC_SETUP.md and docs/DUC_TRACEABILITY.md.

Verification uses offline fixtures, real local HTTP and embedded PostgreSQL/pgvector; these do not establish Google OAuth or live model quality. A separate read-only code review identified storage-path trust, revoked profile access, misleading AI telemetry and provider-disable handling; regression tests were added before the fixes. No user secrets were committed, no external messages were sent, and no production deployment was performed. Team members must review and understand generated code before submission.

---

# Bổ sung theo format mẫu ngày 2026-10-26

## Khoa

| STT | Ngày | Người thực hiện | Công cụ AI / model | Mức đóng góp | Phạm vi / module | Prompt chính (tóm tắt) | Commit SHA | Sinh viên tinh chỉnh / tối ưu | Review / kiểm chứng | AI sai và cách xử lý |
| :--: | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | 2026-10-24 | Khoa | Claude Code (model chưa ghi trong log) | Sinh mới | Structured critique, schema và phản hồi sau câu trả lời: `backend/src/services/critiqueService.js`, `backend/src/schemas/critique.js`, `backend/src/utils/schema.js`, feedback UI | Tạo phần nhận xét JSON có schema, bám câu hỏi và câu trả lời; không để LLM tự chấm điểm rubric. | `8c9f0bf` | Khoa đọc output Gemini/Gemma, chỉnh prompt và xử lý danh sách trả về dạng chuỗi; điểm rubric vẫn do code xác định. | Log hiện ghi đã thử với Gemini và Gemma 4 E4B, kiểm tra câu trả lời thiếu/ngoài chủ đề/injection và xác nhận điểm không đổi khi tắt model. Kết quả hiện lưu: Gemini 7/8; bộ local ghi nhận 79% trước, 88% sau, 100% sau chỉnh parser. | **AI sai 1:** tự thêm định nghĩa OOP không có trong nguồn. Khoa sửa prompt và thêm kiểm tra tỷ lệ grounding để bỏ “stronger answer” không đủ căn cứ. **AI sai 2:** thiết kế ban đầu làm Finish chờ tới 20 giây. Khoa kiểm tra trên trình duyệt, rút giới hạn chờ còn 6 giây và cho feedback cập nhật khi critique đến muộn. **AI sai 3:** detector tìm “um” theo substring, làm câu có “documentation/number/columns” bị tính nhầm. Khoa đổi sang ranh giới từ và thêm regression test. |
| 2 | 2026-10-24—25 | Khoa | Claude Code (model chưa ghi trong log) | Sinh mới; sửa / refactor | Prompt registry, evaluation runner và ca critique; tích hợp critique vào store async: `backend/src/prompts/`, `backend/eval/`, `backend/src/services/sessionService.js` | Lưu prompt có phiên bản; tạo 8 ca evaluation với expected checks xác định; tích hợp review mà không làm ghi đè câu trả lời đến đồng thời. | `8c9f0bf`, `2cc72d6` | Khoa tự viết expected results từ question bank; giữ critique atomic bằng cập nhật riêng trường JSONB; giữ prompt cũ để so sánh trước/sau. | Có unit tests cho validation/eval và báo cáo before/after; log cũ ghi 194 backend tests và chạy Supabase thật cho luồng critique async. | **AI sai 4:** script chuyển prompt đọc nhầm stage merge, tạo prompt body rỗng rồi xóa bản gốc. Khoa khôi phục prompt từ nhánh `main` và thêm test so nội dung. **AI sai 5:** ghi cả session khi chỉ cập nhật critique có thể ghi đè answer vừa gửi. Khoa chuyển sang cập nhật một trường JSONB và thêm test giữ nguyên hai answer. |
| 3 | 2026-10-25 | Khoa | Claude Code (model chưa ghi trong log) | Sửa / refactor | Rà soát RAG và debrief chat: guard, retrieval và `plainText` | Rà nhánh RAG, chạy thử các ca thực; sửa lỗi guard/retrieval phát hiện được, giữ nội dung tài liệu hợp lệ. | `3c35202`, `2cc72d6` | Khoa tách quy tắc input khỏi quy tắc lọc CV; dùng ID câu hỏi để tìm câu có số thứ tự thay vì trông cậy embedding phân biệt số. | Log hiện ghi đã thử 14 cách diễn đạt guard và tái hiện lỗi với câu CV bình thường; đã chạy lại trên Supabase bằng tài khoản tạm rồi xóa. | **AI sai 6:** dùng chung pattern lọc chat và CV sẽ xóa cả dòng CV hợp lệ như “Developer: Java”. Khoa tách hai danh sách và thêm tests. **AI sai 7:** đổi “the first question” thành “question 1” vẫn truy hồi nhầm câu do embedding. Khoa dò similarity, tra chunk theo ID và giới hạn theo user/session. |

## Long

| STT | Ngày | Người thực hiện | Công cụ AI / model | Mức đóng góp | Phạm vi / module | Prompt chính (tóm tắt) | Commit SHA | Sinh viên tinh chỉnh / tối ưu | Review / kiểm chứng | AI sai và cách xử lý |
| :--: | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | 2026-10-23 | Long | Codex (OpenAI; model ID của phiên làm việc cũ chưa được lưu) | Sinh mới; review | Upload CV/JD, trích xuất text, chunking, Gemini embeddings, Supabase pgvector, Coach có nguồn/no-match, input guard, streaming và test: `backend/src/services/documentService.js`, `ragService.js`, `coachService.js`, `frontend/src/pages/CoachPage.jsx` | Tóm tắt yêu cầu Long giao Codex: triển khai các hạng mục RAG/upload/streaming/guard theo phân công Person 2; cho phép hỏi dựa trên CV/JD và ngân hàng câu hỏi, trích nguồn, từ chối khi không có dữ liệu hoặc câu ngoài phạm vi. Đây là tóm tắt, không phải prompt nguyên văn được lưu. | `5e4e3e9` | Phương án lưu/truy xuất dùng pgvector trong Postgres của nhóm và lọc tài liệu riêng theo user/session. Long kiểm tra thủ công luồng tải CV/JD, hỏi Coach và xem citation/no-match; cấu hình/migration và kiểm chứng trên Supabase được thực hiện sau commit đầu. | `backend/test/long.test.js` và `backend/test/rag.test.js` kiểm tra lọc quyền, truy xuất, guard và fallback. Long cũng thử CV/JD tổng hợp qua UI; các ảnh trong quá trình làm cho thấy câu có nguồn, câu ngoài phạm vi và injection bị từ chối. Đây chưa phải bằng chứng mọi câu trả lời sinh ra đều đúng. | **AI sai 1 (ngưỡng truy xuất):** bản đầu đặt mặc định `RAG_MATCH_THRESHOLD=0.72`, khiến nhiều câu hỏi hợp lệ về CV không tìm thấy nguồn. Feedback kiểm thử báo 4/13 ca có nguồn đúng với Gemini tại ngưỡng này. Long yêu cầu sửa; commit `40d755f` thêm ngưỡng theo provider, tìm CV/JD tách khỏi question bank và đường cứu tài liệu có bằng chứng từ khóa. Bộ fixture nhỏ sau chỉnh ghi nhận 23/23 ca chọn nguồn; không suy rộng thành độ chính xác trên CV thật. |
| 2 | 2026-10-24 | Long | Codex (OpenAI; model ID của phiên làm việc cũ chưa được lưu) | Sửa / refactor; review | Giới hạn upload và DOCX giải nén, quota tài liệu/chunks, retrieval cân bằng nguồn, Nomic prefixes, xóa chat liên quan tài liệu, prompt Coach/debrief có version, log metadata: `backend/src/services/documentService.js`, `ragService.js`, `embeddingService.js`, `backend/src/guards/inputGuard.js` | Tóm tắt yêu cầu Long giao Codex sau khi nhận review: sửa giới hạn chunk/quota, guard bỏ lọt biến thể injection, truy xuất CV bị question bank lấn, ngưỡng similarity quá cao, và giữ privacy khi xóa tài liệu. | `40d755f` | Long dùng feedback và các câu hỏi thử thực tế để chọn phạm vi sửa; bổ sung trần text/chunks và số tài liệu trước khi embedding, giới hạn DOCX khi giải nén, tách truy xuất tài liệu/ngân hàng câu hỏi, giữ nguồn riêng theo user; thêm ca kiểm thử để giữ các hành vi này. Các cải tiến đọc PDF nhiều cột và Coach search-first ở commit `3b5c817`/`7af9754` là phần Khoa, không tính vào đóng góp của Long. | `backend/test/long.test.js` có ca từ chối tài liệu vượt text/chunk limit trước khi lập chỉ mục, ca guard, nguồn CV/JD và no-match. `backend/eval/long-cases.json` cùng `npm run eval:long:live` đã ghi 23/23 ca chọn nguồn và 11/11 ca guard ngày 2026-10-24 với fixture tổng hợp và Gemini embeddings; kết quả đo retrieval/guard, không chấm chất lượng diễn đạt. | **AI sai 2 (chi phí và quota upload):** bản đầu chỉ giới hạn file 5 MB nhưng không giới hạn text/chunks; review ước tính một file text 5 MB có thể tạo khoảng 2.786 lệnh embedding. Long yêu cầu sửa; commit `40d755f` thêm `MAX_TEXT_CHARS`, `MAX_CHUNKS`, quota tài liệu và chặn DOCX giải nén quá lớn trước khi indexing. Test `extracted text and chunk limits reject oversized documents before indexing` xác nhận lỗi bị chặn. Đây là ước tính từ review, không phải số request live đã đo. |

Ghi chú cho Long: tên model Codex dùng để hỗ trợ lập trình không được lưu trong các commit cũ, nên không suy đoán từ model generation (`Gemini`/`Gemma`) hay model embedding của ứng dụng. Các prompt trên được tóm tắt từ yêu cầu trong quá trình làm, cần Long đối chiếu nếu nhóm lưu transcript riêng. Hai lỗi ở bảng là lỗi thiết kế/triển khai của mã có AI hỗ trợ, đã có bản sửa và test trong commit của Long; lỗi provider 429 khi demo không được tính là lỗi AI viết mã. Trường hợp fallback trích 220 ký tự đầu không trả lời đúng câu hỏi Education trên CV thật đã được Long phát hiện sau đó, nhưng chưa ghi là "đã sửa" ở đây.

## Đức

| STT | Ngày | Người thực hiện | Công cụ AI / model | Mức đóng góp | Phạm vi / module | Prompt chính (tóm tắt) | Commit SHA | Sinh viên tinh chỉnh / tối ưu | Review / kiểm chứng | AI sai và cách xử lý |
| :--: | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | 2026-10-25 | Đức | Codex (GPT-6) | Sinh mới; sửa / refactor | Supabase Auth/RLS, agent tools có xác nhận, plans, telemetry/fallback, setup/deploy: migrations; `backend/src/agent/`, `backend/src/services/`, `frontend/src/pages/PlanPage.jsx`; `fdac959` | Tích hợp Auth/JWT và role; làm agent đọc/đề xuất thay đổi dữ liệu qua tools nhưng phải xin user xác nhận trước khi ghi; ghi log AI và giữ manual CRUD hoạt động khi provider lỗi. | `fdac959` | Quyết định giữ proposal bất biến, xác nhận ghi trong transaction, giữ dữ liệu/keys nhạy cảm khỏi log, chi phí không rõ để `NULL`, và giữ luồng manual khi AI tắt. | Trước đó ghi nhận backend/frontend suites, build, Supabase Auth/JWT/role, xác nhận proposal, manual CRUD và fallback. Các kiểm chứng này được mô tả trong `docs/DUC_SETUP.md`, `docs/CLOUD_VERIFICATION.md`. | **AI sai 1 (tích hợp quota):** code ban đầu gọi `getPool().connect()` dù pool có wrapper theo JWT và không cung cấp `connect`. Bị lộ khi rà integration; đổi sang `withTransaction` để giữ role/claims và rollback. **AI sai 2 (so sánh CV/JD):** luồng agent bỏ qua yêu cầu evidence/citation của RAG. Review tái hiện, rồi buộc có nguồn CV và JD, giữ câu trả lời đến khi kiểm tra citation và dùng extract có dẫn nguồn nếu generation lỗi. |
| 2 | 2026-10-25 | Đức | Codex (GPT-6) | Sửa / refactor | Hợp nhất log RAG/critique/agent vào `ai_logs`, dashboard data API, privacy/export/delete: `backend/src/services/aiTelemetry.js`, `supabase/migrations/20261025000100_unified_ai_logs.sql` | Dùng một bảng cho mọi lần gọi AI; giữ tương thích với logger của Long, không ghi trùng, mang theo provider/operation/tools/token/latency/cost và không suy đoán dữ liệu lịch sử bị thiếu. | `8e82a57`, `7082b10`, `84212ad` | Thêm mapping legacy có thể đối soát/xóa, giữ user ID không ánh xạ trong `legacy_user_id`, chi phí/token không rõ là `NULL`, và trigger ngăn backfill phục hồi log đã xóa. | Đã có kiểm tra schema/RLS/backfill và smoke ghi đúng ba operation vào cùng request ID; bằng chứng tích hợp ở `docs/MERGE_VERIFICATION_2026-10-25.md`. | **AI sai 3 (telemetry critique):** JSON parse được nhưng sai schema từng có thể bị log thành `ok`. Đưa validation vào call được telemetry theo dõi và giữ retry thuộc critique. **AI sai 4 (thinking config):** structured Gemini có thể lỗi khi provider không chấp nhận thinking config. Thêm một lần retry có ghi log riêng khi tắt config đó. |
| 3 | 2026-10-26 | Đức | Codex (GPT-6) | Sinh mới | Admin AI Usage và AI Logs: `frontend/src/pages/admin/`, `backend/src/routes/admin.js`, `supabase/migrations/20261026000100_admin_ai_usage_summary.sql` | Chỉ làm khu vực admin theo dõi usage AI: tổng request/token/chi phí/latency/lỗi/từ chối và trang log có lọc/phân trang; không xây quản lý user và không lộ prompt/tài liệu. | `4dbddbc` | Giữ chi phí chưa biết là unknown, giới hạn filters/range, không trả user ID hoặc payload riêng tư trong bảng log. | Cú pháp backend đã được kiểm tra bằng `node --check`; production Vite build đã thành công. Chưa chạy test suite hay áp migration mới lên Supabase. | Chưa có trường hợp AI sai được xác nhận cho thay đổi này; cần cập nhật sau khi review/chạy thử và commit. |
| 4 | 2026-10-26 | Đức | Codex (GPT-6) | Sinh mới | Tab quản trị đọc `AI_USAGE.md`: `frontend/src/pages/admin/AdminAiUsageLogPage.jsx`, `backend/src/routes/admin.js`, `docker-compose.yml` | Thêm trang AI Usage cho admin; đọc trực tiếp file nguồn để thay đổi được phản ánh, giữ quyền truy cập admin-only và hỗ trợ Docker. | `4dbddbc` | Dùng endpoint backend có kiểm quyền, không bundle file vào frontend; Docker bind-mount file chỉ đọc; trang tự làm mới mỗi 30 giây và có nút Refresh. | Production build frontend của cả root và worktree đạt; `node --check` backend đạt. Chưa chạy test suite hoặc kiểm tra bằng trình duyệt có tài khoản admin. | Chưa có trường hợp AI sai được xác nhận cho thay đổi này; cập nhật sau review/chạy thử. |
| 5 | 2026-10-26 | Đức | Codex (GPT-6) | Sửa / refactor | Hardening agent evidence, auth async lifecycle, RLS fixture và eval checker: `backend/src/agent/answerPolicy.js`, `backend/src/agent/agent.js`, `frontend/src/context/AuthContext.jsx`, `backend/eval/ducChecks.js`, tests | Rà các story theo acceptance criteria, tái hiện ca lỗi bằng fixture, rồi sửa và cập nhật traceability/setup/eval docs. | `4dbddbc` | Giữ tool allow-list/SSE và prompt v1 làm lịch sử; thêm prompt `duc-v2`, buffer nội dung CV/JD đến khi qua policy/citation check, chỉ stream app-data sau đúng read tool; dùng epoch/mounted guard cho response auth. Không khẳng định citation chứng minh đúng ngữ nghĩa. | Offline đã chạy: backend 251/251; frontend Node 5/5 + UI 23/23; production build đạt; checker contract 3/3; agent/auth/RLS focused regressions đạt. `eval:duc` offline 8/8 theo test contracts, không gọi Gemini/cloud. | **AI sai 5:** code agent trước đó có thể trả lời thông tin CV khi model bỏ search, dùng nguồn question-bank thay CV, hoặc phát text trước lúc citation được kiểm tra; review tái hiện bằng model giả. Thêm yêu cầu search chạy thành công, nguồn đúng loại, citation check và giữ nội dung CV/JD trong buffer đến khi hợp lệ. **AI sai 6:** `updateProfile`/`refreshUser` response cũ có thể khôi phục người dùng sau logout hoặc đổi phiên; deferred-response tests tái hiện, provider-wide epoch/mounted guard chặn cập nhật cũ. |

### Đức cần hoàn thiện

- Ghi rõ người review và kết quả review cho phần Admin mới; kiểm thử quyền admin/user, lọc/phân trang và thống kê sau khi migration được áp dụng.
- SHA ở các hàng 3–5 trỏ đến commit `4dbddbc` chứa phần triển khai tương ứng. Hai ví dụ lỗi AI ở các hàng trước đã được ghi theo các regression trong tài liệu merge; cần đối chiếu với code review/commit để xác nhận cách diễn đạt cuối cùng.

## Ghi chú về thông tin còn thiếu

Các ngày/SHA của hàng cũ được lấy từ lịch sử Git hiện có. Hệ thống không lưu nguyên văn tất cả prompt; phần “Prompt chính” được ghi là tóm tắt khi có đủ bối cảnh, còn thiếu thì được nêu rõ. Tài liệu mẫu bên ngoài chỉ được dùng làm cấu trúc tham khảo; các nội dung và đường dẫn riêng của dự án khác không được chép vào nhật ký này.
