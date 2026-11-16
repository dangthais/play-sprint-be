# Kiến trúc — Quick Playing

> Trạng thái: **Draft** (stack đã chốt, ADR-001). Người phụ trách: agent `architect`.

## 1. Mục tiêu & phạm vi
- **Mục tiêu:** nền tảng chơi game nhanh trên web. Người dùng duyệt catalog game (grid thumbnail, phân trang), chọn game và chơi ngay trong iframe sandbox; backend quản lý catalog, phiên chơi, điểm số (xác minh phía server) và leaderboard.
- **Đã xong:** F1 "Trang danh sách game" (`GET /api/games` phân trang + grid thumbnail; bảng `games`, migration, seed). F2 "Chơi game" (5 game vendored ở origin riêng, SDK + giao thức v1, `GET /api/games/{gameId}`, trang chơi với game host).
- **Đã xong (Giai đoạn 2, F3 "Session & điểm số"):** phiên chơi do server cấp (`POST /api/sessions`, token phiên — ADR-015); nộp điểm một lần, atomic, xác minh theo luật từng game lưu trong DB (ADR-016, ADR-017); Memory Match đổi điểm thành số lượt lật; Tic Tac Toe không xếp hạng; leaderboard theo nickname (ADR-018); rate limit in-memory (ADR-019); error handler (ADR-020); trang chơi gọi API, game host chỉ phát sự kiện (ADR-021).
- **Phạm vi hiện tại (Giai đoạn 3, F4 "Người dùng"):** đăng ký/đăng nhập email + mật khẩu (scrypt, ADR-022); phiên đăng nhập bằng cookie `httpOnly` (ADR-023); chống CSRF bằng SameSite + kiểm `Origin` (ADR-024); rate limit đăng ký/đăng nhập + chống dò tài khoản (ADR-025); danh tính trên leaderboard: tên tài khoản duy nhất, khách không giả được, gộp theo tài khoản (ADR-026); phiên chơi gắn tài khoản (ADR-027); hồ sơ (đổi tên, đổi mật khẩu), lịch sử chơi, kỷ lục cá nhân (ADR-028); frontend auth + trang mới (ADR-029). Khách vẫn chơi được như F3. **Không thêm game.**
- **Phạm vi Giai đoạn 4 ("Production", chưa làm):** deploy một VPS bằng Docker Compose (Caddy HTTPS + web tĩnh + api + games + PostgreSQL, ADR-030/031/033/034); CSP + header bảo mật production (ADR-032); job dọn phiên chơi bỏ dở và phiên đăng nhập hết hạn (ADR-035); CI GitHub Actions (ADR-036); tách repo backend `play-sprint-be` (ADR-037). Không đổi tính năng người dùng.
- **Ngoài phạm vi (hiện tại):** xác minh email; quên/đặt lại mật khẩu (chưa có dịch vụ email); OAuth/đăng nhập mạng xã hội; 2FA; xoá tài khoản; quản trị người dùng; "đăng xuất mọi thiết bị" riêng lẻ (chỉ xảy ra khi đổi mật khẩu); đồng bộ trạng thái đăng nhập giữa các tab; thông điệp host → game; công cụ kiểm duyệt tên ngoài cột `hidden`; trang quản trị catalog; rate limit phân tán nhiều instance; nhiều instance API / zero-downtime deploy; CDN; backup tự động ra ngoài VPS; chính sách lưu trữ (retention) cho phiên đã nộp điểm; push image lên registry; CD tự động.

## 2. Tổng quan hệ thống
```
[Browser]
  ├── apps/web (React, WEB_ORIGIN :5173) ──/api (Vite proxy / reverse proxy, cùng origin)──> apps/api (Fastify, :3000) ──pg──> PostgreSQL
  │        ├── /thumbnails/*.svg (asset tĩnh của web)
  │        └── Trang /games/:id → GameHost
  │                 │  <iframe sandbox="allow-scripts" src=embedUrl>   (origin của tài liệu game = opaque "null")
  │                 ▼
  └── apps/games (static server Node, GAME_ORIGIN :5174)
           ├── /games/<id>/…   (game vendored, đã chỉnh)
           ├── /sdk/qp-sdk.js   (game SDK, script cổ điển)
           └── /sdk/config.js   (sinh động: { hostOrigin: WEB_ORIGIN })
        game ──postMessage({qp:1,type,…}, WEB_ORIGIN)──> GameHost (kiểm source + origin + schema)
```

Production (Giai đoạn 4, ADR-030/031):
```
Internet ─:443/:80─> caddy ─┬─ https://WEB_DOMAIN   : /api/* → api:3000 ; còn lại → /srv/web (build FE, SPA fallback)
                            └─ https://GAMES_DOMAIN : → games:5174 (node:http, header/CSP do games server đặt)
mạng edge: caddy, api, games      mạng backend (internal): api, db, migrate, seed
```

## 3. Thành phần
| Thành phần | Trách nhiệm | Công nghệ |
|---|---|---|
| Frontend (`apps/web`, `@qp/web`) | UI catalog, phân trang, routing tối giản, trang chơi | React 19 + Vite 8, TypeScript 6; routing bằng History API (ADR-011); Vitest + Testing Library (jsdom) |
| Game host (`apps/web/src/features/game-host`) | Iframe sandbox, nhận/validate message của game, trạng thái loading/playing/over/error, điểm phía client | React; do `game-integration` sở hữu (ADR-012) |
| Backend API (`apps/api`, `@qp/api`) | Game catalog (`GET /games`, `GET /games/{id}`), session + nộp điểm có xác minh + leaderboard (F3, `apps/api/src/sessions/`), rate limit (`apps/api/src/rate-limit.ts`); auth + tài khoản (F4, `apps/api/src/auth/`) | Node 24 (chạy `.ts` trực tiếp), Fastify 5, `pg` (SQL có tham số, không ORM); Vitest |
| Trang chơi (`apps/web/src/features/play`, `apps/web/src/features/scoring`) | Gọi API session/score/leaderboard theo sự kiện của game host; nickname (khách) hoặc tên tài khoản; hiển thị kết quả và leaderboard | React; do `frontend` sở hữu (ADR-021, ADR-029) |
| Auth backend (`apps/api/src/auth/`) | Băm mật khẩu, cookie, phiên đăng nhập, kiểm `Origin`, route `/api/auth/*`, `/api/me` (PATCH), `/api/me/password` | Node `crypto.scrypt`, không dependency mới (ADR-022 … ADR-025) |
| Lịch sử/kỷ lục (`apps/api/src/sessions/history.routes.ts`) | `GET /api/me/sessions`, `GET /api/me/bests` | SQL có tham số trên bảng `sessions` (ADR-028) |
| Auth frontend (`apps/web/src/features/auth`, `apps/web/src/features/account`, `apps/web/src/layout/UserMenu.tsx`) | `AuthProvider`/`useAuth`, trang đăng nhập/đăng ký/hồ sơ/lịch sử, menu người dùng | React context, routing tự viết (ADR-029) |
| Games server (`apps/games`, `@qp/games`) | Phục vụ tĩnh game vendored + SDK ở origin riêng, kèm CSP/security headers | Node 24 `node:http` tự viết, không dependency (ADR-010); Vitest |
| Game SDK (`apps/games/public/sdk/qp-sdk.js`) | API nhỏ cho game: `QP.ready()`, `QP.score(n)`, `QP.gameOver(n)` → postMessage tới host | JS thuần, script cổ điển (không module) |
| Database | `games`, `game_scoring_rules`, `sessions` (F3); `users`, `auth_sessions` (F4, migration 003) | PostgreSQL 17+; migration SQL thuần + runner tự viết (ADR-006) |
| E2E | Kiểm thử luồng người dùng | Playwright (`tests/e2e`, `playwright.config.ts` tự bật api + web + games) |
| Tooling | Monorepo, lint, format | pnpm workspace, ESLint flat config, Prettier |
| Deploy (Giai đoạn 4) | Reverse proxy + HTTPS, phục vụ build FE, header bảo mật web; compose 6 service; job dọn phiên (`apps/api/src/db/cleanup.ts`); CI | Docker Compose, Caddy 2, `postgres:17-alpine`, GitHub Actions (ADR-030 … ADR-037) |

### 3.1 Cấu hình (biến môi trường)
| Biến | Mặc định | Dùng cho |
|---|---|---|
| `DATABASE_URL` | (không có) | Kết nối DB khi chạy app/migrate/seed. Thiếu → server vẫn khởi động (health OK), route cần DB trả 500 `INTERNAL_ERROR` và log cảnh báo; migrate/seed thoát mã ≠ 0 với thông báo rõ. |
| `TEST_DATABASE_URL` | (không có) | DB riêng cho test của repository/migration. Thiếu → test DB `skip` có thông báo. |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | Bind server API |
| `WEB_ORIGIN` | `http://localhost:5173` | API: dựng URL thumbnail (ADR-004). Games server: `hostOrigin` trong `/sdk/config.js` (targetOrigin của SDK) và CSP `frame-ancestors`. |
| `GAME_ORIGIN` | `http://localhost:5174` | API: dựng `embedUrl` (ADR-004). Games server: nguồn được phép trong CSP của chính nó. |
| `GAMES_HOST` / `GAMES_PORT` | `127.0.0.1` / `5174` | Bind games server |
| `VITE_GAME_ORIGIN` | `http://localhost:5174` | Frontend (build-time): origin game tin cậy — kiểm `embedUrl`, CSP `frame-src` của web (vite config). Phải trùng `GAME_ORIGIN`. |
| `LOG_LEVEL` | `info` | Logger Fastify (pino) |
| `TRUST_PROXY` | (rỗng = không tin proxy) | API (F3, ADR-019): giá trị truyền cho option `trustProxy` của Fastify để lấy IP client cho rate limit. Rỗng → `false` (`request.ip` = địa chỉ TCP; dev qua Vite proxy mọi request là `127.0.0.1`). Số nguyên `n` ≥ 1 → tin `n` hop proxy. Ngược lại: danh sách IP/CIDR phân tách bằng dấu phẩy. Giá trị `true` bị **từ chối** (fail fast) vì cho phép giả mạo `X-Forwarded-For`. |
| `COOKIE_SECURE` | (rỗng = tự suy) | API (F4, ADR-023): `true` → cookie đăng nhập có `Secure` và tên `__Host-qp_sid`; `false` → không `Secure`, tên `qp_sid` (chỉ cho dev HTTP). Rỗng → `true` nếu `WEB_ORIGIN` là `https:`, ngược lại `false`. Giá trị khác `true`/`false`/rỗng → không khởi động. `false` khi `WEB_ORIGIN` là `https:` → không khởi động (fail fast). |
| `CLEANUP_INTERVAL_MINUTES` | `60` | API (Giai đoạn 4, ADR-035): chu kỳ job dọn phiên trong process API. Số nguyên `0`..`1440`; `0` = tắt. Sai → không khởi động. Chỉ chạy khi có `DATABASE_URL`. |

Biến chỉ dùng cho Docker Compose (Giai đoạn 4, ADR-030/031/033; đọc từ `.env` cạnh `compose.yaml` trên VPS, dùng để nội suy — không truyền thẳng vào app): `WEB_DOMAIN`, `GAMES_DOMAIN` (bắt buộc, hostname không scheme), `ACME_EMAIL` (bắt buộc), `POSTGRES_PASSWORD` (bắt buộc, chỉ ký tự URL-safe — khuyến nghị `openssl rand -hex 32`), `FE_PATH` (mặc định `../play-sprint`; có thể là git URL kèm tag), `LOG_LEVEL`, `CLEANUP_INTERVAL_MINUTES`. Compose **tự dựng** `WEB_ORIGIN=https://${WEB_DOMAIN}`, `GAME_ORIGIN=https://${GAMES_DOMAIN}`, `VITE_GAME_ORIGIN=https://${GAMES_DOMAIN}` (build arg), `DATABASE_URL`, `TRUST_PROXY=1`, `COOKIE_SECURE=true`, `HOST=0.0.0.0`, `GAMES_HOST=0.0.0.0` — nhờ vậy `VITE_GAME_ORIGIN` luôn trùng `GAME_ORIGIN`.

`WEB_ORIGIN` (F4) còn là origin duy nhất được chấp nhận ở kiểm tra `Origin` chống CSRF của API (ADR-024).

`WEB_ORIGIN`/`GAME_ORIGIN` phải là origin hợp lệ (`http`/`https`, không path); sai → server không khởi động (fail fast). **`GAME_ORIGIN` phải khác `WEB_ORIGIN`** — API và games server từ chối khởi động nếu trùng; GameHost không nhúng iframe nếu origin game trùng origin trang (ADR-012).

## 4. Luồng chính
### 4.1 Xem danh sách game (F1)
1. User mở `/` (có thể kèm `?page=N`). FE đọc `page` từ URL (không hợp lệ → 1).
2. FE gọi `GET /api/games?page=N&limit=12` (đường dẫn tương đối, cùng origin).
3. BE validate query (Fastify schema) → lỗi trả 400 `{code: VALIDATION_ERROR, message}`.
4. BE chạy 2 truy vấn có tham số: `SELECT count(*)::int FROM games` và `SELECT ... FROM games ORDER BY created_at DESC, id ASC LIMIT $1 OFFSET $2`.
5. BE map record → `Game` (dựng `thumbnailUrl`, `embedUrl` tuyệt đối) và trả `{items, total, page, limit}`; trang vượt quá → `items: []`, `total` vẫn đúng.
6. FE render grid thumbnail + điều hướng trang; đổi trang cập nhật `?page=` bằng History API. (F2) Mỗi thẻ là link `/games/<id>`.

### 4.2 Chơi một game (F2 — chỉ điểm phía client)
1. User bấm thẻ game (hoặc mở thẳng `/games/<id>`). Router FE (ADR-011) render trang chơi; id không khớp slug → "Không tìm thấy game", không gọi API.
2. FE gọi `GET /api/games/<id>` → 200 `Game` | 404 `NOT_FOUND` (hiển thị "Không tìm thấy game") | lỗi khác (alert + "Thử lại").
3. FE render `GameHost` với `embedUrl`, `gameOrigin = VITE_GAME_ORIGIN`. GameHost kiểm `new URL(embedUrl).origin === gameOrigin` và `gameOrigin !== location.origin`; sai → trạng thái `error`, không tạo iframe.
4. Iframe `sandbox="allow-scripts"` nạp `<GAME_ORIGIN>/games/<id>/`. Trang game nạp `/sdk/config.js`, `/sdk/qp-sdk.js`, rồi mã game. Trạng thái host: `loading`.
5. Game gọi `QP.ready()` → SDK `parent.postMessage({qp:1,type:'ready'}, hostOrigin)` → host kiểm `event.source === iframe.contentWindow`, `event.origin === 'null'`, schema → `playing`, điểm 0.
6. Trong khi chơi: `QP.score(n)` → host cập nhật điểm. Kết thúc ván: `QP.gameOver(n)` → `over`, hiển thị "Ván trước: n". Ván mới: game gọi lại `QP.ready()`.
7. Không nhận `ready` trong 15 s sau sự kiện `load` của iframe → `error` + nút "Thử lại" (remount iframe). Nút "Chơi lại" luôn remount iframe.

### 4.3 Chơi có session & nộp điểm (F3, Giai đoạn 2)
Áp dụng khi `game.ranked === true` (thiếu field → coi như `false`). Game không xếp hạng (Tic Tac Toe) chạy như §4.2, không gọi API session/leaderboard, trang hiện ghi chú "Game này không xếp hạng".
1. Trang chơi (`GamePlayPage` + hook `useScoreSession`, ADR-021) render `GameHost` với callback `onReady`, `onGameOver(score)`; hiển thị ô nickname (giá trị khởi tạo lấy từ `localStorage['qp:nickname']` của origin web) và leaderboard (`GET /api/games/<id>/leaderboard?limit=10`).
2. Mỗi lần GameHost chấp nhận `ready` → `onReady()` → trang **bỏ** ván hiện tại nếu ván đó chưa có `gameOver` (token bị huỷ khỏi bộ nhớ, phiên trên server tự hết hạn) và mở ván mới: `POST /api/sessions {gameId}` → `{session, sessionToken}`; token chỉ giữ trong bộ nhớ (ref) của hook.
3. Khi GameHost chuyển `playing → over` → `onGameOver(score)` (đúng một lần mỗi ván) → trang gắn điểm vào ván hiện tại:
   - Tạo phiên còn đang chờ → đợi xong rồi nộp. Tạo phiên đã lỗi → kết quả "Không lưu được điểm" (không thể tạo phiên muộn vì thời lượng do server đo).
   - Nickname hiện tại hợp lệ → nộp ngay `POST /api/sessions/<id>/score` với header `X-Session-Token`, body `{score, playerName}`. Nickname rỗng/không hợp lệ → kết quả "Nhập tên để lưu điểm" + nút "Lưu điểm" (nộp khi người dùng bấm; phiên vẫn hiệu lực tới `expiresAt`).
4. Backend (§ADR-017): kiểm rate limit → định dạng → token (hash khớp) → trạng thái/idempotent → hết hạn → luật game (thời lượng server tính) → `UPDATE … WHERE status='active'` atomic → `ScoreResult {session, rank, personalBest}`.
5. Kết quả hiển thị ở khối `score-result`: đã lưu (điểm + hạng), bị từ chối, hết hạn/đã nộp, lỗi tạm thời (mạng/5xx/429 → nút "Thử lại", an toàn nhờ idempotent). Lưu thành công → tải lại leaderboard; lưu nickname vào `localStorage`.
6. Ván mới bắt đầu ngay sau `gameOver` (Brick Breaker gửi `gameOver` rồi `ready` liền nhau; Memory Match `ready` sau 1 s; Snake/2048 cần reload/"Chơi lại") → bước 2 mở ván mới trong khi kết quả ván trước vẫn hiển thị/đang nộp (mỗi ván có token riêng trong closure).
7. Rời trang/unmount: huỷ request đang chạy, token mất theo bộ nhớ; phiên bỏ dở để `active` tới khi hết hạn (không nhận điểm sau `expiresAt`).
8. Thông điệp host → game (start/pause) vẫn ngoài phạm vi; nếu cần dùng `MessageChannel` (giao thức v2).
9. (F4) Khi đã đăng nhập: xem §4.5 — các bước trên giữ nguyên, chỉ khác danh tính khi nộp điểm.

