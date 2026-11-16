import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  JSON_HEADERS,
  makeHarness,
  startSession,
  submit,
  T0,
  type Harness,
} from './test-helpers.ts';

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('POST /api/sessions', () => {
  it('creates a session (AC3)', async () => {
    const x = mk();
    const res = await x.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: JSON_HEADERS,
      payload: { gameId: 'snake' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['session', 'sessionToken']);
    expect(body.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.session).toEqual({
      id: expect.stringMatching(UUID),
      gameId: 'snake',
      status: 'active',
      startedAt: new Date(T0).toISOString(),
      expiresAt: new Date(T0 + 2 * 3600 * 1000).toISOString(),
      endedAt: null,
      score: null,
      durationMs: null,
      playerName: null,
    });
    // DB chỉ lưu hash của token.
    const stored = x.repo.storedHash(body.session.id);
    expect(stored?.toString('hex')).toBe(
      createHash('sha256').update(body.sessionToken).digest('hex'),
    );
    expect(JSON.stringify(x.repo.all())).not.toContain(body.sessionToken);
  });

  it('issues distinct tokens and ids', async () => {
    const x = mk();
    const a = await startSession(x);
    const b = await startSession(x);
    expect(a.id).not.toBe(b.id);
    expect(a.token).not.toBe(b.token);
  });

  it('works for memory-match (asc game)', async () => {
    const x = mk();
    expect((await startSession(x, 'memory-match')).id).toMatch(UUID);
  });

  it('422 GAME_NOT_RANKED for tic-tac-toe, no row created (AC4)', async () => {
    const x = mk();
    const res = await x.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: JSON_HEADERS,
      payload: { gameId: 'tic-tac-toe' },
    });
    expectError(res, 422, 'GAME_NOT_RANKED');
    expect(x.repo.all()).toHaveLength(0);
  });

  it('422 GAME_NOT_RANKED for chess; 201 for maze-chomp (F5 AC10)', async () => {
    const x = mk();
    const res = await x.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: JSON_HEADERS,
      payload: { gameId: 'chess' },
    });
    expectError(res, 422, 'GAME_NOT_RANKED');
    expect(x.repo.all()).toHaveLength(0);
    const ok = await x.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: JSON_HEADERS,
      payload: { gameId: 'maze-chomp' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().session.gameId).toBe('maze-chomp');
  });

  it.each(['no-such-game', 'Snake', 'a'.repeat(65), 'sn/ake', '..', ''])(
    '404 for unknown or malformed slug %j (AC4)',
    async (gameId) => {
      const x = mk();
      const res = await x.app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: JSON_HEADERS,
        payload: { gameId },
      });
      expectError(res, 404, 'NOT_FOUND');
      expect(x.repo.all()).toHaveLength(0);
    },
  );

  it.each([
    ['number', '{"gameId":5}'],
    ['null', '{"gameId":null}'],
    ['missing', '{}'],
    ['array body', '[]'],
    ['malformed', '{"gameId":'],
    ['empty', ''],
  ])('400 VALIDATION_ERROR for %s gameId/body (AC4)', async (_l, payload) => {
    const x = mk();
    const res = await x.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: JSON_HEADERS,
      payload,
    });
    expectError(res, 400, 'VALIDATION_ERROR');
  });

  it('ignores unknown body fields (contract)', async () => {
    const x = mk();
    const res = await x.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: JSON_HEADERS,
      payload: { gameId: 'snake', extra: 1 },
    });
    expect(res.statusCode).toBe(201);
  });

  it('413 and 415 (AC1)', async () => {
    const x = mk();
    const big = await x.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: JSON_HEADERS,
      payload: JSON.stringify({ gameId: 'a'.repeat(2000) }),
    });
    expectError(big, 413, 'PAYLOAD_TOO_LARGE');
    const txt = await x.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { 'content-type': 'text/plain' },
      payload: 'gameId=snake',
    });
    expectError(txt, 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('500 with generic body when the repository fails', async () => {
    const x = mk();
    x.repo.findGameRule = async () => {
      throw new Error('connection refused to secret-host:5432');
    };
    const res = await x.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: JSON_HEADERS,
      payload: { gameId: 'snake' },
    });
    expectError(res, 500, 'INTERNAL_ERROR');
    expect(res.body).not.toContain('secret-host');
  });
});

