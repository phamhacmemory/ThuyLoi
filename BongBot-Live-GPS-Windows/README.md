# Quan trắc độ mặn Cống Bông Bót

Trạm ESP32-S3 gửi GPS và dữ liệu nước qua A7680C/4G đến máy chủ HTTPS trên PC. SQLite lưu mẫu và React TypeScript hiển thị số đo, lịch sử và Google Maps. Nhánh firmware quan trắc có hàng đợi microSD, gửi bù và mã mẫu duy nhất để server ghi đúng một lần khi thiết bị gửi lại.

## Bắt đầu với dữ liệu thật trên Windows

Gói Windows x64 này có sẵn web đã build và Node.js portable. Giải nén toàn bộ ZIP, rồi làm theo ba bước dưới đây.

1. **Bấm `Start-Live.bat`.** Giữ cửa sổ này mở. Dashboard `http://127.0.0.1:8080/` mở bằng trình duyệt mặc định. Đăng nhập với tên `operator` và mật khẩu hiện trong cửa sổ. Ở lần mở đầu, chương trình đăng ký trạm `BB-01` và tạo `data/telemetry.sqlite`. Web bắt đầu trống và cập nhật khi ESP32 gửi mẫu. Khi chạy lại, ứng dụng mở lại cùng database và thông tin đăng nhập.
2. **Tạo địa chỉ HTTPS cho ESP32 ngoài mạng LAN.** Dùng Cloudflare Tunnel với hostname cố định, trỏ Published application về `http://127.0.0.1:8080`, và chạy `cloudflared` trên chính PC. Bật chuyển hướng HTTP sang HTTPS ở nhà cung cấp tunnel. Trang web được bảo vệ bằng tài khoản `operator`, còn thiết bị dùng token riêng ở endpoint ingest. Để thử ngắn hạn khi chưa có tên miền, cài `cloudflared` và chạy `cloudflared tunnel --url http://127.0.0.1:8080`. Địa chỉ `trycloudflare.com` sẽ thay đổi nếu dừng tunnel này. Dùng địa chỉ cố định cho trạm chạy liên tục. [Hướng dẫn Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/get-started/).
3. **Bấm `Configure-Station.bat`.** Nhập địa chỉ HTTPS công khai và APN của SIM (từ `AT+CGDCONT?`). Trình cấu hình xác minh địa chỉ trỏ tới đúng server trên PC, kiểm tra chứng chỉ HTTPS và tự ghi token cùng CA vào `firmware/Station/bong_bot_local_config.h`. Mở `firmware/Station/Station.ino` trong Arduino IDE, chọn ESP32S3 Dev Module, bật USB CDC On Boot khi dùng USB native, cài ba thư viện ở mục 4, rồi nạp vào ESP32. Cấu hình mặc định dùng UART modem **RX15 / TX18 / 115200** và GPS **RX16 / 9600**; chỉnh chân GPS trong file vừa tạo nếu mạch của anh dùng chân khác. Cấu hình tạo mới để các cảm biến tùy chọn ở trạng thái tắt.

Mỗi 30 giây, firmware ghi một mẫu gồm trạng thái thời gian, GPS nếu có fix, số vệ tinh và HDOP nếu có, cùng các chỉ số cảm biến đã bật. Nếu khởi động trong nhà, có thể thấy `Waiting for GPS fix` và web chưa có tọa độ. Đặt anten GPS nơi thoáng và chờ Serial Monitor hiện `GPS fix`. `PPP IP` xác nhận đường 4G và `HTTP 201` xác nhận đã lưu mẫu mới. Dashboard cập nhật khoảng 15 giây một lần và hiện bảng **Mẫu tọa độ đã lưu**. Mẫu gửi lại thành công sẽ thấy `HTTP 200`; SQLite giữ lịch sử qua lần khởi động lại PC.

