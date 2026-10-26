# User stories, tiêu chí chấp nhận và bảng truy vết – InterviewAI

Tài liệu này dùng cho báo cáo (mục "user stories + traceability table" của đề). Trạng thái được lập ngày
**26/10/2026** trên `origin/main` (commit `84212ad`), cộng với nhánh `khoa/history-and-usage` chứa US-05 và US-13
(đã chạy và kiểm thử nhưng **chưa gộp vào `main`**). Mỗi story ghi rõ chủ module, trạng thái và mức đã kiểm chứng.

**Cách đọc trạng thái**

| Ký hiệu | Ý nghĩa |
|---|---|
| ✅ Xong | Có code, có test tự động pass, và đã chạy thử với dịch vụ thật |
| 🟡 Xong một phần | Có code và test, nhưng còn thiếu một phần của tiêu chí hoặc chưa kiểm chứng ngoài đời thật |
| ❌ Chưa làm | Chưa có code |

**Kết quả test:** trên `main` backend 236/236, frontend 5/5 (Node) + 16/16 (Vitest). Trên nhánh `khoa/history-and-usage`
backend 260/260, frontend 5/5 (Node) + 40/40 (Vitest). Build frontend pass, `npm audit` backend: 0 lỗ hổng.
Lịch sử Git trên GitHub không chứa khoá bí mật.

## Tổng hợp

| # | User story | Chủ module | Capability | Trạng thái |
|---|---|---|---|---|
| US-01 | Đăng nhập bằng Google | Đức | – | 🟡 Code xong; Google chưa bật ở project Supabase |
| US-02 | Phân quyền admin / user | Đức | – | ✅ |
| US-03 | Luyện phỏng vấn và nhận điểm theo rubric | Khoa | – | ✅ |
| US-04 | Nhận xét có cấu trúc cho từng câu trả lời | Khoa | **C** Structured output | ✅ |
| US-05 | Tìm kiếm, lọc, sắp xếp, phân trang lịch sử | Khoa | – | ✅ (nhánh `khoa/history-and-usage`, chưa gộp vào `main`) |
| US-06 | Tải CV / JD lên và xoá | Long | A (đầu vào) | ✅ |
| US-07 | Hỏi Coach, nhận câu trả lời có nguồn | Long (+Đức: vòng lặp agent) | **A** RAG | ✅ |
| US-08 | Câu trả lời AI hiện dần (streaming) | Long / Đức | – | ✅ |
| US-09 | Chặn prompt injection và câu hỏi ngoài phạm vi | Long (Khoa sửa) | Guardrail | 🟡 Guard là danh sách mẫu câu; lớp bảo vệ chính là chỉ trả lời từ nguồn |
| US-10 | Nhờ Coach làm việc bằng tool, có xác nhận | Đức | **B** Agent | ✅ |
| US-11 | Quản lý kế hoạch luyện tập (CRUD) | Đức | – | ✅ |
| US-12 | App vẫn dùng được khi AI lỗi | Đức | Guardrail | ✅ |
| US-13 | Admin xem thống kê sử dụng AI | Khoa | Logging | ✅ (nhánh `khoa/history-and-usage`, chưa gộp vào `main`; chi phí hiện "unknown" do chưa có giá model) |
| US-14 | *(tuỳ chọn)* Nhận dạng giọng nói bằng AI | Đức | D Multimodal | ❌ (nhánh `cloud-speech-trial` chưa gộp) |

Ba capability bắt buộc cho nhóm 3 người: **A (RAG)**, **B (tool agent)**, **C (structured output)** đều đã có trên `main`.

---

## US-01 – Đăng nhập bằng Google (Đức)

*Là người dùng, tôi muốn đăng nhập bằng Google để không phải tạo mật khẩu.*

**Tiêu chí chấp nhận**
- Trang đăng nhập có nút Google (OAuth2, PKCE qua Supabase Auth); tài khoản email/mật khẩu dùng để test vẫn đăng nhập được.
- Lần đầu đăng nhập, trigger SQL tạo hồ sơ `profiles` với role `user`.
- Mọi request gửi JWT của Supabase; token sai hoặc hết hạn → 401 và giao diện quay về trang đăng nhập.
- Đăng xuất làm token cũ không dùng được nữa.

