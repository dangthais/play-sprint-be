import { afterEach, describe, expect, it } from 'vitest';
import { makeHarness, signUp, startSession, submit, T0, type Harness } from './test-helpers.ts';

let h: Harness | undefined;
afterEach(async () => {
  await h?.app.close();
  h = undefined;
});

function mk(extra: Parameters<typeof makeHarness>[0] = {}): Harness {
  h = makeHarness(extra);
  return h;
}

function expectError(res: { statusCode: number; json(): unknown }, status: number, code: string) {
  expect(res.statusCode).toBe(status);
  const body = res.json() as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(['code', 'message']);
  expect(body.code).toBe(code);
}

type Who = { cookie: Record<string, string> };

async function play(
  x: Harness,
  who: Who | null,
  o: { game?: string; score: number; name?: string; startAt: number; durationMs?: number },
): Promise<string> {
  x.clock.now = o.startAt;
  const s = await startSession(x, o.game ?? 'snake', who?.cookie ?? {});
  x.clock.now = o.startAt + (o.durationMs ?? 60_000);
  const payload =
    o.name === undefined ? { score: o.score } : { score: o.score, playerName: o.name };
  await submit(x, s, payload, who?.cookie ?? {});
  return s.id;
}

const get = (x: Harness, url: string, who: Who | null) =>
  x.app.inject({ method: 'GET', url, headers: who?.cookie ?? {} });

