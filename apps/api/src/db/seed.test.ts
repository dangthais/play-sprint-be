import { describe, expect, it } from 'vitest';
import { createInMemoryGamesRepository } from '../games/games.repository.memory.ts';
import { SEED_GAMES, SEED_RULES, seedScoringRules } from './seed.ts';

const API_ORDER = [
  'maze-chomp',
  'block-drop',
  'sky-hop',
  'space-shooter',
  'asteroid-blaster',
  'frog-crossing',
  'bubble-pop',
  'mole-smash',
  'typing-race',
  'simon-says',
  'minesweeper',
  'sliding-puzzle',
  'code-breaker',
  'word-guess',
  'reversi',
  'chess',
  'checkers',
  'sudoku',
  'solitaire',
  'sea-battle',
  'tic-tac-toe',
  'merge-2048',
  'memory-match',
  'brick-breaker',
  'snake',
];

// id, title, tags, orientation (bảng F5; chỉ số i → createdAt = 2026-11-10T00:00:00Z + i giờ)
const F5_GAMES: [string, string, string[], string][] = [
  ['sea-battle', 'Sea Battle', ['board', 'strategy'], 'any'],
  ['solitaire', 'Solitaire', ['classic', 'cards'], 'any'],
  ['sudoku', 'Sudoku', ['puzzle', 'numbers'], 'any'],
  ['checkers', 'Checkers', ['board', 'classic'], 'any'],
  ['chess', 'Chess', ['board', 'classic'], 'any'],
  ['reversi', 'Reversi', ['board', 'classic'], 'any'],
  ['word-guess', 'Word Guess', ['puzzle', 'words'], 'any'],
  ['code-breaker', 'Code Breaker', ['puzzle', 'logic'], 'any'],
  ['sliding-puzzle', 'Sliding Puzzle', ['puzzle'], 'any'],
  ['minesweeper', 'Minesweeper', ['puzzle', 'classic'], 'any'],
  ['simon-says', 'Simon Says', ['classic', 'memory'], 'any'],
  ['typing-race', 'Typing Race', ['arcade', 'words'], 'any'],
  ['mole-smash', 'Mole Smash', ['arcade', 'reflex'], 'any'],
  ['bubble-pop', 'Bubble Pop', ['arcade', 'puzzle'], 'portrait'],
  ['frog-crossing', 'Frog Crossing', ['arcade', 'classic'], 'any'],
  ['asteroid-blaster', 'Asteroid Blaster', ['arcade', 'shooter'], 'portrait'],
  ['space-shooter', 'Space Shooter', ['arcade', 'shooter'], 'portrait'],
  ['sky-hop', 'Sky Hop', ['arcade'], 'portrait'],
  ['block-drop', 'Block Drop', ['arcade', 'classic'], 'any'],
  ['maze-chomp', 'Maze Chomp', ['arcade', 'classic'], 'portrait'],
];

describe('SEED_GAMES', () => {
  it('has 25 unique valid games, all with a description (AC7)', () => {
    expect(SEED_GAMES).toHaveLength(25);
    expect(new Set(SEED_GAMES.map((g) => g.id)).size).toBe(25);
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
      expect(g.tags.some((t) => ['arcade', 'puzzle', 'classic', 'board'].includes(t))).toBe(true);
    }
  });

  it('F5 games match the table (title, tags, orientation, createdAt)', () => {
    const byId = new Map(SEED_GAMES.map((g) => [g.id, g]));
    F5_GAMES.forEach(([id, title, tags, orientation], i) => {
      const g = byId.get(id);
      expect(g, id).toBeDefined();
      expect(g?.title).toBe(title);
      expect(g?.tags).toEqual(tags);
      expect(g?.orientation).toBe(orientation);
      expect(g?.createdAt.toISOString()).toBe(
        new Date(Date.UTC(2026, 10, 10) + i * 3_600_000).toISOString(),
      );
    });
  });

  it('keeps the 5 original games unchanged', () => {
    const g = (id: string) => SEED_GAMES.find((x) => x.id === id);
    expect(g('snake')).toMatchObject({
      title: 'Snake',
      orientation: 'any',
      tags: ['arcade', 'classic'],
    });
    expect(g('brick-breaker')).toMatchObject({ orientation: 'landscape', tags: ['arcade'] });
    expect(g('memory-match')?.createdAt.toISOString()).toBe('2026-01-04T00:00:00.000Z');
    expect(g('merge-2048')?.createdAt.toISOString()).toBe('2026-01-07T00:00:00.000Z');
    expect(g('tic-tac-toe')?.createdAt.toISOString()).toBe('2026-01-13T00:00:00.000Z');
  });

  it('lists in the expected order after sorting', async () => {
    const repo = createInMemoryGamesRepository(SEED_GAMES);
    const { items, total } = await repo.list({ limit: 25, offset: 0 });
    expect(total).toBe(25);
    expect(items.map((g) => g.id)).toEqual(API_ORDER);
    const p3 = await repo.list({ limit: 12, offset: 24 });
    expect(p3.items.map((g) => g.id)).toEqual(['snake']);
  });

  it('brick-breaker ties with snake', () => {
    const t = (id: string) => SEED_GAMES.find((g) => g.id === id)?.createdAt.toISOString();
    expect(t('snake')).toBe('2026-01-01T00:00:00.000Z');
    expect(t('brick-breaker')).toBe(t('snake'));
  });
});

