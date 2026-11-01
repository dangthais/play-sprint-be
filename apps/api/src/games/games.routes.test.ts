import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { SEED_GAMES } from '../db/seed.ts';
import { createInMemoryGamesRepository } from './games.repository.memory.ts';
import type { GameRecord, GamesRepository } from './games.types.ts';

// Fixture riêng 25 game để kiểm tra phân trang, độc lập với seed thật.
const BASE_MS = Date.UTC(2026, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE: GameRecord[] = Array.from({ length: 25 }, (_, i) => {
  const id = i === 1 ? 'block-drop' : `game-${String(i).padStart(2, '0')}`;
  return {
    id,
    title: `Game ${i}`,
    description: i === 23 ? null : `Mô tả ${i}`,
    thumbnailPath: `/thumbnails/${id}.svg`,
    embedPath: `/games/${id}/`,
    orientation: 'landscape' as const,
    tags: ['arcade'],
    // block-drop (i=1) trùng created_at với game-00 để kiểm tra tie-breaker theo id.
    createdAt: new Date(i === 1 ? BASE_MS : BASE_MS + i * DAY_MS),
    ranked: false,
    scoreOrder: null,
  };
});

let app: FastifyInstance | undefined;

function make(repo: GamesRepository = createInMemoryGamesRepository(FIXTURE), extra = {}) {
  app = buildApp({ gamesRepository: repo, ...extra });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/games', () => {
  it('returns first page by default (AC1)', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/games' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(25);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.items).toHaveLength(20);
    expect(body.items.slice(0, 3).map((g: { id: string }) => g.id)).toEqual([
      'game-24',
      'game-23',
      'game-22',
    ]);
    const first = body.items[0];
    expect(first).toEqual({
      id: 'game-24',
      title: 'Game 24',
      description: expect.any(String),
      thumbnailUrl: 'http://localhost:5173/thumbnails/game-24.svg',
      embedUrl: 'http://localhost:5174/games/game-24/',
      orientation: 'landscape',
      tags: expect.any(Array),
      createdAt: '2026-01-25T00:00:00.000Z',
      ranked: false,
    });
  });

  it('omits description when null', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/games?limit=100' });
    const tower = res.json().items.find((g: { id: string }) => g.id === 'game-23');
    expect(tower).toBeDefined();
    expect('description' in tower).toBe(false);
  });

  it('returns the last page with tie-breaker order (AC2)', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/games?page=2&limit=20' });
    const ids = res.json().items.map((g: { id: string }) => g.id);
    expect(ids).toHaveLength(5);
    expect(ids.slice(-2)).toEqual(['block-drop', 'game-00']);
  });

  it('pages with limit 7 cover all 25 ids without duplicates (AC2)', async () => {
    const a = make();
    const seen: string[] = [];
    for (let page = 1; page <= 4; page++) {
      const res = await a.inject({ method: 'GET', url: `/api/games?page=${page}&limit=7` });
      seen.push(...res.json().items.map((g: { id: string }) => g.id));
    }
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  it('returns empty items for page beyond range (AC3)', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/games?page=99' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], total: 25, page: 99, limit: 20 });
  });

  it('accepts boundary values page=10000 and limit=100', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/games?page=10000&limit=100' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ page: 10000, limit: 100, items: [] });
  });

  it('handles an empty catalog', async () => {
    const res = await make(createInMemoryGamesRepository([])).inject({
      method: 'GET',
      url: '/api/games',
    });
    expect(res.json()).toEqual({ items: [], total: 0, page: 1, limit: 20 });
  });

  it.each([
    'page=0',
    'page=-1',
    'page=1.5',
    'page=abc',
    'page=',
    'page=10001',
    'limit=0',
    'limit=101',
    'limit=abc',
    'limit=',
    'limit=-5',
    'limit=1e1',
    'page=1&page=2',
    'limit=5&limit=6',
    'page=%2B1',
    'page=01',
  ])('rejects %s with 400 VALIDATION_ERROR (AC4)', async (qs) => {
    const res = await make().inject({ method: 'GET', url: `/api/games?${qs}` });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['code', 'message']);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(typeof body.message).toBe('string');
  });

  it('ignores unknown query params (AC5)', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/games?foo=bar&sort=asc' });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(25);
  });

  it('builds URLs from configured origins (AC7)', async () => {
    const res = await make(undefined, {
      webOrigin: 'https://web.example.com',
      gameOrigin: 'https://games.example.com',
    }).inject({ method: 'GET', url: '/api/games?limit=1' });
    const g = res.json().items[0];
    expect(g.thumbnailUrl).toBe('https://web.example.com/thumbnails/game-24.svg');
    expect(g.embedUrl).toBe('https://games.example.com/games/game-24/');
  });

  it('returns generic 500 when repository throws (AC6)', async () => {
    const failing: GamesRepository = {
      async list() {
        throw new Error('connection refused to secret-host:5432');
      },
      async findById() {
        throw new Error('connection refused to secret-host:5432');
      },
    };
    const res = await make(failing).inject({ method: 'GET', url: '/api/games' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(res.body).not.toContain('secret-host');
  });
});

