# Kế hoạch triển khai — Quick Playing

Trạng thái: `[ ]` chưa làm · `[~]` đang làm · `[x]` xong

## Giai đoạn 0 — Nền tảng
- [x] Chốt tech stack (architect; người dùng đã duyệt — ADR-001)
- [x] Khởi tạo repo (monorepo pnpm `apps/api`, `apps/web`), lint (ESLint), format (Prettier), Vitest, Playwright — T0, session chính
- [ ] CI (chưa có; cần PostgreSQL service để chạy test DB + e2e full-stack) → Giai đoạn 4 / T4 (CI repo backend; e2e full-stack chưa lên CI)
- [x] Khởi tạo git (`git init`, nhánh `main`; chưa có commit)
- [x] Hoàn thiện `api-contract.yaml` — nay ở **v0.5.1** (Giai đoạn 4, chỉ mô tả header)

## Giai đoạn 1 — MVP
- [~] **F1. Trang danh sách game** (`GET /games` phân trang + grid thumbnail) — code, unit test, e2e UI, review xong; còn chờ kiểm chứng trên PostgreSQL thật và `.env.example` (xem bảng)
- [~] **F2. Chơi game** — 5 game vendored + games server + SDK/giao thức v1 + `GET /games/{id}` + routing & trang chơi (xem bảng F2). Code, unit test, e2e (trang chơi với API giả lập + games server thật), review xong; còn chờ kiểm chứng full-stack trên PostgreSQL thật
  - [ ] Backend: `GET /games/{id}`, seed 5 game
  - [ ] Game integration: games server, 5 game, SDK, `docs/game-protocol.md`, game host component
  - [ ] Frontend: routing tối giản (ADR-011), thẻ game là link, trang chơi
  - [ ] QA: e2e trang chơi + games server, cập nhật e2e F1

**Tiêu chí hoàn thành:** người dùng mở danh sách, chọn và chơi được 1 game mẫu.

### F1. Trang danh sách game
Contract: `docs/api-contract.yaml` v0.2.0 (`GET /games`, `Game`, `GameListResponse`, `Error`). ADR-002 … ADR-008 trong `docs/architecture.md`.

| ID | Agent | Mô tả | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| T0 | session chính | Scaffold monorepo, stack, lệnh | — | [x] |
| T1 | backend | Migration + runner, seed 25 game, repository (pg + in-memory), route `GET /api/games`, error handler, config env | T0 | [x] code + unit test; SQL chưa chạy trên Postgres thật |
| T2 | frontend | API client, trang danh sách (grid, phân trang, loading/error/empty), 25 thumbnail SVG + placeholder | T0 | [x] |
| T3 | qa-engineer | Viết e2e `tests/e2e/games-list.spec.ts` (UI với API giả lập + smoke full-stack tự skip) | T0 | [x] |
| T4 | session chính (thay qa) | Chạy test/lint/typecheck/build + e2e: e2e UI 22 pass; 22 test full-stack skip (chưa có DB) | T1, T2, T3 | [~] còn phần full-stack |
| T5 | code-reviewer | Review diff T1–T3: 0 Critical/High; đã sửa R1, R2, R4, R6, R8; để lại R3, R5 | T4 | [x] |
| T6 | session chính | `.env.example` (WEB_ORIGIN, GAME_ORIGIN, TEST_DATABASE_URL…), cập nhật tiến độ | T1 | [~] `.env.example` bị permission `Edit(./.env.*)` chặn — cần người dùng tạo hoặc nới quyền |

Đợt 1 (song song): T1, T2, T3 · Đợt 2: T4, T6 · Đợt 3: T5 (+ sửa finding, chạy lại kiểm tra).

Seed (dùng chung giữa T1 và T2 — tên file thumbnail phải khớp `id`), theo thứ tự `i = 0..24`:
`snake, block-drop, brick-breaker, memory-match, minesweeper, sudoku, merge-2048, flappy-wing, pong, space-shooter, maze-runner, word-search, tic-tac-toe, connect-four, solitaire, bubble-pop, color-flood, jump-runner, tower-stack, fruit-slice, sliding-puzzle, simon-says, typing-race, asteroid-dodge, mini-golf`.
`created_at = 2026-01-01T00:00:00Z + i ngày`, riêng `block-drop` (i=1) = `2026-01-01T00:00:00Z` (trùng `snake`, để test tie-breaker). Thứ tự API: `mini-golf, asteroid-dodge, typing-race, …, merge-2048, sudoku, minesweeper, memory-match, brick-breaker, block-drop, snake`.

> Ghi chú F2: danh sách seed 25 game ở trên là lịch sử F1; từ F2 seed còn 5 game (architecture §5.3, ADR-014).

### F2. Chơi game (5 game thật)
Contract: `docs/api-contract.yaml` **v0.3.0** (`GET /games/{gameId}`). ADR-009 … ADR-014 trong `docs/architecture.md` (ADR-007 bị thay thế một phần). Giao thức: ADR-012 → `docs/game-protocol.md`.

| ID | Agent | Mô tả | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| T0 | session chính | Scaffold `apps/games` (package.json, tsconfig), script root, ignore ESLint/Prettier cho game vendored, Playwright webServer thứ 3, CSP header trong `apps/web/vite.config.ts`, cập nhật lệnh trong `CLAUDE.md` | — | [x] |
| T1 | backend | `GET /api/games/:gameId` + `findById` (pg + in-memory), seed 5 game + cảnh báo dòng thừa, `GAME_ORIGIN ≠ WEB_ORIGIN`, unit test | — | [x] code + unit test; SQL `findById`/`countNonSeedGames` chưa chạy trên Postgres thật |
| T2 | game-integration | Games server (`node:http`), 5 game đã chỉnh, SDK + `/sdk/config.js`, LICENSE + UPSTREAM.md, `docs/game-protocol.md`, unit test server | T0 | [x] |
| T3 | game-integration | Game host component (`apps/web/src/features/game-host/`): iframe sandbox, validate message, trạng thái, unit test | — | [x] |
| T4 | qa-engineer | Viết e2e: trang chơi (API giả lập + games server thật), games server (header/path), cập nhật e2e F1 theo seed 5 game | — (chạy ở T6) | [x] |
| T5 | frontend | Routing (ADR-011), `Link` trên thẻ game, trang chơi `/games/:id`, `fetchGame`, `config.ts` (`VITE_GAME_ORIGIN`), unit test | T3 | [x] |
| T6 | session chính | Unit (games 53, api 61 + 4 skip, web 104), lint, typecheck, build pass; e2e 113 pass, 28 skip (full-stack cần DB), 0 fail | T0–T5 | [~] còn phần full-stack |
| T7 | code-reviewer | Review: 0 Critical/High; đã sửa M1 (link tiêu đề từ `?page=2`), M2 (test flaky), L1 (e2e full-stack không skip im lặng khi DB còn dòng F1), L2 (CSP `sandbox allow-scripts`), L3 (lệch docs), L4 | T6 | [x] |

Đợt 0: T0 · Đợt 1 (song song): T1, T2, T3, T4 · Đợt 2: T5 · Đợt 3: T6 → T7 (+ sửa finding, chạy lại).

Biến môi trường mới (cần thêm vào `.env.example` — hiện bị permission chặn): `GAMES_HOST`, `GAMES_PORT`, `VITE_GAME_ORIGIN`.

## Giai đoạn 2 — Session & điểm số
- [~] **F3. Session + nộp điểm có xác minh + leaderboard** — code, unit test, e2e (API giả lập), review xong; còn chờ kiểm chứng SQL (migration 002, ghi atomic, leaderboard) và e2e full-stack trên PostgreSQL thật
  - [ ] Backend: sửa R5 (error handler), rate limit, session + nộp điểm có xác minh, leaderboard, migration 002, seed luật
  - [ ] Game integration: Memory Match đếm lượt lật, callback GameHost, cập nhật `docs/game-protocol.md`
  - [ ] Frontend: nickname, hiển thị kết quả, leaderboard
  - [ ] QA: e2e luồng điểm (API giả lập) + kịch bản gian lận full-stack

### F3. Session & nộp điểm có xác minh
Contract: `docs/api-contract.yaml` **v0.4.0** (`Game.ranked/scoreOrder`, `POST /sessions`, `POST /sessions/{id}/score`, `GET /games/{id}/leaderboard`, mã lỗi mới). Kiến trúc: §4.3, §5.5, §5.6; ADR-015 … ADR-021 (ADR-005 bị thay thế một phần bởi ADR-020).

Luật đã chốt với người dùng: Tic Tac Toe không xếp hạng; Memory Match điểm = số lượt lật (ít hơn tốt hơn, ≥ 8, kiểm thời gian tối thiểu); Snake/2048/Brick Breaker có trần tốc độ ghi điểm + `max_score` (ADR-016).

