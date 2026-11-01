import type { FastifyInstance } from 'fastify';
import { validationError } from '../errors.ts';
import type { SessionsService } from './sessions.service.ts';

const DEFAULT_PAGE = 1;
const MAX_PAGE = 10000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Tự validate chuỗi querystring như `GET /games` (không dựa vào coerceTypes): chặn "1e1", " 2", "+1"...
function parsePositiveInt(name: string, raw: unknown, def: number, max: number): number {
  if (raw === undefined) return def;
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,8}$/.test(raw)) {
    throw validationError(`${name} must be a positive integer`);
  }
  const n = Number(raw);
  if (n > max) throw validationError(`${name} must be at most ${max}`);
  return n;
}

/**
 * `GET /api/me/sessions`, `GET /api/me/bests` (ADR-028). `userId` luôn lấy từ phiên đăng nhập
 * (`request.authUser`), không bao giờ từ query/path. Hook `onSend` của auth đặt `Cache-Control: no-store`.
 */
export function registerHistoryRoutes(
  app: FastifyInstance,
  opts: { service: SessionsService },
): void {
  const { service } = opts;
  const onRequest = [app.rateLimitHooks.accountRead, app.auth.requireUser];

  app.get('/api/me/sessions', { onRequest }, async (request) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const page = parsePositiveInt('page', query.page, DEFAULT_PAGE, MAX_PAGE);
    const limit = parsePositiveInt('limit', query.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const userId = (request.authUser as NonNullable<typeof request.authUser>).id;

    const { items, total } = await service.history(userId, { limit, offset: (page - 1) * limit });
    return {
      items: items.map((r) => ({
        sessionId: r.sessionId,
        gameId: r.gameId,
        gameTitle: r.gameTitle,
        scoreOrder: r.scoreOrder,
        score: r.score,
        durationMs: r.durationMs,
        result: r.result,
        endedAt: r.endedAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  });

  app.get('/api/me/bests', { onRequest }, async (request) => {
    const userId = (request.authUser as NonNullable<typeof request.authUser>).id;
    const rows = await service.personalBests(userId);
    return {
      items: rows.map((r) => ({
        gameId: r.gameId,
        gameTitle: r.gameTitle,
        scoreOrder: r.scoreOrder,
        score: r.score,
        durationMs: r.durationMs,
        achievedAt: r.achievedAt.toISOString(),
        plays: r.plays,
      })),
    };
  });
}
