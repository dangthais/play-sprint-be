# Nguồn game vendored

- Repo: https://github.com/he-is-talha/html-css-javascript-games
- Commit: `aafbeac2119b9442790aee50cd143cdc4aeb1f88`
- Giấy phép: MIT, © 2024 Talha Bin Yousaf. Nguyên văn tại `public/games/LICENSE.txt` (được phục vụ cùng game, tại `/games/LICENSE.txt`).
- Mã upstream là mã bên thứ ba **không tin cậy**: chỉ chép và chỉnh tối thiểu, không chạy script của upstream. Game chạy trong iframe `sandbox="allow-scripts"` ở origin riêng (xem `docs/game-protocol.md`).

## Ánh xạ

| id | Thư mục upstream | Đích |
|---|---|---|
| `snake` | `24-Snake-Game` | `public/games/snake/` |
| `merge-2048` | `10-2048-Game` | `public/games/merge-2048/` |
| `tic-tac-toe` | `15-Tic-Tac-Toe` | `public/games/tic-tac-toe/` |
| `memory-match` | `22-Memory-Card-Game` | `public/games/memory-match/` |
| `brick-breaker` | `18-Breakout-Game` | `public/games/brick-breaker/` |

Ảnh (`*.png`, `images/*`) được chép nguyên. Cập nhật upstream là thủ công: diff theo bảng này.

## Thay đổi chung (cả 5 game)

Mỗi file đã sửa có comment "Modified for Quick Playing" ở đầu file (HTML/CSS/JS).

- `index.html`: bỏ favicon `https://i.ibb.co/...`; thêm `<script src="/sdk/config.js">` rồi `<script src="/sdk/qp-sdk.js">` trước script game (cùng `defer` nếu game dùng `defer`). Không thêm inline script/handler. Các comment banner của tác giả (có URL) được giữ nguyên, không có tác dụng.
- `style.css`: bỏ `@import` Google Fonts; `font-family` đổi sang font hệ thống (`system-ui, ...`).
- Chuyển line ending CRLF -> LF ở các file đã sửa.

## Thay đổi từng game

### snake
- `index.html`: bỏ Font Awesome (cdnjs); icon mũi tên thay bằng ký tự `←` `↑` `→` `↓` trong các `<i data-key>`.
- `style.css`: thêm `.wrapper { position: relative }` và kiểu `.qp-overlay` cho lớp phủ Game Over.
- `script.js`:
  - `localStorage` (đọc và ghi) bọc `try/catch`, fallback 0 (sandbox không có storage).
  - `handleGameOver`: thay `alert` + `location.reload()` bằng lớp phủ "Game Over" dựng bằng DOM API/`textContent`, nút "Chơi lại" gọi `location.reload()`; cờ `gameOverSent`.
  - `QP.ready()` khi khởi tạo, `QP.score(score)` khi ăn mồi, `QP.gameOver(score)` đúng một lần.

### merge-2048
- `index.html`: chỉ thay đổi chung (script cổ điển, không `defer`; game dựa vào biến toàn cục ngầm nên không đổi sang module/strict).
- `style.css`: thêm font hệ thống vào `font-family`.
- `script.js`: `QP.ready()` sau `createBoard()`; `QP.score(score)` khi gộp ô có tổng > 0; `QP.gameOver(score)` khi "You WIN"/"You LOSE" với cờ `gameOverSent` (một lần).

### tic-tac-toe
- `index.js`: `QP.ready()` trong `init()` và `restartGame()`; `QP.gameOver(0)` khi có người thắng hoặc hoà (không có điểm).

### memory-match
- `script.js`: điểm = **số lượt lật** (thấp là tốt, ADR-016): biến `moves` tăng mỗi lần lật thẻ thứ 2 của một cặp và gọi `QP.score(moves)`; đủ 8 cặp thì `QP.gameOver(moves)` (một lần; chơi hoàn hảo = 8); `shuffleCard()` reset `moves = 0` và gọi `QP.ready()` (khi khởi tạo và khi ván mới).

### brick-breaker
- `script.js`:
  - `QP.score(score)` khi phá gạch.
  - Bóng chạm đáy: `QP.gameOver(score)` **trước** khi reset điểm, sau đó `QP.ready()`; `QP.ready()` cũng được gọi khi khởi tạo.
  - Sửa lỗi upstream: `score % (brickRowCount * brickRowCount)` -> `brickRowCount * brickColumnCount`.
  - Font canvas `"Balsamiq Sans"` -> `system-ui, sans-serif`.