#### Tiêu chí chấp nhận F3
**Backend / API**
- AC1 (R5): body POST > 1 KiB → 413 `PAYLOAD_TOO_LARGE`; `Content-Type: text/plain` → 415 `UNSUPPORTED_MEDIA_TYPE`; JSON hỏng/rỗng → 400 `VALIDATION_ERROR`; `GET /api/games?limit=0` vẫn 400; route lạ 404; body lỗi chỉ có đúng `{code,message}`.
- AC2: `GET /games`, `/games/{id}`: snake, merge-2048, brick-breaker `ranked:true, scoreOrder:'desc'`; memory-match `ranked:true, scoreOrder:'asc'`; tic-tac-toe `ranked:false`, không có `scoreOrder`.
- AC3: `POST /sessions {gameId:'snake'}` → 201, `session.status='active'`, `id` uuid, `expiresAt = startedAt + 2h`, `sessionToken` khớp `^[A-Za-z0-9_-]{43}$`; DB chỉ lưu `token_hash = sha256(token)`; token không xuất hiện trong log.
- AC4: tic-tac-toe → 422 `GAME_NOT_RANKED` (không tạo dòng); game không tồn tại/slug sai → 404; `gameId` là số hoặc thiếu body → 400.
- AC5: phiên snake, clock +60 s, nộp `{score:17, playerName:"  Lan  "}` → 200 `playerName:"Lan"`, `durationMs:60000`, `rank:1`, `personalBest:true`; leaderboard có đúng dòng này.
- AC6: hai lần nộp đồng thời cùng dữ liệu → cả hai 200 cùng session, DB 1 dòng `finished`, leaderboard 1 mục; hai lần khác điểm → đúng một 200, lần kia 409 `SESSION_NOT_ACTIVE`. Kiểm trên repo in-memory và pg (pg skip khi thiếu DB).
- AC7: sau 200, nộp lại y hệt → 200 cùng session; khác điểm → 409. Sau 422, nộp lại y hệt → vẫn 422.
- AC8: thiếu header/sai định dạng → 401 `UNAUTHORIZED`; token đúng định dạng nhưng sai → 404, phiên vẫn `active`, sau đó nộp bằng token đúng vẫn thành công; token trong query bị bỏ qua → 401.
- AC9: token của phiên A nộp cho phiên B → 404; B không đổi.
- AC10 (memory, quá nhanh): score 8 lúc 2999 ms → 422 `SCORE_REJECTED`, phiên `finished/rejected/DURATION_TOO_SHORT`, nộp tiếp → 409; score 20 lúc 14 999 ms → 422, lúc 15 000 ms → 200; score 7 → 422.
- AC11 (vượt trần): snake 901 (thời gian dài) → 422; snake 60 s: 156 → 422, 155 → 200; brick 46 lúc 0 ms → 422, 45 → 200; 2048: 250001 → 422.
- AC12 (kiểu dữ liệu, chưa tiêu thụ phiên): `score` `"17"`, `17.5`, `-1`, `1000000001`, `true`, `null` → 400, phiên vẫn `active`; `playerName` `""`, `"   "`, 21 ký tự, `"a<b"`, `"‮abc"`, `"ab​"`, emoji, `"a"` + 3 dấu kết hợp → 400.
- AC13: clock +2h → 409 `SESSION_EXPIRED`, dòng vẫn `active`, không vào leaderboard.
- AC14: leaderboard tic-tac-toe → 422 `GAME_NOT_RANKED`; trang tic-tac-toe gửi 0 request `/api/sessions`, có `unranked-note`, không có `leaderboard`.
- AC15 (rate limit): `POST /sessions` thứ 61 trong cửa sổ cùng IP → 429 `RATE_LIMITED` + `Retry-After ≥ 1` (kể cả body hỏng); cửa sổ mới → 201; IP khác không ảnh hưởng; tương tự nộp điểm (60) và leaderboard (120).
- AC16 (`TRUST_PROXY`): không đặt → `X-Forwarded-For` giả không lách được; `TRUST_PROXY=1` → dùng IP từ XFF; `TRUST_PROXY=true` → `loadConfig` throw.
- AC17: mọi lần nộp bị từ chối (400/401/404/409/422/429) log `warn` `event:'score_rejected', reason`; log không chứa token, hash, IP, nickname.
- AC18 (leaderboard): desc điểm cao trước, hoà → thời lượng ngắn trước, hoà tiếp → `ended_at` sớm trước; memory thấp trước; "Lan" 10 và "lan" 12 → 1 dòng 12; loại bản ghi rejected/`hidden`; `limit` sai → 400; `rank` liên tục.
- AC19: `ScoreResult.rank` đúng khi có người khác; `personalBest=false` khi kém kỷ lục cũ của cùng tên.
- AC20 (pg, skip khi thiếu DB): migration 002 áp được lên 001; CHECK từ chối `finished` có `score` null và `rejected` không có `reject_reason`.
- AC21: seed luật upsert chạy lại an toàn; tic-tac-toe không có dòng luật.

**Game integration**
- AC22 (memory): mỗi lần lật thẻ thứ 2 của một cặp `moves++` và `QP.score(moves)`; đủ 8 cặp → `QP.gameOver(moves)`; `shuffleCard` reset `moves = 0`; chơi hoàn hảo → `gameOver(8)`.
- AC23 (GameHost): `onReady` gọi cho mỗi `ready` được chấp nhận (kể cả khi đang `playing`), không gọi khi `error`/message sai; `onGameOver` gọi đúng một lần mỗi chuyển `playing→over`; đổi callback không đăng ký lại listener; callback throw không làm hỏng host; `scoreLabel` mặc định "Điểm"; test cũ vẫn pass.

**Frontend**
- AC24: game xếp hạng: mỗi `ready` → 1 `POST /api/sessions {gameId}`; `gameOver` với nickname hợp lệ → `POST /api/sessions/<id>/score`, header `X-Session-Token` = token vừa nhận, body `{score, playerName}`; token không nằm trong URL, storage, DOM, không gửi vào iframe.
- AC25: `score-result[data-state]`: pending, saved (`score-result-rank` có "#N"), rejected (422), expired (409 `SESSION_EXPIRED`), not-saved (409 `SESSION_NOT_ACTIVE`, 404, 401, tạo phiên lỗi), error (mạng, 5xx, 429); saved → tải lại leaderboard và lưu nickname.
- AC26: `nickname-input` lấy sẵn từ localStorage (`qp:nickname`); tên sai → `nickname-error`; `gameOver` khi tên sai → `needs-name` + `score-save`; nhập tên hợp lệ rồi bấm → nộp.
- AC27: lỗi mạng/5xx → tự retry tối đa 2 lần (1 s, 3 s) với cùng body và token, rồi `error` + `score-retry`; 429 không tự retry.
- AC28 (Brick Breaker): `gameOver` rồi `ready` liền nhau → ván 1 nộp bằng token 1, ván 2 tạo phiên mới; kết quả không lẫn.
- AC29: tạo phiên lỗi → khi `gameOver` hiện `not-saved`, không gửi request nộp.
- AC30: unmount giữa chừng → huỷ request, không setState sau unmount.
- AC31: leaderboard hiển thị `playerName` dạng text (mock `<img src=x>` hiện nguyên văn).
- AC32: e2e F1/F2 cũ vẫn pass; e2e Memory chơi thật 8 lượt, host hiện "Số lượt: 8".

Thông điệp UI và testid: xem `docs/architecture.md` §4.3 / ADR-021 (`nickname-input`, `nickname-error`, `score-result` + `data-state`, `score-result-rank`, `score-save`, `score-retry`, `leaderboard`, `leaderboard-row`, `leaderboard-empty`, `leaderboard-error`, `leaderboard-retry`, `unranked-note`). Nội dung: pending "Đang lưu điểm…"; saved "Đã lưu điểm: N. Hạng #R" (+ "(kỷ lục cá nhân)"); needs-name "Nhập tên để lưu điểm"; rejected "Điểm của ván này không được ghi nhận."; expired "Phiên chơi đã hết hạn, điểm không được lưu."; not-saved "Không lưu được điểm cho ván này."; error "Không gửi được điểm. Kiểm tra kết nối và thử lại."; error 429 "Bạn thao tác quá nhanh, vui lòng thử lại sau."

