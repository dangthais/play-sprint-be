import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_SESSION_GRACE_MS,
  CLEANUP_LOCK_KEY,
  runCleanup,
  startCleanupScheduler,
} from './cleanup.ts';

interface FakeOpts {
  lock?: boolean;
  /** rowCount trả về lần lượt cho các câu DELETE. */
  deletes?: number[];
  failOnDelete?: boolean;
}

type Call = { sql: string; params: unknown[] };

function fakePool(opts: FakeOpts = {}) {
  const calls: Call[] = [];
  const deletes = [...(opts.deletes ?? [])];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []): Promise<unknown> => {
      calls.push({ sql, params });
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: opts.lock ?? true }] };
      if (sql.includes('pg_advisory_unlock')) return { rows: [] };
      if (/^(SET|RESET) /.test(sql)) return { rows: [] };
      if (opts.failOnDelete) throw new Error('boom postgres://user:secret@host/db');
      return { rows: [], rowCount: deletes.shift() ?? 0 };
    }),
    release: vi.fn(),
  };
  const connect = vi.fn(async () => client);
  return { pool: { connect } as never, connect, calls, client };
}

describe('runCleanup (fake pool)', () => {
  const now = new Date('2026-06-01T12:00:00Z');

  it('uses grace cutoff for active play sessions and now for auth sessions', async () => {
    const f = fakePool({ deletes: [3, 2] });
    const r = await runCleanup(f.pool, { now });
    expect(r).toEqual({ skipped: false, playSessionsDeleted: 3, authSessionsDeleted: 2 });
    const del = f.calls.filter((c) => c.sql.startsWith('DELETE'));
    expect(del).toHaveLength(2);
    expect(del[0]?.sql).toContain("status = 'active'");
    expect(del[0]?.params).toEqual([new Date(now.getTime() - ACTIVE_SESSION_GRACE_MS), 1000]);
    expect(del[1]?.sql).toContain('FROM auth_sessions');
    expect(del[1]?.params).toEqual([now, 1000]);
    expect(
      f.calls.some((c) => c.sql.includes('pg_advisory_unlock') && c.params[0] === CLEANUP_LOCK_KEY),
    ).toBe(true);
  });

  it('sets lock/statement timeouts before deleting and resets them before release', async () => {
    const f = fakePool({ deletes: [0, 0] });
    await runCleanup(f.pool, { now });
    const sqls = f.calls.map((c) => c.sql);
    const firstDelete = sqls.findIndex((s) => s.startsWith('DELETE'));
    expect(sqls.findIndex((s) => s.includes('lock_timeout'))).toBeLessThan(firstDelete);
    expect(sqls.findIndex((s) => s.includes('statement_timeout'))).toBeLessThan(firstDelete);
    expect(sqls.at(-1)).toMatch(/^RESET lock_timeout; RESET statement_timeout/);
    expect(f.client.release).toHaveBeenCalledWith(false);
  });

  it('never targets finished sessions in SQL', async () => {
    const f = fakePool();
    await runCleanup(f.pool, { now });
    for (const c of f.calls.filter((x) => x.sql.startsWith('DELETE'))) {
      expect(c.sql).not.toContain('finished');
    }
  });

  it('batches until a short batch or maxBatches', async () => {
    const a = fakePool({ deletes: [2, 2, 1, 0] });
    const r1 = await runCleanup(a.pool, { now, batchSize: 2 });
    expect(r1.playSessionsDeleted).toBe(5);
    const b = fakePool({ deletes: [2, 2, 2, 2, 2, 2] });
    const r2 = await runCleanup(b.pool, { now, batchSize: 2, maxBatches: 2 });
    expect(r2.playSessionsDeleted).toBe(4);
    expect(r2.authSessionsDeleted).toBe(4);
    expect(b.calls.filter((c) => c.sql.startsWith('DELETE'))).toHaveLength(4);
  });

  it('returns skipped when the lock is held and does not unlock', async () => {
    const f = fakePool({ lock: false });
    expect(await runCleanup(f.pool, { now })).toEqual({
      skipped: true,
      playSessionsDeleted: 0,
      authSessionsDeleted: 0,
    });
    expect(f.calls.some((c) => c.sql.startsWith('DELETE'))).toBe(false);
    expect(f.calls.some((c) => c.sql.includes('pg_advisory_unlock'))).toBe(false);
    expect(f.client.release).toHaveBeenCalledOnce();
  });

  it('unlocks and releases when a delete fails', async () => {
    const f = fakePool({ failOnDelete: true });
    await expect(runCleanup(f.pool, { now })).rejects.toThrow();
    expect(f.calls.some((c) => c.sql.includes('pg_advisory_unlock'))).toBe(true);
    expect(f.client.release).toHaveBeenCalledOnce();
  });

  it('rejects invalid batch options', async () => {
    const f = fakePool();
    await expect(runCleanup(f.pool, { now, batchSize: 0 })).rejects.toThrow();
    await expect(runCleanup(f.pool, { now, maxBatches: 1.5 })).rejects.toThrow();
  });
});

