# Play Sprint — Backend

Backend của nền tảng chơi game nhanh trên web (tách từ monorepo Quick Playing). Repo gồm:
- API quản lý game, phiên chơi, điểm số có xác minh, leaderboard và tài khoản;
- games server phục vụ game bên thứ ba ở origin riêng;
- cấu hình deploy production (Docker Compose + Caddy).

Frontend nằm ở repo [play-sprint](https://github.com/dangthais/play-sprint).

## Công nghệ
- Monorepo pnpm (`apps/*`), Node 24 (`.nvmrc`), TypeScript 6 (strict).
- `apps/api` (`@qp/api`): Fastify 5 + PostgreSQL qua `pg` (SQL có tham số, không ORM). Prefix route `/api`.
- `apps/games` (`@qp/games`): server tĩnh `node:http` phục vụ game vendored (MIT, xem `apps/games/UPSTREAM.md`) và game SDK.
- Test: Vitest. Test cần DB dùng `TEST_DATABASE_URL`; thiếu biến này thì test tự skip.
- Lint/format: ESLint + Prettier.

## Chạy khi phát triển
```bash
nvm use
pnpm install
pnpm db:migrate && pnpm db:seed   # cần DATABASE_URL
pnpm dev                          # api :3000, games :5174
```
Chạy kèm frontend (`pnpm dev` ở repo FE, :5173), vì Vite proxy `/api` sang api.

## Lệnh
| Việc | Lệnh |
|---|---|
| Dev | `pnpm dev` |
| Migrate / seed / dọn phiên | `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:cleanup` |
| Test | `pnpm test` |
| Lint / type-check | `pnpm lint`, `pnpm typecheck` |
| Build | `pnpm build` |

## Biến môi trường
Đặt trong `.env` ở thư mục gốc (không commit). Mẫu: `.env.example`. Chi tiết ở `docs/architecture.md` §3.1.

## Production
VPS + Docker Compose (Caddy HTTPS tự động, api, games, PostgreSQL, web build từ repo FE). Runbook: [`docs/deployment.md`](docs/deployment.md).

## Tài liệu
- `docs/api-contract.yaml`: hợp đồng API (OpenAPI 3.1), **nguồn sự thật**. Sửa ở đây trước rồi chép sang repo FE.
- `docs/architecture.md`: kiến trúc và ADR.
- `docs/implementation-plan.md`: giai đoạn và tiến độ.
- `docs/game-protocol.md`: giao thức postMessage giữa game và host.

## Ghi công
Game dựa trên mã nguồn MIT của Talha Bin Yousaf (https://github.com/he-is-talha/html-css-javascript-games).