**Truy vết**
| Thành phần | File |
|---|---|
| Backend | `backend/src/middleware/requireAuth.js`, `backend/src/services/supabaseAuth.js`, `backend/src/db/supabase.js`; `supabase/migrations/20261024000100_profiles.sql` |
| Frontend | `frontend/src/lib/supabase.js`, `frontend/src/context/AuthContext.jsx`, `frontend/src/pages/LoginPage.jsx` |
| Test | `backend/test/person3-auth.test.js`, `person3-sql.test.js`; `frontend/src/pages/LoginPage.test.jsx`, `context/AuthContext.test.jsx`, `lib/supabase.test.jsx` |

**Mức kiểm chứng:** đăng nhập email/mật khẩu, JWT, token đã đăng xuất bị từ chối và 401/403 đã chạy thật với Supabase (theo `docs/CLOUD_VERIFICATION.md`).
**Chưa kiểm chứng:** đăng nhập Google thật bằng trình duyệt – provider Google đang tắt ở project Supabase, cần người có quyền cấu hình.

## US-02 – Phân quyền admin / user (Đức)

**Tiêu chí chấp nhận**
- Middleware `requireRole('admin')`: route `/api/admin/*` trả 403 với role `user`.
- Menu và route Admin ở giao diện chỉ dành cho admin.
- Người dùng không tự đổi được cột `role` (chặn bằng quyền cột trong cơ sở dữ liệu); admin đầu tiên tạo bằng `ADMIN_EMAILS` + script.

**Truy vết:** `backend/src/middleware/requireRole.js`, `backend/src/server.js` (`/api/admin`), `backend/scripts/bootstrapAdmins.js`, `frontend/src/components/ProtectedRoute.jsx`, `frontend/src/App.jsx` (route `/admin/*`);
test `person3-auth.test.js`, `person3-http.test.js`, `person3-sql.test.js`.
**Ghi chú:** trang Admin hiện chỉ là trang giữ chỗ; thống kê nằm ở US-13.

## US-03 – Luyện phỏng vấn và nhận điểm (Khoa)

**Tiêu chí chấp nhận**
- Chọn kịch bản, trả lời từng câu bằng giọng nói hoặc gõ, kết thúc và nhận điểm 4 tiêu chí (Fluency, Relevance, Vocabulary Range, Structure).
- Câu trả lời gõ có điểm Fluency = 0 (Fluency đo giọng nói).
- Điểm do code (rubric) quyết định, không do LLM; session của người khác trả 404.

**Truy vết**
| Endpoint | File | Test |
|---|---|---|
| `POST /api/sessions`, `POST /api/sessions/:id/answer`, `POST /api/sessions/:id/finish`, `GET /api/sessions/:id/feedback`, `GET /api/progress` | `backend/src/routes/sessions.js`, `services/sessionService.js`, `aiSimulator.js`, `scoringService.js`, `data/rubric.json`, `data/scenarios.json` | `scoring.test.js`, `services.test.js`, `scenarios.test.js` |
| Giao diện | `InterviewPage.jsx`, `FeedbackPage.jsx`, `DashboardPage.jsx`, `ScoreBar.jsx` | – |

**ADR liên quan:** `docs/adr/0001-llm-does-not-score.md`.

## US-04 – Nhận xét có cấu trúc cho từng câu trả lời (Khoa) – capability C

*Là người luyện, tôi muốn biết câu trả lời còn thiếu ý gì so với đáp án tham khảo.*

**Tiêu chí chấp nhận**
- Sau mỗi câu, LLM trả JSON (`coveredPoints`, `missingPoints`, `strengths`, `suggestion`, `improvedAnswer`, `onTopic`), được kiểm tra bằng schema Zod trước khi lưu và hiển thị.
- JSON sai → thử lại một lần kèm lỗi; vẫn sai hoặc AI lỗi → dùng nhận xét dự phòng tạo từ dữ liệu câu hỏi; buổi luyện không bị gián đoạn.
- Điểm rubric không đổi dù có hay không có AI; điểm/ý "thiếu" phải truy được về đáp án tham khảo (kiểm tra bằng code, loại bỏ ý không có trong ngân hàng câu hỏi).
- Nhận xét chạy nền; trang kết quả tự cập nhật khi nhận xét về tới.

