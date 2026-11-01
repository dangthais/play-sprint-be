import { isIP } from 'node:net';
import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import { rateLimitedError } from './errors.ts';

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  clock?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Số giây (nguyên, >= 1) tới khi cửa sổ kết thúc; chỉ có nghĩa khi `allowed = false`. */
  retryAfterSec: number;
  /** true khi bảng khoá đầy nên request dùng bucket chung "overflow"; caller nên log. */
  overflow: boolean;
}

function parseIpv6Groups(addr: string): number[] | null {
  let text = addr;
  // Đuôi IPv4 nhúng (a:b::1.2.3.4) → hai nhóm 16 bit.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (isIP(tail) !== 4) return null;
    const [a, b, c, d] = tail.split('.').map(Number) as [number, number, number, number];
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0] ?? '');
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const rest = toGroups(halves[1] ?? '');
  if (rest === null || head.length + rest.length > 7) return null;
  return [...head, ...new Array<number>(8 - head.length - rest.length).fill(0), ...rest];
}

/**
 * Chuẩn hoá IP thành khoá rate limit: IPv4 giữ nguyên; IPv4-mapped (`::ffff:a.b.c.d`) → IPv4;
 * IPv6 khác → prefix /64 (4 nhóm đầu, dạng `h:h:h:h::/64`); bỏ zone id (`%eth0`).
 * Chuỗi không phải IP hợp lệ được giữ nguyên (chữ thường).
 */
export function normalizeIpKey(ip: string): string {
  const addr = (ip.split('%', 1)[0] ?? '').toLowerCase();
  const family = isIP(addr);
  if (family === 4) return addr;
  if (family !== 6) return ip;
  const g = parseIpv6Groups(addr);
  if (g === null) return ip;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  }
  return `${g
    .slice(0, 4)
    .map((x) => x.toString(16))
    .join(':')}::/64`;
}

export interface RateLimiter {
  check(bucket: string, ip: string): RateLimitResult;
  size(): number;
}

interface Entry {
  count: number;
  resetAt: number;
}

export const DEFAULT_MAX_KEYS = 10_000;

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = opts;
  const maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
  const clock = opts.clock ?? Date.now;
  const entries = new Map<string, Entry>();
  // Bucket chung cho mọi khoá mới khi bảng đầy: tổng cộng tối đa `limit` request mỗi cửa sổ.
  const overflowEntries = new Map<string, Entry>();

  function sweep(now: number): void {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }
  }

  function checkOverflow(bucket: string, now: number): RateLimitResult {
    let entry = overflowEntries.get(bucket);
    if (entry === undefined || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      overflowEntries.set(bucket, entry);
    }
    entry.count += 1;
    if (entry.count > limit) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
        overflow: true,
      };
    }
    return { allowed: true, retryAfterSec: 0, overflow: true };
  }

  return {
    check(bucket, rawIp) {
      const now = clock();
      const key = `${bucket}\u0000${normalizeIpKey(rawIp)}`;
      const existing = entries.get(key);
      if (existing !== undefined && existing.resetAt > now) {
        existing.count += 1;
        if (existing.count > limit) {
          return {
            allowed: false,
            retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
            overflow: false,
          };
        }
        return { allowed: true, retryAfterSec: 0, overflow: false };
      }
      if (existing !== undefined) entries.delete(key);
      if (entries.size >= maxKeys) {
        sweep(now);
        if (entries.size >= maxKeys) return checkOverflow(bucket, now);
      }
      entries.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSec: 0, overflow: false };
    },
    size: () => entries.size,
  };
}

export type RateLimitName =
  | 'createSession'
  | 'submitScore'
  | 'leaderboard'
  | 'authRegister'
  | 'authLogin'
  | 'accountWrite'
  | 'accountRead';

/** Bucket khoá theo giá trị khác IP (email đã chuẩn hoá) — xem `createKeyedRateLimit`. */
export type KeyedRateLimitName = 'authLoginAccount' | 'passwordChangeAccount';

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export type RateLimitOverrides = Partial<
  Record<RateLimitName | KeyedRateLimitName, RateLimitConfig>
>;

export const DEFAULT_RATE_LIMITS: Readonly<Record<RateLimitName, RateLimitConfig>> = {
  createSession: { limit: 60, windowMs: 60_000 },
  submitScore: { limit: 60, windowMs: 60_000 },
  leaderboard: { limit: 120, windowMs: 60_000 },
  // ADR-025
  authRegister: { limit: 10, windowMs: 10 * 60_000 },
  authLogin: { limit: 30, windowMs: 5 * 60_000 },
  accountWrite: { limit: 20, windowMs: 15 * 60_000 },
  accountRead: { limit: 120, windowMs: 60_000 },
};

export const DEFAULT_KEYED_RATE_LIMITS: Readonly<Record<KeyedRateLimitName, RateLimitConfig>> = {
  authLoginAccount: { limit: 10, windowMs: 15 * 60_000 },
  passwordChangeAccount: { limit: 10, windowMs: 15 * 60_000 },
};

