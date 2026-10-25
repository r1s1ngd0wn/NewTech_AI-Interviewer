# Tài liệu mẫu kiểm thử RAG

## Vị trí và công ty

Công ty Sao Khue Labs đang tuyển Junior Backend Developer cho nhóm Nền tảng. Nhóm làm việc hybrid tại Đà Nẵng và họp trực tiếp vào thứ Ba hằng tuần. Ứng viên phù hợp nên có ít nhất một năm kinh nghiệm với Node.js và REST API.

## Công nghệ và cách làm việc

Dịch vụ backend chính sử dụng Node.js, Express và PostgreSQL. Nhóm lưu tệp trên Supabase Storage và dùng pgvector để tìm kiếm tài liệu theo ngữ nghĩa. Mỗi thay đổi cần có pull request và ít nhất một thành viên khác review trước khi merge vào nhánh main.

## Tình huống phỏng vấn

Trong bài tập thiết kế API, ứng viên cần đề xuất cách xử lý endpoint tạo đơn hàng khi client gửi lại request do timeout. Đáp án tốt nên đề cập đến idempotency key, unique constraint trong PostgreSQL và trả lại kết quả của request đã được xử lý thay vì tạo đơn trùng lặp.

## Tiêu chí đánh giá

Rubric chấm bài theo bốn tiêu chí: tính đúng đắn kỹ thuật, khả năng giải thích trade-off, bảo mật dữ liệu và giao tiếp rõ ràng. Mỗi tiêu chí được chấm từ 1 đến 5 điểm. Ứng viên nên nêu rõ một rủi ro và một cách kiểm thử cho đề xuất của mình.

## Kế hoạch onboarding

Trong tuần đầu, nhân viên mới đọc hướng dẫn chạy project và sửa một lỗi nhỏ trong môi trường local. Trong tháng đầu, nhân viên mới cần viết unit test cho một endpoint và tham gia review pull request cùng mentor.
