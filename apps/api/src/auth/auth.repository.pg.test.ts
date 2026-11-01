import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from '../db/migrate.ts';
import { seedGames, seedScoringRules } from '../db/seed.ts';
import { hashToken } from '../sessions/token.ts';
import { createPgAuthRepository, mapUniqueViolation } from './auth.repository.ts';
import { describeAuthRepository } from './auth.repository.suite.ts';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.warn('[skip] TEST_DATABASE_URL is not set: skipping Postgres auth tests');
}

const HASH =
  'scrypt$v=1$n=32768,r=8,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

// Schema tạm riêng cho file này (DROP ở cuối); không đụng schema public.
describe.skipIf(!url)('pg auth + migration 003', () => {
  const schema = `qp_auth_${process.pid}_${Date.now()}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let tmpDir: string;
  const preIds = { guestFinished: randomUUID(), guestActive: randomUUID() };

  async function migrate(dir?: string): Promise<string[]> {
    const client = await pool.connect();
    try {
      return await runMigrations(client, dir);
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url as string });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({
      connectionString: url as string,
      options: `-c search_path=${schema}`,
      max: 8,
    });
    // Pha 1: chỉ 001 + 002 và có dữ liệu (AC16: 003 áp được trên 002 có dữ liệu).
    tmpDir = await mkdtemp(path.join(tmpdir(), 'qp-mig-'));
    for (const f of ['001_create_games.sql', '002_sessions_scoring.sql']) {
      await copyFile(path.join(MIGRATIONS_DIR, f), path.join(tmpDir, f));
    }
    expect(await migrate(tmpDir)).toEqual(['001_create_games.sql', '002_sessions_scoring.sql']);
    await seedGames(pool);
    await seedScoringRules(pool);
    await pool.query(
      `INSERT INTO sessions (id, game_id, token_hash, status, started_at, expires_at, ended_at,
                             duration_ms, score, player_name, player_key, result)
       VALUES ($1, 'snake', $2, 'finished', now(), now() + interval '1 hour', now(), 10, 5,
               'Lan', 'lan', 'accepted')`,
      [preIds.guestFinished, hashToken('pre1')],
    );
    await pool.query(
      `INSERT INTO sessions (id, game_id, token_hash, started_at, expires_at)
       VALUES ($1, 'snake', $2, now(), now() + interval '1 hour')`,
      [preIds.guestActive, hashToken('pre2')],
    );
    // Pha 2: áp 003 (chỉ còn 003 chưa chạy).
    expect(await migrate()).toEqual(['003_users_auth.sql']);
  });

  afterAll(async () => {
    try {
      await pool?.end();
      await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    } finally {
      await admin?.end();
    }
  });

  describeAuthRepository('pg', async () => {
    await pool.query('DELETE FROM sessions WHERE user_id IS NOT NULL');
    await pool.query('DELETE FROM users');
    return { repo: createPgAuthRepository(pool) };
  });

  describe('migration 003 (AC16)', () => {
    it('is recorded and re-running is a no-op', async () => {
      expect(await migrate()).toEqual([]);
      const r = await pool.query(
        "SELECT 1 FROM schema_migrations WHERE version = '003_users_auth.sql'",
      );
      expect(r.rowCount).toBe(1);
    });

    it('old sessions rows: user_id NULL, rank_key = g:<player_key> (NULL for guest active)', async () => {
      const r = await pool.query<{ id: string; user_id: string | null; rank_key: string | null }>(
        'SELECT id, user_id, rank_key FROM sessions WHERE id = ANY($1)',
        [[preIds.guestFinished, preIds.guestActive]],
      );
      const byId = new Map(r.rows.map((x) => [x.id, x]));
      expect(byId.get(preIds.guestFinished)).toMatchObject({ user_id: null, rank_key: 'g:lan' });
      expect(byId.get(preIds.guestActive)).toMatchObject({ user_id: null, rank_key: null });
    });

    it('old leaderboard index is kept; new indexes exist', async () => {
      const r = await pool.query<{ indexname: string }>(
        'SELECT indexname FROM pg_indexes WHERE schemaname = $1',
        [schema],
      );
      const names = r.rows.map((x) => x.indexname);
      for (const n of [
        'sessions_leaderboard_idx',
        'sessions_rank_idx',
        'sessions_user_history_idx',
        'auth_sessions_user_idx',
        'auth_sessions_expires_idx',
        'users_email_key',
        'users_display_name_key_key',
      ]) {
        expect(names).toContain(n);
      }
    });

    const insertUser = (email: string, key: string, hash = HASH, name = 'Lan') =>
      pool.query(
        `INSERT INTO users (id, email, password_hash, display_name, display_name_key,
                            created_at, updated_at, password_changed_at)
         VALUES ($1, $2, $3, $4, $5, now(), now(), now())`,
        [randomUUID(), email, hash, name, key],
      );

    it('users CHECK constraints reject bad rows', async () => {
      await expect(insertUser('Upper@Example.com', 'k1')).rejects.toThrow();
      await expect(insertUser('ab', 'k2')).rejects.toThrow();
      await expect(insertUser('a@b.cc', 'k3', 'bcrypt$nope')).rejects.toThrow();
      await expect(insertUser('a@b.cc', 'k4', HASH, '')).rejects.toThrow();
      await expect(insertUser('a@b.cc', 'k5', HASH, 'x'.repeat(21))).rejects.toThrow();
    });

    it('unique email / display_name_key; violations are mapped by constraint name', async () => {
      await insertUser('uniq@example.com', 'uniq-key');
      const emailErr = await insertUser('uniq@example.com', 'other-key').catch((e: unknown) => e);
      expect(emailErr).toMatchObject({ code: '23505', constraint: 'users_email_key' });
      expect(mapUniqueViolation(emailErr)).toMatchObject({ field: 'EMAIL' });
      const nameErr = await insertUser('uniq2@example.com', 'uniq-key').catch((e: unknown) => e);
      expect(nameErr).toMatchObject({ code: '23505', constraint: 'users_display_name_key_key' });
      expect(mapUniqueViolation(nameErr)).toMatchObject({ field: 'NAME' });
      expect(mapUniqueViolation(new Error('x'))).toBeNull();
      expect(mapUniqueViolation({ code: '23505', constraint: 'something_else' })).toBeNull();
    });

    it('auth_sessions: CHECKs, unique token_hash, cascade on user delete (rolled back)', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const uid = randomUUID();
        await client.query(
          `INSERT INTO users (id, email, password_hash, display_name, display_name_key,
                              created_at, updated_at, password_changed_at)
           VALUES ($1, 'cascade@example.com', $2, 'Casc', 'casc', now(), now(), now())`,
          [uid, HASH],
        );
        const ins = (sid: string, hash: Buffer, offset: string) =>
          client.query(
            `INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at)
             VALUES ($1, $2, $3, now(), now() + $4::interval)`,
            [sid, uid, hash, offset],
          );
        await ins(randomUUID(), hashToken('cas1'), '1 day');
        await client.query('SAVEPOINT s1');
        await expect(ins(randomUUID(), hashToken('cas1'), '1 day')).rejects.toMatchObject({
          constraint: 'auth_sessions_token_hash_key',
        });
        await client.query('ROLLBACK TO s1');
        await expect(ins(randomUUID(), Buffer.alloc(31), '1 day')).rejects.toThrow();
        await client.query('ROLLBACK TO s1');
        await expect(ins(randomUUID(), hashToken('cas2'), '-1 day')).rejects.toThrow();
        await client.query('ROLLBACK TO s1');
        await client.query('DELETE FROM users WHERE id = $1', [uid]);
        const left = await client.query('SELECT 1 FROM auth_sessions WHERE user_id = $1', [uid]);
        expect(left.rowCount).toBe(0);
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    });

    it('sessions.user_id FK + rank_key = u:<user_id> for member sessions', async () => {
      const uid = randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash, display_name, display_name_key,
                            created_at, updated_at, password_changed_at)
         VALUES ($1, 'member@example.com', $2, 'Member', 'member', now(), now(), now())`,
        [uid, HASH],
      );
      const sid = randomUUID();
      await pool.query(
        `INSERT INTO sessions (id, game_id, token_hash, status, started_at, expires_at, ended_at,
                               duration_ms, score, player_name, player_key, result, user_id)
         VALUES ($1, 'snake', $2, 'finished', now(), now() + interval '1 hour', now(), 10, 5,
                 'Member', 'member', 'accepted', $3)`,
        [sid, hashToken('mem'), uid],
      );
      const r = await pool.query<{ rank_key: string }>(
        'SELECT rank_key FROM sessions WHERE id = $1',
        [sid],
      );
      expect(r.rows[0]?.rank_key).toBe(`u:${uid}`);
      // Active phiên của tài khoản: rank_key theo user_id (không cần player_key).
      const aid = randomUUID();
      await pool.query(
        `INSERT INTO sessions (id, game_id, token_hash, started_at, expires_at, user_id)
         VALUES ($1, 'snake', $2, now(), now() + interval '1 hour', $3)`,
        [aid, hashToken('mem2'), uid],
      );
      const r2 = await pool.query<{ rank_key: string }>(
        'SELECT rank_key FROM sessions WHERE id = $1',
        [aid],
      );
      expect(r2.rows[0]?.rank_key).toBe(`u:${uid}`);
      await expect(
        pool.query(
          `INSERT INTO sessions (id, game_id, token_hash, started_at, expires_at, user_id)
           VALUES ($1, 'snake', $2, now(), now() + interval '1 hour', $3)`,
          [randomUUID(), hashToken('mem3'), randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });
});