describe('GET /api/games/:gameId', () => {
  it('returns 200 identical to the list element', async () => {
    const a = make();
    const list = (await a.inject({ method: 'GET', url: '/api/games?limit=100' })).json().items;
    for (const item of list) {
      const res = await a.inject({ method: 'GET', url: `/api/games/${item.id}` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(item);
    }
  });

  it('omits description when null', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/games/game-23' });
    expect(res.statusCode).toBe(200);
    expect('description' in res.json()).toBe(false);
  });

  it('serves the seed catalog with configured origins', async () => {
    const res = await make(createInMemoryGamesRepository(SEED_GAMES), {
      webOrigin: 'https://web.example.com',
      gameOrigin: 'https://games.example.com',
    }).inject({ method: 'GET', url: '/api/games/snake' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: 'snake',
      thumbnailUrl: 'https://web.example.com/thumbnails/snake.svg',
      embedUrl: 'https://games.example.com/games/snake/',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('returns 404 NOT_FOUND for an unknown id', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/games/unknown-game' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'NOT_FOUND', message: 'Game not found' });
  });

  it.each([
    'Snake',
    'a'.repeat(65),
    'snake%2Fx',
    '..',
    '-x',
    'snake.',
    '%00',
    'snake/',
    'snake%20',
    '%2e%2e',
    'sn_ake',
    'g%C3%A1me',
  ])('returns 404 for malformed id %j without calling the repository', async (id) => {
    const repo = createInMemoryGamesRepository(FIXTURE);
    const findById = vi.spyOn(repo, 'findById');
    const list = vi.spyOn(repo, 'list');
    const res = await make(repo).inject({ method: 'GET', url: `/api/games/${id}` });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['code', 'message']);
    expect(body.code).toBe('NOT_FOUND');
    expect(findById).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('accepts a 64-character id (boundary) and queries the repository', async () => {
    const repo = createInMemoryGamesRepository(FIXTURE);
    const findById = vi.spyOn(repo, 'findById');
    const id = 'a'.repeat(64);
    const res = await make(repo).inject({ method: 'GET', url: `/api/games/${id}` });
    expect(res.statusCode).toBe(404);
    expect(findById).toHaveBeenCalledWith(id);
  });

  it('returns generic 500 when repository throws', async () => {
    const failing: GamesRepository = {
      async list() {
        throw new Error('boom');
      },
      async findById() {
        throw new Error('connection refused to secret-host:5432');
      },
    };
    const res = await make(failing).inject({ method: 'GET', url: '/api/games/snake' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(res.body).not.toContain('secret-host');
  });
});

describe('ranked / scoreOrder (AC2)', () => {
  it.each([
    ['snake', true, 'desc'],
    ['merge-2048', true, 'desc'],
    ['brick-breaker', true, 'desc'],
    ['memory-match', true, 'asc'],
    ['tic-tac-toe', false, undefined],
  ])('%s in detail and list', async (id, ranked, order) => {
    const a = make(createInMemoryGamesRepository(SEED_GAMES));
    const detail = (await a.inject({ method: 'GET', url: `/api/games/${id}` })).json();
    expect(detail.ranked).toBe(ranked);
    expect(detail.scoreOrder).toBe(order);
    expect('scoreOrder' in detail).toBe(order !== undefined);
    const list = (await a.inject({ method: 'GET', url: '/api/games' })).json().items;
    expect(list.find((g: { id: string }) => g.id === id)).toEqual(detail);
  });
});

describe('unknown routes', () => {
  it('returns 404 NOT_FOUND (AC6)', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['code', 'message']);
    expect(body.code).toBe('NOT_FOUND');
  });
});
