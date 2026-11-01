import type pg from 'pg';
import { createPool } from './pool.ts';

/** Khoá advisory của job dọn (khác khoá migrate 7_420_310_001). */
export const CLEANUP_LOCK_KEY = 7_420_310_002;
/** Biên an toàn: chỉ xoá phiên chơi `active` đã hết hạn quá 24 h. */
export const ACTIVE_SESSION_GRACE_MS = 86_400_000;

export interface CleanupResult {
  skipped: boolean;
  playSessionsDeleted: number;
  authSessionsDeleted: number;
}

export interface CleanupOptions {
  now: Date;
  batchSize?: number;
  maxBatches?: number;
}

type Queryable = Pick<pg.PoolClient, 'query'>;

// Chỉ xoá phiên `active` đã hết hạn; tuyệt đối không đụng `finished` (leaderboard/lịch sử/kỷ lục).
const DELETE_PLAY_SESSIONS = `DELETE FROM sessions WHERE id IN (
  SELECT id FROM sessions WHERE status = 'active' AND expires_at < $1
  ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED)`;
const DELETE_AUTH_SESSIONS = `DELETE FROM auth_sessions WHERE id IN (
  SELECT id FROM auth_sessions WHERE expires_at <= $1
  ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED)`;

async function deleteInBatches(
  db: Queryable,
  sql: string,
  cutoff: Date,
  batchSize: number,
  maxBatches: number,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const res = await db.query(sql, [cutoff, batchSize]);
    const n = res.rowCount ?? 0;
    total += n;
    if (n < batchSize) break;
  }
  return total;
}

export async function runCleanup(
  pool: Pick<pg.Pool, 'connect'>,
  { now, batchSize = 1000, maxBatches = 100 }: CleanupOptions,
): Promise<CleanupResult> {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    !Number.isInteger(maxBatches) ||
    maxBatches < 1
  ) {
    throw new Error('batchSize and maxBatches must be positive integers');
  }
  const client = await pool.connect();
  let locked = false;
  let destroy = false;
  let timeoutsSet = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [CLEANUP_LOCK_KEY],
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { skipped: true, playSessionsDeleted: 0, authSessionsDeleted: 0 };
    // Không treo vô hạn khi chờ khoá bảng (vd. migration lúc deploy): lỗi → lượt sau chạy lại.
    // Đặt ở mức session nên phải RESET trước khi trả client về pool.
    await client.query("SET lock_timeout = '5s'");
    await client.query("SET statement_timeout = '30s'");
    timeoutsSet = true;
    const playSessionsDeleted = await deleteInBatches(
      client,
      DELETE_PLAY_SESSIONS,
      new Date(now.getTime() - ACTIVE_SESSION_GRACE_MS),
      batchSize,
      maxBatches,
    );
    const authSessionsDeleted = await deleteInBatches(
      client,
      DELETE_AUTH_SESSIONS,
      now,
      batchSize,
      maxBatches,
    );
    return { skipped: false, playSessionsDeleted, authSessionsDeleted };
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [CLEANUP_LOCK_KEY]);
      } catch {
        // Kết nối hỏng: huỷ client để khoá (theo session) được nhả khi kết nối đóng.
        destroy = true;
      }
    }
    if (timeoutsSet && !destroy) {
      try {
        await client.query('RESET lock_timeout; RESET statement_timeout');
      } catch {
        destroy = true;
      }
    }
    client.release(destroy);
  }
}

export interface CleanupLog {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface CleanupSchedulerOptions {
  pool: Pick<pg.Pool, 'connect'>;
  intervalMs: number;
  clock: () => Date;
  log: CleanupLog;
  initialDelayMs?: number;
}

export function startCleanupScheduler(opts: CleanupSchedulerOptions): {
  stop(): Promise<void>;
} {
  const { pool, intervalMs, clock, log, initialDelayMs = 60_000 } = opts;
  let current: Promise<void> | null = null;
  let stopped = false;
  let interval: NodeJS.Timeout | undefined;

  const tick = (): void => {
    if (stopped || current) return; // không chạy chồng
    current = (async () => {
      try {
        const r = await runCleanup(pool, { now: clock() });
        if (r.skipped) {
          log.info({ event: 'cleanup_skipped' });
        } else if (r.playSessionsDeleted > 0 || r.authSessionsDeleted > 0) {
          log.info({
            event: 'cleanup',
            playSessionsDeleted: r.playSessionsDeleted,
            authSessionsDeleted: r.authSessionsDeleted,
          });
        }
      } catch (err) {
        // Chỉ ghi tên/mã lỗi: thông điệp lỗi pg có thể chứa host/chi tiết kết nối.
        const e = err as { name?: unknown; code?: unknown } | null;
        log.warn({
          event: 'cleanup_failed',
          err: {
            name: typeof e?.name === 'string' ? e.name : 'Error',
            code: typeof e?.code === 'string' ? e.code : undefined,
          },
        });
      } finally {
        current = null;
      }
    })();
  };

  const initial = setTimeout(() => {
    tick();
    interval = setInterval(tick, intervalMs);
    interval.unref();
  }, initialDelayMs);
  initial.unref();

  return {
    async stop() {
      stopped = true;
      clearTimeout(initial);
      clearInterval(interval);
      await current;
    },
  };
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set; cannot run cleanup.');
    process.exit(1);
  }
  const pool = createPool(url);
  try {
    const r = await runCleanup(pool, { now: new Date() });
    if (r.skipped) {
      console.log('Cleanup skipped: another cleanup is running.');
    } else {
      console.log(
        `Cleanup done: ${r.playSessionsDeleted} abandoned play sessions, ${r.authSessionsDeleted} expired login sessions deleted.`,
      );
    }
  } catch (err) {
    // Chỉ tên + mã lỗi (mã SQLSTATE giúp chẩn đoán); message có thể chứa chi tiết kết nối.
    const code = (err as { code?: unknown } | null)?.code;
    console.error(
      'Cleanup failed:',
      err instanceof Error ? err.name : 'unknown error',
      typeof code === 'string' ? code : '',
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