### 4.4 Đăng ký / đăng nhập / phiên đăng nhập (F4)
1. Tải ứng dụng: `AuthProvider` gọi `GET /api/auth/me` một lần → `{user}` hoặc `{user:null}` (`status: loading → authenticated | anonymous`). Không có cookie → server trả `{user:null}` mà không truy vấn DB.
2. Đăng ký (`/dang-ky`): FE kiểm sớm (email, mật khẩu 8–128, xác nhận mật khẩu, tên theo quy tắc nickname) → `POST /api/auth/register {email, password, displayName}`. Server (ADR-022…025): rate limit → `Origin` → body → chuẩn hoá → `INSERT users` (unique email, unique `display_name_key`; vi phạm → 409 `EMAIL_TAKEN`/`NAME_TAKEN`) → xoá phiên đăng nhập cũ nếu request mang cookie hợp lệ → sinh token 256 bit, `INSERT auth_sessions (token_hash = sha256(token), expires_at = now + 30 ngày)` → 201 `{user}` + `Set-Cookie`. FE đặt `user` vào context, điều hướng tới `next` (đã kiểm an toàn) hoặc `/`.
3. Đăng nhập (`/dang-nhap`): `POST /api/auth/login {email, password}`. Server: rate limit IP → `Origin` → body → rate limit theo email → tra `users` theo email; không có → vẫn chạy `scrypt` với hash giả; so `timingSafeEqual` → sai: 401 `INVALID_CREDENTIALS` + log `{event:'login_failed'}` (không email) → đúng: nếu tham số hash cũ thì băm lại (nâng cấp), xoá phiên cũ của request (nếu có), tạo phiên mới → 200 `{user}` + `Set-Cookie`.
4. Mọi request: cookie (`__Host-qp_sid` hoặc `qp_sid` theo `COOKIE_SECURE`) được parse thủ công; giá trị phải khớp `^[A-Za-z0-9_-]{43}$`; nhiều cookie cùng tên → coi như không có. Tra `auth_sessions JOIN users WHERE token_hash = $1 AND expires_at > $now`. Không khớp → khách/401. Kết quả được nhớ trong request (tối đa một truy vấn mỗi request).
5. Đăng xuất (menu người dùng): `POST /api/auth/logout` → server `DELETE FROM auth_sessions WHERE token_hash = $1` → 204 + cookie `Max-Age=0`. FE chuyển `anonymous`; nếu đang ở `/ho-so` hoặc `/lich-su` → về `/dang-nhap?next=…`.
6. Đổi mật khẩu (`/ho-so`): `POST /api/me/password {currentPassword, newPassword}` → kiểm mật khẩu hiện tại (sai → 403 `INVALID_CREDENTIALS`) → trong **một transaction**: cập nhật hash + `password_changed_at`, `DELETE FROM auth_sessions WHERE user_id = $1`, tạo phiên mới → 204 + `Set-Cookie`. Mọi thiết bị khác bị đăng xuất.
7. Đổi tên (`/ho-so`): `PATCH /api/me {displayName}` → 200 `{user}`; FE cập nhật context (menu, trang chơi).
8. Trang cần đăng nhập (`/ho-so`, `/lich-su`) khi `anonymous` → `navigate('/dang-nhap?next=<path hiện tại>', {replace:true})`; khi `loading` → hiện "Đang tải…". Trang `/dang-nhap`, `/dang-ky` khi đã `authenticated` → chuyển tới `next`/`/`. Mọi API `/me*` trả 401 `UNAUTHORIZED` → FE gọi `markSignedOut()` (chuyển `anonymous`).

### 4.5 Chơi khi đã đăng nhập (F4)
1. Trang chơi đọc `useAuth()`. `authenticated` → **ẩn** ô nickname, hiện "Bạn đang chơi với tên <tên hiển thị>" (`playing-as`); `anonymous`/`loading` → ô nickname như F3.
2. `POST /api/sessions {gameId}` không đổi ở FE; trình duyệt tự gửi cookie (cùng origin). Server gắn `user_id` nếu cookie hợp lệ.
3. `gameOver` khi `authenticated` → nộp `{score}` (không `playerName`), không cần tên hợp lệ (không có trạng thái `needs-name`). Khách → như F3; server trả 409 `NAME_TAKEN` nếu tên trùng tên tài khoản → khối kết quả `data-state="name-taken"` + ô nickname báo lỗi + nút `score-save` (nộp lại với tên khác trên **cùng phiên**, phiên vẫn `active`).
4. Server (ADR-027): phiên của tài khoản chỉ nộp được với cookie của đúng tài khoản (khác/không có → 404); phiên khách nộp bởi request đã đăng nhập → gắn vào tài khoản đó. `player_name`/`player_key` lưu = tên hiển thị/khoá của tài khoản lúc nộp.
5. Leaderboard: thành viên hiển thị tên hiện tại + huy hiệu "Thành viên" (`leaderboard-member-badge`); `localStorage['qp:nickname']` chỉ dùng cho khách, không bị ghi khi nộp bằng tài khoản.

## 5. Data model
### 5.1 Bảng `games` (migration `apps/api/migrations/001_create_games.sql`)
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | `text` | PK; `CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,63}$')` (slug, dùng trực tiếp làm `Game.id`) |
| `title` | `text` | NOT NULL; `CHECK (char_length(title) BETWEEN 1 AND 100)` |
| `description` | `text` | NULL; `CHECK (description IS NULL OR char_length(description) <= 500)` |
| `thumbnail_path` | `text` | NOT NULL; path tương đối với `WEB_ORIGIN`, bắt đầu bằng `/`; `CHECK (thumbnail_path ~ '^/[A-Za-z0-9/_.-]+$' AND position('..' in thumbnail_path) = 0)` |
| `embed_path` | `text` | NOT NULL; path tương đối với `GAME_ORIGIN`; cùng dạng CHECK như trên |
| `orientation` | `text` | NOT NULL DEFAULT `'any'`; `CHECK (orientation IN ('landscape','portrait','any'))` |
| `tags` | `text[]` | NOT NULL DEFAULT `'{}'` |
| `created_at` | `timestamptz` | NOT NULL DEFAULT `now()` |

Index: `CREATE INDEX games_created_at_id_idx ON games (created_at DESC, id ASC);` (khớp đúng `ORDER BY` của danh sách). F2 **không** đổi schema, không có migration mới. `GET /games/{id}` dùng PK (`WHERE id = $1`).

### 5.2 Bảng `schema_migrations` (do runner tạo nếu chưa có)
`version text PRIMARY KEY` (tên file, vd. `001_create_games.sql`), `applied_at timestamptz NOT NULL DEFAULT now()`.

### 5.3 Seed (`apps/api/src/db/seed.ts`) — F2 (ADR-014)
Đúng **5 game chơi được** (thay 25 game mẫu của F1). Upsert theo `id`, chạy lại an toàn, **không xoá** dòng cũ; sau khi upsert, seed in cảnh báo số dòng trong `games` không thuộc danh sách seed (không in id cụ thể cũng được). `thumbnail_path = /thumbnails/<id>.svg`, `embed_path = /games/<id>/`.

| id | title | orientation | tags | created_at |
|---|---|---|---|---|
| `snake` | Snake | any | arcade, classic | 2026-01-01T00:00:00Z |
| `brick-breaker` | Brick Breaker | landscape | arcade | 2026-01-01T00:00:00Z (trùng `snake` → test tie-breaker) |
| `memory-match` | Memory Match | any | puzzle, memory | 2026-01-04T00:00:00Z |
| `merge-2048` | Merge 2048 | any | puzzle, numbers | 2026-01-07T00:00:00Z |
| `tic-tac-toe` | Tic Tac Toe | any | classic, board | 2026-01-13T00:00:00Z |

Thứ tự API: `tic-tac-toe, merge-2048, memory-match, brick-breaker, snake`. Mô tả (tiếng Việt, ≤ 500 ký tự) phản ánh đúng game thật và cách điều khiển; cả 5 game đều có `description`.

**F5 (ADR-038):** thêm 20 game → tổng **25**. Danh sách đầy đủ (`id`, `title`, `tags`, `orientation`, mô tả) nằm ở `docs/implementation-plan.md` mục F5; `created_at = 2026-11-10T00:00:00Z + i giờ` (i = 0..19 theo bảng đó). 5 game ở trên giữ nguyên. Thứ tự API: `maze-chomp, block-drop, sky-hop, space-shooter, asteroid-blaster, frog-crossing, bubble-pop, mole-smash, typing-race, simon-says, minesweeper, sliding-puzzle, code-breaker, word-guess, reversi, chess, checkers, sudoku, solitaire, sea-battle, tic-tac-toe, merge-2048, memory-match, brick-breaker, snake`.

### 5.4 Game vendored (`apps/games`, ADR-009)
Nguồn: https://github.com/he-is-talha/html-css-javascript-games, commit `aafbeac2119b9442790aee50cd143cdc4aeb1f88`, MIT © 2024 Talha Bin Yousaf.

| id | thư mục upstream | Điểm (`score`) | `gameOver` khi |
|---|---|---|---|
| `snake` | `24-Snake-Game` | số mồi đã ăn | đụng tường / thân |
| `merge-2048` | `10-2048-Game` | tổng giá trị ô đã gộp | "You WIN" hoặc "You LOSE" (logic upstream) |
| `tic-tac-toe` | `15-Tic-Tac-Toe` | luôn 0 (hai người chơi cùng máy, không có điểm) | có người thắng hoặc hoà |
| `memory-match` | `22-Memory-Card-Game` | **F3:** số lượt lật (mỗi lần lật thẻ thứ hai của một cặp = 1 lượt; ≥ 8 khi thắng; ít hơn tốt hơn). F2: số cặp đã khớp | khớp đủ 8 cặp |
| `brick-breaker` | `18-Breakout-Game` | số gạch phá trong lượt | bóng chạm đáy (gửi trước khi upstream reset điểm), sau đó ván mới |
| `maze-chomp` (F5) | `02-Pac-Man-Game` | 10/viên, 50/viên lớn (≤ 3800) | ăn hết viên hoặc hết 3 mạng |
| `sky-hop` (F5) | `04-Doodle-Jump-Game` | độ cao `floor(px/8)` | rơi khỏi màn hình |
| `block-drop` (F5) | `20-Tetris-Game` | điểm upstream (khối + hàng theo cấp) | khối chạm đỉnh |
| `space-shooter` (F5) | `42-Space-Invaders-Game` | 10/alien, cộng dồn qua đợt (khoá Medium) | hết mạng (qua đợt không phải `gameOver`) |
| `asteroid-blaster` (F5) | `43-Asteroids-Game` | 20/50/100 theo cỡ đá, 200/UFO (khoá Medium) | thắng 5 đợt hoặc hết mạng |
| `frog-crossing` (F5) | `46-Frogger-Game` | điểm upstream (khoá Medium) | đủ 5 tổ hoặc hết mạng |
| `bubble-pop` (F5) | `40-Bubble-Shooter-Game` | 10/bóng nổ, 15/bóng rơi (khoá Medium) | dọn sạch hoặc chạm vạch |
| `mole-smash` (F5) | `35-Whack-A-Mole-Game` | số lần đập trúng | hết 10 s |
| `typing-race` (F5) | `27-Typing-Game` | số từ gõ đúng (khoá Medium) | hết giờ |
| `simon-says` (F5) | `36-Simon-Says-Game` | số cấp vượt qua | bấm sai |
| `minesweeper` (F5) | `16-Minesweeper-Game` | số ô đã mở (54 = thắng) | đạp mìn hoặc mở hết |
| `sliding-puzzle` (F5) | `37-Sliding-Puzzle-Game` | số bước (**asc**, khoá 3×3) | giải xong |
| `code-breaker` (F5) | `38-Mastermind-Game` | số lượt đoán (**asc**; thua = 11; khoá Medium) | đoán đúng hoặc hết 10 lượt |
| `word-guess` (F5) | `11-Wordle-Game` | số lượt đoán (**asc**; thua = 7; khoá Medium, tắt gợi ý) | đoán đúng hoặc hết 6 lượt |
| `reversi` (F5) | `44-Reversi-Game` | số quân đen của người chơi (khoá Medium) | hết nước đi |
| `chess`, `checkers`, `sudoku`, `solitaire`, `sea-battle` (F5) | `03-Chess-Game`, `41-Checkers-Game`, `06-Sudoku-Game`, `05-Solitaire-Game`, `48-Battleship-Game` | luôn 0 (không xếp hạng) | ván kết thúc (thắng/thua/hoà) |

### 5.5 Bảng `game_scoring_rules` (F3, migration `apps/api/migrations/002_sessions_scoring.sql`, ADR-016)
Một dòng = game có xếp hạng. Game **không có dòng** → `ranked = false` (Tic Tac Toe).

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `game_id` | `text` | PK; FK → `games(id)` `ON DELETE CASCADE` |
| `score_order` | `text` | NOT NULL; `CHECK (score_order IN ('desc','asc'))` |
| `min_score` | `integer` | NOT NULL; `CHECK (min_score >= 0)` |
| `max_score` | `integer` | NOT NULL; `CHECK (max_score >= min_score AND max_score <= 1000000000)` |
| `min_duration_ms` | `integer` | NOT NULL DEFAULT 0; `CHECK (min_duration_ms >= 0)` |
| `score_slack` | `integer` | NOT NULL DEFAULT 0; `CHECK (score_slack >= 0)` |
| `max_score_per_sec` | `numeric(10,3)` | NULL; `CHECK (max_score_per_sec IS NULL OR (max_score_per_sec > 0 AND max_score_per_sec <= 100000))` (trần để phép tính số nguyên ở app không tràn, ADR-016) |
| `min_ms_per_score` | `integer` | NULL; `CHECK (min_ms_per_score IS NULL OR min_ms_per_score >= 0)` |

Seed (trong `apps/api/src/db/seed.ts`, upsert theo `game_id`; công thức ở ADR-016):

| game_id | order | min | max | min_duration_ms | slack | max/s | min ms/điểm |
|---|---|---|---|---|---|---|---|
| `snake` | desc | 0 | 900 | 0 | 5 | 2.5 | — |
| `merge-2048` | desc | 0 | 250000 | 0 | 100 | 250 | — |
| `brick-breaker` | desc | 0 | 20000 | 0 | 45 | 10 | — |
| `memory-match` | asc | 8 | 1000 | 3000 | 0 | — | 1000 |
| `maze-chomp` (F5) | desc | 0 | 3800 | 0 | 200 | 90 | — |
| `sky-hop` (F5) | desc | 0 | 1000000 | 0 | 100 | 200 | — |
| `block-drop` (F5) | desc | 0 | 1000000 | 0 | 500 | 250 | — |
| `space-shooter` (F5) | desc | 0 | 100000 | 0 | 100 | 200 | — |
| `asteroid-blaster` (F5) | desc | 0 | 200000 | 0 | 2000 | 300 | — |
| `frog-crossing` (F5) | desc | 0 | 5000 | 0 | 2500 | 150 | — |
| `bubble-pop` (F5) | desc | 0 | 1000000 | 0 | 600 | 60 | — |
| `mole-smash` (F5) | desc | 0 | 50 | 9500 | 0 | — | — |
| `typing-race` (F5) | desc | 0 | 5000 | 9000 | 0 | — | 1900 |
| `simon-says` (F5) | desc | 0 | 200 | 0 | 0 | — | 3000 |
| `minesweeper` (F5) | desc | 0 | 54 | 3000 | 0 | — | — |
| `sliding-puzzle` (F5) | asc | 1 | 5000 | 2000 | 0 | — | 100 |
| `code-breaker` (F5) | asc | 1 | 11 | 3000 | 0 | — | 2000 |
| `word-guess` (F5) | asc | 1 | 7 | 3000 | 0 | — | 1500 |
| `reversi` (F5) | desc | 0 | 64 | 3000 | 0 | — | — |

Game F5 không có dòng luật (không xếp hạng): `chess`, `checkers`, `sudoku`, `solitaire`, `sea-battle`. Căn cứ từng ngưỡng: ADR-039.

### 5.6 Bảng `sessions` (F3, cùng migration 002, ADR-015/017/018)
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | `uuid` | PK (sinh ở app bằng `crypto.randomUUID()`) |
| `game_id` | `text` | NOT NULL; FK → `games(id)` (không cascade) |
| `token_hash` | `bytea` | NOT NULL; `CHECK (octet_length(token_hash) = 32)` (SHA-256 của token) |
| `status` | `text` | NOT NULL DEFAULT `'active'`; `CHECK (status IN ('active','finished'))` |
| `started_at` | `timestamptz` | NOT NULL (đồng hồ app, ADR-017) |
| `expires_at` | `timestamptz` | NOT NULL; `CHECK (expires_at > started_at)` |
| `ended_at` | `timestamptz` | NULL |
| `duration_ms` | `integer` | NULL; `CHECK (duration_ms >= 0)` |
| `score` | `integer` | NULL; `CHECK (score BETWEEN 0 AND 1000000000)` |
| `player_name` | `text` | NULL; `CHECK (char_length(player_name) BETWEEN 1 AND 20)` (đã chuẩn hoá) |
| `player_key` | `text` | NULL; `lower(player_name)` tính ở app, khoá gộp "một người một dòng" |
| `result` | `text` | NULL; `CHECK (result IN ('accepted','rejected'))` |
| `reject_reason` | `text` | NULL; `CHECK (reject_reason ~ '^[A-Z_]{1,40}$')`; có giá trị **khi và chỉ khi** `result = 'rejected'` |
| `hidden` | `boolean` | NOT NULL DEFAULT `false` (quản trị ẩn tên phản cảm bằng SQL; leaderboard bỏ qua) |

