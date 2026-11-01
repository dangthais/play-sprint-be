import { describe, expect, it } from 'vitest';
import { createInMemoryGamesRepository } from '../games/games.repository.memory.ts';
import { SEED_GAMES, SEED_RULES, seedScoringRules } from './seed.ts';

describe('SEED_GAMES', () => {
  it('has 5 unique valid games, all with a description', () => {
    expect(SEED_GAMES).toHaveLength(5);
    expect(new Set(SEED_GAMES.map((g) => g.id)).size).toBe(5);
    for (const g of SEED_GAMES) {
      expect(g.id).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
      expect(g.title.length).toBeGreaterThan(0);
      expect(g.title.length).toBeLessThanOrEqual(100);
      expect((g.description ?? '').length).toBeGreaterThan(0);
      expect((g.description ?? '').length).toBeLessThanOrEqual(500);
      expect(g.thumbnailPath).toBe(`/thumbnails/${g.id}.svg`);
      expect(g.embedPath).toBe(`/games/${g.id}/`);
      expect(g.thumbnailPath).toMatch(/^\/[A-Za-z0-9/_.-]+$/);
      expect(g.embedPath).toMatch(/^\/[A-Za-z0-9/_.-]+$/);
      expect(g.thumbnailPath).not.toContain('..');
    }
  });

  it('lists in the expected order after sorting', async () => {
    const repo = createInMemoryGamesRepository(SEED_GAMES);
    const { items, total } = await repo.list({ limit: 20, offset: 0 });
    expect(total).toBe(5);
    expect(items.map((g) => g.id)).toEqual([
      'tic-tac-toe',
      'merge-2048',
      'memory-match',
      'brick-breaker',
      'snake',
    ]);
  });

  it('brick-breaker ties with snake', () => {
    const t = (id: string) => SEED_GAMES.find((g) => g.id === id)?.createdAt.toISOString();
    expect(t('snake')).toBe('2026-01-01T00:00:00.000Z');
    expect(t('brick-breaker')).toBe(t('snake'));
  });
});

describe('SEED_RULES (AC21)', () => {
  it('covers exactly the 4 ranked games; tic-tac-toe has no rule', () => {
    expect(SEED_RULES.map((r) => r.gameId).sort()).toEqual([
      'brick-breaker',
      'memory-match',
      'merge-2048',
      'snake',
    ]);
    const ids = new Set(SEED_GAMES.map((g) => g.id));
    for (const r of SEED_RULES) {
      expect(ids.has(r.gameId)).toBe(true);
      expect(r.minScore).toBeGreaterThanOrEqual(0);
      expect(r.maxScore).toBeGreaterThanOrEqual(r.minScore);
      expect(r.maxScore).toBeLessThanOrEqual(1_000_000_000);
      expect(
        r.maxScorePerSec === null || (r.maxScorePerSec > 0 && r.maxScorePerSec <= 100000),
      ).toBe(true);
    }
    const byId = Object.fromEntries(SEED_RULES.map((r) => [r.gameId, r]));
    expect(byId.snake).toMatchObject({
      scoreOrder: 'desc',
      maxScore: 900,
      scoreSlack: 5,
      maxScorePerSec: 2.5,
    });
    expect(byId['merge-2048']).toMatchObject({
      maxScore: 250000,
      scoreSlack: 100,
      maxScorePerSec: 250,
    });
    expect(byId['brick-breaker']).toMatchObject({
      maxScore: 20000,
      scoreSlack: 45,
      maxScorePerSec: 10,
    });
    expect(byId['memory-match']).toMatchObject({
      scoreOrder: 'asc',
      minScore: 8,
      maxScore: 1000,
      minDurationMs: 3000,
      minMsPerScore: 1000,
    });
  });

  it('SEED_GAMES carry ranked/scoreOrder derived from rules', () => {
    const g = (id: string) => SEED_GAMES.find((x) => x.id === id);
    expect(g('snake')).toMatchObject({ ranked: true, scoreOrder: 'desc' });
    expect(g('memory-match')).toMatchObject({ ranked: true, scoreOrder: 'asc' });
    expect(g('tic-tac-toe')).toMatchObject({ ranked: false, scoreOrder: null });
  });

  it('seedScoringRules upserts with parameters (re-runnable, no DELETE)', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return { rows: [] };
      },
    };
    expect(await seedScoringRules(db as never)).toBe(4);
    expect(await seedScoringRules(db as never)).toBe(4);
    expect(calls).toHaveLength(8);
    for (const c of calls) {
      expect(c.sql).toContain('ON CONFLICT (game_id) DO UPDATE');
      expect(c.sql).not.toMatch(/DELETE|DROP|TRUNCATE/i);
      expect(c.params).toHaveLength(8);
    }
  });
});
