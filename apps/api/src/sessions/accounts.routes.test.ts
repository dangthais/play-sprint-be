import { afterEach, describe, expect, it } from 'vitest';
import {
  JSON_HEADERS,
  makeHarness,
  signUp,
  startSession,
  submit,
  T0,
  WEB,
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

const stored = (x: Harness, id: string) => x.repo.all().find((s) => s.id === id);
const board = (x: Harness, game = 'snake') =>
  x.app.inject({ method: 'GET', url: `/api/games/${game}/leaderboard` });

describe('POST /api/sessions with an account (AC17)', () => {
  it('stores user_id for a valid cookie; response is unchanged and leaks no user id', async () => {
    const x = mk();
    const lan = await signUp(x, 'Lan');
    const res = await x.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { ...JSON_HEADERS, ...lan.cookie },
      payload: { gameId: 'snake' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['session', 'sessionToken']);
    expect(Object.keys(body.session).sort()).toEqual(
      [
        'endedAt',
        'durationMs',
        'expiresAt',
        'gameId',
        'id',
        'playerName',
        'score',
        'startedAt',
        'status',
      ].sort(),
    );
    expect(JSON.stringify(body)).not.toContain(lan.userId);
    expect(stored(x, body.session.id)?.userId).toBe(lan.userId);
  });

  it('no cookie, a malformed cookie or an unknown token -> guest session (201, user_id null)', async () => {
    const x = mk();
    const a = await startSession(x);
    const b = await startSession(x, 'snake', { cookie: 'qp_sid=short', origin: WEB });
    const c = await startSession(x, 'snake', {
      cookie: `qp_sid=${'A'.repeat(43)}`,
      origin: WEB,
    });
    for (const s of [a, b, c]) expect(stored(x, s.id)?.userId).toBeNull();
  });

  it('403 FORBIDDEN when a cookie is present without Origin or with a foreign Origin', async () => {
    const x = mk();
    const lan = await signUp(x, 'Lan');
    const noOrigin = await x.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { ...JSON_HEADERS, cookie: lan.cookie.cookie as string },
      payload: { gameId: 'snake' },
    });
    expectError(noOrigin, 403, 'FORBIDDEN');
    const foreign = await x.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { ...JSON_HEADERS, origin: 'https://evil.example' },
      payload: { gameId: 'snake' },
    });
    expectError(foreign, 403, 'FORBIDDEN');
    expect(x.repo.all()).toHaveLength(0);
  });
});