CHECK toàn vẹn trạng thái: `status = 'active'` ⇔ `ended_at, duration_ms, score, player_name, player_key, result` **đều NULL**; `status = 'finished'` ⇔ các cột đó **đều NOT NULL**. `CHECK ((result = 'rejected') = (reject_reason IS NOT NULL))` viết dạng không bị NULL làm "lọt" (`result IS NOT DISTINCT FROM 'rejected'`).

Index:
- `sessions_leaderboard_idx ON sessions (game_id, player_key, score, duration_ms, ended_at) WHERE result = 'accepted' AND NOT hidden` — phục vụ `DISTINCT ON (player_key)` và tính hạng.
- `sessions_active_expires_idx ON sessions (expires_at) WHERE status = 'active'` — cho job dọn phiên sau này.

Giai đoạn 3: migration 003 thêm cột (không đổi/xoá cột hiện có) — xem §5.9.

### 5.7 Bảng `users` (F4, migration `apps/api/migrations/003_users_auth.sql`, ADR-022/026)
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | `uuid` | PK (sinh ở app bằng `crypto.randomUUID()`) |
| `email` | `text` | NOT NULL; đã chuẩn hoá ở app (trim + lowercase ASCII); `CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254)`; `UNIQUE` (constraint `users_email_key`) |
| `password_hash` | `text` | NOT NULL; `CHECK (password_hash LIKE 'scrypt$%' AND char_length(password_hash) <= 200)` (định dạng ADR-022) |
| `display_name` | `text` | NOT NULL; `CHECK (char_length(display_name) BETWEEN 1 AND 20)` (đã chuẩn hoá như nickname) |
| `display_name_key` | `text` | NOT NULL; `lower(display_name)` tính ở app (cùng hàm `normalizeNickname` → `key`); `UNIQUE` (constraint `users_display_name_key_key`) |
| `created_at` | `timestamptz` | NOT NULL |
| `updated_at` | `timestamptz` | NOT NULL |
| `password_changed_at` | `timestamptz` | NOT NULL |

App map vi phạm unique (pg `23505`) theo **tên constraint** → `EMAIL_TAKEN` / `NAME_TAKEN` (không đọc `detail`). Không lưu IP, user-agent.

### 5.8 Bảng `auth_sessions` (F4, cùng migration 003, ADR-023)
Tên khác `sessions` (phiên chơi) để tránh nhầm.

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL; FK → `users(id)` `ON DELETE CASCADE` |
| `token_hash` | `bytea` | NOT NULL; `UNIQUE`; `CHECK (octet_length(token_hash) = 32)` (SHA-256 của token cookie) |
| `created_at` | `timestamptz` | NOT NULL |
| `expires_at` | `timestamptz` | NOT NULL; `CHECK (expires_at > created_at)` |

Index: `auth_sessions_user_idx ON auth_sessions (user_id)` (xoá mọi phiên khi đổi mật khẩu); `auth_sessions_expires_idx ON auth_sessions (expires_at)` (job dọn sau này). Khi đăng nhập, app xoá các phiên **đã hết hạn** của chính user đó (dọn tại chỗ, không ảnh hưởng dữ liệu người dùng).

### 5.9 Thay đổi bảng `sessions` (F4, cùng migration 003, ADR-026/027)
- `ADD COLUMN user_id uuid NULL REFERENCES users(id)` (không cascade; xoá tài khoản ngoài phạm vi).
- `ADD COLUMN rank_key text GENERATED ALWAYS AS (CASE WHEN user_id IS NOT NULL THEN 'u:' || user_id::text WHEN player_key IS NOT NULL THEN 'g:' || player_key END) STORED` — khoá gộp "một người một dòng" của leaderboard/hạng (thay `player_key`). PostgreSQL ≥ 12; thêm cột generated sẽ ghi lại bảng (bảng nhỏ — chấp nhận).
- Index mới:
  - `sessions_rank_idx ON sessions (game_id, rank_key, score, duration_ms, ended_at) WHERE result = 'accepted' AND NOT hidden` — thay vai trò của `sessions_leaderboard_idx` (index cũ **giữ nguyên**, không drop trong 003; dọn sau nếu muốn).
  - `sessions_user_history_idx ON sessions (user_id, ended_at DESC, id DESC) WHERE status = 'finished' AND user_id IS NOT NULL` — lịch sử chơi.
- `sessions_state_chk` không đổi (`player_name`/`player_key` vẫn NOT NULL khi `finished`; với tài khoản = tên hiển thị/khoá lúc nộp).
- Dữ liệu cũ: mọi dòng hiện có `user_id = NULL` → `rank_key = 'g:' || player_key` (hành vi leaderboard của khách không đổi).

## 6. Bảo mật
- Iframe `sandbox="allow-scripts"` (không `allow-same-origin`, không `allow-modals/forms/popups/top-navigation`); game ở origin riêng; `GAME_ORIGIN ≠ WEB_ORIGIN` được kiểm ở mọi nơi (ADR-012).
- Host chỉ chấp nhận message khi `event.source === iframe.contentWindow` **và** `event.origin === 'null'` (origin opaque của tài liệu sandbox) **và** schema hợp lệ; còn lại bỏ qua im lặng. Không bao giờ dùng `targetOrigin '*'`. Host không gửi gì vào game (F2); không truyền token/dữ liệu người dùng vào game.
- Trang game có CSP chặt (ADR-013): chỉ tải tài nguyên từ `GAME_ORIGIN`, `connect-src 'none'`, `frame-ancestors WEB_ORIGIN`, `sandbox allow-scripts` (origin opaque kể cả khi mở top-level). Web có `frame-src GAME_ORIGIN` (dev/preview qua header Vite; production do reverse proxy — chưa làm).
- Games server: chỉ GET/HEAD, chống path traversal, whitelist phần mở rộng, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- Điểm F2 chỉ hiển thị phía client, **không** được coi là tin cậy. F3: server xác minh phiên (tồn tại, `active`, chưa hết hạn, token khớp hash), nộp một lần atomic, thời lượng do server đo, điểm trong giới hạn và tốc độ theo luật từng game (ADR-016/017). Đây là giới hạn thiệt hại, không chứng minh được ván đã thực sự được chơi (client vẫn có thể bịa điểm hợp lệ trong ngưỡng) — chấp nhận ở giai đoạn này.
- Token phiên: 256 bit ngẫu nhiên, chỉ trả một lần, server lưu SHA-256; gửi qua header `X-Session-Token` (không URL, không storage, không vào game, không log). Header tuỳ biến + body JSON buộc preflight CORS với request cross-origin → API không bật CORS nên site lạ không nộp điểm được qua trình duyệt nạn nhân.
- Rate limit theo IP cho tạo phiên, nộp điểm, leaderboard (ADR-019). Mọi lần nộp bị từ chối được log (lý do, gameId, sessionId, score, durationMs; không token/IP/nickname).
- Nickname là dữ liệu người dùng: server chuẩn hoá + whitelist ký tự (ADR-018); FE chỉ render dạng text.
- Mọi lỗi API trả `{code, message}`, không lộ stack/lỗi DB; lỗi 5xx được log phía server.
- (F4) Mật khẩu: `scrypt` có muối, so sánh `timingSafeEqual`, không bao giờ log/trả về (ADR-022). Phiên đăng nhập: cookie `httpOnly; SameSite=Lax; Path=/` (+ `Secure`, tiền tố `__Host-` ở production), DB chỉ lưu SHA-256 của token, hết hạn 30 ngày, đăng xuất xoá phía server, đăng nhập/đăng ký/đổi mật khẩu luôn cấp token mới (ADR-023). Không JWT, không `localStorage`.
- (F4) CSRF: SameSite=Lax + kiểm `Origin` = `WEB_ORIGIN` cho request đổi trạng thái; API vẫn không bật CORS; body chỉ nhận `application/json` (form HTML cross-site → 415) (ADR-024).
- (F4) Brute force/dò tài khoản: rate limit theo IP và theo email; lỗi đăng nhập chung chung + thời gian tương đương; `EMAIL_TAKEN` khi đăng ký là rủi ro chấp nhận (ADR-025).
- (F4) Logger: không ghi email, mật khẩu, token, cookie, header `Set-Cookie`. Serializer `req` hiện chỉ có method + path (header không bao giờ được log); thêm `redact` của pino cho `req.headers.cookie`, `req.headers["x-session-token"]`, `res.headers["set-cookie"]` làm lớp phòng thủ thứ hai; log sự kiện auth chỉ có `event`, `reason`, `userId` (nếu đã biết).
- (F4) Response `/auth/*`, `/me*` có `Cache-Control: no-store`. Dữ liệu tài khoản chỉ trả cho chính chủ (không có endpoint nhận `userId` từ client).
- (F4) Cookie không đặt `Domain` (host-only). Ở dev, `localhost:5173` và `localhost:5174` cùng host nên cookie cũng được gửi kèm điều hướng iframe tới games server — games server bỏ qua cookie, mã game không đọc được (`httpOnly`, origin opaque). Production bắt buộc đặt game ở **site khác** (ADR-010).
- Query DB luôn có tham số (`LIMIT $1 OFFSET $2`, `WHERE id = $1`); không nối chuỗi.
- FE không dùng `innerHTML`/`dangerouslySetInnerHTML`; chỉ gán `img src` khi URL là `http(s)`. Mã game vendored có dùng `innerHTML` với chuỗi tĩnh nội bộ — chấp nhận vì chạy trong sandbox origin riêng, không phải mã nền tảng; ESLint/Prettier bỏ qua thư mục vendored.
- Thumbnail SVG tự tạo, tĩnh, không script, không tham chiếu tài nguyên ngoài; luôn hiển thị qua `<img>`.
- (Giai đoạn 4) Production: chỉ Caddy mở cổng ra ngoài (80/443); PostgreSQL ở mạng Docker `internal` (không ra Internet, không với tới từ Caddy/games); `TRUST_PROXY=1` (đúng một hop Caddy, Caddy ghi đè `X-Forwarded-For` của client); `COOKIE_SECURE=true` → `__Host-qp_sid`; HSTS ở Caddy; CSP web đầy đủ ở Caddy, header API ở app, CSP game ở games server (ADR-030 … ADR-032). Secret (mật khẩu Postgres) chỉ trong `.env` trên VPS, không vào image/log. Container app chạy user `node`, filesystem read-only, `cap_drop: ALL`, `no-new-privileges`.

## 7. Quyết định kiến trúc (ADR)

### ADR-001: Chọn tech stack (đã được người dùng duyệt)
- Bối cảnh: Giai đoạn 0 chưa có stack; cần stack phổ biến, ít dependency, chạy tốt trên Windows dev.
- Quyết định: monorepo pnpm (`apps/api`, `apps/web`), Node 24, TypeScript 6; backend Fastify 5 + PostgreSQL qua `pg` (không ORM); frontend React 19 + Vite; test Vitest (unit) + Playwright (e2e); ESLint + Prettier.
- Hệ quả: Node 24 chạy `.ts` trực tiếp nên chỉ dùng cú pháp TS xoá được và import ghi đuôi `.ts`. Không ORM → tự viết SQL có tham số và runner migration (ADR-006). Không thêm thư viện validate. Querystring số nguyên (`page`, `limit`) được tự parse bằng regex chặt (`^[1-9][0-9]*$`, từ chối tham số lặp) thay vì dựa vào `coerceTypes` của Ajv, vì Ajv chấp nhận `1e1`, ` 2`… Body JSON của các endpoint sau dùng JSON Schema tích hợp của Fastify.

### ADR-002: Phân trang offset (`page` / `limit`)
- Bối cảnh: catalog nhỏ (hàng chục–hàng nghìn game), UI cần "Trang X / Y" và nhảy trang; người dùng yêu cầu page vượt quá trả 200 rỗng.
- Quyết định: query `page` (integer 1..10000, mặc định 1), `limit` (integer 1..100, mặc định 20); `offset = (page-1)*limit`. Response `{items, total, page, limit}`. `total` lấy bằng truy vấn `count(*)` riêng (không dùng `count(*) OVER()` vì trang vượt quá không có dòng nào để mang `total`). Page vượt quá số trang → 200, `items: []`, `total` đúng. Giá trị không hợp lệ (không phải số nguyên, ngoài khoảng, lặp tham số) → 400 `VALIDATION_ERROR`, không âm thầm kẹp giá trị.
- Hệ quả: đơn giản, dễ test. Nhược điểm offset (chậm khi offset lớn, lệch trang khi có game mới chèn vào giữa hai lần tải) chấp nhận được ở quy mô hiện tại; trần `page ≤ 10000` chặn offset vô lý. Nếu catalog lớn sẽ cân nhắc keyset pagination (thay đổi contract major).

### ADR-003: Sắp xếp "mới nhất trước" ổn định
- Bối cảnh: nhiều game có thể trùng thời điểm tạo (seed, import hàng loạt); thiếu tie-breaker thì phân trang offset có thể lặp/mất phần tử giữa các trang.
- Quyết định: `ORDER BY created_at DESC, id COLLATE "C" ASC`; index tổng hợp `(created_at DESC, id COLLATE "C" ASC)` (so sánh theo byte để thứ tự không phụ thuộc collation của DB). Thêm field `createdAt` (date-time) vào schema `Game` để client thấy được tiêu chí sắp xếp.
- Hệ quả: thứ tự xác định hoàn toàn; seed có một cặp trùng `created_at` để test tie-breaker (F2: `snake` / `brick-breaker`).

### ADR-004: Lưu path tương đối, backend dựng URL tuyệt đối
- Bối cảnh: thumbnail nằm trong `apps/web/public` (phục vụ bởi origin web); game phục vụ từ origin riêng. Origin khác nhau theo môi trường (dev/staging/prod).
- Quyết định: DB lưu `thumbnail_path` / `embed_path` (bắt đầu bằng `/`, không `..`); API trả `thumbnailUrl = new URL(thumbnail_path, WEB_ORIGIN).href`, `embedUrl = new URL(embed_path, GAME_ORIGIN).href`. Contract giữ `format: uri` (URL tuyệt đối).
- Hệ quả: đổi môi trường chỉ cần đổi env, không migrate dữ liệu. Không hỗ trợ thumbnail ở host ngoài (CDN) cho tới khi có ADR mới. Từ F2, `embedUrl` của 5 game seed trỏ tới game thật trong `apps/games`.

### ADR-005: Định dạng lỗi thống nhất — *bị thay thế một phần bởi ADR-020 (cách map lỗi 4xx của framework)*
- Bối cảnh: lỗi mặc định của Fastify có dạng `{statusCode, code: 'FST_ERR_...', error, message}`, không khớp contract và có thể lộ chi tiết nội bộ.
- Quyết định: `setErrorHandler` + `setNotFoundHandler` ở `buildApp`: lỗi validation → 400 `VALIDATION_ERROR` (message mô tả ngắn tham số sai); route không tồn tại → 404 `NOT_FOUND`; lỗi khác → 500 `INTERNAL_ERROR` với message chung, chi tiết chỉ ghi log server. Danh mục `Error.code` liệt kê trong schema `Error` của contract.
- Hệ quả: mọi endpoint dùng chung handler; thêm code mới phải cập nhật contract trước.

### ADR-006: Migration SQL thuần + runner tự viết
- Bối cảnh: không ORM; chỉ cần migration tiến (forward-only) đơn giản; tránh thêm dependency.
- Quyết định: file `apps/api/migrations/NNN_<mô_tả>.sql` (3 chữ số, chạy theo thứ tự tên). `apps/api/src/db/migrate.ts` (lệnh `pnpm db:migrate`): tạo `schema_migrations` nếu chưa có, giữ `pg_advisory_lock` trong lúc chạy, áp từng file chưa chạy trong một transaction và ghi `version`. Không có down-migration; sửa sai bằng migration mới. Không bao giờ sửa file migration đã áp dụng.
- Hệ quả: không dependency mới; logic runner cần unit/integration test (skip khi thiếu `TEST_DATABASE_URL`).

### ADR-007: Frontend không dùng router; state trang trong URL — *bị thay thế một phần bởi ADR-011*
- Bối cảnh: hiện chỉ có một trang; không muốn thêm `react-router` khi chưa cần.
- Quyết định: `App` render trực tiếp trang danh sách. Số trang lưu ở query `?page=N` (đọc từ `location.search`, ghi bằng `history.pushState`, nghe `popstate`) để back/forward và chia sẻ link hoạt động. FE gọi API bằng đường dẫn tương đối `/api/...` (dev: Vite proxy; prod: reverse proxy cùng origin) nên **không bật CORS** ở API (mặc định trình duyệt chặn cross-origin) — không cần `@fastify/cors`.
- Hệ quả: phần "App render trực tiếp trang danh sách" và "thẻ game chưa là link" được thay bằng ADR-011. Phần `?page=N` và không bật CORS vẫn giữ nguyên.

### ADR-008: Kiểm thử được mà không cần DB
- Bối cảnh: môi trường agent không có thông tin đăng nhập PostgreSQL.
- Quyết định: `buildApp` nhận `gamesRepository` (dependency injection). Route test dùng repository in-memory (cài đặt cùng thứ tự sắp xếp). Test repository Postgres/migration chỉ chạy khi có `TEST_DATABASE_URL` (ngược lại `skip` có thông báo) và tự dọn (khuyến nghị: chạy trong transaction + schema tạm, `ROLLBACK` cuối test). E2E UI chặn và giả lập `/api/games` (và `/api/games/<id>`) bằng `page.route` (không cần DB); e2e full-stack tự `skip` nếu API không trả dữ liệu seed.
- Hệ quả: CI sau này cần một PostgreSQL service để chạy đủ bộ test DB + full-stack. E2E trang chơi dùng API giả lập nhưng games server **thật** (không cần DB).
- Bổ sung F3: `buildApp` nhận thêm `sessionsRepository` (pg + in-memory, cùng ngữ nghĩa atomic), `clock?: () => number` (ms, mặc định `Date.now`; một đồng hồ dùng chung cho rate limiter và sessions, sessions tạo `new Date(clock())`), `trustProxy?` và `rateLimits?` (ghi đè giới hạn trong test). Logic xác minh điểm, chuẩn hoá nickname, sinh/hash token, rate limiter là **hàm thuần** có unit test đầy đủ; SQL của repository pg giữ đơn giản và có test (skip khi thiếu `TEST_DATABASE_URL`) gồm test hai lần nộp đồng thời.

