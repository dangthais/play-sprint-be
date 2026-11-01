import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgAuthRepository } from '../auth/auth.repository.ts';
import { createPgSessionsRepository } from '../sessions/sessions.repository.ts';
import { hashToken } from '../sessions/token.ts';
import { CLEANUP_LOCK_KEY, runCleanup } from './cleanup.ts';
import { runMigrations } from './migrate.ts';
import { seedGames, seedScoringRules } from './seed.ts';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.warn('[skip] TEST_DATABASE_URL is not set: skipping Postgres cleanup tests');
}

const HOUR = 3_600_000;
const NOW = new Date('2026-06-10T12:00:00Z');
const ago = (h: number) => new Date(NOW.getTime() - h * HOUR);

// Schema tạm riêng; bị DROP ở cuối, không đụng schema public.
describe.skipIf(!url)('pg cleanup job (ADR-035)', () => {
  const schema = `qp_clean_${process.pid}_${Date.now()}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  const userId = randomUUID();

  async function insertActive(hoursUntilExpiry: number, uid: string | null = null) {
    const id = randomUUID();
    const expires = new Date(NOW.getTime() + hoursUntilExpiry * HOUR);
    await pool.query(
      `INSERT INTO sessions (id, game_id, token_hash, status, started_at, expires_at, user_id)
       VALUES ($1, 'snake', $2, 'active', $3, $4, $5)`,
      [id, hashToken(id), new Date(expires.getTime() - HOUR), expires, uid],
    );
    return id;
  }

  async function insertFinished(
    result: 'accepted' | 'rejected',
    endedHoursAgo: number,
    score: number,
    uid: string | null,
  ) {
    const id = randomUUID();
    const ended = ago(endedHoursAgo);
    await pool.query(
      `INSERT INTO sessions (id, game_id, token_hash, status, started_at, expires_at, ended_at,
                             duration_ms, score, player_name, player_key, result, reject_reason, user_id)
       VALUES ($1, 'snake', $2, 'finished', $3, $4, $5, 60000, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        hashToken(id),
        new Date(ended.getTime() - HOUR),
        new Date(ended.getTime() - HOUR + 30 * 60_000),
        ended,
        score,
        uid ? 'Member' : 'Guest',
        uid ? 'member-key' : `guest-${id}`,
        result,
        result === 'rejected' ? 'SCORE_TOO_HIGH' : null,
        uid,
      ],
    );
    return id;
  }

  async function ids(table: 'sessions' | 'auth_sessions'): Promise<Set<string>> {
    const res = await pool.query<{ id: string }>(`SELECT id FROM ${table}`);
    return new Set(res.rows.map((r) => r.id));
  }

  async function snapshot() {
    const repo = createPgSessionsRepository(pool);
    return {
      board: await repo.leaderboard('snake', 'desc', 100),
      history: await repo.listHistory(userId, { limit: 100, offset: 0 }),
      bests: await repo.personalBests(userId),
    };
  }

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url as string });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({
      connectionString: url as string,
      options: `-c search_path=${schema}`,
      max: 6,
    });
    const client = await pool.connect();
    try {
      await runMigrations(client);
    } finally {
      client.release();
    }
    await seedGames(pool);
    await seedScoringRules(pool);
    await pool.query(
      `INSERT INTO users (id, email, password_hash, display_name, display_name_key, created_at,
                          updated_at, password_changed_at)
       VALUES ($1, 'cleanup@example.com', 'scrypt$x', 'Member', 'member', $2, $2, $2)`,
      [userId, ago(1000)],
    );
  });

  afterAll(async () => {
    try {
      await pool?.end();
      await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin?.end();
    }
  });

  it('deletes only active sessions expired more than 24h ago; history is untouched (AC11)', async () => {
    const oldGuest = await insertActive(-25);
    const oldUser = await insertActive(-25.5, userId);
    const recentlyExpired = await insertActive(-1);
    const stillActive = await insertActive(1);
    const acceptedOld = await insertFinished('accepted', 24 * 400, 100, null);
    const acceptedUser = await insertFinished('accepted', 24 * 300, 200, userId);
    const rejectedGuest = await insertFinished('rejected', 24 * 500, 999, null);
    const rejectedUser = await insertFinished('rejected', 24 * 350, 998, userId);

    const before = await snapshot();
    expect(before.board.length).toBeGreaterThan(0);
    expect(before.history.total).toBe(2);
    expect(before.bests.length).toBe(1);

    const r = await runCleanup(pool, { now: NOW });
    expect(r).toEqual({ skipped: false, playSessionsDeleted: 2, authSessionsDeleted: 0 });

    const left = await ids('sessions');
    expect(left.has(oldGuest)).toBe(false);
    expect(left.has(oldUser)).toBe(false);
    for (const keep of [
      recentlyExpired,
      stillActive,
      acceptedOld,
      acceptedUser,
      rejectedGuest,
      rejectedUser,
    ]) {
      expect(left.has(keep)).toBe(true);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('deletes expired auth_sessions and keeps /auth/me behavior (resolve)', async () => {
    const auth = createPgAuthRepository(pool);
    const mk = async (expires: Date) => {
      const id = randomUUID();
      const hash = hashToken(id);
      await pool.query(
        `INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, userId, hash, new Date(expires.getTime() - 10 * HOUR), expires],
      );
      return { id, hash };
    };
    const expired = await mk(ago(2));
    const boundary = await mk(NOW);
    const valid = await mk(new Date(NOW.getTime() + HOUR));

    const resolve = async (hash: Buffer) => (await auth.findSession(hash, NOW)) !== null;
    expect([
      await resolve(expired.hash),
      await resolve(boundary.hash),
      await resolve(valid.hash),
    ]).toEqual([false, false, true]);

    const r = await runCleanup(pool, { now: NOW });
    expect(r.authSessionsDeleted).toBe(2);
    const left = await ids('auth_sessions');
    expect(left.has(expired.id)).toBe(false);
    expect(left.has(boundary.id)).toBe(false);
    expect(left.has(valid.id)).toBe(true);
    expect([
      await resolve(expired.hash),
      await resolve(boundary.hash),
      await resolve(valid.hash),
    ]).toEqual([false, false, true]);
    const users = await pool.query('SELECT 1 FROM users WHERE id = $1', [userId]);
    expect(users.rowCount).toBe(1);
  });

  it('works in batches and stops at maxBatches', async () => {
    for (let i = 0; i < 5; i++) await insertActive(-30 - i);
    const first = await runCleanup(pool, { now: NOW, batchSize: 2, maxBatches: 2 });
    expect(first.playSessionsDeleted).toBe(4);
    const second = await runCleanup(pool, { now: NOW, batchSize: 2, maxBatches: 2 });
    expect(second.playSessionsDeleted).toBe(1);
    const third = await runCleanup(pool, { now: NOW, batchSize: 2, maxBatches: 2 });
    expect(third.playSessionsDeleted).toBe(0);
  });

  it('returns skipped when another connection holds the lock (AC14)', async () => {
    const victim = await insertActive(-40);
    const holder = await pool.connect();
    try {
      await holder.query('SELECT pg_advisory_lock($1)', [CLEANUP_LOCK_KEY]);
      const r = await runCleanup(pool, { now: NOW });
      expect(r).toEqual({ skipped: true, playSessionsDeleted: 0, authSessionsDeleted: 0 });
      expect((await ids('sessions')).has(victim)).toBe(true);
    } finally {
      await holder.query('SELECT pg_advisory_unlock($1)', [CLEANUP_LOCK_KEY]);
      holder.release();
    }
    const after = await runCleanup(pool, { now: NOW });
    expect(after.skipped).toBe(false);
    expect(after.playSessionsDeleted).toBe(1);
  });

  it('releases the lock after a mid-run failure (AC14)', async () => {
    const failing = {
      async connect() {
        const c = await pool.connect();
        const original = c.query;
        const real = c.query.bind(c) as (...a: unknown[]) => Promise<unknown>;
        const origRelease = c.release.bind(c);
        // Khôi phục client trước khi trả về pool để không ảnh hưởng truy vấn sau.
        c.release = ((arg?: boolean | Error) => {
          (c as unknown as { query: unknown }).query = original;
          origRelease(arg);
        }) as typeof c.release;
        (c as unknown as { query: unknown }).query = (sql: unknown, ...rest: unknown[]) => {
          if (typeof sql === 'string' && sql.startsWith('DELETE FROM auth_sessions')) {
            return Promise.reject(new Error('injected failure'));
          }
          return real(sql, ...rest);
        };
        return c;
      },
    };
    await expect(runCleanup(failing as never, { now: NOW })).rejects.toThrow('injected failure');
    const probe = await pool.connect();
    try {
      const res = await probe.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [CLEANUP_LOCK_KEY],
      );
      expect(res.rows[0]?.locked).toBe(true);
      await probe.query('SELECT pg_advisory_unlock($1)', [CLEANUP_LOCK_KEY]);
    } finally {
      probe.release();
    }
    expect((await runCleanup(pool, { now: NOW })).skipped).toBe(false);
  });
});
