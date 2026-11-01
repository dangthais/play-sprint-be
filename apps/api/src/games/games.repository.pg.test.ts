import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createPool } from '../db/pool.ts';
import { runMigrations } from '../db/migrate.ts';
import { SEED_GAMES, countNonSeedGames, seedGames, seedScoringRules } from '../db/seed.ts';
import { createPgGamesRepository } from './games.repository.ts';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.warn('[skip] TEST_DATABASE_URL is not set: skipping Postgres repository/migration tests');
}

// Mỗi test chạy trên một schema tạm (search_path) và DROP schema đó ở cuối; không đụng schema public.
describe.skipIf(!url)('pg repository + migrations', () => {
  const schema = `qp_test_${process.pid}_${Date.now()}`;
  let pool: pg.Pool;
  let client: pg.PoolClient;

  beforeAll(async () => {
    pool = createPool(url as string);
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
  });

  afterAll(async () => {
    try {
      if (client) {
        await client.query('SET search_path TO public');
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        client.release();
      }
    } finally {
      await pool?.end();
    }
  });

  it('migrations are idempotent', async () => {
    const first = await runMigrations(client);
    expect(first).toContain('001_create_games.sql');
    expect(first).toContain('002_sessions_scoring.sql');
    const second = await runMigrations(client);
    expect(second).toEqual([]);
  });

  it('seed is re-runnable and repository lists in stable order', async () => {
    await seedGames(client);
    await seedGames(client);
    await seedScoringRules(client);
    const repo = createPgGamesRepository(client);
    const p1 = await repo.list({ limit: 20, offset: 0 });
    const p2 = await repo.list({ limit: 20, offset: 20 });
    expect(p1.total).toBe(SEED_GAMES.length);
    expect(p1.items.map((g) => g.id)).toEqual([
      'tic-tac-toe',
      'merge-2048',
      'memory-match',
      'brick-breaker',
      'snake',
    ]);
    expect(p2.items).toEqual([]);
    expect(p1.items[0]?.createdAt).toBeInstanceOf(Date);
    expect(await countNonSeedGames(client)).toBe(0);
  });

  it('findById returns a record or null', async () => {
    await seedGames(client);
    const repo = createPgGamesRepository(client);
    const found = await repo.findById('snake');
    expect(found).toMatchObject({
      id: 'snake',
      title: 'Snake',
      embedPath: '/games/snake/',
      orientation: 'any',
      ranked: true,
      scoreOrder: 'desc',
    });
    expect(await repo.findById('tic-tac-toe')).toMatchObject({ ranked: false, scoreOrder: null });
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(await repo.findById('nope')).toBeNull();
    expect(await repo.findById("x' OR '1'='1")).toBeNull();
  });

  it('rejects invalid rows via CHECK constraints', async () => {
    await expect(
      client.query(
        `INSERT INTO games (id, title, thumbnail_path, embed_path) VALUES ('bad-1', 't', '/a/../b', '/g/')`,
      ),
    ).rejects.toThrow();
  });
});