### ADR-009: Vendor 5 game bên thứ ba (MIT), chỉnh sửa tối thiểu, ghi nguồn — *mở rộng bởi ADR-038 (thêm 20 game F5, cùng repo/commit)*
- Bối cảnh: người dùng chọn "tích hợp hẳn 5 game" từ repo MIT `he-is-talha/html-css-javascript-games`. Mã bên thứ ba là dữ liệu không tin cậy; game dùng tài nguyên ngoài (favicon i.ibb.co, Google Fonts, Font Awesome cdnjs), Snake dùng `localStorage` và `alert` — đều hỏng/không được phép trong sandbox + CSP của nền tảng.
- Quyết định: chép đúng các file cần thiết của 5 thư mục (bảng §5.4) vào `apps/games/public/games/<id>/` từ commit `aafbeac2…`. Chỉ sửa ở mức cần để: (1) bỏ mọi tài nguyên ngoài (font hệ thống thay web font, bỏ favicon, icon mũi tên Snake bằng ký tự Unicode); (2) chạy được trong sandbox không `allow-same-origin`/`allow-modals` (Snake: `localStorage` bọc try/catch, thay `alert`+`reload` bằng lớp phủ "Game Over" dựng bằng DOM API/`textContent` với nút "Chơi lại"); (3) gọi SDK (`QP.ready/score/gameOver`); (4) sửa lỗi upstream chặn việc chơi tiếp (Breakout: điều kiện hiện lại gạch dùng `brickRowCount * brickColumnCount`). Mỗi file đã sửa có comment đầu file "Modified for Quick Playing — xem apps/games/UPSTREAM.md". Giữ nguyên văn `LICENSE` upstream tại `apps/games/public/games/LICENSE.txt` (được phục vụ cùng game) và `apps/games/UPSTREAM.md` (URL repo, commit, ánh xạ thư mục → id, danh sách thay đổi từng game). Thư mục vendored bị loại khỏi ESLint/Prettier.
- Hệ quả: đáp ứng điều kiện MIT (giữ notice). Cập nhật upstream là thủ công (diff theo UPSTREAM.md). Thumbnail giữ SVG tự tạo của nền tảng. 20 thumbnail SVG của game mẫu F1 không còn dùng — **giữ lại** trong F2 (repo chưa có commit nên xoá là không khôi phục được); dọn khi người dùng đồng ý.

### ADR-010: Games server = static server Node tự viết (không Vite) ở origin riêng
- Bối cảnh: game phải ở origin khác web và phải có header riêng (CSP có `frame-ancestors` — chỉ đặt được bằng header). Phương án Vite (đã có trong repo) bị loại vì: dev server chèn `<script type="module" src="/@vite/client">` vào HTML — trong iframe origin opaque, module script bị fetch chế độ CORS với `Origin: null` và bị chặn, kèm websocket HMR vi phạm CSP; dev server biến đổi file `.js` cổ điển; khi build, Vite không đóng gói/chép script cổ điển (không `type="module"`) trừ khi đặt trong `public/`; chuyển game sang module sẽ bật strict mode và làm hỏng mã upstream (biến toàn cục ngầm trong 2048).
- Quyết định: package `apps/games` (`@qp/games`) với `src/server.ts` dùng `node:http` (Node 24 chạy `.ts` trực tiếp), phục vụ thư mục `apps/games/public/`:
  - Chỉ `GET`/`HEAD` (khác → 405 + `Allow: GET, HEAD`). Bind `GAMES_HOST:GAMES_PORT`.
  - Giải mã path an toàn (`decodeURIComponent` lỗi → 400); từ chối segment rỗng giữa, `.`/`..`, segment bắt đầu bằng `.`, `\`, ký tự NUL; resolve và bắt buộc nằm trong root (`path.resolve` + kiểm tra tiền tố `root + sep`) → ngược lại 404.
  - Thư mục có `/` cuối → `index.html`; thư mục thiếu `/` cuối → 301 tới cùng path + `/` (để đường dẫn tương đối trong game đúng).
  - Whitelist phần mở rộng + Content-Type: `.html` (text/html; charset=utf-8), `.js` (text/javascript; charset=utf-8), `.css` (text/css; charset=utf-8), `.png`, `.jpg`, `.svg` (image/svg+xml), `.txt` (text/plain; charset=utf-8). Khác → 404.
  - `GET /sdk/config.js` sinh động: `self.QP_CONFIG = Object.freeze({"hostOrigin":"<WEB_ORIGIN>"});` (giá trị qua `JSON.stringify`), `Cache-Control: no-store`.
  - Header mọi response (kể cả 404/405): CSP (ADR-013), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-cache` (trừ config.js). **Không** đặt `Cross-Origin-Resource-Policy`/COEP (sẽ chặn tài nguyên khi tài liệu có origin opaque).
  - Lỗi trả text ngắn, không lộ đường dẫn hệ thống. Validate `WEB_ORIGIN`/`GAME_ORIGIN` như API và từ chối khởi động nếu trùng nhau.
- Hệ quả: không dependency mới, kiểm soát header hoàn toàn, cùng một server cho dev và e2e. Phải tự test path traversal/headers (unit + e2e). Production: phục vụ bằng CDN/reverse proxy với **cùng bộ header** và nên đặt game ở **site khác** (domain đăng ký khác), vì cookie không cô lập theo cổng (localhost:5173 và :5174 cùng site).

### ADR-011: Routing frontend tối giản bằng History API (không thêm react-router) — *mở rộng bởi ADR-029 (4 route tài khoản)*
- Bối cảnh: F2 cần 2 trang (`/`, `/games/:id`) + trang không tìm thấy. Thêm `react-router` là dependency mới cho nhu cầu rất nhỏ.
- Quyết định: module `apps/web/src/routing/` gồm `parseRoute(pathname)` → `{name:'list'} | {name:'play', id} | {name:'notFound'}` (`/` → list; `/games/<id>` hoặc `/games/<id>/` → play với `id` đã decode (decode lỗi → notFound); mọi path khác → notFound. Việc kiểm `id` khớp `^[a-z0-9][a-z0-9-]{0,63}$` nằm ở `GamePlayPage`: không khớp thì hiện "Không tìm thấy game" và không gọi API), hook `useRoute()` (đọc `location.pathname`, nghe `popstate` và sự kiện điều hướng nội bộ), `navigate(path)` (`history.pushState` + phát sự kiện), component `Link` (render `<a href>`; chặn click trái không kèm phím Ctrl/Meta/Shift/Alt và không `target` để điều hướng client-side; còn lại để trình duyệt xử lý). `?page=` của trang danh sách giữ nguyên (ADR-007). Vite dev/preview đã có SPA fallback nên deep link `/games/<id>` hoạt động; production cần reverse proxy fallback về `index.html` (ghi chú deploy).
- Hệ quả: không dependency mới, ~100 dòng có unit test. Khi số trang > ~5 hoặc cần nested route/loader, đánh giá lại `react-router` (ADR mới).

### ADR-012: Giao thức game ↔ host v1, game SDK, sandbox origin opaque
- Bối cảnh: game không đáng tin; cần nhận `ready`/điểm/kết thúc. `.claude/rules/security.md`: sandbox `allow-scripts`, kiểm `event.source`, `event.origin`, schema; không `targetOrigin '*'`.
- Quyết định:
  - Iframe `sandbox="allow-scripts"` (không `allow-same-origin`) ⇒ tài liệu game có **origin opaque**: `event.origin` của mọi message từ game là chuỗi `"null"`; storage/cookie/`alert` không dùng được trong game. Host kiểm **cả ba**: `event.source === iframe.contentWindow`, `event.origin === "null"`, schema hợp lệ. Ràng buộc chính là `event.source` (chỉ đúng cửa sổ iframe này); origin thật của game được bảo đảm bằng việc chỉ nhúng `embedUrl` có origin bằng `gameOrigin` tin cậy + CSP `frame-src`.
  - Message (game → host), object thuần, đúng các key liệt kê, `qp` là số phiên bản giao thức = `1`:
    - `{ qp: 1, type: 'ready' }` — game sẵn sàng / bắt đầu ván mới (gửi được nhiều lần).
    - `{ qp: 1, type: 'score', score }` — cập nhật điểm hiện tại của ván.
    - `{ qp: 1, type: 'gameOver', score }` — kết thúc ván với điểm cuối.
    - `score`: `Number.isSafeInteger(score) && 0 <= score <= 1_000_000_000`.
    - Thiếu/thừa key, `qp ≠ 1`, `type` lạ, `score` sai → host bỏ qua (không throw, không hiển thị lỗi; được phép `console.debug` không kèm payload).
  - Host → game: **không có** ở v1.
  - SDK (`/sdk/qp-sdk.js`, script cổ điển IIFE, không phụ thuộc): đọc `self.QP_CONFIG.hostOrigin` (từ `/sdk/config.js`), chỉ hoạt động khi `window.parent !== window` và `hostOrigin` là origin http(s) hợp lệ; gửi `window.parent.postMessage(msg, hostOrigin)` — trình duyệt tự huỷ message nếu parent không phải `hostOrigin`. Expose `window.QP = Object.freeze({ version: 1, ready(), score(n), gameOver(n) })`; tự validate `n` (sai → bỏ qua + `console.warn`); không bao giờ throw ra mã game; khi chạy top-level (mở game trực tiếp) là no-op.
  - Thứ tự script trong mỗi `index.html` game: `/sdk/config.js` → `/sdk/qp-sdk.js` → mã game (đều là script cổ điển, `src` cùng origin).
  - Trạng thái host: `loading` → (`ready`) `playing` → (`gameOver`) `over` → (`ready`) `playing`…; `score` chỉ cập nhật điểm khi đang `playing` (trạng thái khác thì bỏ qua); `gameOver` chỉ có tác dụng khi đang `playing`. `error` khi: `embedUrl` sai origin, `gameOrigin` trùng origin trang, hoặc không có `ready` trong 15 s sau `load`. "Chơi lại" / "Thử lại" remount iframe (đổi `key`) → `loading`.
  - Đặc tả chính thức (ví dụ, bảng kiểm tra) nằm ở `docs/game-protocol.md` (do `game-integration` viết, phải khớp ADR này).
- Hệ quả: an toàn tối đa (game không truy cập được storage/cookie, kể cả của origin game). Gửi message vào game sau này phải dùng `MessageChannel` (không thể chọn targetOrigin cụ thể cho tài liệu opaque) — giao thức v2. Điểm phía client không tin cậy; Giai đoạn 2 phải xác minh server-side.
- Bổ sung F3 (không đổi giao thức, vẫn v1): GameHost có thêm callback cho trang cha (ADR-021). Ý nghĩa `score` của `memory-match` đổi thành số lượt lật — chỉ là ngữ nghĩa theo game, schema message không đổi.

### ADR-013: Content Security Policy cho trang game và cho web
- Bối cảnh: cần bảo đảm game chỉ tải tài nguyên từ origin của nó và chỉ được nhúng bởi web; web chỉ nhúng frame từ origin game.
- Quyết định:
  - Games server, mọi response: `default-src 'none'; script-src 'self' <GAME_ORIGIN>; style-src 'self' <GAME_ORIGIN> 'unsafe-inline'; img-src 'self' <GAME_ORIGIN>; font-src 'self' <GAME_ORIGIN>; media-src 'self' <GAME_ORIGIN>; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors <WEB_ORIGIN>`. Ghi tường minh `<GAME_ORIGIN>` cạnh `'self'` vì tài liệu sandbox có origin opaque. `'unsafe-inline'` cho style là bắt buộc (Snake chèn thuộc tính `style` qua `innerHTML`); script **không** có `'unsafe-inline'`/`'unsafe-eval'` (game không có inline script/handler).
  - Web (dev + preview, cấu hình trong `apps/web/vite.config.ts` bằng `server.headers`/`preview.headers`): `Content-Security-Policy: frame-src <VITE_GAME_ORIGIN>; object-src 'none'; base-uri 'self'` (chỉ các directive không xung đột với HMR/React Refresh). Nếu header không áp dụng cho HTML SPA fallback thì dùng thêm `<meta http-equiv="Content-Security-Policy">` trong `apps/web/index.html` với `%VITE_GAME_ORIGIN%`.
- Hệ quả: CSP đầy đủ cho web (script-src…) và cho production thuộc việc deploy/reverse proxy — chưa làm, ghi rủi ro. → Giai đoạn 4: ADR-032 (CSP games server giữ nguyên, được Caddy proxy; CSP web đầy đủ đặt ở Caddy).

### ADR-014: Catalog chỉ chứa game chơi được
- Bối cảnh: F1 seed 25 game mẫu không có mã chơi; F2 có 5 game thật. Giữ game không chơi được làm trang chơi hỏng.
- Quyết định: seed chỉ còn 5 game (§5.3). Không thêm cột `playable`/migration. Seed không xoá dòng cũ (thao tác xoá dữ liệu cần người dùng cho phép); in cảnh báo nếu DB còn dòng ngoài danh sách seed. Fixture e2e UI giả lập (25 game) vẫn dùng cho test phân trang; e2e full-stack dùng danh sách seed 5 game.
- Hệ quả: DB dev đã seed theo F1 sẽ còn 20 game cũ tới khi người dùng tự xoá (hoặc cho phép bổ sung tuỳ chọn `--prune`).

### ADR-015: Danh tính tạm thời bằng token phiên (trước khi có đăng nhập) — *bổ sung bởi ADR-027 (phiên gắn tài khoản); token vẫn bắt buộc*
- Bối cảnh: `security.md` yêu cầu phiên "thuộc đúng người tạo" nhưng Giai đoạn 2 chưa có tài khoản. Game không được cầm token; chỉ host gọi API.
- Quyết định:
  - `POST /sessions` sinh `sessionToken` = 32 byte từ `crypto.randomBytes`, mã hoá base64url không padding (43 ký tự). Trả **một lần** trong `SessionCreated`; DB chỉ lưu `token_hash = sha256(token)` (32 byte). Token có entropy 256 bit nên SHA-256 không muối là đủ (không cần bcrypt/argon2).
  - Nộp điểm gửi token ở header **`X-Session-Token`** (không dùng `Authorization` để dành cho đăng nhập Giai đoạn 3; không bao giờ ở URL/query). Server tra `WHERE id = $1 AND token_hash = $2`; không khớp hoặc không có phiên → cùng một lỗi 404 `NOT_FOUND` (không lộ phiên tồn tại). Thiếu/sai định dạng header → 401 `UNAUTHORIZED`.
  - "Người tạo" = người đang giữ token. FE giữ token trong bộ nhớ (ref của hook), không `localStorage`/`sessionStorage`, không log, không truyền vào game, không hiển thị.
  - Giai đoạn 3: migration thêm `sessions.user_id NULL`; nếu request tạo phiên có người dùng đăng nhập thì gắn `user_id`, và nộp điểm kiểm **thêm** user khớp (token vẫn bắt buộc). `playerName` có thể trở thành tuỳ chọn cho người đã đăng nhập — nới request là thay đổi không phá vỡ.
- Hệ quả: không cookie, không CSRF theo cookie; header tuỳ biến buộc preflight nên site khác không nộp điểm hộ được. Mất token (reload trang) = mất ván đó — chấp nhận. Token không giúp chống người dùng tự bịa điểm (họ là chủ token) — phần đó do ADR-016.