describe('POST /api/sessions/:id/score as an account (AC18, AC19, AC20)', () => {
  it('AC18: no playerName needed; session.playerName is the display name; playerName is ignored', async () => {
    const x = mk();
    const lan = await signUp(x, 'Lan');
    const s1 = await startSession(x, 'snake', lan.cookie);
    x.clock.now = T0 + 60_000;
    const r1 = await submit(x, s1, { score: 17 }, lan.cookie);
    expect(r1.statusCode).toBe(200);
    expect(r1.json().session.playerName).toBe('Lan');
    expect(r1.json()).toMatchObject({ rank: 1, personalBest: true });

    const s2 = await startSession(x, 'snake', lan.cookie);
    x.clock.now = T0 + 120_000;
    // `playerName` bị bỏ qua hoàn toàn: kể cả giá trị sai kiểu/định dạng hoặc trùng tên người khác.
    for (const bad of ['<b>', 123, null, { a: 1 }]) {
      const s = await startSession(x, 'snake', lan.cookie);
      const r = await submit(x, s, { score: 3, playerName: bad }, lan.cookie);
      expect(r.statusCode).toBe(200);
      expect(r.json().session.playerName).toBe('Lan');
    }
    expect((await submit(x, s2, { score: 4, playerName: 'Other' }, lan.cookie)).statusCode).toBe(
      200,
    );
    expect(stored(x, s2.id)).toMatchObject({
      playerName: 'Lan',
      playerKey: 'lan',
      userId: lan.userId,
    });
  });

  it('AC18: score is still validated for accounts', async () => {
    const x = mk();
    const lan = await signUp(x, 'Lan');
    const s = await startSession(x, 'snake', lan.cookie);
    for (const score of ['5', -1, 1.5, 1e10, null]) {
      expectError(await submit(x, s, { score }, lan.cookie), 400, 'VALIDATION_ERROR');
    }
    expect(stored(x, s.id)?.status).toBe('active');
  });

  it('AC19: an account session is 404 without cookie or with another account; stays active', async () => {
    const x = mk();
    const a = await signUp(x, 'Ann');
    const b = await signUp(x, 'Bob');
    const s = await startSession(x, 'snake', a.cookie);
    x.clock.now = T0 + 60_000;
    expectError(await submit(x, s, { score: 5, playerName: 'Zed' }), 404, 'NOT_FOUND');
    expectError(await submit(x, s, { score: 5 }, b.cookie), 404, 'NOT_FOUND');
    // cookie hỏng ⇒ khách ⇒ 404
    expectError(
      await submit(x, s, { score: 5, playerName: 'Zed' }, { cookie: 'qp_sid=zzz', origin: WEB }),
      404,
      'NOT_FOUND',
    );
    expect(stored(x, s.id)?.status).toBe('active');
    expect((await submit(x, s, { score: 5 }, a.cookie)).statusCode).toBe(200);
  });

  it('403 when an account cookie is sent without Origin (checked before 404/401)', async () => {
    const x = mk();
    const a = await signUp(x, 'Ann');
    const s = await startSession(x, 'snake', a.cookie);
    const res = await submit(x, s, { score: 5 }, { cookie: a.cookie.cookie as string });
    expectError(res, 403, 'FORBIDDEN');
    expect(stored(x, s.id)?.status).toBe('active');
  });

  it('the session token is still required for accounts (401)', async () => {
    const x = mk();
    const a = await signUp(x, 'Ann');
    const s = await startSession(x, 'snake', a.cookie);
    const res = await x.app.inject({
      method: 'POST',
      url: `/api/sessions/${s.id}/score`,
      headers: { ...JSON_HEADERS, ...a.cookie },
      payload: { score: 5 },
    });
    expectError(res, 401, 'UNAUTHORIZED');
    // token sai (đúng định dạng) → 404
    expectError(
      await submit(x, { id: s.id, token: 'A'.repeat(43) }, { score: 5 }, a.cookie),
      404,
      'NOT_FOUND',
    );
  });

  it('AC20: a guest session submitted with an account cookie is attached to the account', async () => {
    const x = mk();
    const a = await signUp(x, 'Ann');
    const s = await startSession(x); // tạo khi chưa đăng nhập
    expect(stored(x, s.id)?.userId).toBeNull();
    x.clock.now = T0 + 60_000;
    const res = await submit(x, s, { score: 17 }, a.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().session.playerName).toBe('Ann');
    expect(stored(x, s.id)?.userId).toBe(a.userId);
    const lb = (await board(x)).json().items;
    expect(lb).toHaveLength(1);
    expect(lb[0]).toMatchObject({ playerName: 'Ann', isMember: true, score: 17 });
  });
});

