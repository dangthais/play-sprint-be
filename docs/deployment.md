# Triển khai production (VPS + Docker Compose)

Runbook cho ADR-030…037. Một VPS chạy 6 service: `caddy` (HTTPS tự động, web tĩnh, reverse proxy), `api`, `games`, `db` (PostgreSQL 17), `migrate` (one-shot, chạy mỗi lần `up`) và `seed` (chạy tay).

```
Internet ──▶ caddy :80/:443 ─┬─ https://WEB_DOMAIN    → /srv/web (SPA)  +  /api/* → api:3000 ──▶ db (mạng internal)
                             └─ https://GAMES_DOMAIN  → games:5174
```

## 1. Chuẩn bị
- VPS Linux có Docker Engine và Docker Compose v2.24 trở lên. Mở cổng 80/tcp, 443/tcp, 443/udp. Không mở cổng nào khác.
- Hai tên miền trỏ bản ghi A/AAAA về IP của VPS:
  - `WEB_DOMAIN`, ví dụ `quickplaying.vn`;
  - `GAMES_DOMAIN`: **nên dùng domain đăng ký riêng** (ví dụ `qp-games.net`) để game không cùng site với web. Dùng subdomain vẫn chạy được, nhưng mất Site Isolation giữa web và game.
- Clone hai repo **cạnh nhau**:
  ```bash
  git clone https://github.com/dangthais/play-sprint-be.git
  git clone https://github.com/dangthais/play-sprint.git
  cd play-sprint-be
  ```

## 2. Cấu hình `.env` (cạnh `compose.yaml`, không commit)
| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `POSTGRES_PASSWORD` | có | Mật khẩu DB. Sinh bằng `openssl rand -hex 32` (phải URL-safe vì được đưa vào `DATABASE_URL`). |
| `WEB_DOMAIN` | có | Tên miền web, không ghi `https://`. |
| `GAMES_DOMAIN` | có | Tên miền game. Phải khác `WEB_DOMAIN`. |
| `ACME_EMAIL` | có | Email nhận thông báo từ Let's Encrypt. |
| `FE_PATH` | không | Đường dẫn repo FE, mặc định `../play-sprint`. Có thể dùng git URL ghim tag. |
| `LOG_LEVEL` | không | Mặc định `info`. |
| `CLEANUP_INTERVAL_MINUTES` | không | Chu kỳ job dọn phiên, mặc định `60`. `0` là tắt. |

Không cần đặt `COOKIE_SECURE`, `TRUST_PROXY`, `WEB_ORIGIN`, `GAME_ORIGIN` vì compose tự suy ra từ các biến trên.

Kiểm tra: `docker compose config --quiet`. Nếu thiếu biến bắt buộc, lệnh báo lỗi và nêu tên biến.

## 3. Deploy lần đầu
```bash
docker compose up -d --build        # db → migrate → api, games → caddy
docker compose run --rm seed        # nạp 5 game và luật điểm (chạy lại vẫn an toàn)
docker compose ps                   # api và games ở trạng thái healthy, migrate Exited (0)
curl -I https://$WEB_DOMAIN/api/health
```
Caddy tự xin chứng chỉ khi có request đầu tiên. Nếu ACME thất bại, kiểm tra DNS và cổng 80/443 rồi xem `docker compose logs caddy`. Đừng thử lại liên tục vì Let's Encrypt có giới hạn số lần.

## 4. Cập nhật phiên bản
```bash
git -C ../play-sprint pull && git pull
docker compose up -d --build        # migrate tự chạy, in "No pending migrations." nếu không có gì mới
```
Đổi `GAMES_DOMAIN` thì phải build lại image web, vì `VITE_GAME_ORIGIN` là biến build-time của FE.

## 5. Vận hành
- **Job dọn phiên:** chạy trong process `api` theo chu kỳ (có khoá advisory nên không chạy chồng). Job chỉ xoá phiên chơi `active` đã hết hạn quá 24 giờ và phiên đăng nhập hết hạn, không đụng lịch sử hay leaderboard. Muốn chạy tay: `docker compose exec api node dist/db/cleanup.js`.
- **Log:** `docker compose logs -f api`. Log được xoay vòng ở mức 10 MB × 3 file mỗi service. Log không chứa cookie, token hay IP.
- **Backup** (chưa tự động, nên đặt cron hằng ngày và chép ra ngoài VPS):
  ```bash
  docker compose exec -T db pg_dump -U qp -d quick_playing -Fc > backup-$(date +%F).dump
  ```
  Khôi phục: `docker compose exec -T db pg_restore -U qp -d quick_playing --clean < backup.dump`. Thao tác này ghi đè dữ liệu, cần cân nhắc trước khi chạy.
- **Rate limit** dựa trên IP client thật mà Caddy ghi vào `X-Forwarded-For` (`TRUST_PROXY=1`). Nếu sau này đặt CDN (ví dụ Cloudflare) phía trước, phải cấu hình lại `trusted_proxies` và `TRUST_PROXY`. Nếu không, mọi người dùng sẽ chung một IP.

## 6. Kiểm tra sau deploy (smoke e2e, chạy từ monorepo)
```bash
PROD_WEB_URL=https://$WEB_DOMAIN PROD_GAMES_URL=https://$GAMES_DOMAIN pnpm exec playwright test production
```
Luôn lọc `production` (cần cả hai biến). Test đăng ký + nộp điểm tạo dữ liệu vĩnh viễn nên mặc định bị bỏ qua. Chỉ thêm `PROD_ALLOW_WRITES=1` khi chạy trên môi trường thử (`*.localhost`, staging), không dùng trên production thật.

## 7. Thử cục bộ (không cần tên miền thật)
Đặt `WEB_DOMAIN=web.localhost`, `GAMES_DOMAIN=games.localhost`, `ACME_EMAIL=dev@example.com`. Caddy sẽ dùng CA nội bộ, nên trình duyệt báo chứng chỉ không tin cậy (smoke test đã bật `ignoreHTTPSErrors`).