| ID | Agent | Mô tả | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| T1 | backend | Sửa R5 (ADR-020), mở rộng `ErrorCode`, rate limiter thuần (ADR-019), `TRUST_PROXY` → `trustProxy`, bỏ parser `text/plain`, unit test | — | [x] |
| T2 | backend | Migration 002, `ranked/scoreOrder` trong Game, module `sessions` (token, nickname, `verifyScore`, repository pg + in-memory, route tạo phiên/nộp điểm/leaderboard), seed luật, wiring `server.ts`, unit test + test pg (skip khi thiếu DB) | T1 | [x] code + unit test; SQL chưa chạy trên Postgres thật |
| T3 | game-integration | `memory-match` đếm lượt lật; `UPSTREAM.md`; `docs/game-protocol.md` (ngữ nghĩa điểm từng game); GameHost `onReady`/`onGameOver`/`scoreLabel` + unit test | — | [x] |
| T4 | frontend | API client POST + header, `sessions.ts`, `leaderboard.ts`, types; `features/scoring` (hook `useScoreSession`, nickname, khối kết quả, leaderboard); tích hợp `GamePlayPage` (mock GameHost trong unit test) | — (giao diện GameHost cố định theo ADR-021) | [x] |
| T5 | qa-engineer | Viết e2e: `scoring.spec.ts` (API giả lập + games server thật, gồm Memory chơi thật 8 lượt), `scoring-api.spec.ts` (full-stack, kịch bản gian lận, skip khi thiếu DB); cập nhật fixture + mock `/api/sessions` trong `play-game.spec.ts` | — (chạy ở T6) | [x] |
| T6 | session chính | Unit (games 53, api 265 + 24 skip pg, web 188), lint, typecheck, build pass; e2e 151 pass, 112 skip (full-stack cần DB), 0 fail. `.env.example` (`TRUST_PROXY`) vẫn bị permission chặn | T1–T5 | [~] còn phần DB/full-stack |
| T7 | code-reviewer | Review: 0 Critical/High; đã sửa R1 (rate limit bị tắt bằng IPv6 /64 + fail-open), R2 (ký tự vô hình trong nickname), R3 (BOM lệch FE/BE), R4 (log lỗi pg có thể lộ hash/nickname), R5 (4xx không được log), R6 (docs); thêm test bấm "Thử lại" 2 lần (lộ và sửa lỗi gửi trùng) | T6 | [x] |

Đợt 1 (song song): T1, T3, T4, T5 · Đợt 2: T2 (sau T1) · Đợt 3: T6 → T7 (+ sửa finding, chạy lại).

Không thêm dependency. Biến môi trường mới: `TRUST_PROXY` (tuỳ chọn).

## Giai đoạn 3 — Người dùng
- [x] **F4. Tài khoản người dùng** — code, unit test (gồm test pg thật), e2e (UI + full-stack trên PostgreSQL), review bảo mật + re-review xong; đã commit (`cb4efdb`)
  - [x] Đăng ký/đăng nhập/đăng xuất (email + mật khẩu, cookie phiên)
  - [x] Hồ sơ (đổi tên hiển thị, đổi mật khẩu), lịch sử chơi, kỷ lục cá nhân
  - [x] Chơi bằng tài khoản: phiên gắn tài khoản, leaderboard theo tài khoản, khách không giả được tên
  - Không thêm game.

### F4. Tài khoản người dùng
Contract: `docs/api-contract.yaml` **v0.5.0** (minor; không phá vỡ schema cũ — xem changelog). Kiến trúc: §3.1 (`COOKIE_SECURE`), §4.4, §4.5, §5.7–§5.9, §6; ADR-022 … ADR-029 (ADR-015 bổ sung bởi ADR-027; ADR-018 bị thay thế một phần bởi ADR-026; ADR-019 mở rộng bởi ADR-025; ADR-011 mở rộng bởi ADR-029).

Quyết định mặc định (session chính đã chọn, architect xác nhận): email + mật khẩu (scrypt `node:crypto`); cookie `httpOnly` 30 ngày cố định; CSRF = SameSite=Lax + `Origin`; trang riêng (không modal); tên tài khoản duy nhất + khách không dùng được tên tài khoản + huy hiệu thành viên; `EMAIL_TAKEN` được phép lộ khi đăng ký; xoá tài khoản ngoài phạm vi. **Không thêm dependency.**

#### Tiêu chí chấp nhận F4
**Backend — auth** (unit test với repo in-memory + `clock` inject; phần SQL có test pg, skip khi thiếu `TEST_DATABASE_URL`)
- AC1 (đăng ký): `POST /api/auth/register` với `Origin: WEB_ORIGIN`, `{email:"  Lan@Example.COM ", password:"mat-khau-dai-9", displayName:" Lan "}` → 201 `{user:{id, email:"lan@example.com", displayName:"Lan", createdAt}}`; body không có field nào chứa mật khẩu/hash/token. `Set-Cookie` (COOKIE_SECURE=false) = `qp_sid=<43 ký tự base64url>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`, **không** `Domain`, không `Secure`. Với COOKIE_SECURE=true: tên `__Host-qp_sid` + `Secure`. DB: `password_hash` bắt đầu `scrypt$v=1$n=32768,r=8,p=1$`; `auth_sessions.token_hash = sha256(giá trị cookie)`; giá trị cookie không xuất hiện ở bất kỳ cột nào.
- AC2 (validate): email `a@b`, `a b@c.de`, `lan@ví.dụ`, 255 ký tự, số `5`, thiếu → 400; password 7 ký tự → 400, 8 → 201, 129 → 400, không phải chuỗi → 400; `displayName` theo đúng bảng ca kiểm thử nickname F3 (AC12 F3) → 400; body > 4 KiB → 413; `text/plain` → 415; `application/x-www-form-urlencoded` → 415. Message lỗi không chứa giá trị đã gửi.
- AC3 (trùng): email khác hoa/thường của tài khoản có sẵn → 409 `EMAIL_TAKEN`; `displayName:"LAN"` khi đã có tài khoản "Lan" → 409 `NAME_TAKEN`; tên "Minh" chỉ từng được khách dùng trên leaderboard → 201.
- AC4 (đăng nhập): đúng → 200 `{user}` + cookie mới; sai mật khẩu và email không tồn tại → cùng 401 `{code:"INVALID_CREDENTIALS", message}` giống hệt nhau; unit test xác nhận `verifyPassword` vẫn được gọi (hash giả) khi email không tồn tại.
- AC5 (`GET /auth/me`): không cookie → `{user:null}` và **0** truy vấn repository; cookie hợp lệ → `{user}`; cookie sai định dạng hoặc tên cookie xuất hiện 2 lần → `{user:null}` không truy vấn; cookie hết hạn → `{user:null}` + `Set-Cookie … Max-Age=0`.
- AC6 (hết hạn cố định): clock + 30 ngày − 1 ms → còn hiệu lực; + 30 ngày → hết; dùng phiên không gia hạn `expires_at`.
- AC7 (đăng xuất vô hiệu phiên): `POST /auth/logout` → 204 + cookie `Max-Age=0`; dòng `auth_sessions` bị xoá; gửi lại giá trị cookie cũ → `/auth/me` `{user:null}`, `/me/sessions` 401; logout không cookie → 204.
- AC8 (session fixation): login kèm cookie `qp_sid=<chuỗi 43 ký tự do kẻ tấn công chọn>` → `Set-Cookie` có giá trị khác; chuỗi kia vẫn không hợp lệ. Login (hoặc register) khi đang giữ cookie hợp lệ của phiên S1 → S1 bị xoá khỏi DB.
- AC9 (đổi tên): `PATCH /me {displayName:"Lan Anh"}` → 200; `/auth/me` trả tên mới; tên của tài khoản khác (khác hoa/thường) → 409 `NAME_TAKEN`; đổi "Lan" → "LAN" của chính mình → 200; chưa đăng nhập → 401.
- AC10 (đổi mật khẩu vô hiệu phiên khác): user có 2 phiên (thiết bị A, B). Từ A: mật khẩu hiện tại sai → 403 `INVALID_CREDENTIALS`, cả A và B vẫn hợp lệ. Đúng → 204 + cookie mới cho A; cookie cũ của A và cookie của B → 401 ở `/me/sessions`; đăng nhập bằng mật khẩu cũ → 401, mật khẩu mới → 200.
- AC11 (CSRF): `POST /auth/login|register|logout`, `PATCH /me`, `POST /me/password` với `Origin: https://evil.example` hoặc thiếu `Origin` → 403 `FORBIDDEN`, không `Set-Cookie`, không thay đổi DB. `POST /sessions` có cookie + thiếu `Origin` → 403; không cookie + thiếu `Origin` → 201 (test F3 cũ vẫn pass); không cookie + `Origin` sai → 403.
- AC12 (brute force / rate limit): cùng IP: register thứ 11 trong 10 phút → 429 + `Retry-After ≥ 1`; login thứ 31 trong 5 phút → 429; cùng email (từ nhiều IP, `trustProxy` trong test) lần thử thứ 11 trong 15 phút → 429 **kể cả mật khẩu đúng**, email khác không bị ảnh hưởng; cửa sổ mới → lại được; `PATCH /me` + `POST /me/password` thứ 21 / 15 phút → 429; bảng khoá theo email đầy (`maxKeys` nhỏ trong test) → cho qua + 1 log `warn`. `GET /auth/me` không bị rate limit.
- AC13 (không lộ qua log/lỗi): chạy bộ test auth với logger ghi vào stream bộ nhớ → không dòng log nào chứa email, mật khẩu, giá trị cookie/token, chuỗi `Set-Cookie`, tên hiển thị, hash; có log `{event:"login_failed"}` khi đăng nhập sai. Lỗi DB unique không lộ `detail` ra response/log (map theo tên constraint).
- AC14: mọi response `/api/auth/*`, `/api/me*` (cả lỗi) có `Cache-Control: no-store`.
- AC15 (`password.ts`): hash hai lần cùng mật khẩu → khác chuỗi; verify đúng/sai; chuỗi lưu bị sửa/sai định dạng/tham số ngoài khoảng → `false` (không throw); `needsRehash` true khi tham số khác hiện tại; đăng nhập với hash tham số cũ → DB được cập nhật sang tham số mới. Mật khẩu NFC/NFD của cùng chuỗi tiếng Việt ("mậtkhẩu12") đăng nhập được lẫn nhau.
- AC16 (migration 003, pg): áp được trên 002 có dữ liệu; dòng `sessions` cũ có `user_id NULL`, `rank_key = 'g:' || player_key` (`NULL` với phiên active khách); CHECK từ chối email chữ hoa; unique email/display_name_key; `auth_sessions` cascade khi xoá user (test trong transaction rollback).

