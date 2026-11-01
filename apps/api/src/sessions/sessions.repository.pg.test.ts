import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.ts';
import { SEED_RULES, seedGames, seedScoringRules } from '../db/seed.ts';
import { createPgGamesRepository } from '../games/games.repository.ts';
import { describeSessionsRepository } from './repository.suite.ts';
import { createPgSessionsRepository } from './sessions.repository.ts';
import { hashToken } from './token.ts';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.warn('[skip] TEST_DATABASE_URL is not set: skipping Postgres sessions tests');
}

// Mọi kết nối của `pool` dùng search_path = schema tạm (nhiều kết nối thật → test đồng thời đúng nghĩa).
// Schema tạm bị DROP ở cuối; không đụng schema public.
describe.skipIf(!url)('pg sessions + migration 002', () => {
  const schema = `qp_sess_${process.pid}_${Date.now()}`;
  let admin: pg.Pool;
  let pool: pg.Pool;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url as string });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({
      connectionString: url as string,
      options: `-c search_path=${schema}`,
      max: 8,
    });
    const client = await pool.connect();
    try {
      await runMigrations(client);
    } finally {
      client.release();
    }
    await seedGames(pool);
    await seedScoringRules(pool);
  });

  afterAll(async () => {
    try {
      await pool?.end();
      await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin?.end();
    }
  });

  describeSessionsRepository('pg', async () => {
    await pool.query('DELETE FROM sessions');
    await pool.query('DELETE FROM auth_sessions');
    await pool.query('DELETE FROM users');
    return {
      repo: createPgSessionsRepository(pool),
      async setHidden(id, hidden) {
        await pool.query('UPDATE sessions SET hidden = $2 WHERE id = $1', [id, hidden]);
      },
      async countFinished(gameId) {
        const r = await pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM sessions WHERE game_id = $1 AND status = 'finished'",
          [gameId],
        );
        return r.rows[0]?.n ?? 0;
      },
      async addUser(displayName) {
        const id = randomUUID();
        await pool.query(
          `INSERT INTO users (id, email, password_hash, display_name, display_name_key,
                               created_at, updated_at, password_changed_at)
           VALUES ($1, $2, 'scrypt$x', $3, $4, now(), now(), now())`,
          [id, `${id}@example.com`, displayName, displayName.toLowerCase()],
        );
        return id;
      },
      async renameUser(id, displayName) {
        await pool.query(
          'UPDATE users SET display_name = $2, display_name_key = $3 WHERE id = $1',
          [id, displayName, displayName.toLowerCase()],
        );
      },
    };
  });

  it('migration 002 is recorded and re-running is a no-op (AC20)', async () => {
    const client = await pool.connect();
    try {
      expect(await runMigrations(client)).toEqual([]);
      const r = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = '002_sessions_scoring.sql'",
      );
      expect(r.rowCount).toBe(1);
    } finally {
      client.release();
    }
  });

  it('seed rules re-run safely; tic-tac-toe has no rule (AC21)', async () => {
    await seedScoringRules(pool);
    await seedScoringRules(pool);
    const r = await pool.query<{ game_id: string }>('SELECT game_id FROM game_scoring_rules');
    expect(r.rows.map((x) => x.game_id).sort()).toEqual(SEED_RULES.map((x) => x.gameId).sort());
    expect(r.rows.map((x) => x.game_id)).not.toContain('tic-tac-toe');
  });

  it('games repository exposes ranked/scoreOrder via LEFT JOIN (AC2)', async () => {
    const repo = createPgGamesRepository(pool);
    expect(await repo.findById('snake')).toMatchObject({ ranked: true, scoreOrder: 'desc' });
    expect(await repo.findById('memory-match')).toMatchObject({ ranked: true, scoreOrder: 'asc' });
    expect(await repo.findById('tic-tac-toe')).toMatchObject({ ranked: false, scoreOrder: null });
    const list = await repo.list({ limit: 20, offset: 0 });
    expect(list.items.find((g) => g.id === 'tic-tac-toe')?.ranked).toBe(false);
    expect(list.items.filter((g) => g.ranked)).toHaveLength(4);
  });

  describe('CHECK constraints (AC20)', () => {
    const insertActive = (extra = '') =>
      pool.query(
        `INSERT INTO sessions (id, game_id, token_hash, started_at, expires_at${extra ? ', ' + extra.split('=')[0] : ''})
         VALUES ($1, 'snake', $2, now(), now() + interval '2 hours'${extra ? ', ' + extra.split('=')[1] : ''})`,
        [randomUUID(), hashToken('t')],
      );

    it('accepts a plain active session', async () => {
      await insertActive();
    });

    it.each([
      ['finished with null score', "status = 'finished'"],
      ['active with a score', 'score = 5'],
      ['bad token_hash length', null],
    ])('rejects %s', async (_label, extra) => {
      if (extra === null) {
        await expect(
          pool.query(
            `INSERT INTO sessions (id, game_id, token_hash, started_at, expires_at)
             VALUES ($1, 'snake', $2, now(), now() + interval '1 hour')`,
            [randomUUID(), Buffer.alloc(31)],
          ),
        ).rejects.toThrow();
        return;
      }
      await expect(insertActive(extra)).rejects.toThrow();
    });

    it('rejects expires_at <= started_at', async () => {
      await expect(
        pool.query(
          `INSERT INTO sessions (id, game_id, token_hash, started_at, expires_at)
           VALUES ($1, 'snake', $2, now(), now())`,
          [randomUUID(), hashToken('t')],
        ),
      ).rejects.toThrow();
    });

    const finished = (result: string, reason: string | null) =>
      pool.query(
        `INSERT INTO sessions (id, game_id, token_hash, status, started_at, expires_at, ended_at,
                               duration_ms, score, player_name, player_key, result, reject_reason)
         VALUES ($1, 'snake', $2, 'finished', now(), now() + interval '1 hour', now(),
                 10, 1, 'Lan', 'lan', $3, $4)`,
        [randomUUID(), hashToken('t'), result, reason],
      );

    it('rejected requires reject_reason, accepted forbids it, format enforced', async () => {
      await finished('accepted', null);
      await finished('rejected', 'SCORE_OUT_OF_RANGE');
      await expect(finished('rejected', null)).rejects.toThrow();
      await expect(finished('accepted', 'SCORE_OUT_OF_RANGE')).rejects.toThrow();
      await expect(finished('rejected', 'lower_case')).rejects.toThrow();
    });

    it('rejects an out-of-range scoring rule', async () => {
      await expect(
        pool.query(
          `INSERT INTO game_scoring_rules (game_id, score_order, min_score, max_score)
           VALUES ('tic-tac-toe', 'desc', 10, 5)`,
        ),
      ).rejects.toThrow();
      await expect(
        pool.query(
          `INSERT INTO game_scoring_rules (game_id, score_order, min_score, max_score)
           VALUES ('tic-tac-toe', 'sideways', 0, 5)`,
        ),
      ).rejects.toThrow();
    });
  });

  it('rank_key: account rows use u:<id>, guests g:<key>, active guest rows NULL (ADR-026)', async () => {
    const repo = createPgSessionsRepository(pool);
    const uid = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, display_name, display_name_key,
                           created_at, updated_at, password_changed_at)
       VALUES ($1, $2, 'scrypt$x', 'Rk', 'rk', now(), now(), now())`,
      [uid, `${uid}@example.com`],
    );
    const t0 = new Date();
    const mk = async (userId: string | null) => {
      const id = randomUUID();
      const tokenHash = hashToken(id);
      await repo.create({
        id,
        gameId: 'snake',
        tokenHash,
        startedAt: t0,
        expiresAt: new Date(t0.getTime() + 3600_000),
        userId,
      });
      return { id, tokenHash };
    };
    const keyOf = async (id: string) =>
      (
        await pool.query<{ rank_key: string | null }>(
          'SELECT rank_key FROM sessions WHERE id = $1',
          [id],
        )
      ).rows[0]?.rank_key;
    const guest = await mk(null);
    expect(await keyOf(guest.id)).toBeNull();
    const done = (s: { id: string; tokenHash: Buffer }, userId: string | null) =>
      repo.finish({
        id: s.id,
        tokenHash: s.tokenHash,
        now: new Date(t0.getTime() + 1000),
        durationMs: 1000,
        score: 1,
        playerName: 'Rk',
        playerKey: 'rk',
        result: 'accepted',
        rejectReason: null,
        userId,
      });
    await done(guest, null);
    expect(await keyOf(guest.id)).toBe('g:rk');
    const member = await mk(uid);
    await done(member, uid);
    expect(await keyOf(member.id)).toBe(`u:${uid}`);
    const idx = await pool.query(
      "SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = 'sessions_rank_idx'",
      [schema],
    );
    expect(idx.rowCount).toBe(1);
  });

  it('SQL injection attempts are inert', async () => {
    const repo = createPgSessionsRepository(pool);
    expect(await repo.findGameRule("snake' OR '1'='1")).toBeNull();
    expect(await repo.leaderboard("x'; DROP TABLE sessions; --", 'desc', 5)).toEqual([]);
  });
});
