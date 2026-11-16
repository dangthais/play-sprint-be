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
| `maze-chomp` | `02-Pac-Man-Game` | `public/games/maze-chomp/` |
| `sky-hop` | `04-Doodle-Jump-Game` | `public/games/sky-hop/` |
| `block-drop` | `20-Tetris-Game` | `public/games/block-drop/` |
| `space-shooter` | `42-Space-Invaders-Game` | `public/games/space-shooter/` |
| `asteroid-blaster` | `43-Asteroids-Game` | `public/games/asteroid-blaster/` |
| `frog-crossing` | `46-Frogger-Game` | `public/games/frog-crossing/` |
| `bubble-pop` | `40-Bubble-Shooter-Game` | `public/games/bubble-pop/` |
| `mole-smash` | `35-Whack-A-Mole-Game` | `public/games/mole-smash/` |
| `typing-race` | `27-Typing-Game` | `public/games/typing-race/` |
| `simon-says` | `36-Simon-Says-Game` | `public/games/simon-says/` |
| `minesweeper` | `16-Minesweeper-Game` | `public/games/minesweeper/` |
| `sliding-puzzle` | `37-Sliding-Puzzle-Game` | `public/games/sliding-puzzle/` |
| `code-breaker` | `38-Mastermind-Game` | `public/games/code-breaker/` |
| `word-guess` | `11-Wordle-Game` | `public/games/word-guess/` |
| `reversi` | `44-Reversi-Game` | `public/games/reversi/` |
| `chess` | `03-Chess-Game` | `public/games/chess/` |
| `checkers` | `41-Checkers-Game` | `public/games/checkers/` |
| `sudoku` | `06-Sudoku-Game` | `public/games/sudoku/` |
| `solitaire` | `05-Solitaire-Game` | `public/games/solitaire/` |
| `sea-battle` | `48-Battleship-Game` | `public/games/sea-battle/` |

Ảnh (`*.png`, `images/*`) được chép nguyên. Cập nhật upstream là thủ công: diff theo bảng này.

## Thay đổi chung (5 game ban đầu)

Mỗi file đã sửa có comment "Modified for Quick Playing" ở đầu file (HTML/CSS/JS).

- `index.html`: bỏ favicon `https://i.ibb.co/...`; thêm `<script src="/sdk/config.js">` rồi `<script src="/sdk/qp-sdk.js">` trước script game (cùng `defer` nếu game dùng `defer`). Không thêm inline script/handler. Các comment banner của tác giả (có URL) được giữ nguyên, không có tác dụng.
- `style.css`: bỏ `@import` Google Fonts; `font-family` đổi sang font hệ thống (`system-ui, ...`).
- Chuyển line ending CRLF -> LF ở các file đã sửa.

## Thay đổi từng game (5 game ban đầu)

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

## Thay đổi chung cho 20 game F5

Áp dụng cho `maze-chomp` ... `sea-battle` (chỉ chép `index.html`, `script.js`, `style.css`; không có ảnh). Mỗi file đã sửa có comment "Modified for Quick Playing — xem apps/games/UPSTREAM.md".

- `index.html`: như phần chung ở trên (bỏ favicon `i.ibb.co`, thêm `/sdk/config.js` rồi `/sdk/qp-sdk.js` trước script game); bỏ Google Fonts và Font Awesome; font hệ thống (`system-ui`, monospace cho `typing-race`).
- `style.css`: bỏ `@import`/`url(http...)`; font hệ thống. Chuỗi font trong canvas cũng đổi (vd. `bubble-pop`).
- Không còn `alert`/`confirm`/`history.go`/`innerHTML` template có handler/`onClick` inline: thay bằng DOM API + `textContent` và `addEventListener`; nút "Chơi lại" có thể gọi `location.reload()`. `localStorage` bọc `try/catch` hoặc bỏ. Không còn tài nguyên ngoài origin game.
- `QP.ready()` khi tải trang (không cần thao tác) và khi bắt đầu ván mới (Play Again/New Game/Restart). Ở các game có cờ (`dirty`/`hasPlayed`/`gameOverSent`/`needReady`) chỉ gọi khi ván trước đã kết thúc hoặc đã có thao tác; ở `bubble-pop`, `code-breaker`, `sliding-puzzle`, `word-guess`, `reversi`, `minesweeper` thì mỗi lần New Game/Play Again đều gọi (không xét cờ). Lần Start đầu sau khi tải không gọi lại.
- `QP.score(n)` khi điểm đổi; `QP.gameOver(n)` đúng một lần mỗi ván (cờ); game không xếp hạng báo `0`.
- Game xếp hạng có màn chọn mức: khoá một mức (xem từng game), ẩn `#levelScreen`/nút đổi mức.
- Chuyển line ending CRLF -> LF ở các file đã sửa.

