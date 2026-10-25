# Kế hoạch hoàn thiện các story của Đức

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Người dùng yêu cầu đúng một subagent review; subagent review đã hoàn tất. Đề xuất thực hiện các bước code trực tiếp trong phiên chính.

**Goal:** Khắc phục bốn thiếu sót đã được xác minh trong story auth, agent và kiểm chứng; đồng bộ tài liệu final với bằng chứng thật.

**Architecture:** Giữ kiến trúc React, Express, Supabase và Gemini đang có. Thêm chính sách kiểm tra bằng chứng ở ranh giới trả lời của agent, dùng một bộ đếm vòng đời auth chung trong AuthProvider, sửa fixture RLS và tách việc chấm eval thành hàm thuần có thể kiểm tra offline.

**Tech Stack:** Node.js, Express, React, Supabase Auth/Postgres, PGlite/pgvector, Node test runner và Vitest.

**Spec:** Thiết kế đề xuất và tiêu chí chấp nhận trong mục 1–3 của tài liệu này, dựa trên yêu cầu brainstorming/planning của người dùng và review độc lập ngày 2026-10-26. Đây là bản để người dùng duyệt trước khi thực hiện code.

## 1. Kết luận review độc lập

Một subagent đã rà lại current working tree bằng cách đọc code và tái hiện offline. Kết luận:

| Vấn đề | Bằng chứng | Phạm vi ảnh hưởng |
|---|---|---|
| Agent trả thông tin CV dù model bỏ qua tìm nguồn | backend/src/agent/agent.js nhận final text khi sources rỗng. Mô hình giả lập trả kinh nghiệm không có thật vẫn được trả về và phát token. | Sai nội dung và thiếu kiểm soát output; chưa chứng minh rò dữ liệu chéo user. |
| Text không có citation hợp lệ có thể lộ trước khi final bị thay thế | onToken phát trước validateCitations cho nhánh ngoài comparison. | Người dùng thấy nội dung chưa hợp lệ; khi stream đứt, UI có thể giữ partial text. |
| Live eval đếm tên tool thay cho thành công | backend/eval/runDucLive.js lấy mọi tool event, gồm running/error. | Ca đọc có thể pass khi tool thất bại. Kết quả lịch sử cần giữ định nghĩa chấm cũ. |
| Auth có response đến muộn khôi phục user cũ | refreshUser/updateProfile không dùng version guard của sync trong AuthContext. | UI/điều hướng có thể sai sau logout, expiry hoặc đổi tài khoản; backend vẫn kiểm tra JWT. |
| Test ownership dùng session không hợp lệ cho Bob | person3-sql.test.js chỉ tạo session Alice rồi dùng cùng session_id khi đóng vai Bob. | Một số assertion đang chứng minh chặn inactive session thay vì chặn hai user hợp lệ đọc dữ liệu nhau. |

Baseline ở lượt review trước: backend 236/236 test; frontend 5 test Node và 16 test UI đạt. Đây là kết quả local của checkout lúc review, không phải một lần chạy cloud mới. Review độc lập không gọi Google/Gemini hoặc sửa dữ liệu cloud.

AI_USAGE.md đã có bốn ví dụ AI sai của Đức tại các hàng bổ sung. Nhận xét trước rằng Đức thiếu hai ví dụ cần được sửa trong hướng dẫn slide. Không tạo thêm câu chuyện lỗi để đủ số lượng.

## 2. Brainstorming và lựa chọn đề xuất

| Hướng | Lợi ích | Hạn chế | Quyết định đề xuất |
|---|---|---|---|
| Chỉ tăng yêu cầu trong prompt | Ít thay đổi code | Không ngăn model bỏ tool hoặc stream lời bịa; lỗi đã tái hiện được | Không đủ cho các lỗi đã tìm thấy. |
| Chính sách bằng chứng tại backend và kiểm tra trước khi hiển thị | Kiểm soát được ca model không tuân thủ, không thêm một model call kiểm duyệt | Phải phân biệt câu hỏi dữ liệu với lời chào/làm rõ; nhánh knowledge mất hiển thị token tức thời | Chọn hướng này. |
| Thêm một LLM kiểm tra câu trả lời | Có thể nhận diện sai ngữ nghĩa tốt hơn kiểm tra citation | Tăng chi phí/latency; chính model kiểm tra cũng có thể sai | Chưa cần trong đợt này. |

Đợt này gồm bốn sửa lỗi và một bước cập nhật tài liệu. Những phần mở rộng như lưu lịch sử Coach, tool liệt kê practice plans mới, deployment và tìm kiếm lịch sử US-05 được giữ thành các việc độc lập để không làm lớn đợt sửa.

