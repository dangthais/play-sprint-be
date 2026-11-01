# Play Sprint — Backend

Backend của nền tảng chơi game nhanh trên web, gồm API (game, session, điểm số, leaderboard, tài khoản), games server phục vụ game bên thứ ba ở origin riêng, và cấu hình deploy production. Frontend nằm ở repo `play-sprint` (chạy cạnh repo này, `../play-sprint`).

## Tài liệu (nguồn sự thật)
- `docs/architecture.md`: thành phần, luồng dữ liệu, ADR
- `docs/implementation-plan.md`: giai đoạn, nhiệm vụ, tiến độ
- `docs/api-contract.yaml`: hợp đồng API FE ↔ BE (OpenAPI 3.1). **Sửa contract trước, code sau**, rồi chép sang repo FE.
- `docs/game-protocol.md`: giao thức postMessage giữa game và host
- `docs/deployment.md`: runbook production

## Tech stack & lệnh
Monorepo **pnpm** (workspace `apps/*`), **Node 24** (`.nvmrc`), TypeScript 6.0 (strict).
- `apps/api` (`@qp/api`): **Fastify 5** + **PostgreSQL** qua `pg` (SQL có tham số, không ORM). Node 24 chạy `.ts` trực tiếp (type stripping): chỉ dùng cú pháp TS xoá được (không `enum`/`namespace`/parameter properties), import tương đối ghi đuôi `.ts`. Prefix route `/api`.
- `apps/games` (`@qp/games`): server tĩnh `node:http` phục vụ game vendored (MIT, `apps/games/UPSTREAM.md`) và game SDK ở origin riêng `GAME_ORIGIN` (:5174). Mã trong `apps/games/public/games/**` là mã vendored: ESLint/Prettier bỏ qua, chỉ chỉnh tối thiểu và ghi "Modified for Quick Playing".
- Test: **Vitest** (đặt cạnh code `*.test.ts`). Test cần DB dùng `TEST_DATABASE_URL`; nếu biến này không có thì test DB phải `skip` có thông báo, không fail.
- Lint/format: **ESLint** (flat config) + **Prettier**.
- Production: `compose.yaml`, `Dockerfile` (target `api`, `games`), `deploy/` (Caddyfile, image web build từ repo FE). CI: `.github/workflows/ci.yml`.
- Env: đọc từ `.env` ở thư mục gốc (Node `--env-file-if-exists`, Vitest `loadEnv`).

| Việc | Lệnh |
|---|---|
| Cài đặt | `pnpm install` |
| Dev | `pnpm dev` (api :3000, games :5174) |
| Migrate / seed / dọn phiên | `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:cleanup` (cần `DATABASE_URL`) |
| Test | `pnpm test` |
| Lint / type-check | `pnpm lint`, `pnpm typecheck` |
| Build | `pnpm build` |

## Quy ước
- Làm theo pattern và cấu trúc đang có trong code.
- Commit message dùng Conventional Commits. Không tạo commit trừ khi người dùng yêu cầu.
- Secret chỉ đặt trong `.env` (không commit); khi thêm biến mới thì cập nhật `.env.example`.
- Contract: `info.version` theo semver; giá trị `Error.code` phải được liệt kê trong mô tả schema `Error`.

## Bảo mật
- Client và game đều không đáng tin: mọi input validate ở backend; SQL có tham số; lỗi luôn có dạng `{ code, message }`, không lộ stack trace.
- Điểm số: server xác minh session tồn tại, `active`, đúng người tạo, nộp một lần (atomic), thời lượng và điểm hợp lý; lần nộp bị từ chối được ghi log (không ghi dữ liệu nhạy cảm).
- Không ghi log hay đưa secret vào report. Không đọc file `.env*` (trừ `.env.example`).
- Không push, deploy, đụng production hay chạy thao tác phá huỷ DB/file khi chưa được người dùng cho phép rõ ràng.