**Truy vết**
| Thành phần | File |
|---|---|
| Backend | `backend/src/services/critiqueService.js`, `schemas/critique.js`, `utils/schema.js`, `prompts/critique.md`, `services/sessionService.js` (`startCritique`, `waitForCritiques`), `store/table.js` (`setTurnCritique`) |
| Frontend | `frontend/src/components/CritiqueBlock.jsx`, `pages/FeedbackPage.jsx` |
| Test | `backend/test/critique.test.js`, `eval.test.js` |
| Đánh giá | `backend/eval/run.js`, `eval/checks.js`, `eval/cases/critique.json`; kết quả trong `backend/eval/results/` |
| Tài liệu | `docs/adr/0002-grounding-checks-on-model-output.md` |

**Kết quả đánh giá (8 case × 3 lượt, mô hình local Gemma):** 79% → 88% → 100% sau hai cải tiến; Gemini flash-lite: 7/8 (1 lỗi timeout). Chỉ là bằng chứng trên mẫu nhỏ, xem giới hạn trong ADR 0002.

## US-05 – Tìm kiếm, lọc, sắp xếp, phân trang lịch sử (Khoa)

*Là người luyện, tôi muốn tìm lại một buổi phỏng vấn cũ theo kịch bản, trạng thái hoặc ngày.*

**Tiêu chí chấp nhận**
- `GET /api/sessions?q=&scenario=&status=&from=&to=&sort=date|score&order=asc|desc&page=&limit=` (`limit` ≤ 50, mặc định 10) trả `{items, page, limit, total, totalPages}`; `q` tìm trong tên kịch bản, ngành, cấp độ, loại câu hỏi.
- Chỉ trả session của người gọi: lọc theo người dùng ở tầng ứng dụng **và** do row-level security của cơ sở dữ liệu; mọi giá trị đi vào SQL qua tham số bind, không nối chuỗi.
- Session chưa chấm điểm luôn xếp cuối khi sắp xếp theo điểm; ngày chỉ có ngày (không giờ) hiểu là cả ngày theo UTC.
- Tham số sai (trạng thái lạ, trang 0, `limit` > 50, ngày sai, `from` sau `to`, nhiều giá trị) → 400 kèm thông báo rõ.
- Giao diện: trang `/history` có ô tìm kiếm, lọc kịch bản / trạng thái / khoảng ngày, sắp xếp, phân trang; bộ lọc nằm trên URL (tải lại hoặc gửi link vẫn giữ nguyên); dùng được trên điện thoại.

**Truy vết**
| Thành phần | File |
|---|---|
| Backend | `GET /api/sessions` trong `backend/src/routes/sessions.js`; `services/historyService.js` (kiểm tra tham số, kết quả); `store/sessionSearch.js` (SQL và bản chạy trong bộ nhớ); chỉ mục `sql/004_session_owner_index.sql` |
| Frontend | `frontend/src/pages/HistoryPage.jsx`, `lib/api.js` (`searchSessions`), liên kết trong `components/Header.jsx` và `pages/DashboardPage.jsx` |
| Test | `backend/test/history.test.js` (11 test, gồm SQL thật trên PostgreSQL nhúng với đúng migration và RLS, thử tấn công SQL injection, HTTP); `frontend/src/pages/HistoryPage.test.jsx` (9 test) |

**Mức kiểm chứng:** chạy thật với Supabase (4 session của tài khoản demo): lọc, sắp xếp và phân trang đúng. Giao diện được chụp ở màn hình máy tính và 375 px (không tràn ngang), seed 13 session qua API thật.

## US-06 – Tải CV / JD lên và xoá (Long)

**Tiêu chí chấp nhận**
- Nhận PDF, DOCX, TXT, MD ≤ 5 MB; sai loại / quá cỡ / rỗng → 400. Giới hạn 100 000 ký tự, 40 đoạn, 10 tài liệu mỗi người, 3 tài liệu mỗi buổi phỏng vấn; DOCX nén quá mức bị từ chối.
- File lưu ở bucket riêng tư; văn bản được tách đoạn, nhúng vector (768 chiều) và lưu pgvector theo `user_id`.
- Xoá tài liệu xoá cả file, bản ghi và đoạn đã chỉ mục; người khác không xem/xoá được (404).
- Dòng chỉ thị kiểu "ignore previous instructions" bị loại trước khi lập chỉ mục.