## Thay đổi từng game F5

### maze-chomp
- Lớp phủ "Nhấn để bắt đầu" (`#qpStartOverlay` > `#qpStartBtn`): cờ `awaitingStart` giữ Pac-Man và ma đứng yên (vòng lặp vẫn vẽ); không gọi lại `ready`.
- Hai `alert` -> lớp phủ DOM (`textContent`) có nút "Chơi lại" gọi `restartGame`.
- `QP.score(score)` mỗi viên ăn; `finishGame` -> `QP.gameOver(score)` một lần; `restartGame` gọi `QP.ready()` nếu ván đã kết thúc hoặc đã điều khiển.
- Sửa lỗi upstream: `checkCollisions` thoát sớm khi `gameOver` (ăn viên cuối và va ma cùng khung hình).
- Hằng số đã kiểm: 360 viên + 4 viên lớn => tối đa 3800. Viên ở ô xuất phát được ăn ngay khi tải (`score: 10` trước thao tác).

### sky-hop
- `localStorage` đọc/ghi bọc `try/catch`.
- `gameOver()` -> `QP.gameOver(score)` một lần; `QP.score` giới hạn 250 ms/lần (`SCORE_MIN_INTERVAL_MS`); nút restart gọi `QP.ready()`; `QP.ready()` cuối IIFE khi tải.

### block-drop
- `handleKey`: khi tạm dừng bằng Esc (`isActive !== 1`) chỉ phím Esc được xử lý, không còn di chuyển/xoay/hạ khối khi đang dừng.
- Luôn dùng `keydown` (bỏ nhánh `keypress` theo user agent và `window.event`), `preventDefault` cho phím mũi tên.
- Sửa lỗi upstream: `incLevel` không vượt `numLevels` (upstream ném lỗi ở cấp 11); xoay không được thì bỏ qua (upstream ném lỗi). Bỏ `console.log`; `innerHTML` -> `textContent`.
- `gameOver`: cờ `ended`, `QP.gameOver(score)` một lần, lớp phủ + "Chơi lại" (`location.reload()`); chặn play/pause/phím sau khi kết thúc. `QP.score` trong `incScore`; `QP.ready()` khi tải.

### space-shooter
- Khoá mức Medium.
- Lớp phủ "Nhấn để bắt đầu" (`#qpStartOverlay` > `button#qpStartBtn`, tạo bằng DOM API, class `.qp-overlay`): `prepareGame` dựng ván nhưng giữ `state.running = false`, `QP.ready()` vẫn gửi khi tải; bấm nút hoặc Enter/Space/phím mũi tên/WASD mới chạy vòng lặp. Lần bấm này không gọi `ready`.
- `QP.ready()` khi tải; New Game/Play Again gọi `QP.ready()` nếu `gameOverSent || dirty` (Next Wave không gọi). `QP.score` +10/alien; `QP.gameOver` chỉ khi thua.
- Sửa lỗi upstream: `endGame` bị gọi lặp (guard `state.gameOver`).

