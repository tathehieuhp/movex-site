# Thêm trợ lý AI chăm sóc khách hàng (Claude) vào movex.info.vn

**Ngày**: 2026-10-12
**Mức độ**: Trung bình
**Thành phần**: `chat-widget.js/.css`, `chat-worker/` (Cloudflare Worker `movex-chat`)
**Trạng thái**: Đã hoàn thành, còn việc cho chủ dự án

## Bối cảnh

Site tĩnh movex.info.vn (GitHub Pages) cần một nút chat nổi (logo MoveX) để trả lời khách, dùng Claude API. Site không có backend (máy chủ xử lý phía sau), nên không thể để API key trong trình duyệt.

## Việc đã làm

- Kiến trúc: widget trên trình duyệt -> Cloudflare Worker `movex-chat` -> Claude API qua `@anthropic-ai/sdk`.
- Worker kiểm tra Origin allowlist (danh sách domain được phép), rate-limit 20 req/phút mỗi IP, giới hạn độ dài và số lượt history, trả kết quả dạng SSE (streaming từng phần).
- Model chọn qua `DEFAULT_MODEL`/`ALLOWED_MODELS` trong `wrangler.toml` và `data-model` trên thẻ script.
- Cập nhật chính sách bảo mật để nói rõ nội dung chat được xử lý bởi bên thứ ba.
- Commit: c73956a, 01d0f96, 41dc1e9.

## Khó khăn & cách giải quyết

1. **Anthropic trả `403 Request not allowed`** ngay lần gọi đầu từ Worker đã deploy. Nguyên nhân: Worker chạy ở edge (điểm mạng) gần khách nhất; với mạng FPT ở Việt Nam đó là Hong Kong (colo HKG), nơi Anthropic chặn. Đã thử Smart Placement: chạy được sau khoảng 4 phút nhưng không ổn định (3 request: 1 ở châu Âu, 2 vẫn về HKG). Cách sửa cuối: gọi Claude bên trong Durable Object (đối tượng có trạng thái, đặt được vị trí) với `locationHint "enam"`, pool 4 object đặt tên. Kết quả 5/5 request thành công từ ORD/IAD. Thêm `GET /health` trả colo của DO để chẩn đoán sau này.
2. **PowerShell không hỗ trợ `&&`**: lệnh `cd chat-worker && npx wrangler ...` chạy sai thư mục, `wrangler deploy` định deploy cả site. Cách xử lý: deploy từ Bash của agent, và với PowerShell chỉ đưa mỗi lệnh một block.
3. Subdomain workers.dev mới cần khoảng 1 phút để có chứng chỉ TLS; lỗi kết nối trong lúc đó là bình thường.
4. Model vẫn in `**bold**` dù prompt cấm: widget giờ loại bỏ `**`, prompt cũng được siết lại.

## Quyết định

Chọn Haiku 5.5 làm model mặc định để trả lời nhanh (đo được khoảng 2-3 giây so với khoảng 5 giây của Opus 5.5). Đổi lấy chất lượng suy luận thấp hơn, chấp nhận cho việc hỏi đáp thông thường.

## Sai sót cần ghi lại

Khi debug, agent chạy `taskkill /F /IM node.exe` để dừng `wrangler tail`. Lệnh này giết mọi tiến trình node trên máy, quá rộng và có thể làm mất công việc khác. Lẽ ra phải nhắm đúng PID của tiến trình đó.

## Bài học

- Dịch vụ chạy ở edge sẽ bị ảnh hưởng bởi vị trí địa lý của khách; nếu API upstream chặn theo vùng, phải ghim vị trí chạy (Durable Object + locationHint), đừng tin vào placement tự động.
- Có endpoint `/health` lộ colo giúp chẩn đoán vấn đề vùng nhanh hơn nhiều.
- Hỏi shell của người dùng trước khi đưa lệnh nối; không nối lệnh với `&&` cho PowerShell.
- Khi cần dừng tiến trình, dừng theo PID cụ thể, không theo tên image.

## Việc còn lại

- Chủ dự án: đặt spend limit (hạn mức chi tiêu) trong Anthropic console để tránh bị lạm dụng làm tốn tiền.
- Chủ dự án: đọc lại đoạn chính sách bảo mật mới trước khi công bố.
- Lưu ý: Haiku không có cơ chế server-side refusal fallback (tự chuyển hướng khi từ chối); nội dung nhạy cảm chỉ dựa vào system prompt.