### ADR-016: Luật tính điểm lưu trong DB, xác minh bằng hàm thuần; ngưỡng từng game
- Bối cảnh: điểm do game (không tin cậy) báo qua host. Cần giới hạn thiệt hại khi client bịa điểm mà không chặn nhầm người chơi thật. Người dùng chọn: Memory tính theo lượt lật (ít hơn tốt hơn), Tic Tac Toe không xếp hạng.
- Quyết định:
  - Bảng `game_scoring_rules` (§5.5). Không có dòng ⇒ `ranked = false`. `GET /games`, `GET /games/{id}` `LEFT JOIN` để trả `ranked`, `scoreOrder` (các cột khác **không** công khai).
  - Hàm thuần `verifyScore(rule, score, durationMs)` → `{ ok: true } | { ok: false, reason }`, áp dụng tuần tự:
    1. `min_score ≤ score ≤ max_score`, sai → `SCORE_OUT_OF_RANGE`.
    2. `durationMs ≥ min_duration_ms`, sai → `DURATION_TOO_SHORT`.
    3. Nếu có `max_score_per_sec`: `score ≤ score_slack + floor(max_score_per_sec × durationMs / 1000)`, sai → `SCORE_RATE_EXCEEDED`. Tính bằng số nguyên: `perSecMilli = round(max_score_per_sec × 1000)`; vế phải `score_slack + floor(perSecMilli × durationMs / 1_000_000)` (với trần 100000/s và `durationMs` < 2 h thì tích < 2^53).
    4. Nếu có `min_ms_per_score`: `durationMs ≥ min_duration_ms + min_ms_per_score × (score − min_score)`, sai → `DURATION_TOO_SHORT`.
  - `durationMs` do server đo (ADR-017). Server bắt đầu đo **sau** khi game đã `ready` (thêm độ trễ tạo phiên), nên đo được ngắn hơn thực tế khoảng một RTT — các ngưỡng dưới đây đã chừa biên.
  - Ngưỡng (suy ra từ mã vendored trong `apps/games/public/games/`):
    - **snake**: lưới 30×30, `setInterval(initGame, 100)` ⇒ rắn đi 1 ô/100 ms; mồi đặt ngẫu nhiên đều. Khoảng cách Manhattan trung bình giữa hai ô ngẫu nhiên ≈ 20 ô (≈ 2 s/mồi); xác suất mồi rơi trong bán kính 4 ô ≈ 40/900 ≈ 4,4 %. Trần `score ≤ 5 + floor(2,5 × giây)` (trung bình ≤ 4 tick/mồi) — chỉ người chơi cực kỳ may mắn nhiều lần liên tiếp mới chạm. Rắn đứng yên tới phím đầu tiên chỉ làm `durationMs` dài hơn (an toàn). `max_score = 900` (số ô).
    - **merge-2048**: mỗi `keyup` mũi tên gọi `generate()` thêm một ô 2 (kể cả khi bàn không đổi — hành vi upstream) ⇒ tổng giá trị ô `S ≤ 4 + 2m` sau `m` phím. Điểm = tổng giá trị các ô sinh ra do gộp; ô `2^k` dựng từ các ô 2 đóng góp `(k − 1)·2^k` ⇒ `score ≤ (log2(ô lớn nhất) − 1)·S ≤ 11·S` (game kết thúc khi xuất hiện 2048). Giả sử ≤ 10 phím/giây (rất rộng): `score ≤ 11·(4 + 20t) = 44 + 220t` ⇒ trần `100 + 250 × giây`. Tuyệt đối: 16 ô ≤ 1024 cộng ô 2048 ⇒ `S ≤ 18432`, `score ≤ ~202 752` ⇒ `max_score = 250000`.
    - **brick-breaker**: 9×5 = 45 gạch, hiện lại khi phá đủ 45 hoặc mất bóng; bóng 4 px/khung `requestAnimationFrame` (60–144 Hz, có thể hơn). Nhịp phá nhanh nhất là bóng dội giữa trần và hàng gạch trên (~80 px khứ hồi ≈ 20 khung ≈ 3/s ở 60 Hz, ~7/s ở 144 Hz); có thể phá 2 gạch trong một khung (xuyên hàng) nên có bùng nổ ngắn. Trung bình cả lượt thấp hơn nhiều vì bóng phải về thanh đỡ (~380 px). Trần `45 + floor(10 × giây)` (một màn làm biên bùng nổ). `max_score = 20000`.
    - **memory-match**: 8 cặp; điểm = số lượt lật cặp (≥ 8). Mỗi lượt sai khoá bàn 1200 ms (`setTimeout(…, 1200)`) ⇒ thực tế `durationMs ≥ 1200·(score − 8)`. Luật: `min_score = 8`, `max_score = 1000`, `durationMs ≥ 3000 + 1000·(score − 8)` (sàn 3 s cho 16 cú nhấp; 1000 ms/lượt sai chừa 200 ms cho độ trễ). `scoreOrder = asc`.
    - **tic-tac-toe**: không có dòng luật ⇒ không xếp hạng (hai người cùng máy, `gameOver.score` luôn 0).
  - Mã game: chỉ `memory-match/script.js` đổi (đếm lượt, `QP.score(moves)`, `QP.gameOver(moves)`); giao thức v1 không đổi.
- Ngưỡng 15 game F5: ADR-039 (cùng công thức, không đổi `verifyScore`).
- Hệ quả: chỉnh ngưỡng = cập nhật seed (upsert) không cần deploy code. Ngưỡng là **giới hạn thiệt hại**, không phải bằng chứng ván đã chơi: kẻ gian vẫn nộp được điểm "hợp lý" (vd. Snake ~150 điểm sau 1 phút chờ) — leaderboard có thể bị nhiễm, giảm bằng rate limit + cột `hidden`. Chống gian lận mạnh hơn (replay input, mô phỏng server) ngoài phạm vi. Ngưỡng có thể chặn nhầm trong trường hợp cực hiếm (màn hình > 240 Hz với Brick Breaker) — theo dõi log `score_rejected` để nới.

### ADR-017: Vòng đời phiên, thời gian server, nộp một lần atomic, nộp lại idempotent
- Bối cảnh: mỗi phiên chỉ nộp một lần; không tin thời gian client; cần retry an toàn khi lỗi mạng; phiên bỏ dở.
- Quyết định:
  - TTL cố định `SESSION_TTL_MS = 2 giờ` (hằng số trong code). `started_at`, `expires_at`, `ended_at` lấy từ `clock()` của app (một instance; inject được cho test); `durationMs = now − started_at` (ms, số nguyên).
  - Trạng thái chỉ `active` → `finished`. **Không** thêm `expired` vào enum: phiên `active` quá `expires_at` bị từ chối khi nộp (409 `SESSION_EXPIRED`), dòng giữ nguyên; job dọn sau này dùng index `sessions_active_expires_idx`. Không có endpoint đọc phiên nên client không bao giờ thấy phiên quá hạn ⇒ không phá contract.
  - Nộp điểm: (1) đọc phiên + luật theo `id` và `token_hash`; (2) nếu đã `finished` → so `score` và `player_name` đã chuẩn hoá với dữ liệu đã lưu: trùng → trả lại kết quả cũ (200 hoặc 422), khác → 409 `SESSION_NOT_ACTIVE`; (3) quá hạn → 409 `SESSION_EXPIRED`; (4) `verifyScore`; (5) một câu lệnh `UPDATE sessions SET status='finished', ended_at=$, duration_ms=$, score=$, player_name=$, player_key=$, result=$, reject_reason=$ WHERE id=$1 AND token_hash=$2 AND status='active' AND expires_at > $now RETURNING …`; 0 dòng ⇒ có yêu cầu khác thắng ⇒ đọc lại và quay về (2). Không cần transaction/khoá tường minh.
  - Lần nộp **bị từ chối vẫn kết thúc phiên** (`result='rejected'`, `reject_reason`): không cho dò ngưỡng nhiều lần trên cùng phiên; message 422 chung chung, không nêu luật bị vi phạm.
  - Log mọi lần nộp bị từ chối ở mức `warn`: `{ event: 'score_rejected', reason, gameId?, sessionId?, score?, durationMs? }` (`reason` ∈ `RATE_LIMITED`, `UNAUTHORIZED`, `VALIDATION_ERROR`, `NOT_FOUND`, `SESSION_NOT_ACTIVE`, `SESSION_EXPIRED`, `SCORE_OUT_OF_RANGE`, `DURATION_TOO_SHORT`, `SCORE_RATE_EXCEEDED`, `GAME_NOT_RANKED`). Không log token, hash, IP, nickname.
  - Body validate bằng hàm thuần (không dùng Ajv coercion, giống ADR-001): `score` phải `typeof === 'number' && Number.isSafeInteger && 0..1e9`.
- Hệ quả: hai yêu cầu đồng thời → đúng một ghi; client retry với cùng dữ liệu nhận cùng kết quả. Phiên bỏ dở tích luỹ trong DB (mỗi lượt xem trang game xếp hạng tạo ≥ 1 phiên) — chặn bởi rate limit, dọn sau (ghi rủi ro). Nhiều instance API cần đồng hồ đồng bộ (NTP) — chấp nhận.

### ADR-018: Leaderboard theo nickname, thành tích tốt nhất mỗi tên — *bị thay thế một phần bởi ADR-026 (khoá gộp `rank_key`, tên tài khoản duy nhất); quy tắc chuẩn hoá tên giữ nguyên*
- Bối cảnh: chưa có tài khoản; cần tên hiển thị; tránh một người chiếm cả bảng; nội dung do người dùng nhập.
- Quyết định:
  - `playerName` gửi kèm khi **nộp điểm** (không phải khi tạo phiên) để người chơi đổi tên được trong lúc chơi và tạo phiên không phải chờ nhập tên. FE nhớ tên gần nhất ở `localStorage['qp:nickname']` của origin web (không phải bí mật; không truyền vào game).
  - Chuẩn hoá (server là nguồn sự thật, FE dùng cùng quy tắc để báo lỗi sớm): `trim` → NFC → gộp chuỗi khoảng trắng (`\s+`) thành một dấu cách → kiểm: 1–20 code point; regex `^[\p{L}\p{N}][\p{L}\p{M}\p{N} _.\-]*$` (cờ `u`); không quá 2 dấu kết hợp `\p{M}` liên tiếp (chống "zalgo"); mọi ký tự ngoài whitelist (điều khiển `\p{Cc}`, định dạng/bidi/zero-width `\p{Cf}`, emoji, `<>&"'`…) ⇒ 400. `player_key = player_name.toLowerCase()`.
  - Trước khi `trim`, chuỗi thô chứa bất kỳ code point nào trong danh sách cấm ⇒ 400 ở mọi vị trí: U+FEFF (BOM; `trim()` của JS xoá im lặng BOM ở đầu/cuối nên phải kiểm trước), và các ký tự "chữ" vô hình mà `\p{L}` chấp nhận: U+115F, U+1160, U+3164, U+FFA0, U+2800, U+17B4, U+17B5, U+180E. Giới hạn dấu kết hợp kiểm trên cả NFC và NFD (NFC có thể gộp dấu đầu vào chữ cái). FE và BE dùng cùng danh sách và cùng bảng ca kiểm thử.
  - (Sửa sau F4) Cũng trên chuỗi thô: mọi ký tự `\p{Cc}` (gồm `\n`, `\r`, `\t`), `\p{Cf}` và mọi khoảng trắng khác U+0020 (U+00A0, U+3000…) ⇒ 400 — bản đầu gộp `\s+` thành dấu cách **trước** khi kiểm nên `"a\nb"` lọt thành `"a b"`. Sau bước này mới trim dấu cách, NFC, gộp nhiều dấu cách liên tiếp thành một.
  - Leaderboard = thành tích tốt nhất của mỗi `player_key` trong các lượt `result='accepted' AND NOT hidden`. Thứ tự: `score` theo `score_order`, rồi `duration_ms ASC`, `ended_at ASC`, `id ASC`. `rank` = `row_number()` (liên tục, không đồng hạng). SQL có hai biến thể cố định cho `asc`/`desc` (chọn trong code theo luật, không nối chuỗi từ input):
    `SELECT … FROM (SELECT DISTINCT ON (player_key) … FROM sessions WHERE game_id=$1 AND result='accepted' AND NOT hidden ORDER BY player_key, score DESC|ASC, duration_ms, ended_at, id) best ORDER BY score DESC|ASC, duration_ms, ended_at, id LIMIT $2`.
  - `ScoreResult.rank` = 1 + số `player_key` khác có thành tích tốt nhất xếp trên lượt này; `personalBest` = lượt này chính là bản ghi tốt nhất của `player_key`.
  - Nội dung phản cảm: whitelist ký tự + render text thuần + cột `hidden` (ẩn bằng SQL bởi quản trị). Danh sách từ cấm và công cụ kiểm duyệt ngoài phạm vi (câu hỏi mở cho người dùng).
- Hệ quả: tên không độc quyền — hai người cùng tên bị gộp làm một dòng (chấp nhận tới Giai đoạn 3; khi có tài khoản, khoá gộp chuyển sang `user_id`). Truy vấn `DISTINCT ON` dùng index `sessions_leaderboard_idx`; đủ cho quy mô hiện tại.

### ADR-019: Rate limit in-memory theo IP, không thêm dependency — *mở rộng bởi ADR-025 (bucket auth, bucket theo email)*
- Bối cảnh: `security.md` yêu cầu rate limit cho tạo phiên và nộp điểm. Hiện chạy một instance API.
- Quyết định:
  - Module `apps/api/src/rate-limit.ts`: limiter cửa sổ cố định, khoá `(bucket, ip)`, `Map` trong bộ nhớ, `clock` inject được. Gắn bằng hook `onRequest` của từng route (chạy trước parse body/DB). Vượt → 429 `RATE_LIMITED` + header `Retry-After` (giây, làm tròn lên, ≥ 1).
  - Giới hạn mặc định: `createSession` 60/phút, `submitScore` 60/phút, `leaderboard` 120/phút (Brick Breaker có thể tạo phiên mỗi lần mất bóng). Ghi đè được qua `buildApp({ rateLimits })` cho test; không có biến môi trường.
  - Khoá IP được chuẩn hoá (`normalizeIpKey`): IPv4 giữ nguyên; IPv4-mapped (`::ffff:a.b.c.d`) → IPv4; IPv6 khác → prefix **/64** (một host IPv6 thường sở hữu cả /64, khoá theo nguyên địa chỉ thì né được hạn mức).
  - Bộ nhớ: tối đa 10 000 khoá; khi đầy thì quét bỏ khoá hết hạn; nếu vẫn đầy thì mọi khoá **mới** dùng chung một bucket overflow (mỗi bucket tên có overflow riêng, hạn mức = `limit` của bucket cho toàn bộ khoá mới trong một cửa sổ) và log `warn` tối đa một lần mỗi cửa sổ. Khoá đã có vẫn chạy với hạn mức riêng. (Sửa review F3-R1: bản đầu "cho qua" khi đầy, kết hợp khoá theo nguyên IP thì một prefix /64 tắt được rate limit.) Đánh đổi: khi bị tấn công lấp bảng, người dùng mới chia nhau hạn mức overflow và có thể bị 429.
  - IP: `request.ip` của Fastify với option `trustProxy` lấy từ `TRUST_PROXY` (§3.1). Mặc định không tin proxy. Dev qua Vite proxy mọi request là `127.0.0.1` (chung một hạn mức — chấp nhận ở dev). Production sau reverse proxy phải đặt số hop hoặc IP proxy.
  - Phương án thay thế: `@fastify/rate-limit` (chính chủ Fastify, hỗ trợ Redis) — chưa dùng vì nhu cầu nhỏ và quy ước không thêm dependency; chuyển sang khi chạy nhiều instance.
- Hệ quả: hạn mức reset khi restart; không chia sẻ giữa nhiều instance; người dùng sau cùng NAT chia chung hạn mức (60 phiên/phút vẫn rộng).

### ADR-020: Error handler giữ đúng status của lỗi framework (sửa finding R5)
- Bối cảnh: handler hiện tại map mọi 4xx của Fastify thành 400 `VALIDATION_ERROR` (vd. body quá lớn 413, Content-Type sai 415). F3 thêm 401/409/422/429.
- Quyết định:
  - `AppError` → đúng `statusCode`/`code` của nó. `ErrorCode` mở rộng theo danh mục `Error` trong contract v0.4.0; thêm helper tạo lỗi cho từng code.
  - Lỗi framework có `statusCode` 4xx: 400 → `VALIDATION_ERROR`; 404 → `NOT_FOUND`; 413 → `PAYLOAD_TOO_LARGE`; 415 → `UNSUPPORTED_MEDIA_TYPE`; 429 → `RATE_LIMITED`; 4xx khác → **giữ status**, code `BAD_REQUEST`. Message là chuỗi chung theo code (không chuyển nguyên message nội bộ). Log `warn` `{code, statusCode}` cho 4xx (route nộp điểm đã log `score_rejected` riêng nên không log trùng), `error` cho 5xx. Ajv: `coerceTypes:false`, `removeAdditional:false`. Logger dùng serializer an toàn: `req` chỉ method + path; `err` của pg chỉ giữ `code`/`constraint`/`table` (không `detail`/`where`/`parameters` — có thể chứa hash token, nickname).
  - Bỏ parser `text/plain` mặc định (`app.removeContentTypeParser('text/plain')`) để body không phải JSON → 415. Route POST đặt `bodyLimit: 1024`.
- Hệ quả: client phân biệt được lỗi; ADR-005 vẫn giữ định dạng `{code, message}` và handler not-found.

### ADR-021: Ranh giới host ↔ trang chơi: GameHost chỉ phát sự kiện, trang chơi gọi API
- Bối cảnh: GameHost (sở hữu bởi `game-integration`) đang tự quản trạng thái ván. Gọi API trong GameHost sẽ trộn trách nhiệm nhúng game với nghiệp vụ điểm.
- Quyết định:
  - `GameHostProps` thêm (đều tuỳ chọn, tương thích ngược):
    - `onReady?: () => void` — gọi cho **mỗi** `ready` hợp lệ được chấp nhận (trạng thái ≠ `error`), kể cả `ready` lặp khi đang `playing`.
    - `onGameOver?: (score: number) => void` — gọi **đúng một lần** cho mỗi chuyển `playing → over` (không gọi khi `gameOver` bị bỏ qua vì sai trạng thái).
    - `scoreLabel?: string` — nhãn của `game-score` (mặc định `"Điểm"`, hiển thị `"<nhãn>: n"`); `game-last-score` giữ `"Ván trước: n"`.
    - Callback đọc qua ref (không đăng ký lại listener khi đổi callback), gọi trong handler message (không trong reducer/render); trạng thái hiện tại theo dõi bằng ref đồng bộ với reducer; exception từ callback bị bắt và bỏ qua (không làm hỏng host).
  - Trang chơi (`frontend`) sở hữu hook `useScoreSession` (`apps/web/src/features/scoring/`): mô hình "ván" theo §4.3; token chỉ trong closure/ref; retry tự động tối đa 2 lần (1 s, 3 s) cho lỗi mạng/5xx với **cùng** body; 429 và hết lượt retry → trạng thái lỗi + nút "Thử lại"; huỷ request khi unmount.
  - Nhãn điểm: `scoreOrder === 'asc'` → `"Số lượt"`, ngược lại `"Điểm"`. Game không xếp hạng: không truyền callback.
  - Test id mới (e2e): `nickname-input`, `nickname-error`, `score-result` (`data-state` ∈ `pending | saved | needs-name | rejected | expired | not-saved | error`, F4 thêm `name-taken`), `score-result-rank`, `score-save`, `score-retry`, `leaderboard`, `leaderboard-row`, `leaderboard-empty`, `leaderboard-error`, `leaderboard-retry`, `unranked-note`. Test id cũ của GameHost giữ nguyên.
- Hệ quả: GameHost vẫn không biết gì về API/token (đúng mô hình tin cậy); trang chơi test được bằng cách mock GameHost. Logic chuẩn hoá nickname bị lặp ở FE và BE (không có package dùng chung) — giữ đồng bộ bằng cùng một bảng ca kiểm thử.
- Bổ sung F4 (ADR-029): `useScoreSession` nhận danh tính (khách + nickname | tài khoản); thêm `data-state="name-taken"`.

