# BongBot Cloud cho ba trạm

Project Supabase: `rjvcrcskqslirypvzljf`. Dashboard dùng React + Leaflet. Dữ liệu đo, giờ nhận, GPS và ADC/EC/PSU lưu trong PostgreSQL. Firmware tái sử dụng microSD, đọc PSS‑78 khi đã hiệu chuẩn, gửi từng mẫu lúc bình thường và tối đa 12 mẫu mỗi lô khi gửi bù.

## 1. Tạo backend và tài khoản xem

1. Vào Supabase Dashboard → **SQL Editor**, tạo truy vấn mới, dán nội dung `supabase/migrations/202611220001_bongbot.sql` và **Run**.
2. Vào **Authentication → Users**, tạo người dùng email và mật khẩu để đăng nhập dashboard. Bật xác nhận email khi tạo thủ công nếu phù hợp.
3. Vào **Edge Functions → Deploy a new function → Via Editor**, đặt tên **ingest**, thay nội dung `index.ts` bằng `supabase/functions/ingest/index.ts`, rồi **Deploy**. Mở **Details** của function và tắt kiểm tra JWT cũ. Endpoint POST xác thực token riêng theo mã thiết bị trước khi ghi. Function dùng khóa server được Supabase cấp sẵn trong môi trường chạy. Nếu triển khai bằng CLI đã đăng nhập, dùng:
   ```powershell
   npx supabase functions deploy ingest --project-ref rjvcrcskqslirypvzljf --no-verify-jwt
   ```
4. Mở [endpoint ingest](https://rjvcrcskqslirypvzljf.supabase.co/functions/v1/ingest) bằng trình duyệt. GET cần trả `{"ok":true,"service":"bongbot-cloud"}`. Đây là kiểm tra function; lần POST có ACK hợp lệ mới xác nhận database ghi thành công.

## 2. Đăng ký ba trạm một lần

Mở PowerShell tại thư mục này, với Node.js 24 đã cài. Có thể dùng `runtime/win-x64/node.exe` từ ZIP Live cũ thay cho lệnh `node`.

```powershell
node tools/setup-stations.mjs
```

Nhập email tài khoản xem đã tạo. Script kiểm tra HTTPS và tạo CA cho firmware, ba token ngẫu nhiên riêng, `private/register.sql` và `private/serial.txt`. Chạy `private/register.sql` trong SQL Editor Supabase. Giữ thư mục `private` ở máy anh và sao lưu riêng vì nó chứa token. Khi chạy lại script, token đã tạo được giữ nguyên. SQL đăng ký không ghi đè các trạm đã tồn tại.

## 3. Đưa web lên Cloudflare Pages

Trong Cloudflare **Workers & Pages → Create application → Pages → Direct Upload**, tải **BongBot-Dashboard-Pages.zip** nằm trong gói này. Mở URL `pages.dev` vừa tạo và đăng nhập bằng email Supabase Auth. ZIP web đã có Project URL và khóa publishable. Database kiểm tra tài khoản được cấp phép trước khi đọc. Nếu đã có lớp ranh mặt nước, đặt bản `water.geojson` vào `web/public` rồi chạy `npm ci` và `npm run build`, sau đó tải nội dung `dist` lên Pages.

## 4. Nạp chung firmware rồi cấu hình qua USB

- Mở `firmware/Station/Station.ino` trong Arduino IDE. Dùng ESP32S3 Dev Module, Espressif Arduino 3.3.7, TinyGPSPlus 1.0.3, bật USB CDC On Boot nếu dùng USB native. Phần DS18B20 chỉ cần OneWire và DallasTemperature khi bật. Cấu hình mặc định bật ADC GPIO4 và để SD tắt đến khi xác nhận dây. Trong `bong_bot_local_config.h` mới tạo, đặt `SD_PINS_VERIFIED = true` nếu cả ba bộ đã kiểm tra dùng sơ đồ SD trong file. Các bộ có bố trí SD, GPS hoặc đầu dò khác nhau cần build theo cấu hình phần cứng tương ứng.
- Nạp trước vào **BB‑01**. Mở Serial Monitor **115200**, chọn **New Line**, nhấn RESET rồi gửi dòng SET tương ứng trong vòng 12 giây. Thay `<RX> <TX> <BAUD> <APN>` bằng giá trị đã test trên đúng bộ, theo thứ tự RX ESP32, TX ESP32, baud modem, APN SIM. Cặp chân UART được hỗ trợ là 15/18 hoặc 18/15. Giữ nguyên thẻ SD theo đúng trạm chứa mẫu cũ.
- Sau khi thấy `Station profile saved`, cấu hình nằm trong NVS. Gói này dùng chung endpoint và CA. Ba token chỉ nhập qua USB. Với cùng sơ đồ phần cứng, nạp chung firmware cho cả ba thiết bị. Trạm đã gán ID chỉ nhận lệnh cập nhật cùng ID để hạn chế gửi nhầm hàng đợi của trạm khác.
- Chờ `PPP IP` và `ACK verified, deleted`. Kiểm tra dashboard cho BB‑01. Muốn kiểm tra gửi bù, để trạm lấy mẫu có UTC rồi ngắt kết nối 4G tạm thời với modem, chờ vài chu kỳ và nối lại. So sánh giờ đo và giờ nhận trong lịch sử. Sau khi BB‑01 đạt, làm tương tự BB‑02 và BB‑03.

Dữ liệu SQLite từng gửi lên server laptop vẫn ở laptop. Gói này chuyển luồng nhận mẫu từ thời điểm đổi endpoint. Các mẫu còn trên thẻ SD sẽ chuyển theo trạm gốc khi nhận ACK hợp lệ. Gói Free cần theo dõi dung lượng và lưu lượng web. Dashboard đọc lịch sử 1 giờ và làm mới mỗi phút; các khoảng dài hơn có nút làm mới chủ động.