/**
 * Hook `onRequest` cho một bucket: chạy trước parse body/validate. Vượt hạn mức → 429 RATE_LIMITED
 * + `Retry-After`. Khi bảng khoá đầy, khoá mới dùng chung bucket overflow (tối đa `limit` request
 * mỗi cửa sổ cho tất cả) và log warn tối đa một lần mỗi cửa sổ.
 */
export function createRateLimitHook(
  bucket: string,
  config: RateLimitConfig,
  clock: () => number = Date.now,
  maxKeys?: number,
): onRequestAsyncHookHandler {
  const limiter = createRateLimiter({
    limit: config.limit,
    windowMs: config.windowMs,
    clock,
    ...(maxKeys !== undefined ? { maxKeys } : {}),
  });
  let lastWarnAt = Number.NEGATIVE_INFINITY;
  return async function rateLimitHook(request: FastifyRequest): Promise<void> {
    const result = limiter.check(bucket, request.ip);
    if (result.overflow) {
      const now = clock();
      if (now - lastWarnAt >= config.windowMs) {
        lastWarnAt = now;
        request.log.warn({ bucket }, 'rate limiter key table full; using shared overflow bucket');
      }
    }
    if (!result.allowed) throw rateLimitedError(result.retryAfterSec);
  };
}

export type RateLimitHooks = Record<RateLimitName, onRequestAsyncHookHandler>;

export function createRateLimitHooks(
  overrides: RateLimitOverrides = {},
  clock: () => number = Date.now,
): RateLimitHooks {
  const names = Object.keys(DEFAULT_RATE_LIMITS) as RateLimitName[];
  const hooks = {} as RateLimitHooks;
  for (const name of names) {
    hooks[name] = createRateLimitHook(name, overrides[name] ?? DEFAULT_RATE_LIMITS[name], clock);
  }
  return hooks;
}

/**
 * Số khoá tối đa mặc định của limiter theo khoá. Ước lượng bộ nhớ: mỗi entry ~200 byte (chuỗi khoá
 * ~60-100 byte + object Entry + overhead Map) → 100 000 khoá ~ 20 MB mỗi limiter (hiện có 2). Đủ lớn để
 * tấn công làm đầy bảng tốn kém; shard (1024) chỉ là lớp cuối.
 */
export const KEYED_DEFAULT_MAX_KEYS = 100_000;

export interface KeyedRateLimit {
  /**
   * Đếm một lần thử cho `key`; vượt hạn mức → ném 429 RATE_LIMITED (+ `Retry-After`). Bảng khoá đầy
   * và khoá mới → đếm vào bucket shard `fnv1a(key) mod KEYED_OVERFLOW_SHARDS` (cùng hạn mức, KHÔNG
   * fail-open) và gọi `onFull` tối đa một lần mỗi cửa sổ.
   */
  check(key: string, onFull?: () => void): void;
  size(): number;
}

/** Số shard overflow của limiter theo khoá (bộ nhớ chặn trên: K entry mỗi limiter). */
export const KEYED_OVERFLOW_SHARDS = 1024;

/** FNV-1a 32 bit trên UTF-8 của chuỗi (ổn định, không phụ thuộc runtime). */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (const byte of Buffer.from(text, 'utf8')) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Limiter cửa sổ cố định theo khoá tuỳ ý (vd. email đã chuẩn hoá, user id). Khi bảng đầy, khoá mới
 * không được cho qua (kẻ tấn công phân tán có thể lấp bảng rồi brute force khoá mục tiêu) mà đếm
 * vào một trong K bucket shard; khoá khác shard không bị ảnh hưởng, khoá cùng shard chia chung hạn
 * mức (chấp nhận false positive hiếm).
 */
export function createKeyedRateLimit(
  bucket: string,
  config: RateLimitConfig,
  clock: () => number = Date.now,
  maxKeys: number = KEYED_DEFAULT_MAX_KEYS,
): KeyedRateLimit {
  const entries = new Map<string, Entry>();
  const shards = new Map<string, Entry>();
  let lastWarnAt = Number.NEGATIVE_INFINITY;

  function count(map: Map<string, Entry>, id: string, now: number): void {
    let entry = map.get(id);
    if (entry === undefined || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + config.windowMs };
      map.set(id, entry);
    }
    entry.count += 1;
    if (entry.count > config.limit) {
      throw rateLimitedError(Math.max(1, Math.ceil((entry.resetAt - now) / 1000)));
    }
  }

  return {
    check(key, onFull) {
      const now = clock();
      const k = `${bucket}\u0000${key}`;
      const existing = entries.get(k);
      if (existing !== undefined && existing.resetAt > now) {
        count(entries, k, now);
        return;
      }
      if (existing !== undefined) entries.delete(k);
      if (entries.size >= maxKeys) {
        for (const [ek, entry] of entries) {
          if (entry.resetAt <= now) entries.delete(ek);
        }
        if (entries.size >= maxKeys) {
          if (now - lastWarnAt >= config.windowMs) {
            lastWarnAt = now;
            onFull?.();
          }
          count(shards, String(fnv1a(k) % KEYED_OVERFLOW_SHARDS), now);
          return;
        }
      }
      entries.set(k, { count: 1, resetAt: now + config.windowMs });
    },
    size: () => entries.size,
  };
}
