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

_(to be filled in by Đức: agent tools, authentication, logging, fallback)_

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
| 1 | 2026-10-23 | Long | **Chưa ghi trong log gốc** | Sinh mới | Coach/RAG dựa trên Supabase và pgvector; upload tài liệu, trích xuất nội dung, chia chunk, embeddings, tìm kiếm, trích dẫn nguồn, câu trả lời no-match và retrieval có lọc quyền riêng tư | Log gốc chỉ mô tả công việc, không lưu prompt nguyên văn hoặc bản tóm tắt prompt; Long cần bổ sung câu lệnh chính đã dùng. | `5e4e3e9` | Phần làm chủ được ghi nhận: dữ liệu CV/JD và dữ liệu câu hỏi của app được truy hồi; kết quả gắn nguồn; nội dung riêng tư phải lọc theo user/session. Quyết định chỉnh sửa cụ thể do Long xác nhận thêm. | Có `backend/test/long.test.js`; tài liệu repo ghi 23/23 ca chọn nguồn và 11/11 guard với hai fixture tổng hợp, Gemini embeddings, threshold cục bộ 0.55 ngày 2026-10-24. Kết quả này đo chọn nguồn/guard, không chứng minh độ đúng của câu trả lời sinh ra hoặc chất lượng trên dữ liệu lớn. | Log gốc chưa ghi trường hợp AI sai của Long. **Long cần bổ sung ít nhất hai trường hợp có thật** gồm lỗi AI, cách phát hiện, thay đổi đã làm và bằng chứng; nếu không có, cần xác nhận theo yêu cầu môn học. Không suy diễn lỗi từ việc review của thành viên khác. |
| 2 | 2026-10-24 | Long | **Chưa ghi trong log gốc** | Sửa / refactor | Upload và bảo vệ dữ liệu: giới hạn theo file/user, giới hạn giải nén DOCX, retrieval cân bằng nguồn, ngưỡng theo provider, tiền tố Nomic, xóa chat chọn lọc, prompt Coach/debrief có version, log metadata | Prompt cụ thể chưa có trong log. Chủ đề thay đổi được suy ra từ mô tả commit và phần ghi nhận hiện tại; Long cần xác nhận prompt/cách yêu cầu AI. | `40d755f` | Những hạng mục đã được ghi nhận trong log cũ: thêm giới hạn upload, xử lý DOCX có chặn dung lượng, lọc retrieval riêng tư, prefix riêng cho Nomic và chỉ xóa nội dung chat liên quan tài liệu bị xóa. Người làm cần bổ sung phần nào tự chỉnh và lý do. | Có bộ `backend/eval/long-cases.json`, runner `npm run eval:long`, cùng full backend suite theo lời khai cũ. Kết quả live cần tài khoản thử có fixture; các giới hạn chất lượng được ghi rõ ở hàng 1. | Chưa có lỗi AI cụ thể được ghi. Long cần bổ sung/xác nhận hai ví dụ; không thể dùng các lỗi do Khoa phát hiện khi review Long làm bằng chứng rằng đó là lỗi AI trong phần Long. |

### Long cần hoàn thiện

1. Tên công cụ AI và phiên bản model đã dùng cho từng phần; log hiện có không ghi thông tin này.
2. Prompt chính đã dùng hoặc bản tóm tắt do Long xác nhận; hiện chưa được lưu.
3. Hai ví dụ AI sai của chính phần Long, cách phát hiện và cách sửa; nếu thực tế không có, Long cần xác nhận thay vì ghi khống.
4. Những thay đổi/đánh giá do Long tự thực hiện để phân biệt phần sinh bởi AI với quyết định của người làm.

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
