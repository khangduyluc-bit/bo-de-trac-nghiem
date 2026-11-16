# Bộ đề trắc nghiệm — bản dùng chung trực tuyến

Website dùng Render Static Site và Supabase Edge Function + PostgreSQL. Giáo viên có thể tạo đề công khai cho học sinh hoặc đề riêng tư chỉ giáo viên xem được.

## Chức năng
- Mã truy cập website hiện tại: 1111.
- Giáo viên đăng nhập riêng mới được tạo, xóa hoặc đổi trạng thái công khai/riêng tư.
- Đề công khai hiển thị với học sinh đã nhập mã website; đề riêng tư chỉ hiện khi giáo viên đăng nhập.
- API kiểm tra quyền riêng tư, không chỉ ẩn đề trên giao diện.
- Đáp án được giữ ở máy chủ và máy chủ tự chấm khi học sinh nộp bài.
- Đáp án nhập linh hoạt: 1 A, 1 | A, 1A 2B, số/chữ ở các dòng riêng, bảng Word/Markdown.
- Nhận tiêu đề câu hỏi Câu 1. và Câu 1:.

## Hệ thống
- Frontend: index.html (Render Static Site).
- Backend: supabase/functions/quiz-api/index.ts.
- Schema: database.sql.
- Supabase project: bdbazlitbvavavzcmfsi.
- API: https://bdbazlitbvavavzcmfsi.supabase.co/functions/v1/quiz-api.

## Bảo mật
- Không nhúng service-role/secret key vào trình duyệt.
- Mã website và mật khẩu giáo viên lưu dưới dạng PBKDF2-SHA256 hash riêng.
- Mã website 1111 là mã dùng chung; ai biết mã đều vào được và xem/làm đề công khai.
- Đề riêng tư được bảo vệ ở Edge Function: học sinh không lấy nội dung, nộp bài hoặc xem bảng điểm đề riêng.
- Các bảng bật RLS; quyền client trực tiếp bị thu hồi. Edge Function dùng khóa máy chủ.
- Phiên giáo viên hết hạn sau 8 giờ; phiên mã website hết hạn sau 7 ngày.

## Render
- Branch: main.
- Build command: base64 -d index.html.gz.b64 | gunzip > index.html.
- Publish directory: .