describe('startCleanupScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const makeLog = () => ({ info: vi.fn(), warn: vi.fn() });
  const lockCount = (calls: Call[]) =>
    calls.filter((c) => c.sql.includes('pg_try_advisory_lock')).length;

  it('runs after the initial delay, then every interval', async () => {
    const f = fakePool({ deletes: [1, 0] });
    const log = makeLog();
    const s = startCleanupScheduler({
      pool: f.pool,
      intervalMs: 1000,
      initialDelayMs: 500,
      clock: () => new Date('2026-06-01T00:00:00Z'),
      log,
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(lockCount(f.calls)).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(lockCount(f.calls)).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(lockCount(f.calls)).toBe(2);
    expect(log.info).toHaveBeenCalledWith({
      event: 'cleanup',
      playSessionsDeleted: 1,
      authSessionsDeleted: 0,
    });
    await s.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(lockCount(f.calls)).toBe(2);
  });

  it('does not overlap runs', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = fakePool();
    f.client.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      f.calls.push({ sql, params });
      if (sql.includes('pg_try_advisory_lock')) {
        await gate;
        return { rows: [{ locked: true }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const s = startCleanupScheduler({
      pool: f.pool,
      intervalMs: 100,
      initialDelayMs: 0,
      clock: () => new Date(),
      log: makeLog(),
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(lockCount(f.calls)).toBe(1);
    release();
    await s.stop();
  });

  it('logs a safe warn on failure and keeps running', async () => {
    const f = fakePool({ failOnDelete: true });
    const log = makeLog();
    const s = startCleanupScheduler({
      pool: f.pool,
      intervalMs: 100,
      initialDelayMs: 0,
      clock: () => new Date(),
      log,
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(log.warn.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(log.warn.mock.calls[0]?.[0]).toMatchObject({ event: 'cleanup_failed' });
    expect(JSON.stringify(log.warn.mock.calls)).not.toMatch(/secret|postgres:\/\//);
    await s.stop();
  });

  it('stop waits for the running pass', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = fakePool();
    f.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        await gate;
        return { rows: [{ locked: false }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const s = startCleanupScheduler({
      pool: f.pool,
      intervalMs: 100,
      initialDelayMs: 0,
      clock: () => new Date(),
      log: makeLog(),
    });
    await vi.advanceTimersByTimeAsync(1);
    let stopped = false;
    const p = s.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(10);
    expect(stopped).toBe(false);
    release();
    await p;
    expect(stopped).toBe(true);
  });

  it('stop before the first run cancels it', async () => {
    const f = fakePool();
    const s = startCleanupScheduler({
      pool: f.pool,
      intervalMs: 100,
      initialDelayMs: 500,
      clock: () => new Date(),
      log: makeLog(),
    });
    await s.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.connect).not.toHaveBeenCalled();
  });
});
