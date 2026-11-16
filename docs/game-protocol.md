# Giao thức game <-> host (v1)

Đặc tả chính thức cho `postMessage` giữa game (mã bên thứ ba, trong iframe) và host (`apps/web/src/features/game-host`). Khớp ADR-012/ADR-013 trong `docs/architecture.md`. Muốn đổi giao thức: tăng phiên bản và cập nhật tài liệu này trước.

## 1. Mô hình tin cậy

- Game **không đáng tin**. Game không gọi API, không giữ token, không nhận dữ liệu người dùng. Chỉ host gọi API.
- Điểm do game báo cáo chỉ dùng để hiển thị ở Giai đoạn 1-2 (F2). Giai đoạn 2 (session) phải xác minh server-side.
- Game phục vụ bởi games server (`apps/games`) ở **origin riêng** (`GAME_ORIGIN` khác `WEB_ORIGIN`).

## 2. Iframe và CSP

- Host nhúng iframe với `sandbox="allow-scripts"` và **không** có `allow-same-origin`, `allow-modals`, `allow-forms`, `allow-popups`, `allow-top-navigation`.
- Hệ quả: tài liệu game có **origin opaque**; `event.origin` của mọi message từ game là chuỗi `"null"`. Game không dùng được `localStorage`, cookie, `alert`.
- Host chỉ nhúng `embedUrl` có origin **bằng** `GAME_ORIGIN` tin cậy (đã cấu hình), và `GAME_ORIGIN` phải khác origin của trang host; nếu không thì hiện lỗi, không tạo iframe.
- Web đặt CSP `frame-src <GAME_ORIGIN>`. Games server đặt CSP cho trang game (`default-src 'none'`, `script-src 'self' <GAME_ORIGIN>`, `connect-src 'none'`, `frame-ancestors <WEB_ORIGIN>`, `sandbox allow-scripts` để tài liệu game luôn có origin opaque kể cả khi mở trực tiếp ở top-level, ...), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.

## 3. Message v1 (game -> host)

Mỗi message là object thuần, **đúng** các key sau (thiếu hoặc thừa key đều không hợp lệ). `qp` là số phiên bản giao thức, bằng `1`.

| `type` | Message | Ý nghĩa |
|---|---|---|
| `ready` | `{ qp: 1, type: 'ready' }` | Game sẵn sàng hoặc bắt đầu ván mới. Gửi được nhiều lần. |
| `score` | `{ qp: 1, type: 'score', score }` | Điểm hiện tại của ván (chỉ để hiển thị). |
| `gameOver` | `{ qp: 1, type: 'gameOver', score }` | Kết thúc ván với điểm cuối. |

Ràng buộc `score`: `typeof score === 'number' && Number.isSafeInteger(score) && score >= 0 && score <= 1_000_000_000`.

Trạng thái phía host: `loading` -> (`ready`) `playing` -> (`gameOver`) `over` -> (`ready`) `playing` ...; `score` chỉ cập nhật điểm khi đang `playing` (ở trạng thái khác thì bị bỏ qua); `gameOver` cũng chỉ có tác dụng khi đang `playing`. Lỗi khi: `embedUrl` sai origin, `GAME_ORIGIN` trùng origin trang, hoặc không có `ready` trong 15 giây sau `load`. "Chơi lại"/"Thử lại" remount iframe.

### Ý nghĩa của `score` theo từng game

| Game | `score` | Ghi chú |
|---|---|---|
| `snake` | số mồi đã ăn | cao là tốt |
| `merge-2048` | tổng điểm các lần gộp | cao là tốt |
| `brick-breaker` | số gạch đã phá | cao là tốt |
| `memory-match` | số lượt lật (mỗi lần lật đủ một cặp thẻ) | **thấp là tốt**; hoàn hảo = 8 |
| `tic-tac-toe` | luôn 0 | không xếp hạng |
| `sea-battle` | luôn 0 | không xếp hạng |
| `solitaire` | luôn 0 | không xếp hạng |
| `sudoku` | luôn 0 | không xếp hạng |
| `checkers` | luôn 0 | không xếp hạng |
| `chess` | luôn 0 | không xếp hạng |
| `reversi` | số quân đen (người chơi) khi hết ván, 0-64; khoá mức Medium | cao là tốt |
| `word-guess` | số lượt đoán khi thắng (1-6); thua = 7; khoá Medium | **thấp là tốt** |
| `code-breaker` | số lượt đoán khi thắng (1-10); thua = 11; khoá Medium | **thấp là tốt** |
| `sliding-puzzle` | số bước trượt khi giải xong (bàn 3x3) | **thấp là tốt** |
| `minesweeper` | số ô đã mở (0-54; 54 = thắng) | cao là tốt |
| `simon-says` | số cấp đã vượt qua | cao là tốt |
| `typing-race` | số từ gõ đúng; khoá Medium | cao là tốt |
| `mole-smash` | số lần đập trúng trong 10 giây | cao là tốt |
| `bubble-pop` | điểm upstream (10/bóng nổ, 15/bóng rơi); khoá Medium | cao là tốt |
| `frog-crossing` | điểm upstream (10/hàng tiến, 200 + 10 x giây còn lại/tổ, 1000 khi thắng); khoá Medium | cao là tốt |
| `asteroid-blaster` | điểm upstream (20/50/100 theo cỡ đá, 200/UFO); khoá Medium | cao là tốt |
| `space-shooter` | điểm upstream (10/alien, cộng dồn qua các đợt); khoá Medium | cao là tốt |
| `sky-hop` | độ cao = floor(px/8) | cao là tốt |
| `block-drop` | điểm upstream (5 x cấp/khối, 40 x cấp/hàng) | cao là tốt |
| `maze-chomp` | điểm upstream (10/viên, 50/viên lớn; tối đa 3800) | cao là tốt |