describe('POST /api/sessions/:id/score', () => {
  it('accepts a valid score and normalizes the name (AC5)', async () => {
    const x = mk();
    const s = await startSession(x);
    x.clock.now = T0 + 60_000;
    const res = await submit(x, s, { score: 17, playerName: '  Lan  ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      session: {
        id: s.id,
        gameId: 'snake',
        status: 'finished',
        startedAt: new Date(T0).toISOString(),
        expiresAt: new Date(T0 + 7_200_000).toISOString(),
        endedAt: new Date(T0 + 60_000).toISOString(),
        score: 17,
        durationMs: 60_000,
        playerName: 'Lan',
      },
      rank: 1,
      personalBest: true,
    });
    const lb = await x.app.inject({ method: 'GET', url: '/api/games/snake/leaderboard' });
    expect(lb.json().items).toEqual([
      {
        rank: 1,
        playerName: 'Lan',
        isMember: false,
        score: 17,
        durationMs: 60_000,
        achievedAt: new Date(T0 + 60_000).toISOString(),
      },
    ]);
  });

  it('two concurrent identical submissions both get 200, one row finished (AC6)', async () => {
    const x = mk();
    const s = await startSession(x);
    x.clock.now = T0 + 60_000;
    const [a, b] = await Promise.all([
      submit(x, s, { score: 10, playerName: 'Lan' }),
      submit(x, s, { score: 10, playerName: 'Lan' }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(a.json().session.id).toBe(b.json().session.id);
    expect(x.repo.all().filter((r) => r.status === 'finished')).toHaveLength(1);
    const lb = await x.app.inject({ method: 'GET', url: '/api/games/snake/leaderboard' });
    expect(lb.json().items).toHaveLength(1);
  });

  it('two concurrent different submissions: exactly one 200, other 409 (AC6)', async () => {
    const x = mk();
    const s = await startSession(x);
    x.clock.now = T0 + 60_000;
    const res = await Promise.all([
      submit(x, s, { score: 10, playerName: 'Lan' }),
      submit(x, s, { score: 11, playerName: 'Lan' }),
    ]);
    const codes = res.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
    const loser = res.find((r) => r.statusCode === 409);
    expect(loser?.json().code).toBe('SESSION_NOT_ACTIVE');
    expect(x.repo.all().filter((r) => r.status === 'finished')).toHaveLength(1);
  });

  it('is idempotent after 200 and 409 on different data (AC7)', async () => {
    const x = mk();
    const s = await startSession(x);
    x.clock.now = T0 + 60_000;
    const first = await submit(x, s, { score: 17, playerName: 'Lan' });
    x.clock.now = T0 + 90_000;
    const again = await submit(x, s, { score: 17, playerName: ' Lan ' });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    expectError(await submit(x, s, { score: 18, playerName: 'Lan' }), 409, 'SESSION_NOT_ACTIVE');
    expectError(await submit(x, s, { score: 17, playerName: 'Minh' }), 409, 'SESSION_NOT_ACTIVE');
  });

  it('replays 422 after a rejected submission (AC7)', async () => {
    const x = mk();
    const s = await startSession(x);
    const body = { score: 500, playerName: 'Cheat' };
    expectError(await submit(x, s, body), 422, 'SCORE_REJECTED');
    expectError(await submit(x, s, body), 422, 'SCORE_REJECTED');
    expectError(await submit(x, s, { score: 1, playerName: 'Cheat' }), 409, 'SESSION_NOT_ACTIVE');
  });

  it('replay still works after the session passed expiresAt', async () => {
    const x = mk();
    const s = await startSession(x);
    x.clock.now = T0 + 60_000;
    await submit(x, s, { score: 17, playerName: 'Lan' });
    x.clock.now = T0 + 3 * 3600 * 1000;
    expect((await submit(x, s, { score: 17, playerName: 'Lan' })).statusCode).toBe(200);
  });

  it('401 for missing or malformed token header, even with a bad body (AC8)', async () => {
    const x = mk();
    const s = await startSession(x);
    const url = `/api/sessions/${s.id}/score`;
    const payload = JSON.stringify({ score: 1, playerName: 'Lan' });
    const bad = ['', 'short', 'a'.repeat(44), `${'a'.repeat(42)}!`, `${'a'.repeat(42)}=`];
    for (const t of bad) {
      const res = await x.app.inject({
        method: 'POST',
        url,
        headers: { ...JSON_HEADERS, 'x-session-token': t },
        payload,
      });
      expectError(res, 401, 'UNAUTHORIZED');
    }
    expectError(
      await x.app.inject({ method: 'POST', url, headers: JSON_HEADERS, payload: 'not json' }),
      401,
      'UNAUTHORIZED',
    );
    // token trong query bị bỏ qua
    expectError(
      await x.app.inject({
        method: 'POST',
        url: `${url}?token=${s.token}&sessionToken=${s.token}`,
        headers: JSON_HEADERS,
        payload,
      }),
      401,
      'UNAUTHORIZED',
    );
    expect(x.repo.all()[0]?.status).toBe('active');
  });

  it('404 for a wrong token, session stays active and the right token still works (AC8)', async () => {
    const x = mk();
    const s = await startSession(x);
    const wrong = { id: s.id, token: 'A'.repeat(43) };
    x.clock.now = T0 + 60_000;
    expectError(await submit(x, wrong, { score: 1, playerName: 'Lan' }), 404, 'NOT_FOUND');
    expect(x.repo.all()[0]?.status).toBe('active');
    expect((await submit(x, s, { score: 1, playerName: 'Lan' })).statusCode).toBe(200);
  });

  it("404 when using session A's token for session B (AC9)", async () => {
    const x = mk();
    const a = await startSession(x);
    const b = await startSession(x);
    expectError(
      await submit(x, { id: b.id, token: a.token }, { score: 1, playerName: 'L' }),
      404,
      'NOT_FOUND',
    );
    expect(x.repo.all().every((r) => r.status === 'active')).toBe(true);
  });

  it.each(['abc', '3F0C6A52-6A43-4B8E-9F62-0A3F7B2D9C11', '00000000-0000-0000-0000-000000000000'])(
    '404 for bad or unknown session id %j',
    async (id) => {
      const x = mk();
      const res = await submit(x, { id, token: 'A'.repeat(43) }, { score: 1, playerName: 'Lan' });
      expectError(res, 404, 'NOT_FOUND');
    },
  );

  it('bad id does not hit the repository', async () => {
    const x = mk();
    let calls = 0;
    x.repo.findByIdAndTokenHash = async () => {
      calls++;
      return null;
    };
    await submit(x, { id: 'zzz', token: 'A'.repeat(43) }, { score: 1, playerName: 'Lan' });
    expect(calls).toBe(0);
  });

  it('memory too fast and boundaries (AC10)', async () => {
    const x = mk();
    const s1 = await startSession(x, 'memory-match');
    x.clock.now = T0 + 2999;
    expectError(await submit(x, s1, { score: 8, playerName: 'Mia' }), 422, 'SCORE_REJECTED');
    const row = x.repo.all().find((r) => r.id === s1.id);
    expect(row).toMatchObject({
      status: 'finished',
      result: 'rejected',
      rejectReason: 'DURATION_TOO_SHORT',
    });
    expectError(await submit(x, s1, { score: 9, playerName: 'Mia' }), 409, 'SESSION_NOT_ACTIVE');

    x.clock.now = T0;
    const s2 = await startSession(x, 'memory-match');
    x.clock.now = T0 + 14_999;
    expectError(await submit(x, s2, { score: 20, playerName: 'Mia' }), 422, 'SCORE_REJECTED');
    x.clock.now = T0;
    const s3 = await startSession(x, 'memory-match');
    x.clock.now = T0 + 15_000;
    expect((await submit(x, s3, { score: 20, playerName: 'Mia' })).statusCode).toBe(200);
    const s4 = await startSession(x, 'memory-match');
    x.clock.now = T0 + 90_000;
    expectError(await submit(x, s4, { score: 7, playerName: 'Mia' }), 422, 'SCORE_REJECTED');
  });

  it('score ceilings (AC11)', async () => {
    const x = mk();
    const cases: [string, number, number, number][] = [
      ['snake', 901, 3_600_000, 422],
      ['snake', 156, 60_000, 422],
      ['snake', 155, 60_000, 200],
      ['brick-breaker', 46, 0, 422],
      ['brick-breaker', 45, 0, 200],
      ['merge-2048', 250_001, 7_000_000, 422],
    ];
    for (const [game, score, ms, status] of cases) {
      x.clock.now = T0;
      const s = await startSession(x, game);
      x.clock.now = T0 + ms;
      const res = await submit(x, s, { score, playerName: 'Zed' });
      expect([game, score, res.statusCode]).toEqual([game, score, status]);
    }
  });

  it('bad body types: 400 and the session is not consumed (AC12)', async () => {
    const x = mk();
    const s = await startSession(x);
    x.clock.now = T0 + 60_000;
    const scores: unknown[] = ['17', 17.5, -1, 1_000_000_001, true, null, [], {}, 1e21];
    for (const score of scores) {
      expectError(await submit(x, s, { score, playerName: 'Lan' }), 400, 'VALIDATION_ERROR');
    }
    expectError(await submit(x, s, { playerName: 'Lan' }), 400, 'VALIDATION_ERROR');
    const names: unknown[] = [
      '',
      '   ',
      'x'.repeat(21),
      'a<b',
      '‮abc',
      'ab​',
      'a\u{1f600}',
      'à́̂',
      5,
      null,
    ];
    for (const playerName of names) {
      expectError(await submit(x, s, { score: 5, playerName }), 400, 'VALIDATION_ERROR');
    }
    expectError(await submit(x, s, { score: 5 }), 400, 'VALIDATION_ERROR');
    expectError(await submit(x, s, '[]'), 400, 'VALIDATION_ERROR');
    expectError(await submit(x, s, '{"score":'), 400, 'VALIDATION_ERROR');
    expect(x.repo.all()[0]?.status).toBe('active');
    expect((await submit(x, s, { score: 5, playerName: 'Lan' })).statusCode).toBe(200);
  });

  it('accepts boundary scores 0 and Vietnamese names with stacked marks', async () => {
    const x = mk();
    const s = await startSession(x);
    const res = await submit(x, s, { score: 0, playerName: 'Nguyễn Văn Ệ' });
    expect(res.statusCode).toBe(200);
    expect(res.json().session.playerName).toBe('Nguyễn Văn Ệ');
  });

  it('413 / 415 on the score endpoint', async () => {
    const x = mk();
    const s = await startSession(x);
    expectError(
      await submit(x, s, JSON.stringify({ score: 1, playerName: 'a'.repeat(2000) })),
      413,
      'PAYLOAD_TOO_LARGE',
    );
    expectError(
      await submit(x, s, 'score=1', { 'content-type': 'text/plain' }),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
  });

  it('expired session: 409 SESSION_EXPIRED, row stays active (AC13)', async () => {
    const x = mk();
    const s = await startSession(x);
    x.clock.now = T0 + 2 * 3600 * 1000;
    expectError(await submit(x, s, { score: 1, playerName: 'Lan' }), 409, 'SESSION_EXPIRED');
    expect(x.repo.all()[0]?.status).toBe('active');
    const lb = await x.app.inject({ method: 'GET', url: '/api/games/snake/leaderboard' });
    expect(lb.json().items).toEqual([]);
    // ngay trước hạn vẫn nộp được
    x.clock.now = T0 + 2 * 3600 * 1000 - 1;
    expect(x.clock.now - T0).toBeLessThan(2 * 3600 * 1000);
  });

  it('last millisecond before expiry is accepted (AC13)', async () => {
    const x = mk();
    const s = await startSession(x, 'merge-2048');
    x.clock.now = T0 + 2 * 3600 * 1000 - 1;
    expect((await submit(x, s, { score: 100, playerName: 'Lan' })).statusCode).toBe(200);
  });

  it('rank and personalBest (AC19)', async () => {
    const x = mk();
    const play = async (name: string, score: number, ms: number) => {
      x.clock.now = T0;
      const s = await startSession(x);
      x.clock.now = T0 + ms;
      return (await submit(x, s, { score, playerName: name })).json();
    };
    expect(await play('Ann', 50, 60_000)).toMatchObject({ rank: 1, personalBest: true });
    expect(await play('Bob', 30, 60_000)).toMatchObject({ rank: 2, personalBest: true });
    expect(await play('bob', 20, 60_000)).toMatchObject({ rank: 2, personalBest: false });
    expect(await play('Cid', 60, 60_000)).toMatchObject({ rank: 1, personalBest: true });
    expect(await play('Ann', 70, 60_000)).toMatchObject({ rank: 1, personalBest: true });
  });

  it('memory ranks ascending', async () => {
    const x = mk();
    const play = async (name: string, score: number) => {
      x.clock.now = T0;
      const s = await startSession(x, 'memory-match');
      x.clock.now = T0 + 120_000;
      return (await submit(x, s, { score, playerName: name })).json();
    };
    expect(await play('Ann', 12)).toMatchObject({ rank: 1 });
    expect(await play('Bob', 10)).toMatchObject({ rank: 1 });
    expect(await play('Cid', 11)).toMatchObject({ rank: 2 });
  });

  it('500 generic when the repository fails', async () => {
    const x = mk();
    const s = await startSession(x);
    x.repo.finish = async () => {
      throw new Error('deadlock at db-internal');
    };
    x.clock.now = T0 + 60_000;
    const res = await submit(x, s, { score: 1, playerName: 'Lan' });
    expectError(res, 500, 'INTERNAL_ERROR');
    expect(res.body).not.toContain('db-internal');
  });
});

describe('rate limiting (AC15)', () => {
  it('POST /sessions: 3rd request in the window is 429, even with a broken body', async () => {
    const x = mk({ rateLimits: { createSession: { limit: 2, windowMs: 60_000 } } });
    await startSession(x);
    await startSession(x);
    const res = await x.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: JSON_HEADERS,
      payload: '{broken',
    });
    expectError(res, 429, 'RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    x.clock.now += 60_001;
    await startSession(x);
  });

  it('other IPs are unaffected', async () => {
    const x = mk({ rateLimits: { createSession: { limit: 1, windowMs: 60_000 } } });
    await startSession(x);
    const other = await x.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: JSON_HEADERS,
      payload: { gameId: 'snake' },
      remoteAddress: '10.9.9.9',
    });
    expect(other.statusCode).toBe(201);
  });

  it('score submissions are limited before token/body checks', async () => {
    const x = mk({ rateLimits: { submitScore: { limit: 1, windowMs: 60_000 } } });
    const s = await startSession(x);
    x.clock.now = T0 + 1000;
    expect((await submit(x, s, { score: 1, playerName: 'Lan' })).statusCode).toBe(200);
    const res = await x.app.inject({
      method: 'POST',
      url: '/api/sessions/nonsense/score',
      payload: 'x',
    });
    expectError(res, 429, 'RATE_LIMITED');
  });

  it('leaderboard is limited', async () => {
    const x = mk({ rateLimits: { leaderboard: { limit: 1, windowMs: 60_000 } } });
    expect(
      (await x.app.inject({ method: 'GET', url: '/api/games/snake/leaderboard' })).statusCode,
    ).toBe(200);
    const res = await x.app.inject({ method: 'GET', url: '/api/games/snake/leaderboard' });
    expectError(res, 429, 'RATE_LIMITED');
  });
});