**Backend — phiên chơi + lịch sử**
- AC17: `POST /sessions` kèm cookie hợp lệ (+`Origin`) → dòng có `user_id` = user; không cookie / cookie hỏng → `user_id NULL`, vẫn 201; response giống F3.
- AC18: phiên tài khoản nộp `{score:17}` (không `playerName`) → 200, `session.playerName` = tên hiển thị; nộp `{score:17, playerName:"<b>"}` → 200 (playerName bị bỏ qua, không 400).
- AC19 (sở hữu): phiên của A nộp với token đúng nhưng không cookie → 404; với cookie của B → 404; phiên vẫn `active`, sau đó A nộp → 200.
- AC20: phiên khách (tạo khi chưa đăng nhập) nộp kèm cookie của A → 200, DB `user_id = A`, leaderboard dòng `isMember:true`.
- AC21 (khách giả tên tài khoản): có tài khoản "Lan"; khách nộp `playerName:"lan"` → 409 `NAME_TAKEN`, phiên vẫn `active`; nộp lại cùng phiên với "Lan2" → 200. Log `score_rejected` reason `NAME_TAKEN` (không có tên).
- AC22 (leaderboard): A ("Lan") 2 lượt → 1 dòng `isMember:true` với lượt tốt nhất; lượt khách "Lan" có trước khi A đăng ký → dòng riêng `isMember:false`; khách "Minh" và "minh" vẫn gộp; A đổi tên "Lan Anh" → leaderboard hiện "Lan Anh" cho lượt cũ; `rank`/`personalBest` của `ScoreResult` tính theo `rank_key` (A nộp lượt kém hơn → `personalBest:false`).
- AC23 (idempotent): A nộp lại cùng điểm → 200 cùng kết quả; khác điểm → 409 `SESSION_NOT_ACTIVE`; cùng điểm nhưng cookie B → 404.
- AC24: hai lần nộp đồng thời của tài khoản → đúng một lần ghi (in-memory + pg).
- AC25 (lịch sử, không truy cập được của người khác): A có 3 lượt finished (2 accepted, 1 rejected) + 1 active; B có 1 lượt. `GET /me/sessions` của A → `total:3`, chỉ lượt của A, mới nhất trước, lượt rejected có `result:"rejected"` và không có lý do; `?userId=<B>` bị bỏ qua; B chỉ thấy 1 lượt của B; chưa đăng nhập → 401; `limit=51`, `page=0`, `limit=1e1`, tham số lặp → 400; trang vượt quá → `items:[]`, `total` đúng.
- AC26 (kỷ lục): `GET /me/bests` → mỗi game một mục: snake lấy điểm cao nhất, memory-match lấy số lượt **thấp** nhất; `plays` = số lượt finished; lượt `hidden` không tính làm kỷ lục; chưa đăng nhập → 401; chưa chơi → `items:[]`.

**Frontend**
- AC27 (header): chưa đăng nhập → `auth-login-link` trỏ `/dang-nhap?next=<path hiện tại, encode>`; đã đăng nhập → `user-menu-button` hiện tên (text); bấm → `user-menu` có `user-menu-profile` (`/ho-so`), `user-menu-history` (`/lich-su`), `user-menu-logout`; Esc/click ngoài đóng menu, focus về nút; đăng xuất → `POST /api/auth/logout` → hiện lại `auth-login-link`.
- AC28 (đăng nhập): email/mật khẩu rỗng → lỗi tại chỗ, không gửi request; 401 → `login-error` "Email hoặc mật khẩu không đúng."; 429 → "Bạn thử quá nhiều lần, vui lòng thử lại sau."; lỗi mạng/5xx → "Không thể kết nối. Vui lòng thử lại."; thành công → điều hướng tới `next`; `next` = `//evil.example`, `https://evil.example`, `/\evil`, `javascript:…`, `/dang-nhap` → điều hướng `/`. Nút submit bị khoá khi đang gửi.
- AC29 (đăng ký): xác nhận mật khẩu không khớp / mật khẩu < 8 / tên sai (cùng `validateNickname`) → lỗi tại chỗ, không request; 409 `EMAIL_TAKEN` → `register-email-error` "Email này đã được đăng ký."; 409 `NAME_TAKEN` → `register-display-name-error` "Tên hiển thị đã có người dùng."; thành công → trạng thái đăng nhập + điều hướng.
- AC30 (bảo vệ route): `/ho-so`, `/lich-su` khi `anonymous` → `replace` tới `/dang-nhap?next=%2Fho-so` (tương ứng); đăng nhập xong quay lại đúng trang; khi `loading` không chuyển hướng sớm. `/dang-nhap`, `/dang-ky` khi đã đăng nhập → `/`.
- AC31 (hồ sơ): hiện `profile-email`, `profile-name-input` có sẵn tên; đổi tên thành công → `profile-name-status` "Đã lưu tên hiển thị." và header đổi ngay; 409 → "Tên hiển thị đã có người dùng."; đổi mật khẩu thành công → `password-status` "Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất."; 403 `INVALID_CREDENTIALS` → `password-error` "Mật khẩu hiện tại không đúng."; xác nhận không khớp → không request.
- AC32 (lịch sử): `personal-bests` với `personal-best-row` (tên game là link `/games/<id>`, điểm, nhãn "Số lượt" cho `asc`, thời lượng `formatDuration`); `history-row[data-result=accepted|rejected]` với "Đã ghi nhận"/"Không được ghi nhận", thời điểm `toLocaleString('vi-VN')`; rỗng → `personal-bests-empty`, `history-empty`; lỗi → `history-error` + `history-retry`; phân trang `?page=N` (dùng `Pagination` có sẵn); API trả 401 → `markSignedOut()` + chuyển `/dang-nhap?next=…`.
- AC33 (trang chơi khi đăng nhập): không có `nickname-input`; `playing-as` chứa tên; `gameOver` → `POST /api/sessions/<id>/score` body **đúng** `{score}` + `X-Session-Token`; không bao giờ vào `needs-name`; `localStorage['qp:nickname']` không đổi.
- AC34 (khách, tên của thành viên): 409 `NAME_TAKEN` → `score-result[data-state="name-taken"]` "Tên này thuộc về một thành viên. Hãy chọn tên khác hoặc đăng nhập.", `nickname-error` hiện; sửa tên rồi bấm `score-save` → nộp lại **cùng** session id/token.
- AC35 (leaderboard): `isMember:true` → `leaderboard-member-badge` (text "Thành viên"); tên render dạng text (mock `<img src=x onerror=alert(1)>` hiện nguyên văn ở leaderboard, header, hồ sơ).
- AC36 (không lưu bí mật phía client, e2e full-stack): sau đăng nhập `document.cookie` không chứa `qp_sid`; `localStorage`/`sessionStorage` không chứa email, token; không request nào có token/cookie trong URL.
- AC37 (hồi quy): toàn bộ unit/e2e F1–F3 vẫn pass; e2e UI dùng API giả lập không cần mock `/api/auth/me` (API thật trả `{user:null}` không cần DB khi không có cookie).

#### Hợp đồng nội bộ giữa các task
- **Backend T1 → T2** (`apps/api/src/auth/`):
  - `type AuthUser = { id: string; email: string; displayName: string; displayNameKey: string; createdAt: Date }`.
  - `app.auth.resolve(request): Promise<{ user: AuthUser; authSessionId: string } | null>` (nhớ trên request; không cookie → không truy vấn).
  - Hook `onRequest`: `app.auth.requireSameOrigin`, `app.auth.requireSameOriginIfCookie`; hook `preHandler`: `app.auth.requireUser` (gán `request.authUser`, 401 nếu không có). Thứ tự gắn: `onRequest: [rateLimitHook, requireSameOrigin…, …]`.
  - `app.rateLimitHooks` thêm `authRegister`, `authLogin`, `accountWrite`, `accountRead`; helper `createKeyedRateLimit` cho `authLoginAccount`.
  - `ErrorCode` thêm `FORBIDDEN`, `INVALID_CREDENTIALS`, `EMAIL_TAKEN`, `NAME_TAKEN` + helper `forbiddenError`, `invalidCredentialsError(status)`, `emailTakenError`, `nameTakenError`.
  - `buildApp` nhận thêm `authRepository?` (mặc định in-memory rỗng), `cookieSecure?: boolean`; `POST_BODY_LIMIT` giữ 1024, thêm `AUTH_BODY_LIMIT = 4096`.
  - Migration 003 chứa **cả** thay đổi `sessions` (§5.9) để T2 không phải tạo migration.
