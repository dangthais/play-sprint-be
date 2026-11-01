import { afterEach, describe, expect, it } from 'vitest';
import { makeHarness, startSession, submit, T0, type Harness } from './test-helpers.ts';

let h: Harness | undefined;
afterEach(async () => {
  await h?.app.close();
  h = undefined;
});

/** Chơi một ván: bắt đầu tại `startAt`, nộp sau `durationMs`. */
async function play(
  x: Harness,
  game: string,
  name: string,
  score: number,
  durationMs: number,
  startAt = T0,
): Promise<string> {
  x.clock.now = startAt;
  const s = await startSession(x, game);
  x.clock.now = startAt + durationMs;
  const res = await submit(x, s, { score, playerName: name });
  if (res.statusCode !== 200) throw new Error(`submit failed ${res.statusCode}`);
  return s.id;
}

async function board(x: Harness, game: string, qs = '') {
  return x.app.inject({ method: 'GET', url: `/api/games/${game}/leaderboard${qs}` });
}

function names(res: { json(): { items: { playerName: string }[] } }): string[] {
  return res.json().items.map((i) => i.playerName);
}

describe('GET /api/games/:gameId/leaderboard', () => {
  it('empty board is 200 with items []', async () => {
    h = makeHarness();
    const res = await board(h, 'snake');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ gameId: 'snake', scoreOrder: 'desc', items: [] });
  });

  it('desc: higher first, then shorter duration, then earlier ended_at (AC18)', async () => {
    const x = (h = makeHarness());
    await play(x, 'snake', 'Low', 10, 60_000);
    await play(x, 'snake', 'High', 30, 60_000);
    await play(x, 'snake', 'TieSlow', 20, 90_000);
    await play(x, 'snake', 'TieFast', 20, 70_000);
    // cùng score và duration: ended_at sớm hơn xếp trên
    await play(x, 'snake', 'LateEnd', 15, 60_000, T0 + 500_000);
    await play(x, 'snake', 'EarlyEnd', 15, 60_000, T0);
    const res = await board(x, 'snake');
    expect(names(res)).toEqual(['High', 'TieFast', 'TieSlow', 'EarlyEnd', 'LateEnd', 'Low']);
    expect(res.json().items.map((i: { rank: number }) => i.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(res.json().items[0]).toEqual({
      rank: 1,
      playerName: 'High',
      isMember: false,
      score: 30,
      durationMs: 60_000,
      achievedAt: new Date(T0 + 60_000).toISOString(),
    });
  });

  it('asc for memory-match: lower first', async () => {
    const x = (h = makeHarness());
    await play(x, 'memory-match', 'Slow', 14, 200_000);
    await play(x, 'memory-match', 'Best', 9, 200_000);
    await play(x, 'memory-match', 'Mid', 11, 200_000);
    const res = await board(x, 'memory-match');
    expect(res.json().scoreOrder).toBe('asc');
    expect(names(res)).toEqual(['Best', 'Mid', 'Slow']);
  });

  it('keeps one entry per case-insensitive name with the best result (AC18)', async () => {
    const x = (h = makeHarness());
    await play(x, 'snake', 'Lan', 10, 60_000);
    await play(x, 'snake', 'lan', 12, 60_000);
    await play(x, 'snake', 'LAN', 11, 60_000);
    const res = await board(x, 'snake');
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0]).toMatchObject({ playerName: 'lan', score: 12 });
  });

  it('a worse later result does not displace the best (asc too)', async () => {
    const x = (h = makeHarness());
    await play(x, 'memory-match', 'Mia', 9, 100_000);
    await play(x, 'memory-match', 'Mia', 15, 100_000);
    const res = await board(x, 'memory-match');
    expect(res.json().items).toEqual([expect.objectContaining({ playerName: 'Mia', score: 9 })]);
  });

  it('excludes rejected and hidden entries (AC18)', async () => {
    const x = (h = makeHarness());
    await play(x, 'snake', 'Good', 5, 60_000);
    const hid = await play(x, 'snake', 'Hidden', 50, 60_000);
    x.repo.setHidden(hid, true);
    x.clock.now = T0;
    const s = await startSession(x);
    await submit(x, s, { score: 800, playerName: 'Cheat' }); // rejected
    expect(names(await board(x, 'snake'))).toEqual(['Good']);
  });

  it('respects limit and rejects invalid limits (AC18)', async () => {
    const x = (h = makeHarness());
    for (let i = 0; i < 12; i++) await play(x, 'snake', `P${i}`, i, 60_000);
    expect((await board(x, 'snake')).json().items).toHaveLength(10);
    expect((await board(x, 'snake', '?limit=3')).json().items).toHaveLength(3);
    expect((await board(x, 'snake', '?limit=100')).json().items).toHaveLength(12);
    expect((await board(x, 'snake', '?limit=1')).json().items).toHaveLength(1);
    for (const bad of ['0', '101', 'abc', '', '1e1', '-1', '1.5', '%2B1', '01']) {
      const res = await board(x, 'snake', `?limit=${bad}`);
      expect(res.statusCode, bad).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    }
    expect((await board(x, 'snake', '?limit=1&limit=2')).statusCode).toBe(400);
  });

  it('422 GAME_NOT_RANKED for tic-tac-toe (AC14)', async () => {
    const x = (h = makeHarness());
    const res = await board(x, 'tic-tac-toe');
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('GAME_NOT_RANKED');
  });

  it.each(['no-such-game', 'Snake', 'a'.repeat(65), 'sn%2Fake', '..'])('404 for %j', async (id) => {
    const x = (h = makeHarness());
    const res = await board(x, id);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'NOT_FOUND', message: expect.any(String) });
  });

  it('malformed id does not reach the repository', async () => {
    const x = (h = makeHarness());
    let calls = 0;
    x.repo.findGameRule = async () => {
      calls++;
      return null;
    };
    await board(x, 'Snake');
    expect(calls).toBe(0);
  });

  it('boards are per game', async () => {
    const x = (h = makeHarness());
    await play(x, 'snake', 'Lan', 10, 60_000);
    expect((await board(x, 'brick-breaker')).json().items).toEqual([]);
  });
});