Live dùng nền OpenStreetMap khi có Internet. Anh có thể thêm khóa Google Maps JavaScript API trong `data/google-maps-key.txt` (một dòng chỉ chứa key), rồi chạy lại `Start-Live.bat`. Dùng HTTPS và giới hạn key theo hostname dashboard. Nền bản đồ công cộng OSM phục vụ theo mức best effort; với số người xem lớn, dùng một nhà cung cấp phù hợp. [Chính sách dùng tile OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/).

Tắt PC, đóng cửa sổ Live hoặc dừng tunnel sẽ gián đoạn tải lên. Mặc định ESP32 giữ tối đa 60 mẫu trong RAM; nếu đã xác minh thẻ và chân SPI, bật tùy chọn microSD ở mục 4 để giữ mẫu qua mất điện. Khi sao lưu, chạy `runtime/win-x64/node.exe server/backup.mjs` từ thư mục dự án. Giữ riêng tệp thông tin đăng nhập `data/live-settings.json` và cấu hình firmware đã sinh. Đầu dò độ mặn có thể gắn và cấu hình sau; trường chưa có mẫu hiện dấu gạch.

## Xem trước trên Windows

Giải nén toàn bộ ZIP, mở thư mục vừa giải nén và bấm đúp `Preview.bat`. Gói có sẵn web đã build và Node.js portable cho **Windows 64-bit (x64)**. Dashboard tự mở bằng trình duyệt mặc định. Nếu trình duyệt chưa mở, dùng địa chỉ in trong cửa sổ Preview. Giữ cửa sổ này mở trong lúc xem. Đóng cửa sổ hoặc nhấn Ctrl+C để dừng.

Preview chạy trên 127.0.0.1 với cổng tự chọn, sơ đồ minh họa và dữ liệu mô phỏng trong RAM. Có thể chọn trạm, xem biểu đồ hoặc bật/tắt lớp độ mặn. Google Maps, LTE, mẫu đo thật và triển khai server thực địa được cấu hình riêng theo các mục bên dưới. Không cần tài khoản, Internet hay API key để xem preview.

## 1. Test SIM ngay trên mạch đã hàn

1. Mở `firmware/SimTest/SimTest.ino` trong Arduino IDE. Dùng board **ESP32S3 Dev Module**, gói **esp32 by Espressif Systems 3.3.7**. Bật **USB CDC On Boot** nếu dùng cổng USB native. Serial Monitor chạy **115200 baud**, chọn **New Line** hoặc **Both NL & CR**.
2. Sketch đã test thành công trên trạm dùng **A7680C UTX → ESP GPIO15**, **A7680C URX ← ESP GPIO18**, GND chung. Với mạch khác, ngắt nguồn và đo thông mạch trước khi dùng cấu hình chân này. Đối chiếu mức logic UART và nguồn theo đúng bo breakout. Các thông số nguồn của module trần A7680C không áp trực tiếp cho đầu cấp nguồn của breakout. Hai sketch để GPIO21 (PWRK) và GPIO7 (DTR) không điều khiển. Bật modem bằng cách đã xác nhận cho đúng bo.
3. Sau khi xác nhận và sửa pin nếu cần, đổi `UART_VERIFIED = true`, nạp sketch. Gắn SIM có data và anten LTE theo hướng dẫn của board. Gửi `?` và xem kết quả.

| Lệnh | Kết quả cần thấy | Khi kết quả khác |
| --- | --- | --- |
| `AT` và `ATI` | `OK` và chuỗi nhận diện module | Kiểm tra modem đã bật, nguồn, GND, TX/RX, bộ chuyển mức và baud thực tế. |
| `AT+CPIN?` | `+CPIN: READY` | `SIM PIN` là SIM đang khóa PIN. Dùng đúng PIN đã biết. `SIM not inserted` thì kiểm tra vị trí SIM và tiếp điểm. |
| `AT+CSQ` | Giá trị RSSI khác `99` | `99` là chưa biết hoặc chưa đo được. Kiểm tra anten và vùng phủ, rồi đọc lại. |
| `AT+CEREG?` | `<stat>=1` hoặc `5` | `2` đang tìm mạng, `3` bị từ chối, `0`/ `4` chưa đăng ký hoặc trạng thái chưa rõ. Xem `AT+COPS?` và thử ở vùng phủ phù hợp. A7680C theo SIMCom hỗ trợ FDD B1/B3/B5/B8 và TDD B34/B38/B39/B40/B41. |
| `AT+CGATT?` | `+CGATT: 1` | Kiểm tra SIM được cấp dịch vụ data và trạng thái đăng ký mạng. |
| `AT+CGPADDR=1` | Địa chỉ PDP thực sau khi kích hoạt context | Nếu trống hoặc bằng 0, kiểm tra APN và trạng thái context bằng `AT+CGACT?`. |