- **Frontend T3 → T4**:
  - `useAuth()` (`apps/web/src/features/auth/useAuth.ts`) trả `AuthContextValue` như ADR-029; **ngoài provider** trả `{status:'anonymous', user:null, …}` (hàm hành động reject) để test cũ render component riêng lẻ không cần provider.
  - `api/types.ts`: `User`, `AuthResponse`, `AuthState`, `PlayHistoryItem`, `PlayHistoryResponse`, `PersonalBest`, `PersonalBestsResponse`; `LeaderboardEntry.isMember?: boolean` (FE coi thiếu = false); `ScoreSubmission.playerName?: string`.
  - `api/client.ts`: `postJson`, `patchJson`, `getJson` gửi `credentials: 'same-origin'`; 204 → `undefined`.
- **Test id mới (e2e)**: header `auth-login-link`, `user-menu-button`, `user-menu`, `user-menu-profile`, `user-menu-history`, `user-menu-logout`; đăng nhập `login-page`, `login-form`, `login-email`, `login-password`, `login-submit`, `login-error`, `login-to-register`; đăng ký `register-page`, `register-form`, `register-email`, `register-display-name`, `register-password`, `register-password-confirm`, `register-submit`, `register-error`, `register-email-error`, `register-display-name-error`, `register-password-error`, `register-to-login`; hồ sơ `profile-page`, `profile-email`, `profile-name-form`, `profile-name-input`, `profile-name-submit`, `profile-name-status`, `profile-name-error`, `password-form`, `password-current`, `password-new`, `password-confirm`, `password-submit`, `password-status`, `password-error`; lịch sử `history-page`, `personal-bests`, `personal-best-row`, `personal-bests-empty`, `history-list`, `history-row` (`data-result`), `history-empty`, `history-error`, `history-retry`; trang chơi `playing-as`, `score-result[data-state="name-taken"]`, `leaderboard-member-badge`; trang đang tải `auth-loading`.

#### Bảng task
| ID | Agent | Mô tả | File sở hữu | Phụ thuộc | Done khi | Trạng thái |
|---|---|---|---|---|---|---|
| T1 | backend | Migration 003 (users, auth_sessions, cột/index mới của sessions); module auth: `password.ts`, `cookie.ts`, chuẩn hoá email/mật khẩu, repository pg + in-memory, service, hooks (`resolve`, `requireUser`, `requireSameOrigin[IfCookie]`), route `/api/auth/register|login|logout|me`, `PATCH /api/me`, `POST /api/me/password`; `ErrorCode` mới; bucket rate limit + `createKeyedRateLimit`; `COOKIE_SECURE` trong config; `Cache-Control: no-store`; `redact` logger; wiring `app.ts`/`server.ts`; unit test + test pg | `apps/api/migrations/003_users_auth.sql`; `apps/api/src/auth/**` (mới); `apps/api/src/errors.ts`; `apps/api/src/rate-limit.ts`, `rate-limit.test.ts`; `apps/api/src/config.ts`, `config.test.ts`; `apps/api/src/app.ts`, `app.test.ts`; `apps/api/src/server.ts` | — | AC1–AC16 có test pass (pg skip khi thiếu DB); test api cũ vẫn pass; `pnpm` lint/typecheck pass | [x] |
| T2 | backend | Phiên chơi gắn tài khoản + nộp theo danh tính + `NAME_TAKEN` + `rank_key`/`isMember` ở leaderboard và `rankOf` + `history.routes.ts` (`/api/me/sessions`, `/api/me/bests`) + repository pg/in-memory + test; đăng ký route lịch sử trong `app.ts`, bổ sung stub `server.ts` | `apps/api/src/sessions/**` (gồm `history.routes.ts`, `history.routes.test.ts` mới); `apps/api/src/app.ts`, `apps/api/src/server.ts` (chỉ phần wiring sessions/history — T1 đã xong) | T1 | AC17–AC26 pass (in-memory + pg skip); test F3 cũ pass (cập nhật kỳ vọng `isMember`) | [x] |
| T3 | frontend | API client (credentials, PATCH, 204), `api/auth.ts`, `api/me.ts`, types; `features/auth` (AuthProvider, useAuth, LoginPage, RegisterPage, `safeNext`, validate email/mật khẩu); `features/account` (ProfilePage, HistoryPage, PersonalBests); routing 4 route mới; `App.tsx` bọc provider; `UserMenu` ở top bar; CSS; unit test | `apps/web/src/api/client.ts`, `client.test.ts`, `auth.ts`, `auth.test.ts`, `me.ts`, `me.test.ts`, `types.ts`; `apps/web/src/features/auth/**` (mới); `apps/web/src/features/account/**` (mới); `apps/web/src/routing/**`; `apps/web/src/App.tsx`, `App.test.tsx`; `apps/web/src/layout/SiteHeader.tsx`, `UserMenu.tsx` (mới), `layout.css`, `layout.test.tsx` | — | AC27–AC32, AC35 (header/hồ sơ) có unit test pass; test web cũ pass; lint/typecheck/build pass | [x] |
| T4 | frontend | Trang chơi theo danh tính: `useScoreSession(game, identity)`, ẩn nickname khi đăng nhập + `playing-as`, nộp `{score}`, trạng thái `name-taken`, huy hiệu thành viên ở Leaderboard, `submitScore` nhận `playerName` tuỳ chọn | `apps/web/src/features/play/**`; `apps/web/src/features/scoring/**`; `apps/web/src/api/sessions.ts`, `sessions.test.ts`, `leaderboard.ts` | T3 | AC33–AC35 có unit test pass; test scoring/play cũ pass | [x] |
| T5 | qa-engineer | Viết e2e: `auth.spec.ts` (UI, API giả lập: header, đăng nhập/đăng ký, `next`, bảo vệ route), `account.spec.ts` (hồ sơ, lịch sử, giả lập), `auth-api.spec.ts` (full-stack, skip khi thiếu DB: cookie flags, CSRF, fixation, logout, đổi mật khẩu vô hiệu phiên khác, brute force theo email, khách giả tên, lịch sử người khác, AC36); bổ sung `scoring.spec.ts` (thành viên nộp `{score}`, `name-taken`, huy hiệu); fixture `tests/e2e/fixtures/auth.ts`; cập nhật mock leaderboard có `isMember` | `tests/e2e/auth.spec.ts`, `account.spec.ts`, `auth-api.spec.ts` (mới); `tests/e2e/fixtures/auth.ts` (mới); `tests/e2e/scoring.spec.ts`, `tests/e2e/scoring-api.spec.ts` (kỳ vọng `isMember`); `tests/e2e/fixtures/games.ts` | — (viết theo contract/testid; chạy ở T6) | Spec viết xong, tự skip đúng khi thiếu DB; full-stack ≤ 8 lần đăng ký/10 phút và không chạm hạn mức IP của login | [x] |
| T6 | session chính | Áp migration 003 trên PostgreSQL tạm, chạy unit (api/web/games), lint, typecheck, build, e2e (UI + full-stack với DB); báo `COOKIE_SECURE` cho `.env.example` | T1–T5 | Tất cả pass hoặc ghi rõ lý do | [x] Unit: games 53, api 543 (pg thật), web 436; typecheck/lint/build pass. E2E: 364/365 (1 fail AC18 do dữ liệu test tích luỹ trong DB dev, xem rủi ro); sau sửa R1–R3: auth-api + auth + account 97/97 |
| T7 | code-reviewer | Review diff T1–T5 (trọng tâm bảo mật: cookie, CSRF, fixation, enumeration, log, quyền sở hữu phiên/lịch sử) | T6 | Finding hợp lệ đã sửa, kiểm tra liên quan chạy lại | [x] Review: 0 Critical/High; M1 (race đăng nhập vs đổi mật khẩu), M2 (limiter theo email fail-open), L1–L4 + lỗi nickname ký tự điều khiển đã sửa; re-review: đóng hết, thêm R1 (race 2 lần đổi mật khẩu), R2 (maxKeys 100k), R3 (log 429) đã sửa |

Đợt 1 (song song): T1, T3, T5 · Đợt 2 (song song): T2 (sau T1), T4 (sau T3) · Đợt 3: T6 → T7 (+ sửa finding, chạy lại).

