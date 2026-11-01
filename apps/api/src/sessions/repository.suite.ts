import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FinishInput, SessionsRepository } from './sessions.types.ts';
import { generateToken, hashToken } from './token.ts';

export interface RepositoryHarness {
  repo: SessionsRepository;
  /** Đặt `hidden` trực tiếp (quản trị ẩn tên bằng SQL). */
  setHidden(id: string, hidden: boolean): Promise<void>;
  /** Số dòng `finished` của game. */
  countFinished(gameId: string): Promise<number>;
  /** Tạo tài khoản (tên hiển thị duy nhất trong test) và trả id. */
  addUser(displayName: string): Promise<string>;
  /** Đổi tên hiển thị của tài khoản (leaderboard phải phản ánh tên hiện tại). */
  renameUser(id: string, displayName: string): Promise<void>;
}

const T0 = Date.UTC(2026, 9, 24, 8, 0, 0);
const TTL = 2 * 3600 * 1000;

/**
 * Bộ test ngữ nghĩa chung cho mọi cài đặt `SessionsRepository` (in-memory và pg).
 * `setup` phải trả repo mới, rỗng, đã có game `snake` (desc) và `memory-match` (asc).
 */
export function describeSessionsRepository(
  name: string,
  setup: () => Promise<RepositoryHarness>,
  opts: { skip?: boolean } = {},
): void {
  describe.skipIf(opts.skip === true)(`SessionsRepository semantics: ${name}`, () => {
    async function open(
      h: RepositoryHarness,
      gameId = 'snake',
      startedAt = T0,
      userId: string | null = null,
    ) {
      const token = generateToken();
      const tokenHash = hashToken(token);
      const id = randomUUID();
      await h.repo.create({
        id,
        gameId,
        tokenHash,
        startedAt: new Date(startedAt),
        expiresAt: new Date(startedAt + TTL),
        userId,
      });
      return { id, tokenHash };
    }

    function fin(
      s: { id: string; tokenHash: Buffer },
      over: Partial<FinishInput> = {},
    ): FinishInput {
      return {
        id: s.id,
        tokenHash: s.tokenHash,
        now: new Date(T0 + 60_000),
        durationMs: 60_000,
        score: 10,
        playerName: 'Lan',
        playerKey: 'lan',
        result: 'accepted',
        rejectReason: null,
        userId: null,
        ...over,
      };
    }

    it('findGameRule: ranked, unranked-with-no-rule, unknown', async () => {
      const h = await setup();
      const snake = await h.repo.findGameRule('snake');
      expect(snake?.rule).toMatchObject({ gameId: 'snake', scoreOrder: 'desc', maxScore: 900 });
      expect(snake?.rule?.maxScorePerSec).toBe(2.5);
      expect((await h.repo.findGameRule('memory-match'))?.rule).toMatchObject({
        scoreOrder: 'asc',
        minMsPerScore: 1000,
        maxScorePerSec: null,
      });
      expect(await h.repo.findGameRule('tic-tac-toe')).toEqual({ rule: null });
      expect(await h.repo.findGameRule('nope')).toBeNull();
    });

    it('create + find by id and token hash; wrong token or id → null', async () => {
      const h = await setup();
      const s = await open(h);
      const found = await h.repo.findByIdAndTokenHash(s.id, s.tokenHash);
      expect(found?.session).toMatchObject({
        id: s.id,
        gameId: 'snake',
        status: 'active',
        endedAt: null,
        score: null,
        result: null,
      });
      expect(found?.session.startedAt.getTime()).toBe(T0);
      expect(found?.session.expiresAt.getTime()).toBe(T0 + TTL);
      expect(found?.rule?.gameId).toBe('snake');
      expect(await h.repo.findByIdAndTokenHash(s.id, hashToken('other'))).toBeNull();
      expect(await h.repo.findByIdAndTokenHash(randomUUID(), s.tokenHash)).toBeNull();
    });

    it('finish writes once; second finish returns null', async () => {
      const h = await setup();
      const s = await open(h);
      const done = await h.repo.finish(fin(s));
      expect(done).toMatchObject({
        status: 'finished',
        score: 10,
        durationMs: 60_000,
        playerName: 'Lan',
        playerKey: 'lan',
        result: 'accepted',
        rejectReason: null,
      });
      expect(done?.endedAt?.getTime()).toBe(T0 + 60_000);
      expect(await h.repo.finish(fin(s, { score: 99 }))).toBeNull();
      const again = await h.repo.findByIdAndTokenHash(s.id, s.tokenHash);
      expect(again?.session.score).toBe(10);
    });

    it('finish with wrong token or after expiry returns null and leaves the row active', async () => {
      const h = await setup();
      const s = await open(h);
      expect(await h.repo.finish(fin(s, { tokenHash: hashToken('wrong') }))).toBeNull();
      expect(await h.repo.finish(fin(s, { now: new Date(T0 + TTL) }))).toBeNull();
      expect((await h.repo.findByIdAndTokenHash(s.id, s.tokenHash))?.session.status).toBe('active');
      expect(await h.repo.finish(fin(s, { now: new Date(T0 + TTL - 1) }))).not.toBeNull();
    });

    it('rejected finish stores the reason and stays off the leaderboard', async () => {
      const h = await setup();
      const s = await open(h);
      const done = await h.repo.finish(
        fin(s, { result: 'rejected', rejectReason: 'SCORE_RATE_EXCEEDED', score: 800 }),
      );
      expect(done).toMatchObject({ result: 'rejected', rejectReason: 'SCORE_RATE_EXCEEDED' });
      expect(await h.repo.leaderboard('snake', 'desc', 10)).toEqual([]);
    });

    it('concurrent finish: exactly one succeeds', async () => {
      const h = await setup();
      const s = await open(h);
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => h.repo.finish(fin(s, { score: i }))),
      );
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(await h.countFinished('snake')).toBe(1);
    });

    it('leaderboard: best per player_key, ordering and tie-breakers (desc)', async () => {
      const h = await setup();
      const put = async (
        name: string,
        score: number,
        durationMs: number,
        startedAt = T0,
      ): Promise<string> => {
        const s = await open(h, 'snake', startedAt);
        await h.repo.finish(
          fin(s, {
            now: new Date(startedAt + durationMs),
            durationMs,
            score,
            playerName: name,
            playerKey: name.toLowerCase(),
          }),
        );
        return s.id;
      };
      await put('Lan', 10, 60_000);
      await put('lan', 12, 60_000);
      await put('Bob', 12, 50_000);
      await put('Cid', 12, 50_000, T0 + 1000);
      const hidden = await put('Zed', 100, 1000);
      await h.setHidden(hidden, true);
      const rows = await h.repo.leaderboard('snake', 'desc', 10);
      expect(rows.map((r) => [r.playerName, r.score])).toEqual([
        ['Bob', 12],
        ['Cid', 12],
        ['lan', 12],
        // Lan 10 bị gộp vào 'lan' 12
      ]);
      expect((await h.repo.leaderboard('snake', 'desc', 2)).map((r) => r.playerName)).toEqual([
        'Bob',
        'Cid',
      ]);
      expect(rows[0]?.achievedAt.getTime()).toBe(T0 + 50_000);
    });

    it('leaderboard asc + rankOf + personalBest', async () => {
      const h = await setup();
      const put = async (name: string, score: number) => {
        const s = await open(h, 'memory-match');
        const rec = await h.repo.finish(
          fin(s, {
            now: new Date(T0 + 100_000),
            durationMs: 100_000,
            score,
            playerName: name,
            playerKey: name.toLowerCase(),
          }),
        );
        if (!rec) throw new Error('finish failed');
        return rec;
      };
      const a = await put('Ann', 12);
      const b = await put('Bob', 10);
      const c = await put('Cid', 11);
      const ann2 = await put('ann', 15);
      expect(
        (await h.repo.leaderboard('memory-match', 'asc', 10)).map((r) => r.playerName),
      ).toEqual(['Bob', 'Cid', 'Ann']);
      expect(await h.repo.rankOf(b, 'asc')).toEqual({ rank: 1, personalBest: true });
      expect(await h.repo.rankOf(c, 'asc')).toEqual({ rank: 2, personalBest: true });
      expect(await h.repo.rankOf(a, 'asc')).toEqual({ rank: 3, personalBest: true });
      expect(await h.repo.rankOf(ann2, 'asc')).toEqual({ rank: 3, personalBest: false });
    });

    it('rankOf desc ignores same-name rows and hidden rows', async () => {
      const h = await setup();
      const put = async (name: string, score: number) => {
        const s = await open(h);
        const rec = await h.repo.finish(
          fin(s, { score, playerName: name, playerKey: name.toLowerCase() }),
        );
        if (!rec) throw new Error('finish failed');
        return rec;
      };
      const top = await put('Top', 50);
      const mid = await put('Mid', 30);
      await put('mid', 20);
      expect(await h.repo.rankOf(mid, 'desc')).toEqual({ rank: 2, personalBest: true });
      await h.setHidden(top.id, true);
      expect(await h.repo.rankOf(mid, 'desc')).toEqual({ rank: 1, personalBest: true });
    });

    // ---- F4-T2: danh tính tài khoản (ADR-026/027/028) ----

    /** Mở phiên (của `userId` hoặc khách) và nộp điểm ngay; trả bản ghi đã kết thúc. */
    async function play(
      h: RepositoryHarness,
      o: {
        gameId?: string;
        userId?: string | null;
        name: string;
        score: number;
        durationMs?: number;
        startedAt?: number;
        result?: 'accepted' | 'rejected';
      },
    ) {
      const durationMs = o.durationMs ?? 60_000;
      const startedAt = o.startedAt ?? T0;
      const s = await open(h, o.gameId ?? 'snake', startedAt, o.userId ?? null);
      const result = o.result ?? 'accepted';
      const rec = await h.repo.finish(
        fin(s, {
          now: new Date(startedAt + durationMs),
          durationMs,
          score: o.score,
          playerName: o.name,
          playerKey: o.name.toLowerCase(),
          userId: o.userId ?? null,
          result,
          rejectReason: result === 'rejected' ? 'SCORE_OUT_OF_RANGE' : null,
        }),
      );
      if (!rec) throw new Error('finish failed');
      return { rec, s };
    }

    it('create stores the owner; finish enforces ownership atomically (ADR-027)', async () => {
      const h = await setup();
      const a = await h.addUser('Ann');
      const b = await h.addUser('Bob');
      const mine = await open(h, 'snake', T0, a);
      expect((await h.repo.findByIdAndTokenHash(mine.id, mine.tokenHash))?.session.userId).toBe(a);
      // Khách và tài khoản khác không ghi được vào phiên của tài khoản a.
      expect(await h.repo.finish(fin(mine, { userId: null }))).toBeNull();
      expect(await h.repo.finish(fin(mine, { userId: b }))).toBeNull();
      expect((await h.repo.findByIdAndTokenHash(mine.id, mine.tokenHash))?.session.status).toBe(
        'active',
      );
      const done = await h.repo.finish(
        fin(mine, { userId: a, playerName: 'Ann', playerKey: 'ann' }),
      );
      expect(done?.userId).toBe(a);
    });

    it('a guest session finished by an account is attached to it', async () => {
      const h = await setup();
      const a = await h.addUser('Ann');
      const s = await open(h);
      const done = await h.repo.finish(fin(s, { userId: a, playerName: 'Ann', playerKey: 'ann' }));
      expect(done?.userId).toBe(a);
      const rows = await h.repo.leaderboard('snake', 'desc', 10);
      expect(rows).toEqual([expect.objectContaining({ playerName: 'Ann', isMember: true })]);
    });

    it('concurrent finish by two identities on a guest session: exactly one wins', async () => {
      const h = await setup();
      const a = await h.addUser('Ann');
      const b = await h.addUser('Bob');
      const s = await open(h);
      const results = await Promise.all([
        h.repo.finish(fin(s, { userId: a, score: 1 })),
        h.repo.finish(fin(s, { userId: b, score: 2 })),
        h.repo.finish(fin(s, { userId: null, score: 3 })),
      ]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
    });

    it('leaderboard merges by account, guests with the same name stay separate (ADR-026)', async () => {
      const h = await setup();
      const lan = await h.addUser('Lan');
      await play(h, { userId: lan, name: 'Lan', score: 10 });
      await play(h, { userId: lan, name: 'Lan', score: 30, startedAt: T0 + 1000 });
      await play(h, { name: 'Lan', score: 20 }); // khách trùng tên: không gộp vào tài khoản
      await play(h, { name: 'lan', score: 5 }); // cùng khách (cùng player_key) gộp với dòng trên
      const rows = await h.repo.leaderboard('snake', 'desc', 10);
      expect(rows.map((r) => [r.playerName, r.isMember, r.score])).toEqual([
        ['Lan', true, 30],
        ['Lan', false, 20],
      ]);
    });

    it('members show their CURRENT display name; history keeps the name at submit time', async () => {
      const h = await setup();
      const id = await h.addUser('Old');
      await play(h, { userId: id, name: 'Old', score: 10 });
      await h.renameUser(id, 'New');
      expect((await h.repo.leaderboard('snake', 'desc', 10)).map((r) => r.playerName)).toEqual([
        'New',
      ]);
      expect((await h.repo.listHistory(id, { limit: 10, offset: 0 })).items).toHaveLength(1);
    });

    it('rankOf/personalBest use the account key; a same-name guest is another player', async () => {
      const h = await setup();
      const lan = await h.addUser('Lan');
      const other = await h.addUser('Zed');
      const m1 = await play(h, { userId: lan, name: 'Lan', score: 10 });
      const m2 = await play(h, { userId: lan, name: 'Lan', score: 30, startedAt: T0 + 1000 });
      const g = await play(h, { name: 'Lan', score: 20 });
      const z = await play(h, { userId: other, name: 'Zed', score: 25 });
      expect(await h.repo.rankOf(m2.rec, 'desc')).toEqual({ rank: 1, personalBest: true });
      expect(await h.repo.rankOf(m1.rec, 'desc')).toEqual({ rank: 3, personalBest: false });
      expect(await h.repo.rankOf(z.rec, 'desc')).toEqual({ rank: 2, personalBest: true });
      expect(await h.repo.rankOf(g.rec, 'desc')).toEqual({ rank: 3, personalBest: true });
    });

    it('listHistory: own finished sessions only, newest first, paginated, no active rows', async () => {
      const h = await setup();
      const a = await h.addUser('Ann');
      const b = await h.addUser('Bob');
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const { rec } = await play(h, {
          userId: a,
          name: 'Ann',
          score: i,
          startedAt: T0 + i * 100_000,
          result: i === 1 ? 'rejected' : 'accepted',
        });
        ids.push(rec.id);
      }
      await play(h, { userId: b, name: 'Bob', score: 99 });
      await play(h, { name: 'Guest', score: 98 });
      await open(h, 'snake', T0, a); // phiên active: không xuất hiện
      const first = await h.repo.listHistory(a, { limit: 2, offset: 0 });
      expect(first.total).toBe(5);
      expect(first.items.map((r) => r.sessionId)).toEqual([ids[4], ids[3]]);
      expect(first.items[0]).toMatchObject({
        gameId: 'snake',
        gameTitle: expect.any(String),
        scoreOrder: 'desc',
        score: 4,
        result: 'accepted',
      });
      const second = await h.repo.listHistory(a, { limit: 2, offset: 2 });
      expect(second.items.map((r) => [r.score, r.result])).toEqual([
        [2, 'accepted'],
        [1, 'rejected'],
      ]);
      expect((await h.repo.listHistory(a, { limit: 2, offset: 40 })).items).toEqual([]);
      expect(JSON.stringify(first)).not.toContain('SCORE_OUT_OF_RANGE');
    });

    it('listHistory tie-break: same ended_at -> id descending', async () => {
      const h = await setup();
      const a = await h.addUser('Ann');
      const x = await play(h, { userId: a, name: 'Ann', score: 1 });
      const y = await play(h, { userId: a, name: 'Ann', score: 2 });
      const expected = [x.rec.id, y.rec.id].sort().reverse();
      const rows = await h.repo.listHistory(a, { limit: 10, offset: 0 });
      expect(rows.items.map((r) => r.sessionId)).toEqual(expected);
    });

    it('personalBests: best per game by score_order, hidden excluded, plays counts rejected', async () => {
      const h = await setup();
      const a = await h.addUser('Ann');
      const b = await h.addUser('Bob');
      // snake (desc): best = 30; lượt rejected và lượt hidden vẫn được đếm vào plays.
      await play(h, { userId: a, name: 'Ann', score: 10 });
      const top = await play(h, { userId: a, name: 'Ann', score: 30, startedAt: T0 + 1000 });
      await play(h, {
        userId: a,
        name: 'Ann',
        score: 800,
        result: 'rejected',
        startedAt: T0 + 2000,
      });
      const hidden = await play(h, { userId: a, name: 'Ann', score: 90, startedAt: T0 + 3000 });
      await h.setHidden(hidden.rec.id, true);
      // memory-match (asc): best = nhỏ nhất.
      const mm = { userId: a, name: 'Ann', gameId: 'memory-match' };
      await play(h, { ...mm, score: 20, startedAt: T0 + 9000 });
      await play(h, { ...mm, score: 14, startedAt: T0 + 10_000 });
      // Người khác không ảnh hưởng.
      await play(h, { userId: b, name: 'Bob', score: 500 });
      // Game chỉ có lượt rejected → không có mục.
      await play(h, {
        userId: a,
        name: 'Ann',
        gameId: 'brick-breaker',
        score: 5,
        result: 'rejected',
      });

      const bests = await h.repo.personalBests(a);
      expect(bests.map((x) => [x.gameId, x.scoreOrder, x.score, x.plays])).toEqual([
        ['memory-match', 'asc', 14, 2],
        ['snake', 'desc', 30, 4],
      ]);
      expect(bests[1]?.achievedAt.getTime()).toBe(top.rec.endedAt?.getTime());
      expect(bests[0]?.gameTitle).toEqual(expect.any(String));
      expect(await h.repo.personalBests(await h.addUser('Nobody'))).toEqual([]);
    });
  });
}