Quy tắc `ready` (host báo lỗi nếu không nhận `ready` trong 15 giây sau `load`):

- Game **phải** gọi `QP.ready()` ngay khi tải trang, không cần thao tác người dùng (kể cả game có màn chọn hoặc nút Start).
- Game **phải** gọi `QP.ready()` khi dựng ván mới sau một ván đã kết thúc (Play Again/Restart); với New Game bấm giữa ván thì **nên** gọi `QP.ready()`. Host coi mỗi `ready` là một phiên mới (mỗi ván = một phiên). Lần bấm Start / "Nhấn để bắt đầu" đầu tiên ngay sau khi tải trang **không** gọi lại `ready`.
- Ngoại lệ: một số game chỉ gọi `ready` khi New Game nếu ván trước đã kết thúc hoặc đã có thao tác (cờ `dirty`/`gameOverSent`); ngược lại `bubble-pop`, `code-breaker`, `sliding-puzzle`, `word-guess`, `reversi`, `minesweeper` gọi `ready` vô điều kiện mỗi lần New Game/Play Again (kể cả khi chưa thao tác). Cả hai cách đều hợp lệ: host chỉ cần `ready` mới cho mỗi ván.
- `QP.gameOver(n)` đúng một lần mỗi ván.

Game chỉ báo con số; game không biết gì về session hay token. Chỉ host nộp điểm cho server (`POST /sessions/{id}/score`). Chiều xếp hạng, xác minh và giới hạn điểm là việc của server (xem ADR-016 trong `docs/architecture.md`). Giao thức vẫn là v1, không đổi message.

Phía host, `GameHost` có thêm callback tuỳ chọn (không đổi giao thức): `onReady()` cho mỗi `ready` được chấp nhận, `onGameOver(score)` đúng một lần cho mỗi chuyển `playing -> over`, và `scoreLabel` cho nhãn điểm hiển thị.

## 4. Quy tắc cho host khi nhận message

Kiểm theo thứ tự, sai ở bước nào thì **bỏ qua im lặng** (không throw, không hiện lỗi; được phép `console.debug` không kèm payload):

1. `event.source === iframe.contentWindow` (ràng buộc chính: đúng cửa sổ iframe này).
2. `event.origin === "null"` (origin opaque của tài liệu sandbox).
3. Schema hợp lệ: object thuần, đúng tập key theo `type`, `qp === 1`, `type` thuộc danh sách, `score` thỏa ràng buộc.

Ngoài ra: gỡ listener khi unmount; xử lý `gameOver` theo trạng thái (không tin game gửi nhiều lần); không bao giờ dùng `targetOrigin '*'` khi gửi.

## 5. Game SDK (`/sdk/qp-sdk.js`)

Script cổ điển (IIFE, `'use strict'`), không phụ thuộc. Thứ tự nạp trong `index.html` của mỗi game (đều script cổ điển, cùng `defer` nếu game dùng `defer`):

```html
<script src="/sdk/config.js"></script>
<script src="/sdk/qp-sdk.js"></script>
<!-- mã game -->
```

- `/sdk/config.js` do games server sinh động: `self.QP_CONFIG = Object.freeze({"hostOrigin":"<WEB_ORIGIN>"});` (`Cache-Control: no-store`).
- SDK chỉ hoạt động khi `window.parent !== window` và `hostOrigin` là origin http(s) hợp lệ, ở dạng chuẩn hoá (không path/query). Ngược lại mọi hàm là **no-op** (mở game trực tiếp ở top-level vẫn chạy bình thường).
- Gửi bằng `window.parent.postMessage(msg, hostOrigin)`; không bao giờ `'*'`. Trình duyệt tự huỷ message nếu parent không phải `hostOrigin`.
- API: `window.QP = Object.freeze({ version: 1, ready(), score(n), gameOver(n) })`.
- `score(n)`/`gameOver(n)` tự validate `n` theo mục 3; sai thì bỏ qua và `console.warn`. SDK không bao giờ throw ra mã game.

## 6. Chiều host -> game

**v1 không có** message host -> game. `pause`/`resume`/`start` (nếu cần ở Giai đoạn 2) phải dùng `MessageChannel` (cổng được chuyển vào game qua một message khởi tạo), vì không thể chọn `targetOrigin` cụ thể cho tài liệu opaque. Đó sẽ là giao thức v2 (tăng `qp`).

## 7. Thêm game mới

1. Chép mã game vào `apps/games/public/games/<id>/` với `index.html` là điểm vào; đường dẫn tài nguyên tương đối; không tài nguyên ngoài origin game (CSP chặn), không inline script/handler, không `storage`/`alert`/`fetch`. Chỉ các đuôi `.html .js .css .png .jpg .svg .txt` được phục vụ.
2. Thêm hai script SDK (mục 5) trước mã game; gọi `QP.ready()` khi sẵn sàng/mỗi ván mới, `QP.score(n)` khi điểm đổi, `QP.gameOver(n)` đúng một lần mỗi ván.
3. Nếu là mã bên thứ ba: giữ giấy phép, ghi nguồn/commit/thay đổi vào `apps/games/UPSTREAM.md`, đánh dấu file đã sửa "Modified for Quick Playing".
4. Thêm bản ghi game (backend seed, `embed_path` = `/games/<id>/`; API trả `embedUrl` tuyệt đối theo `GAME_ORIGIN`) và thumbnail.
5. Kiểm tra: `/games/<id>/` trả 200 với header CSP; mở trong host, nhận `ready` trước timeout.