### ADR-022: Mật khẩu băm bằng `scrypt` của `node:crypto` (không dependency)
- Bối cảnh: cần lưu mật khẩu an toàn; quy ước không thêm dependency. Node có sẵn `crypto.scrypt` (memory-hard, được OWASP chấp nhận khi không dùng Argon2id). `bcrypt`/`argon2` cần native addon.
- Quyết định:
  - Module thuần `apps/api/src/auth/password.ts`: `hashPassword(pw) → string`, `verifyPassword(pw, stored) → boolean`, `needsRehash(stored) → boolean`. Dùng bản **async** `crypto.scrypt` (thread pool, không chặn event loop).
  - Tham số hiện tại: `N = 2^15 (32768)`, `r = 8`, `p = 1`, `keylen = 32`, salt 16 byte `randomBytes`, `maxmem = 64 MiB` (N·r·128 = 32 MiB vượt mặc định của Node). ~50–100 ms/lần trên máy dev.
  - Định dạng lưu (tự mô tả, nâng cấp được): `scrypt$v=1$n=32768,r=8,p=1$<salt base64url>$<hash base64url>`. `verifyPassword` parse tham số từ chuỗi (từ chối chuỗi sai dạng hoặc tham số ngoài khoảng an toàn: `n` lũy thừa 2 trong 2^14..2^20, `r` 1..16, `p` 1..4 → coi như sai mật khẩu + log `error` không kèm chuỗi), tính lại với `keylen` = độ dài hash lưu, so bằng `timingSafeEqual` (cùng độ dài).
  - Đăng nhập thành công mà `needsRehash` → băm lại bằng tham số hiện tại và cập nhật (không ảnh hưởng response).
  - Chuẩn hoá mật khẩu: chỉ `normalize('NFC')` (gõ tiếng Việt trên các hệ điều hành khác nhau cho ra cùng chuỗi); không trim; 8–128 code point khi đặt mới, 1–128 khi kiểm (đăng nhập, mật khẩu hiện tại). Không quy tắc thành phần (NIST 800-63B); không kiểm danh sách mật khẩu lộ (ngoài phạm vi).
  - Đăng nhập với email không tồn tại vẫn gọi `verifyPassword` với một hash giả cố định (sinh một lần khi khởi động) để thời gian phản hồi tương đương.
  - (Sửa review F4-M1) Tạo phiên sau khi verify mật khẩu: trong transaction, `SELECT password_hash … FOR UPDATE` dòng user và so với hash vừa verify; khác (mật khẩu vừa bị đổi) → không tạo phiên, 401 `INVALID_CREDENTIALS`. Chặn race "đăng nhập bằng mật khẩu cũ trong lúc đổi mật khẩu" để phiên cũ không sống sót. Tương tự (sửa re-review R1), đổi mật khẩu chỉ ghi khi hash hiện tại vẫn bằng hash vừa verify (`UPDATE … WHERE id=$1 AND password_hash=$verified`); hai lần đổi đồng thời cùng mật khẩu cũ → đúng một thành công, bên thua 403 `INVALID_CREDENTIALS`.
  - (Sửa review F4-L2) Hash lưu sai dạng/tham số ngoài khoảng → log `error {event:'password_hash_invalid'}` (không kèm chuỗi). Sai mật khẩu hiện tại khi đổi mật khẩu → log `warn {event:'password_change_failed'}`.
- Hệ quả: không dependency mới; chi phí CPU/bộ nhớ mỗi lần đăng nhập — giới hạn bằng rate limit (ADR-025). Thread pool libuv mặc định 4 luồng × 32 MiB.

### ADR-023: Phiên đăng nhập bằng cookie `httpOnly` + bảng `auth_sessions` (không JWT)
- Bối cảnh: FE và API cùng origin (proxy `/api`); cần đăng xuất/vô hiệu phiên phía server; không muốn token trong JS (`localStorage`) vì XSS.
- Quyết định:
  - Token = 32 byte `randomBytes` base64url (43 ký tự) — dùng lại `generateToken`/`hashToken` của `apps/api/src/sessions/token.ts` (chuyển import, không nhân bản). DB lưu `sha256(token)` trong `auth_sessions.token_hash` (§5.8).
  - Cookie: tên `__Host-qp_sid` khi `COOKIE_SECURE` bật, `qp_sid` khi tắt (§3.1). Thuộc tính: `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` (+ `Secure`); không `Domain`. Xoá: cùng tên/thuộc tính với `Max-Age=0`.
  - Hết hạn **cố định 30 ngày** từ lúc tạo (hằng số `AUTH_SESSION_TTL_MS` trong code). Không trượt (tránh ghi DB mỗi request); người dùng đăng nhập lại sau 30 ngày — chấp nhận.
  - Parse/serialize cookie bằng hàm tự viết `apps/api/src/auth/cookie.ts` (không `@fastify/cookie`): tách header `Cookie` theo `;`, trim, tách tại `=` đầu tiên; tên cần tìm xuất hiện > 1 lần → coi như không có cookie; giá trị không khớp `^[A-Za-z0-9_-]{43}$` → coi như không có (không truy vấn DB). Serialize chỉ nhận giá trị đã biết là base64url.
  - Phân giải người dùng: hàm `resolveAuth(request)` (nhớ kết quả trên request; tối đa một truy vấn `auth_sessions JOIN users … AND expires_at > $now`). Hook `requireUser` (401 `UNAUTHORIZED`) cho `/me*`. Route công khai (`/sessions*`) gọi `resolveAuth` khi cần — **không** chạy cho `GET /games*`.
  - Session fixation: đăng ký, đăng nhập, đổi mật khẩu luôn sinh token **mới**; token cũ trong request (nếu khớp) bị xoá. Server không bao giờ chấp nhận token do client chọn (không có dòng DB tương ứng).
  - Đăng xuất: `DELETE … WHERE token_hash = $1`. Đổi mật khẩu: transaction xoá mọi phiên của user rồi tạo phiên mới cho request hiện tại.
  - `GET /auth/me` với cookie không còn hiệu lực → `{user:null}` + cookie xoá.
  - (Sửa review F4-L3) Đăng xuất là ngoại lệ của quy tắc "trùng tên = không có": lấy mọi giá trị đúng định dạng của cookie phiên (tối đa 3, bỏ trùng) và xoá từng phiên phía server.
  - (Sửa review F4-L4) Khi `cookieSecure` bật, `loadConfig` từ chối cấu hình có hostname của `GAME_ORIGIN` trùng hostname của `WEB_ORIGIN` (cookie không phân biệt cổng → game sẽ nhận cookie của web).
- Hệ quả: một truy vấn có index (`token_hash` unique) cho mỗi request cần danh tính. Phiên hết hạn tích luỹ tới khi có job dọn (index `auth_sessions_expires_idx`); mỗi lần đăng nhập dọn phiên hết hạn của chính user. Dev HTTP dùng cookie không `Secure` (cờ cấu hình), production fail fast nếu cấu hình sai.

### ADR-024: Chống CSRF bằng SameSite=Lax + kiểm `Origin`
- Bối cảnh: cookie được trình duyệt tự gửi → request đổi trạng thái có thể bị site khác kích hoạt (login CSRF, logout CSRF, đổi tên…).
- Quyết định:
  - Lớp 1: `SameSite=Lax` (cookie không gửi kèm POST/fetch cross-site).
  - Lớp 2: hook `onRequest` `requireSameOrigin` (sau rate limit của route): header `Origin` phải **bằng đúng** `WEB_ORIGIN` (so chuỗi sau khi đã chuẩn hoá ở config); thiếu hoặc sai → 403 `FORBIDDEN`. Gắn cho mọi `POST`/`PATCH` dưới `/api/auth/*`, `/api/me*` (kể cả login/register — chống login CSRF). Biến thể `requireSameOriginIfCookie` cho `POST /api/sessions` và `/score`: `Origin` có mà sai → 403; thiếu `Origin` → 403 chỉ khi có cookie đăng nhập (giữ tương thích cho client khách/test không gửi `Origin`).
  - Lớp 3 (đã có): API không bật CORS; parser chỉ nhận `application/json` (form `x-www-form-urlencoded`/`multipart`/`text/plain` → 415), nên request cross-site "đơn giản" không qua được và request JSON cross-site bị chặn ở preflight.
  - Trình duyệt hiện đại gửi `Origin` cho mọi `fetch` POST/PATCH (kể cả cùng origin). Dev qua Vite proxy: `Origin: http://localhost:5173` = `WEB_ORIGIN` mặc định.
  - Không dùng CSRF token (không cần thêm vòng đọc token; `Origin` đủ cho mô hình cùng origin).
- Hệ quả: client không phải trình duyệt (curl, Playwright `request`) phải tự gửi `Origin` khi gọi `/auth/*`, `/me*` hoặc khi có cookie. Production sau reverse proxy phải giữ nguyên header `Origin`.

### ADR-025: Rate limit cho auth và chống dò tài khoản
- Bối cảnh: brute force mật khẩu, credential stuffing, dò email; scrypt tốn CPU nên endpoint auth cũng là bề mặt DoS.
- Quyết định:
  - Bucket mới trong `apps/api/src/rate-limit.ts` (cùng limiter cửa sổ cố định ADR-019, ghi đè được qua `buildApp({rateLimits})`): `authRegister` 10 / 10 phút / IP; `authLogin` 30 / 5 phút / IP; `accountWrite` (`PATCH /me`, `POST /me/password`) 20 / 15 phút / IP; `accountRead` (`GET /me/sessions`, `GET /me/bests`) 120 / phút / IP. `GET /auth/me`, `POST /auth/logout` không rate limit (rẻ, không băm).
  - Bucket theo tài khoản `authLoginAccount` 10 lần thử / 15 phút, khoá = email **đã chuẩn hoá** (kể cả email không tồn tại — hành vi giống nhau), kiểm sau khi validate body, trước khi băm. Helper mới kiểu `createKeyedRateLimit(bucket, config, clock)` → `check(key)` ném 429. Khi bảng khoá **đầy** (sửa review F4-M2 — bản đầu "cho qua" nên tấn công phân tán lấp 10 000 khoá rồi brute force email mục tiêu không giới hạn): khoá **mới** được đếm vào bucket shard `fnv1a(key) mod 1024` với cùng hạn mức (không bao giờ cho qua), khoá đã có vẫn dùng entry riêng, log `warn` một lần/cửa sổ. Bảng khoá của limiter theo khoá mặc định 100 000 entry (~20 MB/limiter) để việc lấp đầy tốn kém; shard là lớp cuối. Đánh đổi: nếu kẻ tấn công vẫn lấp được bảng, email chưa có trong bảng chia nhau hạn mức shard và có thể bị 429 tới 15 phút (khoá đăng nhập diện rộng có giới hạn thời gian) — chấp nhận thay cho brute force không giới hạn.
  - (Sửa review F4-L1) Bucket theo tài khoản `passwordChangeAccount` 10 / 15 phút, khoá = `user.id`, đếm mọi lần gọi `POST /me/password` trước khi băm — chặn dò mật khẩu hiện tại bằng cookie đánh cắp qua nhiều IP.
  - Đăng nhập sai: luôn 401 `INVALID_CREDENTIALS`, message giống nhau, thời gian tương đương (hash giả). Log `warn` `{event:'login_failed', reason:'INVALID_CREDENTIALS'|'RATE_LIMITED'}` (không email, không IP).
  - Đăng ký trùng email: **chấp nhận lộ** bằng 409 `EMAIL_TAKEN` (không có dịch vụ email để gửi "bạn đã có tài khoản"; UX rõ ràng quan trọng hơn) — giới hạn bằng `authRegister`. Ghi rủi ro.
- Hệ quả: hạn mức reset khi restart (ADR-019). Kẻ tấn công có thể khoá đăng nhập của một email trong 15 phút (DoS có giới hạn) — chấp nhận. Dev/e2e dùng chung IP `127.0.0.1`: e2e full-stack phải tiết kiệm số lần đăng ký/đăng nhập (≤ 8 lần đăng ký mỗi 10 phút), kiểm hạn mức IP ở unit test với `rateLimits` ghi đè.

### ADR-026: Danh tính trên leaderboard — tên tài khoản duy nhất, khách không giả được, gộp theo tài khoản
- Bối cảnh: F3 gộp theo `player_key = lower(nickname)`; hai người cùng tên bị gộp và ai cũng nhập được tên người khác. Có tài khoản thì tên phải "của" tài khoản.
- Quyết định:
  - `users.display_name` dùng **đúng** quy tắc chuẩn hoá nickname (ADR-018, hàm `normalizeNickname` hiện có); `display_name_key` (lowercase) **duy nhất** giữa các tài khoản → 409 `NAME_TAKEN` khi đăng ký/đổi tên. Đổi hoa/thường tên của chính mình được phép.
  - Khách nộp điểm với `player_key` trùng `display_name_key` của **bất kỳ** tài khoản nào → 409 `NAME_TAKEN`, phiên giữ `active` (kiểm trước bước xác minh, contract bước 9). Tên khách đã có trong lịch sử trước khi tài khoản đăng ký vẫn ở leaderboard với `isMember:false` (không xoá/không gộp dữ liệu cũ).
  - Khoá gộp mới `rank_key` (cột generated, §5.9): `'u:' || user_id` cho lượt tài khoản, `'g:' || player_key` cho khách. `DISTINCT ON (rank_key)` thay `DISTINCT ON (player_key)` ở leaderboard và `rankOf`; tie-break giữ nguyên (ADR-018).
  - Leaderboard `LEFT JOIN users` để trả `playerName = COALESCE(u.display_name, best.player_name)` và `isMember = user_id IS NOT NULL`. Lịch sử (ADR-028) giữ `player_name` lúc nộp.
  - FE hiển thị huy hiệu "Thành viên" cho `isMember`.
- Phương án đã cân nhắc: chỉ thêm huy hiệu, cho khách trùng tên — bị loại vì bảng vẫn có thể hiện hai "Lan" khó phân biệt và khách vẫn mạo danh được về mặt hiển thị; chặn hoàn toàn mọi tên khách từng dùng — bị loại vì người đăng ký sẽ không lấy được tên mình vẫn dùng khi chơi khách.
- Hệ quả: một người chơi khách trước đây rồi đăng ký cùng tên sẽ thấy hai dòng (khách cũ + thành viên) — chấp nhận, ghi rủi ro; không có "nhận lại" lượt khách (không chứng minh được quyền sở hữu). Kiểm `NAME_TAKEN` cho khách có race nhỏ với đăng ký đồng thời — chấp nhận.

### ADR-027: Phiên chơi gắn tài khoản; quy tắc sở hữu khi nộp điểm
- Bối cảnh: ADR-015 dự trù `user_id`; security.md yêu cầu phiên "thuộc đúng người tạo".
- Quyết định:
  - `POST /sessions` có cookie hợp lệ → `INSERT … user_id = $user`; không có/không hợp lệ → `NULL` (khách). Response không đổi.
  - Nộp điểm: token vẫn bắt buộc (không bỏ ADR-015). Danh tính request = tài khoản (cookie hợp lệ) hoặc khách. Phiên có `user_id` khác danh tính request (kể cả request khách) → 404 `NOT_FOUND`. Phiên khách + request tài khoản → được nộp và gắn `user_id` (người giữ token chính là người tạo; trường hợp đăng nhập giữa ván).
  - Câu `UPDATE` atomic thêm `user_id = COALESCE(user_id, $user)` và điều kiện `AND (user_id IS NULL OR user_id = $user)` (`$user` NULL với khách ⇒ điều kiện thành `user_id IS NULL`).
  - Tài khoản: `player_name`/`player_key` lưu = `display_name`/`display_name_key` lúc nộp; `playerName` trong body bị bỏ qua (không validate). Idempotent: phiên `finished` + cùng `score` + cùng danh tính (cùng `user_id`; hoặc khách cùng tên) → kết quả cũ; khác → 409.
  - `SessionsService.createSession(gameId, userId | null)`, `submitScore({…, identity: {kind:'user', userId, displayName, displayNameKey} | {kind:'guest', playerName, playerKey}})`. Repository thêm `isDisplayNameTaken(key)` (hoặc tương đương) và nhận `userId` ở `create`/`finish`.
  - Log `score_rejected` thêm lý do `NAME_TAKEN`, `FORBIDDEN`; vẫn không log tên/email.
- Hệ quả: đăng xuất ở tab khác giữa ván → nộp điểm 404 → FE hiển thị `not-saved` (chấp nhận). Không có "chuyển" phiên giữa hai tài khoản.

### ADR-028: Lịch sử chơi và kỷ lục cá nhân đọc trực tiếp từ `sessions`
- Bối cảnh: cần lịch sử các lượt đã nộp của chính người dùng và kỷ lục theo game; không muốn bảng tổng hợp riêng.
- Quyết định:
  - `GET /me/sessions`: `SELECT s.id, s.game_id, g.title, r.score_order, s.score, s.duration_ms, s.result, s.ended_at FROM sessions s JOIN games g ON g.id = s.game_id LEFT JOIN game_scoring_rules r ON r.game_id = s.game_id WHERE s.user_id = $1 AND s.status = 'finished' ORDER BY s.ended_at DESC, s.id DESC LIMIT $2 OFFSET $3` + `count(*)` riêng (ADR-002). Parse `page`/`limit` bằng regex chặt như `GET /games` (`limit` tối đa 50). Không trả `reject_reason`, không trả phiên `active`.
  - `GET /me/bests`: với mỗi game có luật, `DISTINCT ON (game_id)` lượt `accepted AND NOT hidden` của user, sắp theo `score_order` của game (hai nhánh SQL cố định cho asc/desc hợp lại bằng `UNION ALL`, hoặc tính ở app — backend chọn, không nối chuỗi từ input) + `plays = count(*)` lượt `finished` của user cho game đó. Sắp `achievedAt DESC, gameId`.
  - `userId` luôn lấy từ phiên đăng nhập, không bao giờ từ request ⇒ không truy cập được lịch sử người khác.
  - Đặt trong module sessions: `apps/api/src/sessions/history.routes.ts` + phương thức mới trên `SessionsRepository` (pg + in-memory).
- Hệ quả: dùng index `sessions_user_history_idx`; kỷ lục tính lại mỗi lần gọi (số game nhỏ — đủ nhanh).

