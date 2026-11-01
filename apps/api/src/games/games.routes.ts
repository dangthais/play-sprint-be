import type { FastifyInstance } from 'fastify';
import { notFoundError, validationError } from '../errors.ts';
import type { GameRecord, GamesRepository } from './games.types.ts';

export interface GamesRoutesOptions {
  repository: GamesRepository;
  webOrigin: string;
  gameOrigin: string;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_PAGE = 10000;
const MAX_LIMIT = 100;

// Tự validate chuỗi querystring (không dựa vào coerceTypes của Ajv) để chặn chắc chắn.
function parsePositiveInt(name: string, raw: unknown, def: number, max: number): number {
  if (raw === undefined) return def;
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,8}$/.test(raw)) {
    throw validationError(`${name} must be a positive integer`);
  }
  const n = Number(raw);
  if (n > max) throw validationError(`${name} must be at most ${max}`);
  return n;
}

const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function toGameDto(
  g: GameRecord,
  origins: { webOrigin: string; gameOrigin: string },
): Record<string, unknown> {
  return {
    id: g.id,
    title: g.title,
    ...(g.description !== null ? { description: g.description } : {}),
    thumbnailUrl: new URL(g.thumbnailPath, origins.webOrigin).href,
    embedUrl: new URL(g.embedPath, origins.gameOrigin).href,
    orientation: g.orientation,
    tags: g.tags,
    createdAt: g.createdAt.toISOString(),
    ranked: g.ranked,
    ...(g.ranked && g.scoreOrder !== null ? { scoreOrder: g.scoreOrder } : {}),
  };
}

export function registerGamesRoutes(app: FastifyInstance, opts: GamesRoutesOptions): void {
  const origins = { webOrigin: opts.webOrigin, gameOrigin: opts.gameOrigin };

  app.get('/api/games', async (request) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const page = parsePositiveInt('page', query.page, DEFAULT_PAGE, MAX_PAGE);
    const limit = parsePositiveInt('limit', query.limit, DEFAULT_LIMIT, MAX_LIMIT);

    const { items, total } = await opts.repository.list({ limit, offset: (page - 1) * limit });

    return { items: items.map((g) => toGameDto(g, origins)), total, page, limit };
  });

  app.get('/api/games/:gameId', async (request) => {
    const { gameId } = request.params as { gameId: string };
    // Khớp chính xác, không chuẩn hoá; sai định dạng thì không chạm vào repository.
    if (typeof gameId !== 'string' || !GAME_ID_PATTERN.test(gameId)) {
      throw notFoundError('Game not found');
    }
    const game = await opts.repository.findById(gameId);
    if (!game) throw notFoundError('Game not found');
    return toGameDto(game, origins);
  });
}