## 3. Thiết kế và tiêu chí chấp nhận

### 3.1 Agent cần bằng chứng phù hợp trước khi trả lời

Tạo helper thuần backend/src/agent/answerPolicy.js để phân loại yêu cầu và quyết định điều kiện trả lời. Không dùng knowledgeIntent hiện tại làm bộ phân loại chung: hàm đó mặc định mọi trường hợp còn lại thành document.

Giao diện dự kiến:

- classifyCoachRequest(message) trả một mode: comparison, knowledge, app-data, plan-write hoặc greeting. app-data có danh sách tool đọc phù hợp. Trường hợp không xác định được mặc định yêu cầu bằng chứng hoặc trả lời làm rõ cố định.
- assessAnswerEvidence({ request, completedTools, sources, hasAction }) trả { allowed, reason }. completedTools là các lần executeTool thực sự thành công và dữ liệu trả về trong phạm vi request, không phải tên tool model yêu cầu.
- Chỉ lấy userId từ auth context. Không lưu nội dung tool, CV hoặc transcript vào telemetry hay trả payload nội bộ qua SSE để phục vụ eval.

Quy tắc:

1. Yêu cầu CV/JD/tài liệu/kiến thức phải có search_knowledge thành công và nguồn tương ứng. Một lần list_sessions thành công không đủ để trả lời nội dung CV. Nhận diện CV/JD và comparison ưu tiên hơn từ khóa chung về plan/session.
2. Comparison vẫn cần cả nguồn CV và JD cùng citation hợp lệ như hiện tại.
3. Câu hỏi dữ liệu app phải gọi đúng tool đọc, ví dụ list_sessions hoặc get_session_feedback. Tool trả lỗi không tạo bằng chứng. Kết quả rỗng là dữ liệu hợp lệ nhưng chỉ cho phép thông báo không có dữ liệu tương ứng.
4. Tool ghi chỉ tạo action chờ xác nhận. Khi chưa có action hợp lệ, backend dùng thông báo làm rõ cố định cho yêu cầu chưa đủ thông tin, không chuyển lời model tự khẳng định đã lưu dữ liệu.
5. Lời chào/help thuộc danh sách ngắn được backend trả lời cố định. Khi cần ID item hoặc thông tin thao tác, dùng câu làm rõ cố định; tránh khóa mất luồng hỏi thêm hiện có.
6. Với knowledge/comparison và các vòng chưa đủ bằng chứng, thu token vào buffer; chỉ phát text sau kiểm tra nguồn/citation. Không chuyển nội dung bị loại vào partial reply khi stream đứt. Với dữ liệu app đã có đúng tool đọc, có thể giữ streaming hiện tại; kết quả phải được gắn với mode và dữ liệu tool tương ứng.
7. Giữ sự kiện SSE status/tool/sources/action/done/error và không thêm token giả để tạo cảm giác streaming. Giữ 7 tool, tối đa 5 vòng và 8 tool mỗi vòng. Không thêm LLM kiểm duyệt hoặc embedding mặc định cho lời chào/plan.
8. Citation hợp lệ chỉ chứng minh số nguồn tồn tại. Không tuyên bố đã kiểm tra đầy đủ việc câu trả lời có suy ra đúng từ nguồn; hạn chế này vẫn cần ghi trong report và đánh giá bằng case chất lượng.

Mode được xác định tại backend, không cho model hoặc client tự khai báo để bỏ kiểm tra. Bộ nhận diện Việt/Anh phải có ca false positive như “weather app trong CV” và ca trộn ý định như hỏi session nhưng kèm thông tin CV. Không dùng danh sách từ khóa để khẳng định đã hiểu được mọi ngôn ngữ; tình huống mơ hồ dùng làm rõ an toàn.

### 3.2 Auth dùng chung vòng đời cho tất cả cập nhật user

Đưa epoch/mounted guard lên phạm vi AuthProvider bằng useRef, áp dụng cho sync, refreshUser, login/register continuation và updateProfile. Mỗi thao tác chụp epoch cùng tài khoản/phiên ở thời điểm bắt đầu; chỉ apply response nếu vẫn thuộc vòng đời hiện tại.

Invalidate ngay khi bắt đầu logout, SIGNED_OUT, AUTH_EXPIRED, đổi tài khoản và unmount. Token refresh cùng tài khoản không tự làm mất profile hợp lệ. Logout chỉ xóa user sau khi server logout thành công theo hành vi đang có; response cũ phải bị vô hiệu ngay khi logout bắt đầu. Nếu logout lỗi, giữ thông báo lỗi và user hiện tại, đồng thời cho phép một lần đồng bộ mới. Continuation login cũ không được trả thành công và điều hướng như tài khoản hiện tại.