Khi SIM đã đăng ký, có thể thử cấp IP cho profile số 1 trên SIM test. Dùng APN do nhà mạng hoặc đơn vị cấp SIM cung cấp. Nếu context 1 đang hoạt động và đã có IP, xem cấu hình hiện tại bằng `AT+CGDCONT?` trước khi đổi. Khi context 1 chưa hoạt động, gửi từng lệnh và chờ phản hồi.

```text
AT+CGDCONT=1,"IP","APN_CUA_SIM"
AT+CGACT=1,1
AT+CGPADDR=1
```

Xác nhận đường truyền đầu cuối bằng firmware `Station`. Sau khi nạp và kết nối thành công, Serial Monitor in `PPP IP` rồi **HTTP 201** khi server ghi mẫu mới hoặc **HTTP 200** khi nhận lại đúng mẫu đã ghi. Ghi lại tên model và firmware bằng `ATI` và `AT+CGMR` nếu đã có IP PDP nhưng chế độ PPP chưa lên. Cấu hình firmware dùng profile PPP SIM7600 của Arduino ESP32 cho dòng modem tương thích AT. Khả năng chạy profile này cần được xác nhận trên A7680C đã hàn.

Tài liệu [SIMCom A76XX AT Command Manual](https://www.simcom.com/technical_files-p1.html?filetype=0&pro_cat=0&pro_li=155&time=0), [SIMCom A7680C](https://cn.simcom.com/product/A7680C.html), [Espressif Network PPP](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/network.html).

## 2. Mở web và database trên PC Windows

Cài **Node.js 24 LTS**. Trong PowerShell, mở thư mục vừa giải nén rồi chạy:

```powershell
Copy-Item .env.example .env
Copy-Item config/devices.example.json config/devices.json
Copy-Item config/water.example.geojson config/water.geojson
node server/device-key.mjs BB-01 "Cống Bông Bót"
npm ci
npm run build
```

Lệnh tạo thiết bị in token hex 64 ký tự và một object JSON. Giữ token cho firmware, chép object JSON vào trong mảng `[ ... ]` của `config/devices.json`. Mỗi trạm dùng một token riêng. Với lần lắp đầu, để `flow_id` và `chainage_m` bằng `null` đến khi xác nhận vị trí theo tuyến sông.

Chạy `npm start` và mở [http://127.0.0.1:8080](http://127.0.0.1:8080). CSDL được tạo tự động ở `data/telemetry.sqlite` và cấu trúc bảng ở `server/schema.sql`. Các lệnh Bash tương ứng dùng `cp` thay cho `Copy-Item`. Mặc định server Node chỉ nghe trên loopback. Dùng phần triển khai HTTPS bên dưới để modem ngoài hiện trường gửi về.

**Google Maps.** Bật Maps JavaScript API và billing trên Google Cloud, tạo browser API key giới hạn theo Maps JavaScript API và HTTP referrer đúng hostname. Ví dụ `https://<ten-mien>/*` cho deploy và `http://127.0.0.1:8080/*` khi chạy cục bộ. Điền `GOOGLE_MAPS_KEY` vào `.env` (Node cục bộ) hoặc `deploy/.env` (Compose), khởi động lại dịch vụ. Google Maps hiển thị nền bản đồ khu vực Nam Măng Thít trước khi có fix và định vị trạm theo lat/lng của mẫu GPS khi có fix. Dashboard hiển thị thời điểm fix và HDOP; chữ số thập phân của tọa độ chỉ thể hiện độ phân giải hiển thị. [Tài liệu Maps API key](https://developers.google.com/maps/documentation/javascript/get-api-key) · [Các loại nền bản đồ](https://developers.google.com/maps/documentation/javascript/maptypes).

## 3. Đưa server trên PC lên HTTPS

Cài Docker Desktop và bật chế độ Linux containers. Tạo `deploy/.env` từ `deploy/.env.example`. Tạo mật khẩu cho dashboard bằng:

```powershell
docker run --rm -it caddy:2.10-alpine caddy hash-password
```

Chép hash vào dấu nháy đơn của `DASHBOARD_PASSWORD_HASH` và đặt tên người dùng ở `DASHBOARD_USER`. Chọn cách kết nối theo mạng của PC:

| Đường truyền | Cấu hình |
| --- | --- |
| IP công khai, quản lý router | Trỏ tên miền về IP công khai. Chuyển tiếp TCP 80/443 về PC và cho phép qua tường lửa. Đặt `CADDY_SITE` bằng tên miền. Caddy cấp chứng chỉ và chuyển HTTP sang HTTPS. |
| CGNAT hoặc không thể chuyển tiếp cổng | Dùng Cloudflare Tunnel có hostname cố định. Cài `cloudflared` trên cùng PC, đặt public hostname tới `http://127.0.0.1:8081` và dùng ba dòng tunnel trong `deploy/.env.example`. Ép HTTPS ở biên Cloudflare, giữ trang web sau Basic Auth của Caddy. Endpoint ingest dùng bearer token thiết bị, cần đi qua tunnel mà không bị một lớp đăng nhập trình duyệt chặn. |

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail=50 app caddy
```

Từ một thiết bị dùng mạng di động, truy cập `https://TÊN-MIỀN/healthz` và kiểm tra `{"ok":true}`. Mở dashboard qua cùng tên miền và đăng nhập. Đặt `INGEST_URL` của firmware thành `https://TÊN-MIỀN/api/v1/ingest`. Khi thay cấu hình file trạm hoặc GeoJSON, chạy `docker compose --env-file deploy/.env -f deploy/compose.yaml restart app`. Khi sửa biến môi trường trong `deploy/.env`, chạy lại `up -d` để Compose áp dụng biến mới. PC cần bật liên tục cùng Docker, tránh chế độ Sleep nếu trạm phải truyền 24/7.

Tài liệu [Caddy HTTPS](https://caddyserver.com/docs/automatic-https) · [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/get-started/).

## 4. Nạp firmware trạm

Cài thư viện Arduino **TinyGPSPlus 1.0.3**, **OneWire 2.3.8** và **DallasTemperature 4.0.6**. Chọn **ESP32S3 Dev Module**, **USB CDC On Boot = Enabled** và **Partition Scheme = Huge APP** nếu board có 4 MB flash trở lên. Kiểm tra dung lượng flash của board rồi đặt Flash Size tương ứng. Mở `firmware/Station/Station.ino`, sao chép `settings.example.h` thành `bong_bot_local_config.h` trong cùng thư mục và chỉnh thông số.

- **LTE.** Đặt `MODEM_UART_VERIFIED`, chân UART đã đo, baud đã thử, APN, `DEVICE_ID`, token và URL. `ROOT_CA` nhận PEM của CA gốc tin cậy cho chuỗi chứng chỉ public đang dùng, lấy từ nhà phát hành CA với đúng hostname và xác nhận chuỗi. Với tunnel, dùng CA của chứng chỉ ở biên HTTPS. Firmware dùng CA và kiểm chứng hostname. Khi HTTPS chưa chạy, kiểm tra lại giờ UTC của GPS/NTP, CA và tên miền trước khi đổi thông số modem.
- **GPS.** NEO-7M TX → RX ESP theo bảng là GPIO16. Chỉnh theo chân và baud đã test. Firmware đọc NMEA một chiều, nhận Lat/Lng, HDOP và vệ tinh. UTC lấy từ GPS hoặc SNTP sau khi lên PPP. RTC DS1307 trong ảnh hiện chưa dùng vì mức logic và mạch pull-up của board chưa xác nhận.
- **MicroSD.** Theo hình tham chiếu, SPI là CS10/SCK12/MISO13/MOSI11. Đo xác nhận chân và mức logic theo board SD, dùng thẻ FAT32, rồi bật `SD_PINS_VERIFIED`. Mặc định lưu mỗi 30 giây, gửi theo chu kỳ 30 giây và gửi bù tối đa 12 mẫu mỗi lượt. Tối đa 2.880 mẫu chờ, khoảng 24 giờ ở chu kỳ mặc định. Khi đầy, giữ mẫu đã lưu và đếm mẫu mới bị bỏ. HTTP 200/201 xóa mẫu đã được ghi. Mẫu thân lỗi hoặc trùng ID khác nội dung chuyển vào `/rejected`. Kiểm tra thư mục này và chỗ trống của thẻ trong kỳ bảo trì. Khi tắt SD, firmware giữ tối đa 60 mẫu trong RAM, bỏ mẫu cũ nhất khi hàng đợi đầy. Mẫu trong RAM mất khi reset.
- **Nhiệt độ.** Đặt `TEMP_PIN` cho DS18B20 đã mắc đúng nguồn và điện trở kéo lên, rồi đối chiếu nhiệt kế. `-1` trả về trường trống.
- **EC và độ mặn.** Driver có sẵn cho đầu dò RS485 Modbus RTU đọc thanh ghi unsigned 16 bit FC03 hoặc FC04. Dùng transceiver đúng mức logic, chọn RX/TX, DE nếu cần, địa chỉ, parity, mã hàm, thanh ghi đánh số từ 0 và hệ số từ datasheet. Với đầu dò analog, 32 bit, thanh ghi signed hoặc giao thức khác, cần thay adapter trước khi bật đo. Chỉ cấu hình `SAL_REG` khi đã kiểm chứng giá trị Practical Salinity báo theo PSU. EC µS/cm được lưu riêng, firmware không tự đổi EC thành PSU. Nhập offset/scale theo hiệu chuẩn đã đối chiếu.
- **Pin.** Chỉ đặt `BATTERY_PIN` và `BATTERY_FACTOR` khi mạch chia áp đã đo và điện áp cực đại tại ADC nằm trong dải của board. Để trống khi chưa có mạch đo.

Để thử truyền trước khi gắn đầu dò, giữ các chân cảm biến ở `-1`. Sau khi trạm lên PPP, xác nhận server nhận hai mẫu cách nhau khoảng 30 giây và Google Maps mở đúng lat/lng. Khi đã bật SD, ngắt đường kết nối ở phía máy chủ vài phút, khôi phục và kiểm tra mẫu gửi bù vẫn giữ giờ đo. Thử khởi động lại trạm trong lúc còn dữ liệu chờ. Thử đầu dò với thiết bị tham chiếu trước khi dùng số đo cho quyết định vận hành cống.

## 5. Vẽ độ mặn theo lòng sông

Bộ mã sử dụng nền Google Maps Địa hình và lớp vector GeoJSON độc lập. Nạp polygon mặt nước được phép sử dụng, theo khảo sát hoặc dữ liệu GIS của đơn vị quản lý, vào `config/water.geojson`. Dùng QGIS hoặc công cụ GIS tương đương:

1. Vẽ hoặc nhập tim tuyến và ranh mặt nước, dùng CRS mét phù hợp để đo lý trình từ một gốc cố định theo dòng sông. Tạo từng đoạn ngắn dọc theo tim tuyến, cắt theo mép nước thực tế. Giữ bờ, đảo và vùng khô ngoài polygon. Tách cống và mỗi nhánh thủy lực bằng `flow_id` riêng.
2. Mỗi polygon/multipolygon có `reach_id` duy nhất, `flow_id`, `from_m`, `to_m` và tùy chọn `name`. Các đoạn cần có đầu và cuối theo lý trình đã đo. Xuất GeoJSON EPSG:4326 với tọa độ `[kinh độ, vĩ độ]`. Giữ nguyên chỗ rỗng của đảo hoặc bãi nổi.
3. Trong `config/devices.json`, ghi `flow_id` và `chainage_m` của trạm cố định trên tuyến đã khảo sát. Khi di dời trạm, tạo ID mới hoặc cập nhật lịch sử triển khai và cấu hình trước khi tái sử dụng lớp nội suy.
4. Server chỉ tô đoạn khi toàn bộ khoảng `[from_m,to_m]` nằm giữa hai trạm cùng `flow_id`, hai mẫu có PSU và giờ đo hợp lệ, tuổi mẫu tối đa 15 phút, lệch nhau tối đa 5 phút và khoảng cách trạm tối đa 2.000 m theo mặc định. Màu lấy theo giá trị nội suy tuyến tính tại trung điểm lý trình. Các ngưỡng này có thể cấu hình trong môi trường server và nên được hiệu chỉnh theo độ phủ trạm. Điểm GPS có màu theo PSU đo được nếu cùng mẫu và còn mới. Đoạn thiếu dữ liệu có màu xám. Nếu có một trạm, đọc số đo điểm và lịch sử, rồi bổ sung trạm thứ hai trên cùng tuyến để nội suy.
5. Các màu 1, 4, 10 PSU dùng để đọc bản đồ. Màu ước tính biểu diễn số đo nội suy ở thời điểm hiện tại. Cấu hình không dự báo dòng chảy, thủy triều hoặc độ mặn qua cửa cống.

Mẫu `water.example.geojson` để trống vì bộ hồ sơ gửi kèm chưa chứa ranh giới số để dùng trong vận hành. Không có tọa độ trạm mẫu hoặc số liệu giả trong cấu hình mặc định.

## 6. API và bảo trì

| Endpoint | Nội dung |
| --- | --- |
| `GET /healthz` | Kiểm tra server và kết nối SQLite |
| `POST /api/v1/ingest` | Header `X-Device-Id`, `Authorization: Bearer <token>`, JSON. `sample_id` duy nhất, `measured_at` UTC milliseconds hoặc `null`. Các trường cảm biến `ec_us_cm`, `temp_c`, `salinity_psu`, `battery_v`; GPS `lat`, `lng`, `hdop`, `satellites`; bộ đếm `dropped`. |
| `GET /api/v1/dashboard` | Mẫu gần nhất, fix GPS gần nhất, trạng thái và GeoJSON đã tính |
| `GET /api/v1/history?id=BB-01&hours=24` | Lịch sử trạm. Cửa sổ 1, 6, 24 hoặc 72 giờ, tối đa 10.000 mẫu mỗi lần đọc. |

SQLite dùng WAL và khóa chính theo trạm + mã mẫu. Khi giờ đo chưa đồng bộ, database giữ `measured_at=null` và lưu thêm giờ nhận. Lớp nội suy chỉ dùng giờ đo đã biết. Bản web hiển thị giờ Việt Nam, còn API lưu UTC.

Chạy `npm run backup` để tạo bản sao SQLite nhất quán khi Node đang chạy. Với Compose:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml exec app node server/backup.mjs
docker compose --env-file deploy/.env -f deploy/compose.yaml cp app:/app/backups ./backups
```

Giữ bản sao SQLite và cấu hình trạm ở nơi khác PC. Nếu cần phục hồi, dừng server, giữ nguyên bộ database cũ cùng file WAL/SHM trong một thư mục riêng, sau đó đặt bản sao nhất quán vào đúng `DB_PATH` và kiểm tra quyền ghi trước khi khởi động lại. Với Docker, sao lưu trước khi thao tác với volume `telemetry`. Để đổi token, tạo token mới và cập nhật cả firmware lẫn object của trạm. Với nhiều trạm hoặc lưu dài hạn, theo dõi dung lượng volume và thời gian backup. Máy chủ giữ lịch sử cho đến khi quản trị viên chủ động quản lý dữ liệu.