**Truy vết:** `POST/GET/DELETE /api/documents`, `GET /api/documents/:id`; `backend/src/routes/documents.js`, `services/documentService.js`, `ragService.js`, `embeddingService.js`;
`backend/sql/002_rag.sql`, `003_document_library.sql` (và bản trong `supabase/migrations/`); `frontend/src/pages/DocumentsPage.jsx`;
test `long.test.js`, `rag.test.js`; script `backend/scripts/smokeDocuments.js`.
**Ghi chú riêng tư:** `backend/docs/privacy-long.md`.

## US-07 – Hỏi Coach và nhận câu trả lời có nguồn (Long, agent: Đức) – capability A

**Tiêu chí chấp nhận**
- Câu trả lời có đánh dấu [1] [2] và danh sách nguồn (CV/JD, câu hỏi trong ngân hàng, buổi luyện); số nguồn không có trong kết quả truy xuất bị loại.
- Không có đoạn nào đạt ngưỡng → "không tìm thấy", không tự bịa.
- Truy xuất luôn lọc theo người dùng; không lấy được tài liệu của người khác.
- So sánh CV với JD: yêu cầu có bằng chứng từ cả hai; thiếu một trong hai → yêu cầu tải lên.

**Truy vết:** `POST /api/coach/chat`; `backend/src/agent/agent.js` (tool `search_knowledge`), `services/ragService.js` (`retrieveKnowledge`, ngưỡng theo nhà cung cấp, "cứu" bằng trùng từ), `services/coachService.js`;
`frontend/src/pages/CoachPage.jsx`; test `rag.test.js`, `long.test.js`, `rag-fixes.test.js`, `person3-agent.test.js`, `frontend/src/pages/CoachPage.test.jsx`.
**ADR:** `backend/docs/adr-long-rag.md`.
**Đo thử:** với 13 câu hỏi thật về CV/JD, ngưỡng 0,72 trả lời đúng 4/13, ngưỡng 0,55 đúng 11/13 và vẫn chặn 7/7 câu ngoài chủ đề (Gemini embedding).

## US-08 – Streaming (Long / Đức)

**Tiêu chí chấp nhận:** server-sent events với `token`, `sources`, `tool`, `action`, `done`, `error`; giao diện hiện chữ dần, có nút dừng; mất kết nối giữ phần đã nhận.
**Truy vết:** `POST /api/coach/chat`, `POST /api/sessions/:id/chat/stream`; `services/llmService.js` (`generateStream`), `services/geminiClient.js`; `CoachPage.jsx`, `SessionChat.jsx`, `lib/api.js`; test `person3-agent.test.js`, `llm.test.js`, `CoachPage.test.jsx`.

## US-09 – Chặn prompt injection và câu hỏi ngoài phạm vi (Long, Khoa sửa)

**Tiêu chí chấp nhận**
- Câu kiểu "bỏ qua hướng dẫn", "in system prompt" → từ chối lịch sự, không làm theo.
- Câu ngoài phạm vi → từ chối hoặc "không tìm thấy trong tài liệu / ngân hàng câu hỏi".
- Nội dung tài liệu luôn là dữ liệu, không phải chỉ thị; không chặn nhầm câu hợp lệ (ví dụ "dự án weather app của tôi").

**Truy vết:** `backend/src/guards/inputGuard.js`; test `long.test.js`, `rag-fixes.test.js`; đánh giá `backend/eval/runLong.js`, `eval/long-cases.json`.
**Giới hạn (nên nêu trong báo cáo):** danh sách mẫu câu không thể bắt hết các cách diễn đạt; câu lạ vẫn được chặn gián tiếp vì app chỉ trả lời từ nguồn đã truy xuất. 14/14 câu tấn công/ngoài phạm vi mới do Khoa nghĩ ra ban đầu không bị chặn, sau đó đã bổ sung mẫu câu và kiểm tra lại.

## US-10 – Nhờ Coach làm việc bằng tool, có xác nhận (Đức) – capability B