describe('logging (AC17)', () => {
  function capture() {
    const lines: string[] = [];
    const stream = { write: (l: string) => void lines.push(l) };
    return { lines, logger: { level: 'info', stream } as never };
  }

  it('logs every rejected submission as warn without token, hash, IP or nickname', async () => {
    const { lines, logger } = capture();
    const x = mk({ logger, rateLimits: { submitScore: { limit: 12, windowMs: 60_000 } } });
    const s = await startSession(x);
    const secretName = 'Zorbaxqux';
    const hashHex = x.repo.storedHash(s.id)?.toString('hex') ?? 'x';
    const hashB64 = x.repo.storedHash(s.id)?.toString('base64') ?? 'x';
    const other = await startSession(x);

    // 401, 404 (id), 404 (token), 400, 422, 409, 409 expired, 413, 415
    await submit(x, s, { score: 1, playerName: secretName }, { 'x-session-token': 'bad' });
    await submit(x, { id: 'nope', token: s.token }, { score: 1, playerName: secretName });
    await submit(x, { id: s.id, token: 'B'.repeat(43) }, { score: 1, playerName: secretName });
    await submit(x, s, { score: 'x', playerName: secretName });
    await submit(x, s, { score: 901, playerName: secretName });
    await submit(x, s, { score: 2, playerName: secretName });
    x.clock.now = T0 + 3 * 3600 * 1000;
    await submit(x, other, { score: 1, playerName: secretName });
    await submit(x, other, JSON.stringify({ playerName: 'a'.repeat(2000) }));
    await submit(x, other, 'x', { 'content-type': 'text/plain' });
    await x.app.inject({
      method: 'POST',
      url: `/api/sessions/${s.id}/score?token=${s.token}`,
      headers: JSON_HEADERS,
      payload: '{}',
    });
    // 429
    for (let i = 0; i < 13; i++) await submit(x, other, { score: 1, playerName: secretName });

    const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const rejected = records.filter((r) => r.event === 'score_rejected');
    expect(rejected.every((r) => r.level === 40)).toBe(true);
    const reasons = new Set(rejected.map((r) => r.reason));
    for (const reason of [
      'UNAUTHORIZED',
      'NOT_FOUND',
      'VALIDATION_ERROR',
      'SCORE_OUT_OF_RANGE',
      'SESSION_NOT_ACTIVE',
      'SESSION_EXPIRED',
      'PAYLOAD_TOO_LARGE',
      'UNSUPPORTED_MEDIA_TYPE',
      'RATE_LIMITED',
    ]) {
      expect(reasons, reason).toContain(reason);
    }
    const all = lines.join('\n');
    for (const secret of [s.token, other.token, hashHex, hashB64, secretName, '127.0.0.1']) {
      expect(all).not.toContain(secret);
    }
    expect(all).not.toMatch(/x-session-token/i);
  });
});