### 3.3 Eval chấm theo thực thi và kết quả

Tạo backend/eval/ducChecks.js xuất evaluateDucCase({ testCase, events, answer, toolResults, transportErrors, plansAfter }). Kết quả gồm pass và checks cho selection, execution, outcome, transport cùng reason codes ổn định. toolResults chỉ ở trong eval harness; bọc executor nội bộ qua dependency injection mặc định executeTool, không mở API mới và không trả payload tool qua SSE.

Ca đọc chỉ pass khi tool mong đợi chạy thành công, output đúng với fixture của case và câu trả lời cuối dùng được. running/error hoặc gọi sai tool không pass. Provider lỗi sau tool thành công làm outcome fail; báo riêng transport để không gọi nhầm thành lỗi chọn tool. Ca proposal phải có đúng một pending action đã validate và chưa có plan được ghi. Ca refusal không gọi model/tools và có đúng refusal reason.

Báo cáo ghi checker_version mới, prompt_version thực tế và diagnostics theo từng chiều. Dùng tên file có timestamp để không ghi đè historical JSON. Không tính lại pass rate lịch sử từ dữ liệu chưa đủ chi tiết; giữ nguyên và ghi chú đó là tiêu chí chấm cũ.

### 3.4 RLS phải được kiểm tra với hai phiên hợp lệ

Tạo SESSION_ALICE và SESSION_BOB khác nhau. asUser(user, operation) dùng session đúng owner; trước các assertion ownership phải assert is_session_active() = true cho cả hai người. Mỗi người có ít nhất một plan/session/action riêng, đọc được dữ liệu của mình, không đọc hoặc sửa/xác nhận được dữ liệu người kia. Giữ một nhóm kiểm tra revoked/mismatched session riêng, có expected SQLSTATE phù hợp.

## Global Constraints

- Giữ API auth, plans, confirmation và public SSE event contracts đang dùng.
- Giữ 7 tool, tối đa 5 vòng và 8 tool mỗi vòng; proposal hết hạn sau 10 phút.
- Không thay schema DB hoặc thêm dependency nếu các regression chưa chứng minh cần thiết.
- Không làm mất các thay đổi admin/scenarios/tài liệu đang có trong working tree; không stage toàn bộ repo.
- Không ghi secrets hoặc nội dung riêng tư vào test output, telemetry, eval report hoặc tài liệu.
- Offline regression dùng dữ liệu tổng hợp. Một lần live Gemini/cloud mới cần được thông báo rõ vì dùng quota và có thể phát sinh chi phí.
- Không commit/push/migrate/deploy trong phạm vi kế hoạch chưa được thực thi; điểm commit chỉ bao gồm các file của từng task khi người dùng yêu cầu tích hợp.

## Review Focus

1. Model bỏ tool hoặc gọi tool không liên quan: không được phát/giữ câu trả lời bịa về CV/JD.
2. Model phát token không có nguồn rồi stream đứt: partial reply không giữ thông tin chưa được kiểm tra ở nhánh knowledge/comparison.
3. Profile response cũ về sau logout, expiry hoặc đổi tài khoản: không khôi phục identity cũ, kể cả continuation login/register.
4. Tool đúng tên nhưng chạy lỗi hoặc provider lỗi sau tool: không được chấm pass ở outcome.
5. Hai user active cùng lúc và có dữ liệu riêng: phải chứng minh positive access và negative ownership độc lập với kiểm tra session invalid.

## Task 1: Sửa fixture SQL và kiểm tra ownership

**Files:** Modify/Test backend/test/person3-sql.test.js. Đọc supabase/migrations/20261024000100_profiles.sql và 20261024000200_plans_actions_logs.sql để dùng đúng SQLSTATE.

**Interfaces:** asUser(user, operation) giữ chữ ký, chọn session từ map theo user. Không đổi production API.

- [ ] Thêm positive assertion Bob active và đọc được plan của Bob; chứng kiến fixture cũ làm assertion thất bại.
- [ ] Tạo hai session đúng owner, seed dữ liệu riêng và sửa asUser.
- [ ] Thêm assertion Alice/Bob không đọc, sửa, xóa plan/item hoặc xác nhận action của nhau; xác nhận foreign action trả no_data_found/P0002. Giữ test session giả/revoked thành nhóm riêng.
- [ ] Chạy: node --test backend/test/person3-sql.test.js. Đạt khi cả positive ownership và negative ownership có hiệu lực; confirmation/rollback cũ vẫn pass.

