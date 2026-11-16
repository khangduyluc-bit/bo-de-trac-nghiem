# Bộ đề trắc nghiệm — bản dùng chung trực tuyến

Website dùng giao diện HTML tĩnh trên Render Static Site và Supabase Edge Function + PostgreSQL làm backend. Đề thi và kết quả được lưu tập trung để học sinh dùng thiết bị/trình duyệt khác nhau vẫn thấy cùng kho đề và bảng điểm.

## Chức năng
- Giáo viên đăng nhập mới được tạo hoặc xóa đề.
- Học sinh không cần tài khoản để xem và làm đề.
- Máy chủ giữ đáp án đúng và tự chấm khi nộp bài.
- Dữ liệu đề và kết quả được lưu trong PostgreSQL trên Supabase.
- Hỗ trợ nhập câu hỏi theo định dạng Câu 1:, A. ... và đáp án 1 | A.
- Phiên giáo viên hết hạn sau 8 giờ; token lưu trong sessionStorage của tab.

## Hệ thống
- Frontend: index.html (Render Static Site).
- Backend: Supabase Edge Function quiz-api.
- Supabase project: bdbazlitbvavavzcmfsi.
- API: https://bdbazlitbvavavzcmfsi.supabase.co/functions/v1/quiz-api

## Bảo mật
- Không nhúng service-role/secret key vào trình duyệt.
- Các bảng tests, results, app_config bật RLS; quyền client trực tiếp bị thu hồi. Edge Function dùng khóa máy chủ để truy cập DB.
- Mật khẩu giáo viên không lưu trong mã frontend; máy chủ kiểm tra hash PBKDF2 và ký phiên HMAC.

## Deploy Render
Repository lưu giao diện dưới dạng index.html.gz.b64 để tránh giới hạn kích thước nội dung tệp qua API. Static Site dùng:
- Branch: main
- Build command: base64 -d index.html.gz.b64 | gunzip > index.html
- Publish directory: .
Không cần framework hoặc lệnh start. Supabase vẫn đảm nhiệm toàn bộ dữ liệu và API.

## Giới hạn
- Bảng điểm công khai với người truy cập website.
- Mỗi bảng điểm truy vấn tối đa 1.000 lượt thi gần nhất.
- Dữ liệu cũ trong localStorage không tự nhập vào database.