describe('GET /api/me/sessions (AC25)', () => {
  it('401 without a cookie, with a bad cookie and with an unknown token; no-store everywhere', async () => {
    const x = mk();
    for (const headers of [{}, { cookie: 'qp_sid=zzz' }, { cookie: `qp_sid=${'C'.repeat(43)}` }]) {
      const res = await x.app.inject({ method: 'GET', url: '/api/me/sessions', headers });
      expectError(res, 401, 'UNAUTHORIZED');
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('own finished sessions only, newest first, rejected without reason, ?userId ignored', async () => {
    const x = mk();
    const a = await signUp(x, 'Ann');
    const b = await signUp(x, 'Bob');
    const i1 = await play(x, a, { score: 10, startAt: T0 });
    const i2 = await play(x, a, { score: 800, startAt: T0 + 100_000, durationMs: 1000 }); // rejected
    const i3 = await play(x, a, { score: 20, startAt: T0 + 200_000 });
    await startSession(x, 'snake', a.cookie); // active: không xuất hiện
    const ib = await play(x, b, { score: 7, startAt: T0 + 300_000 });
    await play(x, null, { score: 5, name: 'Guest', startAt: T0 + 400_000 }); // khách

    const res = await get(x, '/api/me/sessions', a);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.items.map((i: { sessionId: string }) => i.sessionId)).toEqual([i3, i2, i1]);
    expect(body.items[0]).toEqual({
      sessionId: i3,
      gameId: 'snake',
      gameTitle: 'Snake',
      scoreOrder: 'desc',
      score: 20,
      durationMs: 60_000,
      result: 'accepted',
      endedAt: new Date(T0 + 260_000).toISOString(),
    });
    expect(body.items[1]).toMatchObject({ result: 'rejected', score: 800 });
    expect(JSON.stringify(body)).not.toMatch(/reason|SCORE_|userId|user_id/i);

    // ?userId= bị bỏ qua: vẫn là dữ liệu của chính A.
    const other = await get(x, `/api/me/sessions?userId=${b.userId}`, a);
    expect(other.json().items.map((i: { sessionId: string }) => i.sessionId)).toEqual([i3, i2, i1]);
    // B chỉ thấy lượt của B.
    const mine = await get(x, '/api/me/sessions', b);
    expect(mine.json().items.map((i: { sessionId: string }) => i.sessionId)).toEqual([ib]);
    expect(mine.json().total).toBe(1);
  });

  it('a guest session finished with the account cookie appears in the history', async () => {
    const x = mk();
    const a = await signUp(x, 'Ann');
    x.clock.now = T0;
    const s = await startSession(x);
    x.clock.now = T0 + 60_000;
    await submit(x, s, { score: 5 }, a.cookie);
    expect((await get(x, '/api/me/sessions', a)).json().total).toBe(1);
  });

  it('pagination: limit/page, out-of-range page is empty with the right total', async () => {
    const x = mk();
    const a = await signUp(x, 'Ann');
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await play(x, a, { score: i, startAt: T0 + i * 100_000 }));
    const p1 = (await get(x, '/api/me/sessions?limit=2', a)).json();
    expect(p1).toMatchObject({ total: 5, page: 1, limit: 2 });
    expect(p1.items.map((i: { sessionId: string }) => i.sessionId)).toEqual([ids[4], ids[3]]);
    const p3 = (await get(x, '/api/me/sessions?limit=2&page=3', a)).json();
    expect(p3.items.map((i: { sessionId: string }) => i.sessionId)).toEqual([ids[0]]);
    const far = (await get(x, '/api/me/sessions?limit=2&page=99', a)).json();
    expect(far).toEqual({ items: [], total: 5, page: 99, limit: 2 });
    expect((await get(x, '/api/me/sessions?limit=50&page=10000', a)).statusCode).toBe(200);
  });

  it.each([
    'limit=51',
    'limit=0',
    'page=0',
    'page=10001',
    'limit=1e1',
    'limit=%202',
    'limit=+2',
    'limit=abc',
    'limit=',
    'limit=1&limit=2',
    'page=1&page=2',
    'page=-1',
    'limit=2.5',
    'limit=1234567890',
  ])('400 VALIDATION_ERROR for ?%s', async (qs) => {
    const x = mk();
    const a = await signUp(x, 'Ann');
    expectError(await get(x, `/api/me/sessions?${qs}`, a), 400, 'VALIDATION_ERROR');
  });

  it('401 precedes query validation', async () => {
    const x = mk();
    expectError(await get(x, '/api/me/sessions?limit=999', null), 401, 'UNAUTHORIZED');
  });

  it('rate limited by accountRead (429) before auth', async () => {
    const x = mk({ rateLimits: { accountRead: { limit: 2, windowMs: 60_000 } } });
    const a = await signUp(x, 'Ann');
    expect((await get(x, '/api/me/sessions', a)).statusCode).toBe(200);
    expect((await get(x, '/api/me/bests', a)).statusCode).toBe(200);
    const res = await get(x, '/api/me/sessions', a);
    expectError(res, 429, 'RATE_LIMITED');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /api/me/bests (AC26)', () => {
  it('401 without login; empty list when nothing played', async () => {
    const x = mk();
    expectError(await get(x, '/api/me/bests', null), 401, 'UNAUTHORIZED');
    const a = await signUp(x, 'Ann');
    const res = await get(x, '/api/me/bests', a);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({ items: [] });
  });

  it('best per game by score_order, plays counts all finished (incl. rejected), hidden excluded', async () => {
    const x = mk();
    const a = await signUp(x, 'Ann');
    const b = await signUp(x, 'Bob');
    await play(x, a, { score: 10, startAt: T0 });
    await play(x, a, { score: 30, startAt: T0 + 100_000 });
    const hiddenId = await play(x, a, { score: 50, startAt: T0 + 200_000 });
    x.repo.setHidden(hiddenId, true);
    await play(x, a, { score: 800, startAt: T0 + 300_000, durationMs: 1000 }); // rejected
    await play(x, a, {
      game: 'memory-match',
      score: 20,
      startAt: T0 + 400_000,
      durationMs: 100_000,
    });
    await play(x, a, {
      game: 'memory-match',
      score: 14,
      startAt: T0 + 500_000,
      durationMs: 100_000,
    });
    await play(x, a, {
      game: 'memory-match',
      score: 18,
      startAt: T0 + 600_000,
      durationMs: 100_000,
    });
    await play(x, b, { score: 99, startAt: T0 + 700_000 });
    await startSession(x, 'snake', a.cookie); // active: không đếm

    const res = await get(x, '/api/me/bests', a);
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([
      {
        gameId: 'memory-match',
        gameTitle: 'Memory Match',
        scoreOrder: 'asc',
        score: 14,
        durationMs: 100_000,
        achievedAt: new Date(T0 + 600_000).toISOString(),
        plays: 3,
      },
      {
        gameId: 'snake',
        gameTitle: 'Snake',
        scoreOrder: 'desc',
        score: 30,
        durationMs: 60_000,
        achievedAt: new Date(T0 + 160_000).toISOString(),
        plays: 4,
      },
    ]);
  });

  it('a game with only rejected plays has no entry; query userId is ignored', async () => {
    const x = mk();
    const a = await signUp(x, 'Ann');
    const b = await signUp(x, 'Bob');
    await play(x, a, { score: 800, startAt: T0, durationMs: 1000 });
    await play(x, b, { score: 10, startAt: T0 + 100_000 });
    expect((await get(x, '/api/me/bests', a)).json()).toEqual({ items: [] });
    const viaQuery = await get(x, `/api/me/bests?userId=${b.userId}`, a);
    expect(viaQuery.json()).toEqual({ items: [] });
  });
});