## Task 2: Ngăn response auth đến muộn

**Files:** Modify frontend/src/context/AuthContext.jsx. Test frontend/src/context/AuthContext.test.jsx và các LoginPage tests liên quan.

**Interfaces:** useAuth giữ các method hiện có; response hết hiệu lực không được áp user hoặc được coi là đăng nhập thành công. Guard nội bộ không lộ ra API sản phẩm.

- [ ] Viết deferred-response regression cho updateProfile và refreshUser sau logout, AUTH_EXPIRED, đổi Alice sang Bob và unmount. Assert context không trở về Alice và không tạo điều hướng thành công từ request cũ.
- [ ] Chạy frontend UI test riêng và xác nhận các ca race thất bại vì response cũ thực sự phục hồi user.
- [ ] Dùng provider-wide epoch/mounted guard cho mọi async path setUser; bảo toàn logout failure behavior và token-refresh cùng user.
- [ ] Kiểm tra profile hiện tại vẫn cập nhật được; logout lỗi vẫn hiển thị lỗi/giữ user; Google/password login/register mới vẫn hoạt động.
- [ ] Chạy: npm.cmd run test:ui --prefix frontend -- src/context/AuthContext.test.jsx src/pages/LoginPage.test.jsx. Đạt khi race bị chặn và các luồng đăng nhập hiện có vẫn pass.

## Task 3: Kiểm tra bằng chứng của agent trước khi hiển thị

**Files:** Create backend/src/agent/answerPolicy.js. Modify backend/src/agent/agent.js và backend/src/agent/prompts/coach.v1.md theo quy trình versioning: tạo coach.v2.md, đổi coachPrompt.js sang duc-v2 và giữ v1 để đối chiếu. Test backend/test/person3-agent.test.js; thêm helper policy test file nếu cần; Test frontend/src/pages/CoachPage.test.jsx cho dữ liệu SSE bị ngắt.

**Interfaces:** classifyCoachRequest(message), assessAnswerEvidence({ request, completedTools, sources, hasAction }) như mục 3.1. runAgent giữ các tham số đang có; thêm tùy chọn execute = executeTool để eval nội bộ quan sát kết quả mà không sửa public SSE.

- [ ] Thêm regression cho model trả factual text không gọi tool; tool lỗi; tool sai loại; trả CV sau list_sessions; nguồn rỗng; uncited/invalid-citation text; stream đứt trước validation; valid citations; comparison đủ/thiếu hai loại nguồn.
- [ ] Thêm ca greeting, câu làm rõ ID item, plan thiếu dữ liệu và câu CV nói về weather app để giữ chức năng hợp lệ.
- [ ] Chạy regression và ghi nhận đúng các ca currently-broken thất bại; các ca hành vi được giữ có thể đã pass.
- [ ] Triển khai policy theo mục 3.1; lưu bằng chứng từ execution thành công; buffer text theo mode và trả response cố định khi chưa có bằng chứng. Không nhận mode/identity từ client/model.
- [ ] Nâng prompt lên duc-v2 để mô tả guard mới; giữ prompt v1 và mô tả thay đổi phục vụ before/after.
- [ ] Chạy: node --test backend/test/person3-agent.test.js backend/test/person3-ai.test.js backend/test/person3-plans.test.js backend/test/unified-ai-logs.test.js. Chạy frontend CoachPage test nếu thay phần hiển thị. Đạt khi không phát unsupported knowledge text và không hỏng proposal, cancel/confirm, source numbering, fallback, timeout/cancellation, log attempts.
- [ ] Rà lại trade-off: status/tool vẫn realtime; knowledge text xuất hiện sau kiểm tra. Báo cáo giới hạn citation không chứng minh semantic truth.

## Task 4: Sửa cách chấm và lưu live eval

**Files:** Create backend/eval/ducChecks.js và backend/test/duc-eval.test.js. Modify backend/eval/runDucLive.js, backend/eval/duc-cases.json và backend/eval/runDuc.js cho prompt metadata thực tế nếu cần. Không sửa historical JSON results.

**Interfaces:** evaluateDucCase({ testCase, events, answer, toolResults, transportErrors, plansAfter }) trả { pass, checks, reasons }; dùng execute injection của Task 3 để capture kết quả tool riêng trong harness.

