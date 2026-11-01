# syntax=docker/dockerfile:1
# Image Caddy: build FE (repo play-sprint, build context "fe") + Caddyfile. Không bao giờ copy .env*.

FROM node:24-bookworm-slim AS fe-build
RUN npm install -g pnpm@12.15.0 && npm cache clean --force
WORKDIR /fe
COPY --from=fe package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY --from=fe index.html vite.config.ts tsconfig.json ./
COPY --from=fe src ./src
COPY --from=fe public ./public
# Origin game là biến build-time của FE (đổi tên miền game → build lại image này).
ARG VITE_GAME_ORIGIN
RUN test -n "$VITE_GAME_ORIGIN" || (echo "VITE_GAME_ORIGIN is required" >&2 && exit 1)
ENV VITE_GAME_ORIGIN=$VITE_GAME_ORIGIN
RUN pnpm build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=fe-build /fe/dist /srv/web