Không thêm dependency. Biến môi trường mới: `COOKIE_SECURE` (tuỳ chọn) — cần thêm vào `.env.example` (permission đang chặn).

## Giai đoạn 4 — Production — code + review xong; đã chạy thử đủ stack cục bộ (Docker, `*.localhost`), chưa deploy VPS
- [ ] **P1. Deploy một VPS bằng Docker Compose** (Caddy HTTPS + web tĩnh + api + games + PostgreSQL; migrate tự động, seed thủ công)
- [ ] **P2. CSP + header bảo mật production** (web ở Caddy, API ở app, game ở games server)
- [ ] **P3. Job dọn phiên** (phiên chơi `active` quá hạn + phiên đăng nhập hết hạn; không xoá lịch sử)
- [ ] **P4. CI GitHub Actions** cho repo backend
- [ ] **P5. Tách repo** `play-sprint-be` (`../play-sprint-be`, GitHub `dangthais/play-sprint-be`)

Contract: `docs/api-contract.yaml` **v0.5.1** (patch — chỉ mô tả header bảo mật + server production; không endpoint mới). Kiến trúc: §2 (sơ đồ production), §3.1 (biến mới), §6; ADR-030 … ADR-037 (ADR-013 phần "production chưa làm" được thay bằng ADR-032).

Mặc định đã chọn (xem "Câu hỏi mở" bên dưới): Caddy proxy sang games server Node (không `file_server`); header web ở Caddy, header API ở app, CSP game giữ ở games server; job dọn chạy trong process API (khoá advisory) + CLI `pnpm db:cleanup`; chỉ xoá phiên chơi `active` đã hết hạn > 24 h và `auth_sessions` hết hạn, **không** xoá/đánh dấu phiên `finished`; migrate mỗi lần `up`, seed bằng `docker compose run --rm seed`; `TRUST_PROXY=1`; HSTS 1 năm không `includeSubDomains`; `postgres:17-alpine`; FE build từ `FE_PATH` (mặc định `../play-sprint`). **Không thêm dependency npm.**