### ADR-029: Frontend — `AuthProvider`/`useAuth`, trang riêng cho đăng nhập/đăng ký, route mới
- Bối cảnh: cần trạng thái đăng nhập dùng chung (header, trang chơi, trang tài khoản) mà không thêm thư viện state/router.
- Quyết định:
  - `apps/web/src/features/auth/AuthProvider.tsx` (React context) bọc `SiteLayout` trong `App.tsx`; hook `useAuth()`:
    `{ status: 'loading'|'anonymous'|'authenticated'; user: User|null; login(email, password): Promise<void>; register({email, password, displayName}): Promise<void>; logout(): Promise<void>; updateDisplayName(name): Promise<User>; changePassword(current, next): Promise<void>; markSignedOut(): void }` — các hàm ném `ApiError` để trang hiển thị lỗi; chỉ gọi `GET /api/auth/me` một lần khi mount. Lỗi mạng/5xx ở `/auth/me` → `anonymous` (không chặn trang).
  - Trang (không dùng modal — có URL, back/forward, e2e đơn giản): `/dang-nhap`, `/dang-ky`, `/ho-so`, `/lich-su`. `parseRoute` thêm `{name:'login'} | {name:'register'} | {name:'profile'} | {name:'history'}` (khớp chính xác, cho phép `/` cuối) — mở rộng ADR-011.
  - Tham số `?next=`: hàm `safeNext(raw)` chỉ nhận path bắt đầu bằng đúng một `/` (không `//`, không `\`, không scheme, không ký tự điều khiển), không trỏ tới `/dang-nhap`/`/dang-ky`; sai → `/` (chống open redirect).
  - `api/client.ts`: thêm `credentials: 'same-origin'` tường minh, `patchJson`, hỗ trợ response 204 (không parse JSON). API mới trong `api/auth.ts`, `api/me.ts`; type trong `api/types.ts`.
  - Header: `apps/web/src/layout/UserMenu.tsx` ở bên phải top bar (sau nút ngẫu nhiên): `anonymous` → link "Đăng nhập"; `authenticated` → nút tên hiển thị mở menu (Hồ sơ, Lịch sử chơi, Đăng xuất; đóng bằng Esc/click ngoài; `aria-expanded`); `loading` → chỗ trống giữ kích thước.
  - Trang chơi: `useScoreSession(game, identity)` với `identity = {kind:'account', displayName} | {kind:'guest', nickname}`; tài khoản → body `{score}`; khách → như F3 + trạng thái `name-taken`. `localStorage['qp:nickname']` chỉ ghi khi nộp bằng tên khách.
  - Không render HTML từ dữ liệu người dùng (tên, email) — chỉ text.
  - Test id (e2e): xem `docs/implementation-plan.md` §F4.
- Hệ quả: không dependency mới. Trạng thái đăng nhập không tự đồng bộ giữa các tab (đăng xuất ở tab A, tab B vẫn hiện tên tới khi gặp 401 hoặc tải lại) — chấp nhận, ghi rủi ro.

### ADR-030: Deploy một VPS bằng Docker Compose, Caddy là cổng duy nhất
- Bối cảnh: Giai đoạn 4 (người dùng đã duyệt): một VPS, Docker Compose, HTTPS tự động. Chưa có tên miền. Một instance API (rate limit in-memory, ADR-019).
- Quyết định:
  - File ở gốc repo backend: `compose.yaml`, `Dockerfile` (multi-stage, target `api` và `games`), `.dockerignore`, `deploy/Caddyfile`, `deploy/web.Dockerfile` (image Caddy chứa bản build FE). Trong monorepo các file nằm cùng đường dẫn rồi được chép sang `play-sprint-be` (ADR-037).
  - Service: `db` (`postgres:17-alpine`, volume `pgdata`, healthcheck `pg_isready`), `migrate` (one-shot, image api, ADR-034), `seed` (one-shot, profile `tools`, ADR-034), `api` (image api, `node dist/server.js` — dùng script `start`/`build` đã có), `games` (image games, `node src/server.ts` — giống script `start` hiện có, games không có dependency), `caddy` (image build từ `deploy/web.Dockerfile`, cổng `80`, `443`, `443/udp`).
  - Mạng: `backend` (`internal: true`: `db`, `migrate`, `seed`, `api`) và `edge` (`api`, `games`, `caddy`). Chỉ `caddy` publish cổng; `db` không với tới được từ `caddy`/`games` và không ra Internet.
  - Healthcheck bằng `node -e "fetch(…)"` (image slim không có curl): api `GET http://127.0.0.1:3000/api/health`, games `GET http://127.0.0.1:5174/sdk/config.js`. `api` chờ `db` healthy + `migrate` `service_completed_successfully`; `caddy` **không** `depends_on` (cập nhật khi hiện thực): migrate lỗi thì site tĩnh vẫn phục vụ, `/api` trả 502.
  - Hardening container app: `user: node`, `read_only: true`, `tmpfs: /tmp`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `restart: unless-stopped`, `init: true`; log driver `json-file` `max-size: 10m`, `max-file: 3` cho mọi service. Caddy giữ user mặc định của image (cần bind 80/443) + `no-new-privileges`; volume `caddy_data` (chứng chỉ, khoá ACME) và `caddy_config`.
  - Secret: chỉ `POSTGRES_PASSWORD` (trong `.env` cạnh `compose.yaml`, không commit, không bake vào image). `DATABASE_URL=postgres://qp:${POSTGRES_PASSWORD}@db:5432/quick_playing` dựng trong compose (mật khẩu phải URL-safe). Không dùng Docker secrets vì app chỉ đọc `DATABASE_URL` từ env (giữ đơn giản; ghi rủi ro).
  - Biến bắt buộc dùng cú pháp `${VAR:?thông báo}` để `docker compose config/up` dừng ngay nếu thiếu.
  - Cập nhật: `git pull` (hai repo) → `docker compose up -d --build`. Có downtime vài giây khi container `api` được tạo lại — chấp nhận ở quy mô hiện tại. Migration vì vậy phải tương thích với bản API cũ trong khoảng ngắn đó (ADR-006 đã forward-only).
- Phương án đã cân nhắc: Nginx + certbot (thêm cron gia hạn, cấu hình dài hơn); Caddy phục vụ cả game bằng `file_server` (xem ADR-032); PaaS (người dùng đã chọn VPS).
- Hệ quả: không thêm dependency npm. Một điểm lỗi (một VPS) — chấp nhận. Backup DB chưa tự động (runbook `docs/deployment.md` hướng dẫn `pg_dump`), ghi rủi ro.

### ADR-031: Tên miền, origin và proxy trong production
- Bối cảnh: game phải ở site khác web (ADR-010, F4 §6). Cookie `__Host-qp_sid` là host-only (không `Domain`), `Secure`, `Path=/`. API kiểm `Origin = WEB_ORIGIN` (ADR-024), rate limit theo IP (ADR-019).
- Quyết định:
  - Hai biến `WEB_DOMAIN`, `GAMES_DOMAIN` (hostname). **Khuyến nghị tên miền đăng ký khác hẳn** (vd. `playsprint.com` và `playsprint-games.net`): game ở *site* khác nên (1) trình duyệt cô lập tiến trình theo site (Site Isolation — chống Spectre đọc bộ nhớ trang web), (2) mọi request từ game tới web là cross-site nên `SameSite=Lax` có hiệu lực đầy đủ. **Subdomain** (`games.example.com` cạnh `example.com`) vẫn được chấp nhận (config chỉ từ chối hostname trùng — ADR-023 L4): cookie `__Host-` không bị gửi/ghi đè từ subdomain và tài liệu game luôn có origin opaque (`sandbox`), nhưng mất (1) và (2) — rủi ro còn lại ghi trong kế hoạch.
  - Web và API **cùng origin** `https://${WEB_DOMAIN}`: Caddy phục vụ build tĩnh của FE và `reverse_proxy /api/*` → `api:3000`. Không bật CORS (ADR-007). Caddy giữ nguyên header `Origin` và `Host` (mặc định của `reverse_proxy`).
  - `TRUST_PROXY=1`: Caddy là hop duy nhất. Caddy **không** cấu hình `trusted_proxies` nên luôn ghi `X-Forwarded-For` mới bằng IP client thật (bỏ giá trị client gửi) → API lấy đúng IP, không giả mạo được. Cổng 3000 không publish nên không ai gọi API trực tiếp vượt Caddy. Nếu sau này đặt CDN (Cloudflare…) phía trước thì phải đổi (`trusted_proxies` ở Caddy + số hop) — ADR mới.
  - `COOKIE_SECURE=true` tường minh (config cũng tự suy từ `WEB_ORIGIN` https). App nói HTTP với Caddy nhưng thuộc tính cookie không phụ thuộc giao thức nội bộ.
  - `Referrer-Policy` của web là `same-origin` (không dùng `no-referrer`: với request không ở mode `cors` — vd. form POST — trình duyệt gửi `Origin: null` và kiểm CSRF sẽ trả 403; FE hiện chỉ dùng `fetch` nên không bị, nhưng tránh bẫy).
- Hệ quả: một bộ biến tên miền sinh ra mọi origin (ADR-030), `VITE_GAME_ORIGIN` luôn khớp `GAME_ORIGIN`. Kiểm thử cục bộ dùng `WEB_DOMAIN=web.localhost`, `GAMES_DOMAIN=games.localhost` (Caddy tự cấp chứng chỉ nội bộ cho `*.localhost`, Chromium phân giải `*.localhost` về 127.0.0.1).

### ADR-032: Header bảo mật production — web ở Caddy, API ở app, game ở games server
- Bối cảnh: ADR-013 để CSP production cho reverse proxy. Games server đã tự đặt CSP (có `sandbox allow-scripts`, `frame-ancestors WEB_ORIGIN`), `nosniff`, `Referrer-Policy`, sinh động `/sdk/config.js` và có bộ lọc path đã test (ADR-010). Quy ước: không thêm dependency khi tự đặt được vài header (không `@fastify/helmet`).
- Quyết định — nguyên tắc: header gắn với **nội dung** đặt ở nơi sinh ra nội dung (test được bằng unit test, giống nhau ở dev/e2e/prod); header gắn với **transport** (HSTS) và nội dung tĩnh không có server ứng dụng (build FE) đặt ở Caddy.
  - **Games** (`https://${GAMES_DOMAIN}`): Caddy `reverse_proxy games:5174` (không dùng `file_server`): giữ nguyên CSP/`nosniff`/`Referrer-Policy`/`Cache-Control`, `/sdk/config.js` động, 405 cho method khác, chặn dotfile/traversal, whitelist phần mở rộng — viết lại các quy tắc này bằng Caddyfile sẽ nhân bản logic và dễ lệch; chi phí là một container Node nhỏ. Caddy chỉ thêm `Strict-Transport-Security` và bỏ `Server`. **Không** đặt `X-Frame-Options`, COEP, CORP, COOP cho games (game bị nhúng; CORP/COEP chặn tài nguyên của tài liệu origin opaque — ADR-010). CSP production của game (do `buildCsp` sinh, không đổi code):
    `default-src 'none'; script-src 'self' https://<GAMES_DOMAIN>; style-src 'self' https://<GAMES_DOMAIN> 'unsafe-inline'; img-src 'self' https://<GAMES_DOMAIN>; font-src 'self' https://<GAMES_DOMAIN>; media-src 'self' https://<GAMES_DOMAIN>; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors https://<WEB_DOMAIN>; sandbox allow-scripts`
  - **Web tĩnh** (`https://${WEB_DOMAIN}`, mọi path trừ `/api/*`), đặt ở Caddy:
    - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self'; frame-src https://<GAMES_DOMAIN>; worker-src 'none'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`
      (build Vite không có inline script/style; React gán `style` qua CSSOM nên không cần `'unsafe-inline'`; `data:` cho ảnh nhỏ Vite có thể inline. Nếu kiểm thử phát hiện vi phạm thì sửa FE trước, chỉ nới CSP khi có lý do ghi vào ADR.)
    - `Strict-Transport-Security: max-age=31536000` (không `includeSubDomains`/`preload` tới khi người dùng xác nhận tên miền — câu hỏi mở)
    - `X-Content-Type-Options: nosniff`; `X-Frame-Options: DENY` (trình duyệt cũ; trùng ý `frame-ancestors 'none'`); `Referrer-Policy: same-origin` (ADR-031)
    - `Permissions-Policy: accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()`
    - `Cross-Origin-Opener-Policy: same-origin`; `Cross-Origin-Resource-Policy: same-origin`. **Không** COEP (sẽ chặn iframe game).
    - Cache: `/assets/*` (tên có hash) `public, max-age=31536000, immutable` và **không** SPA fallback (file thiếu → 404, tránh cache vĩnh viễn `index.html` dưới tên `.js`); `/thumbnails/*` `public, max-age=86400`; còn lại `try_files {path} /index.html` + `Cache-Control: no-cache`.
    - Bỏ header `Server`.
  - **API** (`/api/*`), đặt ở app (`apps/api/src/security-headers.ts`, hook `onSend` cho **mọi** response kể cả 4xx/5xx/404/429): `X-Content-Type-Options: nosniff`; `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`; `Cross-Origin-Resource-Policy: same-origin`; `Referrer-Policy: no-referrer`; `Cache-Control: no-store` nếu route chưa đặt `Cache-Control` (dữ liệu API đều động; `/auth/*`, `/me*` vẫn `no-store` như ADR-023). Caddy chỉ thêm HSTS và bỏ `Server` cho `/api/*` — **không** áp header web lên `/api/*` (tránh trùng/ghi đè CSP của API). Không HSTS ở app (app chạy HTTP sau proxy).
  - Dev/preview giữ nguyên CSP tối thiểu trong `vite.config.ts` của FE (ADR-013).
- Hệ quả: không dependency mới; ba nơi đặt header nhưng mỗi nơi có trách nhiệm rõ và có kiểm thử (unit cho API/games, e2e production smoke cho web). Đổi CSP web cần sửa `deploy/Caddyfile` ở repo backend dù nội dung thuộc FE — ghi trong runbook; khi FE thêm tài nguyên mới (font, ảnh ngoài) phải cập nhật CSP cùng lúc.

### ADR-033: Build web trong compose từ repo FE (named build context)
- Bối cảnh: FE đã là repo riêng `play-sprint`; `VITE_GAME_ORIGIN` là biến **build-time**; Caddy cần bản build tĩnh. Muốn không cần registry ở giai đoạn này.
- Quyết định:
  - `caddy.build`: `context: ./deploy`, `dockerfile: web.Dockerfile`, `additional_contexts: { fe: ${FE_PATH:-../play-sprint} }`, `args: { VITE_GAME_ORIGIN: https://${GAMES_DOMAIN} }`.
  - `deploy/web.Dockerfile`: stage `fe-build` (`node:24-bookworm-slim`, cài pnpm đúng phiên bản `packageManager`) `COPY --from=fe` **chỉ** `package.json`, `pnpm-lock.yaml`, `index.html`, `vite.config.ts`, `tsconfig.json`, `src/`, `public/` (không bao giờ chép `.env*`, `node_modules`) → `pnpm install --frozen-lockfile` → kiểm `VITE_GAME_ORIGIN` khác rỗng (rỗng → build fail) → `pnpm build`. Stage cuối `caddy:2-alpine`: `COPY Caddyfile /etc/caddy/Caddyfile`, `COPY --from=fe-build /fe/dist /srv/web`.
  - `FE_PATH` nhận đường dẫn local (mặc định, VPS clone hai repo cạnh nhau) hoặc git URL BuildKit hỗ trợ (vd. `https://github.com/dangthais/play-sprint.git#<tag>`) — production **nên** ghim tag/commit để build lặp lại được.
- Phương án tốt hơn về lâu dài (chưa làm): CI của repo FE build và đẩy image/artefact `dist` lên GHCR, compose BE chỉ kéo theo tag (`WEB_IMAGE`), tách nhịp phát hành FE/BE; hoặc FE đọc origin game lúc chạy (`/config.js` do Caddy sinh) để bỏ phụ thuộc build-time. Cần thay đổi repo FE + registry → để sau.
- Hệ quả: deploy cần mã FE trên VPS (hoặc quyền đọc repo FE qua git). Repo FE nên thêm `.dockerignore` (`node_modules`, `dist`, `.env*`) để giảm dữ liệu gửi vào build (không bắt buộc cho tính đúng vì `COPY` tường minh).

### ADR-034: Migrate tự động mỗi lần deploy, seed thủ công
- Bối cảnh: runner migration có advisory lock, forward-only, idempotent (ADR-006). Seed upsert 5 game + luật điểm (ADR-014/016) và **ghi đè** luật trong DB bằng giá trị trong code.
- Quyết định:
  - Service `migrate`: image api, `command: ["node", "dist/db/migrate.js"]`, `restart: "no"`, chạy mỗi lần `docker compose up`; `api` chỉ khởi động khi `migrate` thoát 0 (`service_completed_successfully`). Migration lỗi → `api` không lên (bản cũ đã bị dừng → downtime; runbook hướng dẫn xem log `docker compose logs migrate`).
  - Service `seed`: image api, `command: ["node", "dist/db/seed.js"]`, `profiles: ["tools"]`, chạy tay `docker compose run --rm seed` lần đầu và khi catalog/luật điểm trong code đổi. Không tự chạy mỗi deploy để không âm thầm ghi đè chỉnh tay luật điểm trong DB.
- Hệ quả: lần deploy đầu cần thêm một lệnh seed (runbook). Không cần thay đổi code migrate/seed.

### ADR-035: Job dọn phiên — chạy trong process API (advisory lock) + lệnh CLI; chỉ xoá dữ liệu không ai nhìn thấy
- Bối cảnh: phiên chơi bỏ dở tích luỹ (mỗi lượt mở trang game xếp hạng tạo phiên, ADR-017); `auth_sessions` hết hạn tích luỹ (ADR-023). Index đã có: `sessions_active_expires_idx (expires_at) WHERE status='active'`, `auth_sessions_expires_idx (expires_at)`. Không được xoá lịch sử/điểm đã nộp.
- Phân tích dữ liệu (theo migration 002/003 và repository):
  - `sessions` `status='active'` và `expires_at` đã qua: không thể nộp điểm (`UPDATE … AND expires_at > $now`), không xuất hiện ở leaderboard (`result='accepted'`), lịch sử (`status='finished'`), kỷ lục (`accepted`/`finished`). Không bảng nào tham chiếu `sessions`. ⇒ **xoá an toàn**.
  - `sessions` `status='finished'` (accepted hoặc rejected, khách hoặc tài khoản): là leaderboard, lịch sử `/me/sessions` (kể cả lượt rejected), kỷ lục, và dữ liệu phân tích gian lận ⇒ **không xoá, không đánh dấu** (không đổi schema). Chính sách retention cho lượt rejected của khách là câu hỏi mở.
  - `auth_sessions` `expires_at <= now`: `resolve` đã loại (`expires_at > $now`); `GET /auth/me` với cookie không khớp dòng nào vẫn trả `{user:null}` + xoá cookie (như cookie hết hạn) ⇒ **xoá an toàn**, không đổi hành vi.
- Quyết định:
  - Module `apps/api/src/db/cleanup.ts` (cùng chỗ với `migrate.ts`/`seed.ts`; SQL có tham số, không nối chuỗi):
    - `runCleanup(pool, { now: Date, batchSize?: number /* 1000 */, maxBatches?: number /* 100 */ }) → Promise<{ skipped: boolean; playSessionsDeleted: number; authSessionsDeleted: number }>`.
    - Lấy một client riêng, `SELECT pg_try_advisory_lock($1)` với khoá `CLEANUP_LOCK_KEY = 7_420_310_002` (khác khoá migrate); không lấy được → `{ skipped: true, … 0 }`. Mở khoá + release trong `finally`.
    - Lặp tới khi một lô xoá < `batchSize` hoặc đủ `maxBatches`:
      `DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE status = 'active' AND expires_at < $1 ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED)` với `$1 = now − ACTIVE_SESSION_GRACE_MS` (24 h — biên cho lệch đồng hồ app/DB và điều tra sự cố gần đây).
      `DELETE FROM auth_sessions WHERE id IN (SELECT id FROM auth_sessions WHERE expires_at <= $1 ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED)` với `$1 = now`.
      Mỗi lô là một câu lệnh autocommit (khoá ngắn).
    - `now` lấy từ đồng hồ app (`clock()`), nhất quán với cách ghi `expires_at` (ADR-017).
    - `startCleanupScheduler({ pool, intervalMs, clock, log, initialDelayMs? /* 60 000 */ }) → { stop(): Promise<void> }`: chạy lần đầu sau `initialDelayMs`, sau đó mỗi `intervalMs`; timer `unref()`; không chạy chồng (cờ `running`); lỗi → `log.warn({ event: 'cleanup_failed', err })` (serializer an toàn), không throw; xong → `log.info({ event: 'cleanup', playSessionsDeleted, authSessionsDeleted })` chỉ khi có xoá hoặc ở mức debug; không log id/token/user. `stop()` huỷ timer và chờ lượt đang chạy xong.
    - CLI (`import.meta.main`, giống `migrate.ts`): thiếu `DATABASE_URL` → stderr + exit 1; chạy `runCleanup` một lần, in số dòng đã xoá, lỗi → exit 1 (message không chứa chuỗi kết nối).
  - `server.ts`: nếu có `pool` và `config.cleanupIntervalMinutes > 0` → `startCleanupScheduler`; khi shutdown gọi `stop()` **trước** `pool.end()`.
  - `config.ts`: `cleanupIntervalMinutes` từ `CLEANUP_INTERVAL_MINUTES` (rỗng/thiếu → 60; regex `^[0-9]+$`, 0..1440; sai → throw).
  - Script `db:cleanup` (`apps/api/package.json`: `node --env-file-if-exists=../../.env src/db/cleanup.ts`; root: `pnpm --filter @qp/api run db:cleanup`). Trong container: `docker compose exec api node dist/db/cleanup.js`.
- Phương án đã cân nhắc: cron trên host + `docker compose run --rm` (thêm cấu hình ngoài repo, dễ quên khi chuyển máy); service compose riêng chạy vòng lặp `sleep` (thêm container cho việc vài giây/giờ). Chọn in-process vì không thêm thành phần vận hành; advisory lock giữ đúng khi sau này chạy nhiều instance; CLI cho chạy tay/khẩn cấp. Đánh đổi: process API làm thêm việc DB nhỏ, theo lô.
- Hệ quả: không migration mới (index đã có). Dữ liệu `finished` tăng mãi — theo dõi; retention là quyết định sản phẩm sau này.

### ADR-036: CI GitHub Actions cho repo backend
- Bối cảnh: chưa có CI (Giai đoạn 0). Test pg cần PostgreSQL (`TEST_DATABASE_URL`), tự tạo schema tạm.
- Quyết định: `.github/workflows/ci.yml`, trigger `push` lên `main` và `pull_request`; `permissions: contents: read`; `concurrency` huỷ lượt cũ cùng ref.
  - Job `check` (`ubuntu-latest`, `timeout-minutes: 15`): service `postgres:17` (user/password/db chỉ dùng cho CI, không phải secret, healthcheck `pg_isready`), env `TEST_DATABASE_URL=postgres://qp:qp_ci@localhost:5432/qp_test`; bước: `actions/checkout@v5` → `pnpm/action-setup@v4` (đọc `packageManager`) → `actions/setup-node@v5` (`node-version-file: .nvmrc`, `cache: pnpm`) → `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build`.
  - Job `docker` (`needs: check`): `docker/setup-buildx-action@v3` + `docker/build-push-action@v6` cho target `api` và `games`, `push: false`, cache `type=gha`. Không build image web (cần repo FE).
  - Không dùng secret nào. Có thể ghim action theo commit SHA (khuyến nghị khi repo công khai).
  - Cùng một file chạy được ở monorepo (script gốc giống nhau) để kiểm tra trước khi tách.
- Hệ quả: test pg thực sự chạy trên CI (log không còn `[skip] TEST_DATABASE_URL`). E2E full-stack (Playwright) ở lại monorepo, không chạy trên CI backend.

### ADR-037: Tách repo backend `play-sprint-be`
- Bối cảnh: FE đã tách thành `../play-sprint` (contract trong FE là bản sao). Người dùng yêu cầu repo backend `dangthais/play-sprint-be` tại `../play-sprint-be`.
- Quyết định:
  - Nội dung: workspace pnpm `apps/api`, `apps/games`; `docs/` (`architecture.md`, `implementation-plan.md`, `api-contract.yaml` — **nguồn sự thật**, `game-protocol.md`, `deployment.md`); `compose.yaml`, `Dockerfile`, `.dockerignore`, `deploy/`; `.github/workflows/ci.yml`; config gốc (`package.json`, `pnpm-workspace.yaml`, lockfile sinh lại, `tsconfig.base.json`, `eslint.config.js`, Prettier, `.nvmrc`, `.gitignore`, `.gitattributes`, `.env.example`); `README.md`, `CLAUDE.md` chỉnh cho repo BE.
  - Bỏ khỏi repo BE: `apps/web`, `tests/`, `playwright.config.ts`, devDependency chỉ dành cho web/e2e (`@playwright/test`, `eslint-plugin-react-hooks`, `vite` nếu không còn ai dùng trực tiếp…); script gốc `typecheck` bỏ `tsc -p tests`, bỏ `test:e2e`; ESLint/Prettier bỏ cấu hình riêng cho `apps/web`.
  - E2E full-stack ở lại monorepo. Đổi contract: sửa ở repo BE trước rồi chép sang FE (README FE đã ghi).
  - Tách bằng sao chép file (không giữ lịch sử git — monorepo mới có 2 commit, lịch sử vẫn còn ở monorepo); `git init`; commit/push chỉ khi người dùng yêu cầu.
- Hệ quả: ba nơi có mã (monorepo, FE, BE) — nguy cơ lệch; cần quyết định monorepo còn vai trò gì sau khi tách (câu hỏi mở).

### ADR-038: F5 — thêm 20 game từ cùng repo upstream; tên trung tính, khoá độ khó cho game xếp hạng, mẫu tích hợp chung
- Bối cảnh: người dùng duyệt thêm 20 game (tổng 25) từ `he-is-talha/html-css-javascript-games` @ `aafbeac2…` (MIT, cùng giấy phép đã có). 45 thư mục còn lại khác nhau rất nhiều: một số phụ thuộc CDN/thư viện (three.js, GSAP, jQuery), API mạng, microphone, ảnh ngoài; nhiều game "thế hệ mới" của repo có màn chọn độ khó (Easy/Medium/Hard) và màn Start; một số là cờ bạc hoặc không phải game. Catalog chỉ có một leaderboard mỗi game (`game_scoring_rules` theo `game_id`).
- Quyết định:
  - **Chọn 20 game** theo bảng ở `docs/implementation-plan.md` mục F5 (15 xếp hạng, 5 không xếp hạng). Loại: CDN/thư viện ngoài không gỡ được, `fetch` ra mạng, Web Speech, cờ bạc (Blackjack, Poker), simulator/không kết thúc, trùng thể loại, ảnh thương hiệu/bản quyền. Có danh sách dự phòng.
  - **Tên/`id` trung tính** (Maze Chomp, Block Drop, Sky Hop, Space Shooter, Asteroid Blaster, Frog Crossing, Mole Smash, Code Breaker, Word Guess, Sea Battle…), như Brick Breaker/Merge 2048 đã làm — tránh tên thương hiệu đã đăng ký. Dùng lại `id` của catalog mẫu F1 khi trùng thể loại (`block-drop`, `minesweeper`, `sudoku`, `space-shooter`, `solitaire`, `bubble-pop`, `sliding-puzzle`, `simon-says`, `typing-race`) để DB dev còn dòng F1 được upsert thành game thật.
  - **Game xếp hạng có nhiều độ khó → khoá một mức** (thường Medium; `sliding-puzzle` Easy 3×3), ẩn màn chọn mức/nút đổi mức và các trợ giúp làm lệch điểm (gợi ý của `word-guess`). Lý do: một leaderboard phải so sánh cùng luật; leaderboard theo độ khó cần đổi schema (ngoài phạm vi). Game không xếp hạng giữ nguyên lựa chọn.
  - **Game không có điểm có ý nghĩa** (cờ vua/đam vs máy hoặc hai người, Sudoku có 3 kích thước, Solitaire, Sea Battle) → không xếp hạng, `QP.gameOver(0)` như tic-tac-toe.
  - **Game `asc` có thể thua** (`word-guess`, `code-breaker`): thua gửi `maxGuesses + 1` (luôn kém mọi ván thắng) thay vì không gửi `gameOver` (host kẹt ở `playing`) hay gửi 0 (sẽ là điểm tốt nhất).
  - **Điểm trần thấp / hoà nhiều** (`minesweeper` 54, `reversi` 64, `mole-smash`, game `asc`): dùng sẵn quy tắc hoà của leaderboard (thời lượng ngắn hơn đứng trước, ADR-018/026) — không thêm cơ chế "điểm = thời gian".
  - **Mẫu tích hợp chung** (bổ sung ADR-009, chi tiết ở plan F5): bỏ tài nguyên ngoài; thay `alert`/`history.go`/handler inline bằng DOM API; bọc/bỏ `localStorage`; `QP.ready()` khi tải trang **không cần thao tác** (host chờ tối đa 15 s) và khi bắt đầu ván mới sau ván trước, không gọi lại ở lần bấm Start đầu tiên; `QP.gameOver` đúng một lần mỗi ván; game không có nút chơi lại được thêm lớp phủ "Chơi lại" (`location.reload()`); sửa lỗi upstream chặn việc chơi (vd. `missedColor` của Simon, cấp 11 của Block Drop). Thumbnail: 20 SVG mới theo phong cách 5 thumbnail hiện có (ghi đè 9 file F1 cùng tên).
  - Không đổi giao thức (v1), SDK, games server, `GameHost`, schema DB, schema API; contract chỉ tăng patch (0.5.2) cho mô tả/ví dụ.
- Hệ quả: catalog 25 game (3 trang ở trang chủ, `PAGE_SIZE = 12`) không cần đổi mã FE/BE ngoài seed. Người chơi mất lựa chọn độ khó ở game xếp hạng. Lượng mã vendored tăng nhiều → review và cập nhật upstream tốn công hơn (ánh xạ trong `apps/games/UPSTREAM.md`). Một số game chỉ chơi bằng bàn phím. Game có màn Start tạo phiên ngay khi tải trang → thêm phiên bỏ dở (job dọn ADR-035).

### ADR-039: Luật điểm cho 15 game xếp hạng F5 (mở rộng ADR-016)
- Bối cảnh: cùng mô hình ADR-016 (`min/max`, `min_duration_ms`, `score_slack + max_score_per_sec × giây`, `min_ms_per_score`); `durationMs` do server đo từ lúc tạo phiên (ngay sau `ready` khi tải trang) nên luôn ≥ thời gian chơi thật trừ khoảng một RTT.
- Quyết định (giá trị ở bảng §5.5; suy từ mã upstream, chưa đo thực tế):
  - `maze-chomp`: bản đồ có 360 viên (10) + 4 viên lớn (50) ⇒ tối đa 3800, ăn hết là kết thúc. Pac-Man đi 8 ô/s (theo `delta`, không phụ thuộc tần số quét) ⇒ ≤ 80 điểm/s + viên lớn ⇒ trần `200 + 90 × giây`. Số viên do T2 kiểm lại.
  - `sky-hop`: mỗi cú nảy lên tối đa `12²/(2·0,45) = 160 px` trong ~27 khung ⇒ ≤ ~0,75 điểm/khung (45/s ở 60 Hz, ~108/s ở 144 Hz, ~180/s ở 240 Hz — vật lý theo khung hình). Trần `100 + 200 × giây` (nới ở T8 cho màn hình tần số quét cao); tối đa 1 000 000.
  - `block-drop`: điểm/giây tăng theo cấp (≤ ~42 × cấp khi thả liên tục), cấp chỉ tăng khi điểm vượt `1000 × 2^(cấp−1)` nên trung bình cả ván thấp. Trần `500 + 250 × giây`; tối đa 1 000 000.
  - `space-shooter` (Medium): 10 điểm/alien, hồi chiêu 12 khung ⇒ ≤ 50/s ở 60 Hz, 120/s ở 144 Hz, 200/s ở 240 Hz nếu trúng mọi phát (theo khung hình). Trần `100 + 200 × giây` (nới ở T8: giá trị 60 ban đầu từ chối nhầm người chơi màn hình ≥ 120 Hz); tối đa 100 000.
  - `asteroid-blaster` (Medium, theo `delta`): 5 đợt × (4..8 đá lớn × 520 điểm) = 15 600 + UFO 200 (xuất hiện từ đợt 3, có thể "cày"). Hồi chiêu 180 ms ⇒ ≤ ~1100/s tức thời; người chơi giỏi ~140/s. Trần `2000 + 300 × giây`; tối đa 200 000.
  - `frog-crossing` (Medium): mỗi chuyến ≤ 12 hàng × 10 + 200 + 10 × 35 s = 670, ≥ 12 bước × 160 ms; 5 tổ + 1000 + điểm hàng làm lại sau khi chết ⇒ ≤ ~4600. Tối đa 5000; trần `2500 + 150 × giây` (slack nâng từ 1700 ở T8 theo review: 5 chuyến ~3 s mỗi chuyến có thể đạt ~4200 ở 15 s).
  - `bubble-pop` (Medium): tổng bóng từng có = 38 ban đầu + số phát bắn, mỗi bóng ≤ 15 điểm; mỗi phát bay ≥ ~0,25 s (240 Hz) ⇒ trần `600 + 60 × giây`.
  - `mole-smash`: ván cố định 10 s sau khi bấm Start; mỗi lần trồi 200–1000 ms ⇒ ≤ 50. `min_duration_ms = 9500` (chừa RTT).
  - `typing-race` (Medium): bắt đầu 10 s, mỗi từ đúng +3 s rồi trừ ngay 1 s ⇒ ván kéo dài đúng `10 + 2 × số từ` giây ⇒ `min_duration_ms = 9000`, `min_ms_per_score = 1900`.
  - `simon-says`: cấp n tốn ≥ 600·n ms phát chuỗi + 3 s chờ giữa cấp ⇒ `min_ms_per_score = 3000` (cận dưới tuyến tính); tối đa 200.
  - `minesweeper`: 8×8, 10 mìn ⇒ 0..54; mở loang nên không giới hạn tốc độ; `min_duration_ms = 3000`.
  - `sliding-puzzle` (3×3, asc): ≥ 1 bước, mỗi bước là một cú nhấp ⇒ `min_duration_ms = 2000`, 100 ms/bước.
  - `code-breaker` (asc, 1..11): mỗi lượt ≥ 5 cú nhấp ⇒ 3000 + 2000 ms/lượt. `word-guess` (asc, 1..7): mỗi lượt gõ 5 chữ + Enter ⇒ 3000 + 1500 ms/lượt.
  - `reversi` (Medium): 0..64; AI chờ 400 ms mỗi nước. Ván có thể kết thúc sớm khi một bên bị xoá sạch quân (ván ngắn nhất ~9 nước), nên `min_duration_ms = 3000` (hạ từ 8000 ở T8 để không từ chối nhầm ván thắng/thua nhanh).
- Hệ quả: như ADR-016 — ngưỡng chỉ giới hạn thiệt hại; game `asc` và game trần thấp vẫn bị nộp "điểm tốt nhất ở thời lượng tối thiểu". Game vật lý theo khung hình (`sky-hop`, `space-shooter`, `bubble-pop`) có thể bị từ chối nhầm trên màn hình > 144 Hz. Nếu T2–T4 báo hằng số khác giả định, session chính sửa seed + bảng §5.5 (upsert, không cần migration). Theo dõi log `score_rejected` theo `reason` để nới/siết.