- [ ] Viết ca checker cho running-only, error, sai tool, output rỗng/sai fixture, provider fail sau tool thành công, valid read, valid pending proposal và refusal không gọi tool/model.
- [ ] Xác nhận tiêu chí hiện tại chấp nhận sai running/error; triển khai checker thuần và gọi từ live runner.
- [ ] Đặt expected checks theo dữ liệu tổng hợp: session ID/owner, feedback đúng session, weak areas từ fixture, scenario Junior thực tồn tại, proposal payload validate và chưa ghi plan.
- [ ] Báo tool selection, execution, outcome và transport riêng; report checker_version và prompt_version thực tế; tên file timestamp không ghi đè lịch sử.
- [ ] Chạy: node --test backend/test/duc-eval.test.js. Dùng fixture kiểm tra report generation mà không gọi Gemini; ghi rõ đây là offline contract.
- [ ] Chạy live sau khi thông báo quota/chi phí và môi trường sẵn sàng. Lưu kết quả mới, không sửa 5/6 và 2/6 cũ thành kết quả của checker mới.

## Task 5: Kiểm chứng tích hợp và cập nhật tài liệu final

**Files:** Modify docs/DUC_TRACEABILITY.md, docs/CLOUD_VERIFICATION.md, docs/DUC_SETUP.md, FINAL_PROJECT_SLIDE_AND_REQUIREMENTS_GUIDE.md và AI_USAGE.md. Thêm ghi nhận review hiện tại nếu cần; không sửa/xóa lời tường thuật gốc của Khoa/Long.

- [ ] Chạy npm.cmd test --prefix backend và npm.cmd test --prefix frontend sau khi các task thay code hoàn tất; chạy npm.cmd run build --prefix frontend. Ghi test counts và ngày thật, không chép con số baseline thành kết quả mới.
- [ ] Rà diff để xác nhận chỉ có file trong phạm vi; giữ endpoint scenarios đầy đủ cho Plan/Coach và các phần admin hiện có.
- [ ] Sửa traceability log reconciliation sang bằng chứng đã có trong MERGE_VERIFICATION_2026-10-25.md; liên kết mỗi story tới regression cụ thể mới thêm.
- [ ] Sửa nhận xét sai rằng Đức thiếu hai AI mistakes; giữ bốn ví dụ đã có, đối chiếu commit/review và bổ sung sự kiện lần này sau khi thực sự sửa xong.
- [ ] Cả hai hàng admin chưa commit trong AI_USAGE cần evidence/SHA khi được commit, không chỉ hàng dashboard. Tách historical, local-verified, user-reported và pending.
- [ ] Google login do người dùng báo thành công được ghi là user-reported; không tự đổi thành đã kiểm tra cloud hiện tại. Giữ thông tin ngày cũ trong CLOUD_VERIFICATION như lịch sử và thêm tình trạng mới có nguồn.
- [ ] Thực hiện checklist browser khi có app chạy: login → profile → logout; hai account đổi phiên; knowledge có/không có nguồn; proposal → cancel/confirm → Plans; AI outage → banner và manual CRUD. Kiểm tra admin/user overview/log filters bằng account phù hợp. Không suy ra browser pass từ unit tests.

## Các việc final còn riêng sau đợt sửa

| Việc | Cần bằng chứng để chốt |
|---|---|
| Google OAuth, admin/user UI, mobile | Thao tác trên trình duyệt bản tích hợp hiện tại, có ngày và môi trường. |
| Live agent evaluation | Report mới với checker đã sửa, quota phù hợp; phân biệt lỗi transport và chất lượng. |
| Admin dashboard | Xác minh migration/RPC hiện diện, quyền truy cập, filters/pagination và đối chiếu tổng hợp với log; tài liệu cũ không đại diện cloud hiện tại. |
| Deployment hoặc Docker demo | Chạy từ clean start trên môi trường được chọn; hiện chưa được chứng minh bởi lượt review này. |
| US-05 | Scenario browse đã có; story gốc về session history cần quyết định scope/traceability hoặc thực hiện riêng. |
| Report, diagram, slides, video | Hoàn thiện đầu ra theo assignment sau khi số liệu và hành vi cuối được xác minh. |

## Self-review của kế hoạch

- Bốn lỗi được xác minh đều có task, regression và điều kiện chấp nhận.
- Năm failure modes ở Review Focus đều được gắn vào Task 1–4.
- Chính sách agent có trade-off hiển thị text và giới hạn semantic được nêu rõ; không coi citation là chứng minh độ đúng.
- Task eval dùng đúng execute injection do Task 3 cung cấp; không cần trả nội dung riêng tư vào SSE.
- Không cần schema migration hoặc dependency mới theo thiết kế hiện tại. Nếu execution phát hiện cần đổi public interface hoặc cấu trúc lớn, cập nhật thiết kế trước khi mở phạm vi.
- Chưa thực hiện các task trong checklist này; đây là thiết kế và kế hoạch để review.