**Tiêu chí chấp nhận**
- Có 7 tool đọc/ghi dữ liệu thật (`search_knowledge`, `list_sessions`, `get_session_feedback`, `list_weak_areas`, `search_scenarios`, `create_practice_plan`, `update_practice_plan_item`); tối đa 5 vòng gọi tool.
- Tool ghi chỉ tạo đề xuất; bấm **Xác nhận** mới ghi. Huỷ hoặc hết hạn (10 phút) thì không ghi; xác nhận hai lần → 409; người khác → 404.
- Danh tính lấy từ đăng nhập, không lấy từ tham số của tool.

**Truy vết:** `backend/src/agent/agent.js`, `agent/tools/index.js`, `services/actionService.js`, `routes/coach.js` (`POST /api/coach/actions/:id/confirm|cancel`),
`supabase/migrations/20261024000200_plans_actions_logs.sql`; `frontend/src/components/ConfirmActionCard.jsx`, `CoachPage.jsx`;
test `person3-agent.test.js`, `person3-sql.test.js`, `frontend/src/components/ConfirmActionCard.test.jsx`.
**ADR:** `backend/docs/adr-duc-auth-agent.md`. **Đánh giá:** `backend/eval/duc-cases.json`, `runDuc.js`, `runDucLive.js`; theo `docs/CLOUD_VERIFICATION.md` đợt chạy thật đầu 5/6, các lần sau bị Gemini giới hạn (HTTP 429) nên **chưa có tỷ lệ pass đầy đủ**.

## US-11 – Quản lý kế hoạch luyện tập (Đức)

**Tiêu chí chấp nhận:** tạo/sửa/xoá kế hoạch và từng mục (kịch bản, ngày, trạng thái); bắt đầu luyện từ mục; chỉ thấy kế hoạch của mình (RLS); kiểm tra dữ liệu đầu vào.
**Truy vết:** `GET/POST /api/plans`, `PATCH/DELETE /api/plans/:id`, `POST /api/plans/:id/items`, `PATCH/DELETE /api/plans/items/:id`; `routes/plans.js`, `services/planService.js`; `frontend/src/pages/PlanPage.jsx`; test `person3-plans.test.js`, `person3-sql.test.js`.

## US-12 – App vẫn dùng được khi AI lỗi (Đức)

**Tiêu chí chấp nhận:** `GET /api/health/ai` cho biết trạng thái; AI lỗi / hết hạn mức / JSON sai → banner "AI tạm thời không khả dụng", luyện phỏng vấn, chấm điểm, kế hoạch vẫn chạy; câu trả lời rỗng, timeout, JSON sai được xử lý và ghi log.
**Truy vết:** `backend/src/services/aiHealth.js`, `server.js` (`/api/health/ai`), `services/aiTelemetry.js`, `critiqueService.js` / `chatService.js` (nhận xét và trả lời dự phòng); `frontend/src/components/AiStatusBanner.jsx`; test `person3-ai.test.js`, `merge-llm.test.js`, `critique.test.js`.
**Mức kiểm chứng:** khoá API sai → agent trả bản dự phòng và trạng thái AI chuyển "không khả dụng" (chạy thật). Banner trên trình duyệt khi AI sập chưa được kiểm tra bằng mắt.

## US-13 – Admin xem thống kê sử dụng AI (Khoa)

*Là quản trị viên, tôi muốn biết app dùng AI bao nhiêu, nhanh chậm, lỗi và tốn kém thế nào.*

**Tiêu chí chấp nhận**
- `GET /api/admin/usage?from=&to=&capability=&model=&prompt=` trả: số request, thành công / thất bại (lỗi, timeout, JSON sai) / bị từ chối, thời gian trung bình và p95, token vào/ra, chi phí ước tính; chia theo capability, model, phiên bản prompt và theo ngày. Mặc định 30 ngày gần nhất (tối đa 366 ngày).
- Chỉ admin: chưa đăng nhập → 401, người dùng thường → 403. Chỉ trả số liệu tổng hợp, không có prompt, câu trả lời hay danh tính người dùng.
- Số liệu lấy thật từ bảng `ai_logs`; request bị guard từ chối trước khi gọi model không tính vào thời gian, token, chi phí.
- **Giá chưa biết là "unknown", không phải 0**: trang ghi rõ chi phí chỉ bao gồm bao nhiêu trên tổng số request có gọi model; token không được báo cũng hiện "-" thay vì 0.
- Giao diện `/admin/usage`: bộ lọc thời gian (7/30/90 ngày hoặc tự chọn) và capability / model / prompt, thẻ tổng quan, biểu đồ theo ngày, ba bảng chi tiết; dùng được trên điện thoại.