### asteroid-blaster
- Khoá mức Medium (5 đợt).
- Lớp phủ "Nhấn để bắt đầu" (`#qpStartOverlay` > `#qpStartBtn`) như `space-shooter`; `beginRunning` đặt lại `lastTime` và thời gian bất tử của tàu; không gọi lại `ready`.
- `QP.ready()` khi tải; `QP.score` khi phá đá/UFO; `QP.gameOver` trong `endGame` (thắng hoặc thua, có guard); New Game/Play Again gọi `QP.ready()` nếu `gameOverSent || dirty`.

### frog-crossing
- Khoá mức Medium.
- Lớp phủ "Nhấn để bắt đầu" (`#qpStartOverlay` > `#qpStartBtn`) như `space-shooter`: đồng hồ 35 s, xe, rắn chỉ chạy sau khi bấm (`beginRunning`); không gọi lại `ready`.
- `QP.ready()` khi tải; `QP.score` ở 4 chỗ đổi điểm; `QP.gameOver` trong `showResult` (guard); New Game/Play Again như `space-shooter`.

### bubble-pop
- Khoá mức Medium (5 màu, 5 hàng, tốc độ 8). Font canvas `Outfit` -> `system-ui`.
- `QP.score` trong `snapBubble`; `QP.gameOver` trong `endGame` (guard); `QP.ready()` cuối `DOMContentLoaded` và trong `restartGame`.
- Sửa lỗi upstream: New Game giữa ván tạo thêm vòng `requestAnimationFrame` (lưu `rafId`, `cancelAnimationFrame`).

### mole-smash
- `onClick` inline -> `addEventListener`, nút `type="button"`; bỏ `@import` Nunito; ảnh `dirt.svg`/`mole.svg` (từ cdpn.io) thay bằng CSS. Bỏ `console.log`.
- `QP.ready()` khi tải; `startGame` gọi `QP.ready()` nếu `hasPlayed`. `QP.score(0)` khi bắt đầu, `QP.score` mỗi lần đập trúng; `QP.gameOver` một lần khi hết 10 giây.
- Cú đập chỉ tính khi đang chơi, chưa hết giờ và hang đang trồi; bộ đếm `round` chống hai chuỗi `peep` chạy chồng.

### typing-race
- Khoá mức Medium; bỏ phần cài đặt, `localStorage`, Font Awesome, `@import` Syne Mono (font monospace hệ thống).
- `gameOver`: template `innerHTML` + `onclick="history.go(0)"` -> DOM API + `textContent`, "Play Again" gọi `location.reload()`.
- `QP.ready()` khi tải (đồng hồ chạy ngay); `QP.score` khi gõ đúng; `QP.gameOver` một lần khi `time === 0`.
- Lưu ý: mỗi từ đúng cộng ròng +2 giây (upstream `time += 3` rồi `updateTime()` trừ 1).

### simon-says
- Giữ `defer`. `<p id="status">` trùng id -> `id="status-row"` (cập nhật CSS). Sửa lỗi upstream: `missedColor` gây `ReferenceError`; `innerHTML = ""` -> `textContent`.
- Khi thua: `disableUserInput` + cờ `gameOverSent`; bấm Start trong lúc chờ reset 1,5 giây không làm hỏng ván.
- `QP.ready()` khi tải, `startGame` gọi `QP.ready()` nếu `hasPlayed`; `QP.score(level)` mỗi cấp; thua -> `QP.gameOver(level - 1)`.

### minesweeper
- Script `defer`, bỏ `window.onload`; thêm nút "Chơi lại" `#restart-button` và `restartGame()` gọi `QP.ready()`; listener nút cờ chuyển ra ngoài `startGame`. Ô đã cắm cờ không mở khi bấm thường. Bỏ `console.log`.
- `QP.ready()` khi tải; `QP.score(tilesClicked)` sau mỗi lần mở (sau flood-fill); `finishGame` một lần -> `QP.gameOver(tilesClicked)` khi đạp mìn hoặc mở đủ 54 ô.