describe('guest names vs accounts (AC21)', () => {
  it('409 NAME_TAKEN (case-insensitive, normalised), session stays active, retry with another name works', async () => {
    const lines: string[] = [];
    const x = mk({
      logger: { level: 'info', stream: { write: (l: string) => void lines.push(l) } } as never,
    });
    await signUp(x, 'Lan');
    const s = await startSession(x);
    x.clock.now = T0 + 60_000;
    for (const name of ['lan', 'LAN', '  Lan  ']) {
      expectError(await submit(x, s, { score: 5, playerName: name }), 409, 'NAME_TAKEN');
    }
    expect(stored(x, s.id)).toMatchObject({ status: 'active', score: null });
    const ok = await submit(x, s, { score: 5, playerName: 'Lan2' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().session.playerName).toBe('Lan2');

    const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const rejected = records.filter(
      (r) => r.event === 'score_rejected' && r.reason === 'NAME_TAKEN',
    );
    expect(rejected).toHaveLength(3);
    const all = lines.join('\n');
    expect(all).not.toContain('Lan2');
    expect(all).not.toMatch(/"lan"/i);
    expect(all).not.toContain(s.token);
  });

  it('a guest may use a name that no account has; an account name is free again for other guests only if unused', async () => {
    const x = mk();
    await signUp(x, 'Lan');
    const s = await startSession(x);
    x.clock.now = T0 + 60_000;
    expect((await submit(x, s, { score: 5, playerName: 'Minh' })).statusCode).toBe(200);
  });

  it('400 when a guest omits playerName', async () => {
    const x = mk();
    const s = await startSession(x);
    expectError(await submit(x, s, { score: 5 }), 400, 'VALIDATION_ERROR');
    expect(stored(x, s.id)?.status).toBe('active');
  });

  it('an invalid cookie behaves as guest (name required and checked)', async () => {
    const x = mk();
    await signUp(x, 'Lan');
    const s = await startSession(x);
    const bad = { cookie: `qp_sid=${'B'.repeat(43)}`, origin: WEB };
    expectError(await submit(x, s, { score: 5 }, bad), 400, 'VALIDATION_ERROR');
    expectError(await submit(x, s, { score: 5, playerName: 'lan' }, bad), 409, 'NAME_TAKEN');
  });
});

describe('leaderboard identity (AC22)', () => {
  async function play(
    x: Harness,
    who: { cookie: Record<string, string> } | null,
    score: number,
    name: string | undefined,
    startAt: number,
    game = 'snake',
  ) {
    x.clock.now = startAt;
    const s = await startSession(x, game, who?.cookie ?? {});
    x.clock.now = startAt + 60_000;
    const res = await submit(
      x,
      s,
      name === undefined ? { score } : { score, playerName: name },
      who?.cookie ?? {},
    );
    expect(res.statusCode).toBe(200);
    return res.json() as { rank: number; personalBest: boolean };
  }

  it('merges account rows, keeps pre-registration guest rows separate, merges same-name guests', async () => {
    const x = mk();
    // Khách "Lan" có trước khi tài khoản "Lan" tồn tại.
    await play(x, null, 20, 'Lan', T0);
    const lan = await signUp(x, 'Lan');
    await play(x, lan, 10, undefined, T0 + 100_000);
    await play(x, lan, 30, undefined, T0 + 200_000);
    await play(x, null, 4, 'Minh', T0 + 300_000);
    await play(x, null, 6, 'minh', T0 + 400_000);
    const items = (await board(x)).json().items as {
      playerName: string;
      isMember: boolean;
      score: number;
      rank: number;
    }[];
    expect(items.map((i) => [i.rank, i.playerName, i.isMember, i.score])).toEqual([
      [1, 'Lan', true, 30],
      [2, 'Lan', false, 20],
      [3, 'minh', false, 6],
    ]);
  });

  it('shows the current display name after a rename (old rows included)', async () => {
    const x = mk();
    const lan = await signUp(x, 'Lan');
    await play(x, lan, 10, undefined, T0);
    await x.auth.updateDisplayName({
      userId: lan.userId,
      displayName: 'Lan Anh',
      displayNameKey: 'lan anh',
      now: new Date(T0),
    });
    const items = (await board(x)).json().items as { playerName: string; isMember: boolean }[];
    expect(items).toEqual([expect.objectContaining({ playerName: 'Lan Anh', isMember: true })]);
  });

  it('rank/personalBest follow the account key', async () => {
    const x = mk();
    const lan = await signUp(x, 'Lan');
    const bob = await signUp(x, 'Bob');
    expect(await play(x, lan, 30, undefined, T0)).toMatchObject({ rank: 1, personalBest: true });
    expect(await play(x, bob, 20, undefined, T0 + 100_000)).toMatchObject({
      rank: 2,
      personalBest: true,
    });
    // Lan nộp lượt kém hơn kỷ lục của chính mình.
    expect(await play(x, lan, 10, undefined, T0 + 200_000)).toMatchObject({
      rank: 2,
      personalBest: false,
    });
    // Khách tên khác tính như một người chơi riêng.
    expect(await play(x, null, 25, 'Cid', T0 + 300_000)).toMatchObject({
      rank: 2,
      personalBest: true,
    });
  });

  it('asc games rank lower-is-better per account', async () => {
    const x = mk();
    const lan = await signUp(x, 'Lan');
    expect(await play(x, lan, 20, undefined, T0, 'memory-match')).toMatchObject({
      rank: 1,
      personalBest: true,
    });
    expect(await play(x, lan, 14, undefined, T0 + 100_000, 'memory-match')).toMatchObject({
      rank: 1,
      personalBest: true,
    });
    expect(await play(x, lan, 30, undefined, T0 + 200_000, 'memory-match')).toMatchObject({
      rank: 1,
      personalBest: false,
    });
    const items = (await board(x, 'memory-match')).json().items as { score: number }[];
    expect(items.map((i) => i.score)).toEqual([14]);
  });
});

describe('idempotency and concurrency by identity (AC23, AC24)', () => {
  it('AC23: same account + same score replays; different score -> 409; other account -> 404', async () => {
    const x = mk();
    const a = await signUp(x, 'Ann');
    const b = await signUp(x, 'Bob');
    const s = await startSession(x, 'snake', a.cookie);
    x.clock.now = T0 + 60_000;
    const first = await submit(x, s, { score: 12 }, a.cookie);
    const again = await submit(x, s, { score: 12, playerName: 'ignored' }, a.cookie);
    expect(first.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    expectError(await submit(x, s, { score: 13 }, a.cookie), 409, 'SESSION_NOT_ACTIVE');
    expectError(await submit(x, s, { score: 12 }, b.cookie), 404, 'NOT_FOUND');
    // Khách không thể "replay" phiên của tài khoản.
    expectError(await submit(x, s, { score: 12, playerName: 'Ann' }), 404, 'NOT_FOUND');
  });

  it('AC23: a finished guest session is not replayable by an account (409) but is by the same guest', async () => {
    const x = mk();
    const a = await signUp(x, 'Ann');
    const s = await startSession(x);
    x.clock.now = T0 + 60_000;
    expect((await submit(x, s, { score: 12, playerName: 'Cid' })).statusCode).toBe(200);
    expect((await submit(x, s, { score: 12, playerName: 'cid' })).statusCode).toBe(409);
    expect((await submit(x, s, { score: 12, playerName: 'Cid' })).statusCode).toBe(200);
    expectError(await submit(x, s, { score: 12 }, a.cookie), 409, 'SESSION_NOT_ACTIVE');
  });

  it('AC23: rejected result is replayed as 422 for the same account', async () => {
    const x = mk();
    const a = await signUp(x, 'Ann');
    const s = await startSession(x, 'snake', a.cookie);
    x.clock.now = T0 + 1000;
    expectError(await submit(x, s, { score: 800 }, a.cookie), 422, 'SCORE_REJECTED');
    expectError(await submit(x, s, { score: 800 }, a.cookie), 422, 'SCORE_REJECTED');
    expectError(await submit(x, s, { score: 801 }, a.cookie), 409, 'SESSION_NOT_ACTIVE');
  });

  it('AC24: concurrent identical submissions by an account -> one row written, both 200', async () => {
    const x = mk();
    const a = await signUp(x, 'Ann');
    const s = await startSession(x, 'snake', a.cookie);
    x.clock.now = T0 + 60_000;
    const results = await Promise.all(
      Array.from({ length: 6 }, () => submit(x, s, { score: 9 }, a.cookie)),
    );
    expect(results.map((r) => r.statusCode)).toEqual(Array(6).fill(200));
    expect(x.repo.all().filter((r) => r.status === 'finished')).toHaveLength(1);
    expect(new Set(results.map((r) => JSON.stringify(r.json()))).size).toBe(1);
  });

  it('AC24: a guest and an account racing on the same guest session -> exactly one stored result', async () => {
    const x = mk();
    const a = await signUp(x, 'Ann');
    const s = await startSession(x);
    x.clock.now = T0 + 60_000;
    const [r1, r2] = await Promise.all([
      submit(x, s, { score: 9, playerName: 'Cid' }),
      submit(x, s, { score: 9 }, a.cookie),
    ]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    expect(x.repo.all().filter((r) => r.status === 'finished')).toHaveLength(1);
  });
});