**Truy vết**
| Thành phần | File |
|---|---|
| Backend | `GET /api/admin/usage`: `backend/src/routes/admin.js`, `services/usageService.js` (SQL tổng hợp, kiểm tra tham số), `db/postgres.js` (`privilegedQuery`, chỉ dùng sau `requireRole('admin')`), `server.js`; dữ liệu từ `ai_logs` (`services/aiTelemetry.js`, `supabase/migrations/20261024000200…`, `…20261025000100…`) |
| Frontend | `frontend/src/pages/AdminPage.jsx`, `AdminUsagePage.jsx`, `lib/usageFormat.js`, route trong `App.jsx` |
| Test | `backend/test/usage.test.js` (13 test: SQL thật trên bảng `ai_logs` với số liệu tính tay, bộ lọc, injection, phân quyền HTTP); `frontend/src/pages/AdminUsagePage.test.jsx` (8), `lib/usageFormat.test.js` |

**Mức kiểm chứng:** chạy trên `ai_logs` thật (140 request): khớp với `count(*)`, bộ lọc và phân nhóm đúng.
**Hạn chế cần ghi trong báo cáo:** chi phí hiện là "unknown" vì `backend/src/config/pricing.json` chưa có giá của `gemini-3.6-flash` và `gemini-embedding-001`; thêm giá thì trang tự tính chi phí trung bình. Giao diện admin đã chụp với số liệu thật nhưng việc đăng nhập admin được mô phỏng (chưa thử với tài khoản admin Supabase thật).

## US-14 – Nhận dạng giọng nói bằng AI (tuỳ chọn, Đức) – ❌

Có commit trên nhánh `cloud-speech-trial` (Groq Whisper + Orpheus) nhưng **chưa gộp vào `main`** (xung đột `server.js` và `frontend/src/lib/api.js`). Chưa tính là capability D.

---

## Các yêu cầu chung của đề và nơi có bằng chứng

| Yêu cầu | Bằng chứng / vị trí | Trạng thái |
|---|---|---|
| Prompt lưu trong file, có phiên bản | `backend/src/prompts/*.md` (+ `archive/`), `backend/src/agent/prompts/coach.v1.md` | ✅ (còn hai nơi nạp prompt) |
| ≥ 3 ADR, ít nhất 1 về thiết kế AI | `docs/adr/0001`, `0002`, `backend/docs/adr-long-rag.md`, `backend/docs/adr-duc-auth-agent.md` | ✅ |
| Bộ đánh giá ≥ 20 case, trước/sau cải tiến | critique 8, Long 34, Đức 8 (ba trình chạy riêng) | 🟡 đủ số case, chưa gộp thành một báo cáo |
| Log mỗi request AI (phiên bản prompt, tool, token, độ trễ) | bảng `ai_logs`, `services/aiTelemetry.js`, `docs/` của Đức | ✅ ghi log; báo cáo trung bình chi phí/độ trễ nằm ở trang `/admin/usage` (US-13, chưa gộp vào `main`), chi phí cần thêm giá model vào `pricing.json` |
| `AI_USAGE.md` đủ ba người | `AI_USAGE.md` (Khoa, Long, Đức) | cần Đức kiểm tra phần của mình |
| Triển khai (Docker Compose hoặc hosting) | `docker-compose.yml`, `render.yaml`, `frontend/vercel.json`, `docs/DUC_SETUP.md` | 🟡 có cấu hình, **chưa triển khai thật** |
| Riêng tư: dữ liệu nào gửi tới nhà cung cấp LLM | `backend/docs/privacy-long.md` | ✅ |
| Không có khoá bí mật trong Git | quét toàn bộ lịch sử trên GitHub ngày 26/10: không có khoá thật | ✅ |
| Sơ đồ kiến trúc (FE, BE, DB, vector store, LLM, luồng một request AI) | – | ❌ chưa có bản cập nhật |
| Báo cáo PDF, slide ≤ 15, video demo | – | ❌ |