#### Tiêu chí chấp nhận Giai đoạn 4
**Deploy (P1)** — kiểm cục bộ với `WEB_DOMAIN=web.localhost`, `GAMES_DOMAIN=games.localhost`, `ACME_EMAIL=dev@example.test`, `POSTGRES_PASSWORD=<hex>`; trên VPS với tên miền thật khi có
- AC1: `docker compose config` thành công với `.env` đủ biến; thiếu `POSTGRES_PASSWORD`, `WEB_DOMAIN`, `GAMES_DOMAIN` hoặc `ACME_EMAIL` → lệnh dừng với thông báo nêu tên biến.
- AC2: Từ trạng thái sạch, `docker compose up -d --build` → `db` healthy → `migrate` áp `001`–`003` và thoát 0 → `api`, `games` healthy; `caddy` chạy độc lập (không `depends_on`, xem ADR-030). Chạy lại `up` → `migrate` in "No pending migrations." và thoát 0; dữ liệu còn nguyên (volume `pgdata`).
- AC3: `docker compose run --rm seed` → `GET https://<WEB>/api/games` trả đúng 5 game; `embedUrl` bắt đầu `https://<GAMES>/games/`, `thumbnailUrl` bắt đầu `https://<WEB>/thumbnails/`; chạy seed lần 2 không lỗi, vẫn 5 game.
- AC4: Chỉ `caddy` publish cổng (80, 443/tcp, 443/udp); `db`, `api`, `games` không có cổng trên host; `db` chỉ ở mạng `backend` (`internal`) — từ container `games`/`caddy` không phân giải/kết nối được `db:5432`. Container `api`/`games` chạy user `node` (không phải root), filesystem read-only.
- AC5 (web tĩnh): `/`, `/games/snake`, `/dang-nhap`, `/khong-ton-tai` → 200 `index.html` + `Cache-Control: no-cache`; `/assets/<file có hash>.js` → 200 + `Cache-Control: public, max-age=31536000, immutable`; `/assets/khong-co.js` → 404 (không trả `index.html`); `/thumbnails/snake.svg` → 200 `image/svg+xml`; `http://<WEB>/` → redirect sang `https://`.
- AC6 (games qua Caddy): `GET https://<GAMES>/games/snake/` → 200, header `Content-Security-Policy` **đúng bằng** `buildCsp('https://<WEB>', 'https://<GAMES>')`, có `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security`; **không** có `X-Frame-Options`, `Cross-Origin-Embedder-Policy`, `Cross-Origin-Resource-Policy`; `/sdk/config.js` chứa `"hostOrigin":"https://<WEB>"` + `Cache-Control: no-store`; `POST /` → 405; `/.env`, `/%2e%2e/` → 404.
- AC7 (luồng thật qua Caddy, Playwright): mở trang chủ, mở `/games/snake` → iframe tải từ `https://<GAMES>`, host nhận `ready`; đăng ký + đăng nhập thành công (kiểm `Origin` không chặn); cookie tên `__Host-qp_sid` có `Secure; HttpOnly; SameSite=Lax`; tạo phiên + nộp điểm (Memory Match hoặc giả lập qua API) → 200; **0** sự kiện `securitypolicyviolation` trên các trang `/`, `/games/snake`, `/dang-nhap`, `/dang-ky`, `/ho-so`, `/lich-su`.
- AC8 (header web): response HTML có đúng các header của ADR-032 (CSP nguyên văn với `frame-src https://<GAMES>`, HSTS `max-age=31536000`, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Permissions-Policy`, COOP/CORP `same-origin`); không có header `Server`; không có COEP.
- AC9 (API qua Caddy): `GET https://<WEB>/api/health` và `GET /api/games` có header API của AC10 + HSTS và **không** mang CSP của web (CSP = `default-src 'none'; frame-ancestors 'none'`). Gửi `X-Forwarded-For: 1.2.3.4` giả qua Caddy không đổi được IP mà API dùng cho rate limit (kiểm theo runbook: 61 lần `POST /api/sessions` từ một máy đổi XFF mỗi lần → lần 61 vẫn 429).

**Header API (P2, unit test với `app.inject`)**
- AC10: Mọi response (200 `GET /api/games`, `GET /api/health`, 400 validation, 401, 403, 404 route lạ, 413, 415, 429, 500 lỗi repository) có `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`. `/auth/*`, `/me*` vẫn `no-store` (không bị lặp giá trị); `Set-Cookie`, `Retry-After` không đổi. Test cũ của api vẫn pass.

**Job dọn (P3)** — unit test với clock giả + test pg (skip khi thiếu `TEST_DATABASE_URL`)
- AC11 (pg): dữ liệu mẫu: phiên `active` hết hạn 25 h trước (khách và tài khoản), `active` hết hạn 1 h trước, `active` còn hạn, `finished/accepted`, `finished/rejected` (khách và tài khoản, kể cả rất cũ). `runCleanup` chỉ xoá hai phiên `active` hết hạn > 24 h; kết quả `leaderboard`, `listHistory`, `personalBests` trước và sau giống hệt.
- AC12 (pg): `auth_sessions` hết hạn (`expires_at <= now`) bị xoá, còn hạn giữ nguyên; sau khi xoá, `GET /api/auth/me` với cookie cũ vẫn trả `{user:null}` + cookie xoá (hành vi AC5 F4 không đổi).
- AC13 (pg): `batchSize: 2` với 5 dòng đủ điều kiện mỗi bảng → xoá hết 5, trả `playSessionsDeleted: 5`, `authSessionsDeleted: 5`; `maxBatches: 1` → chỉ xoá 2.
- AC14 (pg): khi một kết nối khác giữ khoá `CLEANUP_LOCK_KEY` → `runCleanup` trả `{skipped:true}`, không xoá gì; sau khi lỗi giữa chừng, khoá được nhả (lần sau chạy được).
- AC15 (config/scheduler, unit): `CLEANUP_INTERVAL_MINUTES` thiếu/rỗng → 60; `0` → không tạo scheduler; `abc`, `-1`, `1.5`, `1441` → `loadConfig` throw. Scheduler (fake timers): chạy lần đầu sau `initialDelayMs`, rồi mỗi `intervalMs`; lượt đang chạy thì lượt kế bị bỏ qua (không chồng); `runCleanup` reject → log `warn` `event:'cleanup_failed'`, scheduler vẫn sống; `stop()` huỷ timer và chờ lượt đang chạy; log không chứa id, token, chuỗi kết nối. `server.ts` gọi `stop()` trước `pool.end()`.
- AC16 (CLI): `pnpm db:cleanup` có `DATABASE_URL` → in số dòng đã xoá, exit 0; thiếu `DATABASE_URL` → stderr, exit 1. Trong container: `docker compose exec api node dist/db/cleanup.js` chạy được.

**CI (P4)**
- AC17: `.github/workflows/ci.yml` chạy trên `push` (main) và `pull_request`; Node theo `.nvmrc`, pnpm theo `packageManager`; `pnpm install --frozen-lockfile`, `lint`, `typecheck`, `test` (log có chạy test pg — không có dòng `[skip] TEST_DATABASE_URL`), `build`; job `docker` build target `api` + `games` với `push: false`; `permissions: contents: read`; không dùng secret. Kiểm cú pháp bằng một lần chạy thật trên GitHub (sau khi người dùng cho phép push) hoặc `actionlint` nếu có sẵn — ghi rõ nếu chưa chạy được.

**Tách repo (P5)**
- AC18: `../play-sprint-be` có đúng nội dung ADR-037; trong thư mục đó `pnpm install` (lockfile mới) → `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass; không còn tham chiếu `apps/web`, `tests/`, `playwright`; `docker compose build` chạy được với `FE_PATH=../play-sprint`; không có `.env`, `node_modules`, `dist` trong cây git; `docs/api-contract.yaml` v0.5.1 đã chép sang `../play-sprint/docs/`. Không push khi chưa được người dùng cho phép.
- AC19: `docs/deployment.md` (runbook: DNS 2 bản ghi A/AAAA, mở cổng 80/443, chuẩn bị `.env`, lần đầu `up` + `seed`, cập nhật, xem log, chạy dọn tay, backup/restore `pg_dump`, đổi CSP khi FE thêm tài nguyên) và `.env.example` (danh sách biến bên dưới) đã cập nhật.

#### Hợp đồng nội bộ giữa các task
- `apps/api/src/security-headers.ts`: `export function registerSecurityHeaders(app: FastifyInstance): void` (hook `onSend`; header đặt bằng hằng số export `API_SECURITY_HEADERS`); gọi trong `buildApp` **trước** khi đăng ký route.
- `apps/api/src/db/cleanup.ts`: `runCleanup`, `startCleanupScheduler`, `CLEANUP_LOCK_KEY = 7_420_310_002`, `ACTIVE_SESSION_GRACE_MS = 86_400_000`; CLI build ra `dist/db/cleanup.js`. `Config.cleanupIntervalMinutes: number`.
- Ảnh `api`: workdir `/app/apps/api`, chứa `dist/`, `migrations/`, `node_modules` prod; lệnh `node dist/server.js` | `node dist/db/migrate.js` | `node dist/db/seed.js` | `node dist/db/cleanup.js`. Ảnh `games`: workdir `/app/apps/games`, `node src/server.ts`.
- Biến cho `.env.example` (session chính thêm; giá trị mẫu, không secret thật):
  - Dev/app (đã có, chưa từng vào file vì permission): `DATABASE_URL`, `TEST_DATABASE_URL`, `HOST`, `PORT`, `LOG_LEVEL`, `WEB_ORIGIN`, `GAME_ORIGIN`, `GAMES_HOST`, `GAMES_PORT`, `TRUST_PROXY`, `COOKIE_SECURE`; mới: `CLEANUP_INTERVAL_MINUTES`.
  - Compose/production: `WEB_DOMAIN`, `GAMES_DOMAIN`, `ACME_EMAIL`, `POSTGRES_PASSWORD` (ghi chú: `openssl rand -hex 32`), `FE_PATH`.
  - `VITE_GAME_ORIGIN` chỉ thuộc repo FE (giữ trong `.env.example` monorepo vì `apps/web` còn ở đây).

#### Bảng task
| ID | Agent | Mô tả | File sở hữu | Phụ thuộc | Done khi | Trạng thái |
|---|---|---|---|---|---|---|
| T1 | backend | Header bảo mật API (ADR-032): hook `onSend` cho mọi response, `Cache-Control: no-store` mặc định | `apps/api/src/security-headers.ts`, `apps/api/src/security-headers.test.ts` (mới); `apps/api/src/app.ts` | — | AC10 có test pass; test api cũ pass; lint/typecheck pass | [x] |
| T2 | backend | Job dọn (ADR-035): `runCleanup`, scheduler, CLI; `CLEANUP_INTERVAL_MINUTES` trong config; wiring + dừng khi shutdown | `apps/api/src/db/cleanup.ts`, `apps/api/src/db/cleanup.test.ts`, `apps/api/src/db/cleanup.pg.test.ts` (mới); `apps/api/src/config.ts`, `apps/api/src/config.test.ts`; `apps/api/src/server.ts` | — | AC11–AC15 có test pass (pg skip khi thiếu DB, có thông báo); AC16 thử tay khi có DB; lint/typecheck pass. Đề xuất script `db:cleanup` trong report (không tự sửa `package.json`) | [x] |
| T3 | session chính | Docker: `Dockerfile` (target `api`, `games`), `.dockerignore`, `compose.yaml`, `deploy/Caddyfile`, `deploy/web.Dockerfile` theo ADR-030 … ADR-034 | `Dockerfile`, `.dockerignore`, `compose.yaml`, `deploy/Caddyfile`, `deploy/web.Dockerfile` (mới) | — (đường dẫn lệnh cố định theo hợp đồng nội bộ) | `docker compose config` OK; `docker compose build` OK | [x] |
| T4 | session chính | CI (ADR-036) | `.github/workflows/ci.yml` (mới) | — | AC17 (phần kiểm được cục bộ) | [x] |
| T5 | qa-engineer | E2E smoke production: header web/API/games, SPA fallback, cache, luồng đăng ký/đăng nhập/chơi/nộp điểm qua Caddy, bắt `securitypolicyviolation`; **tự skip** khi thiếu `PROD_WEB_URL`/`PROD_GAMES_URL` (dùng `ignoreHTTPSErrors` cho chứng chỉ nội bộ `*.localhost`) | `tests/e2e/production.spec.ts` (mới) | — (viết theo AC5–AC9) | Spec viết xong, skip đúng khi thiếu biến; typecheck `tests` pass | [x] |
| T6 | session chính | Script `db:cleanup` (root + `apps/api/package.json`), `.env.example`, runbook `docs/deployment.md` | `package.json`, `apps/api/package.json`, `.env.example`, `docs/deployment.md` (mới) | T2, T3 | AC16 (script), AC19 | [~] script + runbook xong; `.env.example` chưa cập nhật (deny rule chặn, người dùng tự thêm) |
| T7 | session chính | Kiểm chứng: unit/lint/typecheck/build toàn repo; `docker compose up -d --build` cục bộ với `*.localhost`; `seed`; chạy T5 với `PROD_WEB_URL=https://web.localhost PROD_GAMES_URL=https://games.localhost`; kiểm AC1–AC9 bằng curl; `pnpm db:cleanup` | — (chỉ chạy lệnh) | T1–T6 | Tất cả pass hoặc ghi rõ lý do (vd. không có Docker) | [x] unit (gồm pg thật)/lint/typecheck/build/e2e dev pass; 2026-11-01: `docker compose up` cục bộ (`web.localhost`/`games.localhost`, repo `play-sprint-be`) — build OK, api/games/db healthy, migrate Exited 0, seed 5 game, HTTP→HTTPS 308, header web/api/games đúng, `db:cleanup` trong container OK; smoke production 25/25 pass (gồm test ghi với `PROD_ALLOW_WRITES=1`; sửa locator `.first()` trong test) |
| T8 | code-reviewer | Review diff T1–T6 (trọng tâm: CSP/headers, mạng compose & cổng, secret trong image/log, `TRUST_PROXY`, SQL xoá & khoá advisory, workflow permissions) | — (chỉ đọc) | T7 | Finding hợp lệ đã sửa, kiểm tra liên quan chạy lại | [x] |
| T9 | session chính | Tách repo `../play-sprint-be` (ADR-037): chép file, chỉnh `package.json`/ESLint/Prettier/`CLAUDE.md`/`README.md`, sinh lockfile, chạy lại kiểm tra trong repo mới, chép contract sang FE; `git init` (không commit/push nếu chưa được phép) | Toàn bộ `../play-sprint-be/**`; `../play-sprint/docs/api-contract.yaml` | T8 | AC18 | [x] |
| T10 | session chính | Cập nhật tiến độ kế hoạch + report cuối | `docs/implementation-plan.md` | T9 | Trạng thái bảng này đúng thực tế | [x] |

Đợt 1 (song song): T1, T2 (backend, hai agent — file không giao nhau), T5 (qa), và session chính làm T3, T4 · Đợt 2: T6 (sau T2, T3) · Đợt 3: T7 → T8 (+ sửa finding, chạy lại) · Đợt 4: T9 → T10.

#### Câu hỏi mở (mặc định đang dùng)
- Tên miền: domain đăng ký riêng cho game hay subdomain? (mặc định: hỗ trợ cả hai, khuyến nghị domain riêng — ADR-031)
- Có CDN/proxy (Cloudflare…) trước VPS không? (mặc định: không → `TRUST_PROXY=1`)
- HSTS `includeSubDomains`/`preload`? (mặc định: không, `max-age=31536000`)
- Retention phiên `finished` (đặc biệt lượt rejected của khách)? (mặc định: giữ vĩnh viễn)
- Backup: có cần tự động + lưu ngoài VPS? (mặc định: runbook `pg_dump` thủ công)
- Nguồn FE khi deploy: thư mục local hay git URL ghim tag? (mặc định: `FE_PATH=../play-sprint`)
- Sau khi tách, monorepo còn vai trò gì (chỉ e2e tích hợp / lưu trữ)? `apps/web` canonical ở `play-sprint`?
- Cho phép tạo commit / push lên `dangthais/play-sprint-be`? (mặc định: không, chờ người dùng)

## Rủi ro & ghi chú
- Agent không có thông tin đăng nhập PostgreSQL local: test DB và e2e full-stack sẽ `skip` cho tới khi người dùng đặt `DATABASE_URL`/`TEST_DATABASE_URL` trong `.env` và chạy `pnpm db:migrate && pnpm db:seed`.
- Phân trang offset có thể lệch trang khi catalog thay đổi giữa hai lần tải (chấp nhận, ADR-002).
- (F2) DB đã seed theo F1 còn 20 game không chơi được; seed F2 không xoá (cần người dùng cho phép), chỉ cảnh báo.
- (F2) CSP web chỉ có `frame-src`/`object-src`/`base-uri` ở dev/preview; CSP đầy đủ + header production thuộc việc deploy.
- (F2) Production: game nên ở site khác (domain khác), không chỉ khác cổng/subdomain (ADR-010).
- (F2) Điểm chỉ hiển thị phía client, không tin cậy; Giai đoạn 2 cần giới hạn điểm theo từng game (tic-tac-toe luôn 0, memory-match tối đa 8). → F3: tic-tac-toe không xếp hạng; memory-match đổi sang số lượt lật (ADR-016).
- (F2) 20 thumbnail SVG của game mẫu F1 không còn dùng — giữ lại, dọn khi người dùng đồng ý.
- (Giai đoạn 2) Host → game cần `MessageChannel` (tài liệu game có origin opaque) — giao thức v2.
- (Review R3) `list` chạy 2 truy vấn (items + count) không cùng snapshot; `total` có thể lệch tạm thời khi catalog đổi. Chấp nhận ở quy mô hiện tại.
- (Review R5) Error handler map mọi 4xx của Fastify thành 400 `VALIDATION_ERROR`. Phải sửa (và thêm `Error.code` vào contract, vd. `RATE_LIMITED`) trước khi thêm rate limit / `POST /sessions`. → F3: contract v0.4.0 đã thêm mã lỗi; sửa ở F3/T1 (ADR-020).
- (F3) Ngưỡng điểm chỉ giới hạn thiệt hại; client vẫn bịa được điểm "hợp lý" trong ngưỡng (ADR-016). Giảm bằng rate limit, phiên một lần, cột `hidden`.
- (F3, review) Memory Match: kẻ gian nộp 8 lượt ở ~3 000 ms là hạng 1 mà người thật gần như không vượt được (hoà điểm xếp theo thời lượng). Biện pháp duy nhất hiện tại là ẩn bằng `hidden`; cân nhắc nâng `min_duration_ms` sau khi có số liệu thật từ log.
- (F3, review R8) `scoring-api.spec.ts` ghi các lượt `Qa<run>…` vĩnh viễn vào DB mà API dev đang dùng (không có endpoint xoá). Nên chạy e2e full-stack trên DB riêng, hoặc định kỳ đặt `hidden=true` cho tên `Qa%` (thao tác dữ liệu — cần người dùng cho phép).
- (F3) Phiên bỏ dở tích luỹ (mỗi lần mở trang game xếp hạng ≥ 1 phiên); chưa có job dọn (index `sessions_active_expires_idx` đã sẵn).
- (F3) Phiên bỏ dở tích luỹ (mỗi lượt xem trang game xếp hạng tạo phiên); cần job dọn sau này (index `sessions_active_expires_idx` đã có).
- (F3) Rate limit in-memory: reset khi restart, không chia sẻ nhiều instance; dev qua Vite proxy mọi người dùng chung IP `127.0.0.1`.
- (F3) Nickname tự do: có thể phản cảm; hiện chỉ whitelist ký tự + `hidden` thủ công.
- (F3) Chưa có DB credentials: SQL atomic/leaderboard chỉ kiểm bằng test pg (skip) + repository in-memory cùng ngữ nghĩa; cần người dùng chạy trên PostgreSQL thật.
- Chưa có test cho khởi động `server.ts` khi thiếu `DATABASE_URL` (AC8 đã thử tay, chưa có test tự động).
- (F4) Không có quên/đặt lại mật khẩu: người dùng quên mật khẩu mất tài khoản (chỉ quản trị sửa bằng SQL). Cần dịch vụ email để làm.
- (F4) `EMAIL_TAKEN` cho phép dò email đã đăng ký (giới hạn 10 lần/10 phút/IP) — chấp nhận (ADR-025).
- (F4) Rate limit theo email cho phép kẻ xấu khoá đăng nhập của một email 15 phút (DoS có giới hạn).
- (F4) Rate limit in-memory: dev/e2e dùng chung IP `127.0.0.1`; e2e full-stack phải tiết kiệm lần đăng ký/đăng nhập; restart API reset hạn mức.
- (F4) Người từng chơi khách rồi đăng ký cùng tên sẽ có hai dòng trên leaderboard (khách cũ + thành viên); lượt khách cũ không gộp được.
- (F4) Phiên đăng nhập và phiên chơi hết hạn tích luỹ trong DB; chưa có job dọn (đã có index).
- (F4) Dev: cookie `localhost` được gửi kèm điều hướng iframe tới games server (`localhost:5174`); production bắt buộc game ở site khác.
- (F4) Trạng thái đăng nhập không đồng bộ giữa các tab tới khi gặp 401 hoặc tải lại.
- (F4) `scrypt` (32 MiB, ~50–100 ms) mỗi lần đăng nhập/đăng ký/đổi mật khẩu; thread pool 4 luồng — giới hạn bằng rate limit; theo dõi khi tải thật.
- (F4) E2E full-stack ghi dữ liệu vĩnh viễn vào DB dev (`qa+…@example.test`, lượt `Qa…`): leaderboard top 100 bị lấp dần, test AC18 của `scoring-api.spec.ts` đã fail vì không thấy dòng của mình. Cần chạy e2e full-stack trên DB riêng được làm sạch mỗi lần chạy (thao tác xoá dữ liệu — cần người dùng cho phép).
- (F4) Hạn mức theo khoá (email, tài khoản) khi bảng đầy dùng shard 1024: chặn brute force nhưng kẻ tấn công lấp được 100k khoá có thể khoá đăng nhập diện rộng tới 15 phút (ADR-025).
- (F4) `.env.example` vẫn bị permission chặn: cần thêm `COOKIE_SECURE`, `TRUST_PROXY` (cùng các biến cũ).
- (Giai đoạn 4) Một VPS = một điểm lỗi; deploy tạo lại container `api` → downtime vài giây; migration lỗi → API không lên tới khi sửa.
- (Giai đoạn 4) Chưa có backup tự động/ngoài VPS: mất volume `pgdata` = mất tài khoản và leaderboard.
- (Giai đoạn 4) CSP web không `'unsafe-inline'`: thư viện/tính năng FE mới chèn `<style>`/inline script sẽ bị chặn — e2e production phải bắt `securitypolicyviolation`; CSP nằm ở repo BE (`deploy/Caddyfile`) dù phụ thuộc FE.
- (Giai đoạn 4) `VITE_GAME_ORIGIN` là build-time: đổi `GAMES_DOMAIN` phải build lại image web (compose làm tự động khi `--build`).
- (Giai đoạn 4) Subdomain cho game (nếu người dùng chọn) mất Site Isolation và hiệu lực SameSite giữa web và game (ADR-031).
- (Giai đoạn 4) `TRUST_PROXY=1` chỉ đúng khi không có proxy nào khác trước Caddy; thêm CDN mà không đổi cấu hình → mọi người dùng chung IP của CDN (rate limit sai).
- (Giai đoạn 4) Một role Postgres (`qp`) vừa migrate vừa chạy app (sở hữu schema) — app bị chiếm quyền có thể DROP bảng; tách role migrator/app để sau.
- (Giai đoạn 4) Lockfile monorepo có importer `apps/web`: `pnpm install --frozen-lockfile` trong Docker build ở monorepo có thể cần chép cả `apps/web/package.json` (hết vấn đề sau khi tách repo, lockfile sinh lại).
- (Giai đoạn 4) Ba bản mã (monorepo, `play-sprint`, `play-sprint-be`) dễ lệch; contract phải sửa ở BE trước rồi chép sang FE.
- (Giai đoạn 4) Caddy cần cổng 80/443 mở và DNS trỏ đúng trước khi khởi động, nếu không ACME thất bại và có thể chạm rate limit của Let's Encrypt (thử trước với staging CA nếu cần).
