# syntax=docker/dockerfile:1
# Image production cho api và games (ADR-030…037). Build: docker compose build (target api | games).

FROM node:24-bookworm-slim AS pnpm
RUN npm install -g pnpm@12.15.0 && npm cache clean --force
WORKDIR /app

# Manifest của workspace: lockfile chỉ "frozen" khi đủ mọi importer.
FROM pnpm AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/games/package.json apps/games/

FROM manifests AS api-build
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
RUN pnpm --filter @qp/api build

FROM manifests AS api-prod-deps
RUN pnpm install --frozen-lockfile --prod --filter @qp/api

FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=api-prod-deps /app/node_modules node_modules
COPY --from=api-prod-deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=api-build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
COPY apps/api/package.json apps/api/
WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]

# Games: không có dependency, Node chạy .ts trực tiếp (type stripping).
FROM node:24-bookworm-slim AS games
ENV NODE_ENV=production
WORKDIR /app/apps/games
COPY apps/games/package.json ./
COPY apps/games/src src
COPY apps/games/public public
USER node
EXPOSE 5174
CMD ["node", "src/server.ts"]
