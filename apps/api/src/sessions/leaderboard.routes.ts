import type { FastifyInstance } from 'fastify';
import { notFoundError, validationError } from '../errors.ts';
import type { SessionsService } from './sessions.service.ts';

const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

// Tự validate chuỗi querystring (không dựa vào coerceTypes): chặn "1e1", " 2", "+1", tham số lặp...
function parseLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,8}$/.test(raw)) {
    throw validationError('limit must be a positive integer');
  }
  const n = Number(raw);
  if (n > MAX_LIMIT) throw validationError(`limit must be at most ${MAX_LIMIT}`);
  return n;
}

export function registerLeaderboardRoutes(
  app: FastifyInstance,
  opts: { service: SessionsService },
): void {
  app.get(
    '/api/games/:gameId/leaderboard',
    { onRequest: app.rateLimitHooks.leaderboard },
    async (request) => {
      const { gameId } = request.params as { gameId: string };
      if (!GAME_ID_PATTERN.test(gameId)) throw notFoundError('Game not found');
      const limit = parseLimit((request.query as Record<string, unknown> | undefined)?.limit);

      const result = await opts.service.leaderboard(gameId, limit);
      if (!result) throw notFoundError('Game not found');
      return {
        gameId,
        scoreOrder: result.scoreOrder,
        items: result.rows.map((row, i) => ({
          rank: i + 1,
          playerName: row.playerName,
          isMember: row.isMember,
          score: row.score,
          durationMs: row.durationMs,
          achievedAt: row.achievedAt.toISOString(),
        })),
      };
    },
  );
}