describe('SEED_RULES (AC21)', () => {
  it('covers exactly the 19 ranked games; the 6 others have no rule (AC8)', () => {
    expect(SEED_RULES).toHaveLength(19);
    expect(new Set(SEED_RULES.map((r) => r.gameId)).size).toBe(19);
    const unranked = ['tic-tac-toe', 'chess', 'checkers', 'sudoku', 'solitaire', 'sea-battle'];
    const ruleIds = new Set(SEED_RULES.map((r) => r.gameId));
    for (const id of unranked) {
      expect(ruleIds.has(id), id).toBe(false);
      expect(SEED_GAMES.find((g) => g.id === id)).toMatchObject({
        ranked: false,
        scoreOrder: null,
      });
    }
    expect(SEED_GAMES.filter((g) => g.ranked)).toHaveLength(19);
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

  it('F5 rules match architecture §5.5 / ADR-039', () => {
    type Row = [string, string, number, number, number, number, number | null, number | null];
    const rows: Row[] = [
      ['maze-chomp', 'desc', 0, 3800, 0, 200, 90, null],
      ['sky-hop', 'desc', 0, 1000000, 0, 100, 200, null],
      ['block-drop', 'desc', 0, 1000000, 0, 500, 250, null],
      ['space-shooter', 'desc', 0, 100000, 0, 100, 200, null],
      ['asteroid-blaster', 'desc', 0, 200000, 0, 2000, 300, null],
      ['frog-crossing', 'desc', 0, 5000, 0, 2500, 150, null],
      ['bubble-pop', 'desc', 0, 1000000, 0, 600, 60, null],
      ['mole-smash', 'desc', 0, 50, 9500, 0, null, null],
      ['typing-race', 'desc', 0, 5000, 9000, 0, null, 1900],
      ['simon-says', 'desc', 0, 200, 0, 0, null, 3000],
      ['minesweeper', 'desc', 0, 54, 3000, 0, null, null],
      ['sliding-puzzle', 'asc', 1, 5000, 2000, 0, null, 100],
      ['code-breaker', 'asc', 1, 11, 3000, 0, null, 2000],
      ['word-guess', 'asc', 1, 7, 3000, 0, null, 1500],
      ['reversi', 'desc', 0, 64, 3000, 0, null, null],
    ];
    for (const row of rows) {
      const [gameId, scoreOrder, minScore, maxScore, minDurationMs, scoreSlack] = row;
      const [, , , , , , maxScorePerSec, minMsPerScore] = row;
      expect(
        SEED_RULES.find((r) => r.gameId === gameId),
        gameId,
      ).toEqual({
        gameId,
        scoreOrder,
        minScore,
        maxScore,
        minDurationMs,
        scoreSlack,
        maxScorePerSec,
        minMsPerScore,
      });
    }
  });

  it('SEED_GAMES carry ranked/scoreOrder derived from rules', () => {
    const g = (id: string) => SEED_GAMES.find((x) => x.id === id);
    expect(g('snake')).toMatchObject({ ranked: true, scoreOrder: 'desc' });
    expect(g('memory-match')).toMatchObject({ ranked: true, scoreOrder: 'asc' });
    expect(g('word-guess')).toMatchObject({ ranked: true, scoreOrder: 'asc' });
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
    expect(await seedScoringRules(db as never)).toBe(19);
    expect(await seedScoringRules(db as never)).toBe(19);
    expect(calls).toHaveLength(38);
    for (const c of calls) {
      expect(c.sql).toContain('ON CONFLICT (game_id) DO UPDATE');
      expect(c.sql).not.toMatch(/DELETE|DROP|TRUNCATE/i);
      expect(c.params).toHaveLength(8);
    }
  });
});
