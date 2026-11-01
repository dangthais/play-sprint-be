import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { createPool } from './pool.ts';

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../migrations');

// Khoá advisory cố định để hai tiến trình migrate không chạy chồng nhau.
const MIGRATION_LOCK_KEY = 7_420_310_001;

/** `db` phải là một client riêng (PoolClient/Client) vì dùng BEGIN/COMMIT và advisory lock theo session. */
export async function runMigrations(
  db: pg.PoolClient | pg.Client,
  dir: string = MIGRATIONS_DIR,
): Promise<string[]> {
  await db.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    return await applyPending(db, dir);
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  }
}

async function applyPending(db: pg.PoolClient | pg.Client, dir: string): Promise<string[]> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (await db.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map(
      (r) => r.version,
    ),
  );
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    await db.query('BEGIN');
    try {
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
    ran.push(file);
  }
  return ran;
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set; cannot run migrations.');
    process.exit(1);
  }
  const pool = createPool(url);
  try {
    const client = await pool.connect();
    try {
      const ran = await runMigrations(client);
      console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'No pending migrations.');
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Migration failed:', err instanceof Error ? err.message : 'unknown error');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