### sliding-puzzle
- Khoá bàn 3x3, bỏ `levelScreen` và nút đổi mức. Ảnh picsum -> ô số (`textContent`) + CSS.
- Xáo bằng `do...while` để không bắt đầu ở bàn đã giải, và chỉ nhận bàn có khoảng cách giải tối ưu >= 18 nước (BFS từ trạng thái đích tới độ sâu 17, ~17 400 trạng thái, tính một lần khi tải, ~45 ms trên Node); chặn việc bấm New Game tới khi gặp bàn dễ.
- `QP.ready()` khi tải và trong `restartGame`; `QP.score(moves)` mỗi bước; `QP.gameOver(moves)` một lần khi giải xong.

### code-breaker
- Khoá mức Medium (4 chốt, 6 màu, 10 lượt).
- `QP.ready()` khi tải và trong `restartGame`; `QP.score(số lượt)` mỗi Submit; `endGame` -> `QP.gameOver(won ? history.length : maxGuesses + 1)` (thua = 11), có guard.

### word-guess
- Nút New Game/Play Again và phím ảo gọi `blur()` sau khi bấm; `keydown` gọi `preventDefault()` cho Enter/Backspace/Space (bỏ qua khi giữ Ctrl/Meta/Alt) để Enter thật không vừa nộp lượt đoán vừa kích hoạt nút đang focus.
- Khoá mức Medium (5 chữ, 6 lượt); bỏ màn chọn mức, "Change Level", toggle gợi ý, `hintArea`, bảng `HINTS`.
- `QP.ready()` trong `initGame` (khi tải, New Game, Play Again). `QP.score(guesses.length)` mỗi lượt chưa kết thúc; `QP.gameOver(số lượt | maxGuesses + 1)` một lần trong `submitGuess`.
- Sửa lỗi upstream: lọc từ sai độ dài trong `WORDS` (`calm`, `bridge`) -> 397 từ. `gameId` chống `setTimeout` 500 ms của ván cũ.

### reversi
- `aiTimer`: lưu id `setTimeout` của AI; `startAI` clear trước khi đặt, `startGame` clear để New Game lúc "AI thinking" không đi nước cũ trên bàn mới.
- Khoá mức Medium: `startGame("medium")` khi `DOMContentLoaded`, CSS ẩn màn chọn mức và nút đổi mức.
- `QP.ready()` trong `startGame` (tải, New Game, Play Again); `QP.score(số quân đen)` trong `updateScore` khi đổi; `QP.gameOver(số quân đen)` trong `endGame` (cờ).

### chess (không xếp hạng)
- Giữ màn chọn chế độ. `QP.ready()` khi tải và khi ván mới nếu `dirty`; `finishGame` -> `QP.gameOver(0)` khi chiếu hết/hết nước đi.
- Sửa lỗi upstream: `bindBoard` gắn listener lặp mỗi lần chọn chế độ -> gắn một lần; New Game ẩn lớp phủ phong cấp.

### checkers (không xếp hạng)
- `QP.ready()` khi tải và `startGame` nếu `dirty`; `QP.gameOver(0)` trong `endGame`.
- Sửa lỗi upstream: `gameToken` chống nước đi cũ áp lên bàn mới khi New Game giữa animation.

### sudoku (không xếp hạng)
- `QP.ready()` khi tải và `startGame` nếu `dirty`; `QP.gameOver(0)` trong `checkWin`; cờ `solved` chặn nhập thêm.

### solitaire (không xếp hạng)
- `QP.ready()` khi tải và `newDeal` nếu `dirty`; `QP.gameOver(0)` khi đủ 52 lá lên đích (`winSent`).
- `innerHTML` template -> `fillCorner()` bằng DOM + `textContent`.
- Sửa lỗi upstream: Undo trừ lượt sai chỗ; nút Undo không bật sau khi rút bài; `initDragDrop` gắn listener lặp.

### sea-battle (không xếp hạng)
- `QP.ready()` khi tải và `startPlacement` nếu `dirty` (đã giao tranh); `QP.gameOver(0)` trong `showResult`.
