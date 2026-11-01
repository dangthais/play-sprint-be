import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { POST_BODY_LIMIT, buildApp } from './app.ts';
import { createInMemoryGamesRepository } from './games/games.repository.memory.ts';
import {
  DEFAULT_KEYED_RATE_LIMITS,
  DEFAULT_RATE_LIMITS,
  createKeyedRateLimit,
  fnv1a,
  KEYED_OVERFLOW_SHARDS,
  createRateLimitHook,
  createRateLimiter,
  normalizeIpKey,
} from './rate-limit.ts';

describe('createRateLimiter', () => {
  function setup(extra: { maxKeys?: number } = {}) {
    const t = { now: 1_000_000 };
    const limiter = createRateLimiter({
      limit: 3,
      windowMs: 60_000,
      clock: () => t.now,
      ...extra,
    });
    return { t, limiter };
  }

  it('allows up to limit then blocks with Retry-After >= 1', () => {
    const { t, limiter } = setup();
    for (let i = 0; i < 3; i++) expect(limiter.check('b', '1.1.1.1').allowed).toBe(true);
    const r = limiter.check('b', '1.1.1.1');
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBe(60);
    t.now += 59_500;
    expect(limiter.check('b', '1.1.1.1').retryAfterSec).toBe(1);
  });

  it('resets in a new window', () => {
    const { t, limiter } = setup();
    for (let i = 0; i < 4; i++) limiter.check('b', 'ip');
    t.now += 60_000;
    expect(limiter.check('b', 'ip').allowed).toBe(true);
  });

  it('keeps IPs and buckets independent', () => {
    const { limiter } = setup();
    for (let i = 0; i < 4; i++) limiter.check('b', 'ip1');
    expect(limiter.check('b', 'ip1').allowed).toBe(false);
    expect(limiter.check('b', 'ip2').allowed).toBe(true);
    expect(limiter.check('other', 'ip1').allowed).toBe(true);
  });

  it('shares one limited overflow bucket when key table is full', () => {
    const { t, limiter } = setup({ maxKeys: 2 });
    limiter.check('b', 'a');
    limiter.check('b', 'b');
    // 3 request đầu của overflow (limit = 3) qua, dù từ IP khác nhau; sau đó 429.
    for (const ip of ['c', 'd', 'e']) {
      expect(limiter.check('b', ip)).toMatchObject({ allowed: true, overflow: true });
    }
    const blocked = limiter.check('b', 'f');
    expect(blocked).toMatchObject({ allowed: false, overflow: true });
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(limiter.size()).toBe(2);
    // IP đã có khoá trước khi tràn vẫn dùng hạn mức riêng của nó.
    expect(limiter.check('b', 'a')).toMatchObject({ allowed: true, overflow: false });
    for (let i = 0; i < 2; i++) limiter.check('b', 'a');
    expect(limiter.check('b', 'a')).toMatchObject({ allowed: false, overflow: false });
    // Cửa sổ mới: khoá hết hạn bị dọn, overflow reset.
    t.now += 60_000;
    expect(limiter.check('b', 'c')).toMatchObject({ allowed: true, overflow: false });
    expect(limiter.size()).toBe(1);
  });

  it('IPv6 addresses in the same /64 share one limit; 10000 addresses cannot evade it', () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) limiter.check('b', `2001:db8:0:1::${i + 1}`);
    expect(limiter.check('b', '2001:db8:0:1:ffff::9').allowed).toBe(false);
    expect(limiter.check('b', '2001:db8:0:2::1').allowed).toBe(true);

    const big = createRateLimiter({ limit: 1000, windowMs: 60_000, maxKeys: 10_000 });
    for (let i = 0; i < 10_000; i++) big.check('b', `2001:db8::${i.toString(16)}`);
    expect(big.size()).toBe(1);
  });

  it('IPv4-mapped IPv6 shares the key of the IPv4 address', () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) limiter.check('b', '::ffff:1.2.3.4');
    expect(limiter.check('b', '1.2.3.4').allowed).toBe(false);
  });

  it('exports default limits from ADR-019', () => {
    expect(DEFAULT_RATE_LIMITS.createSession).toEqual({ limit: 60, windowMs: 60_000 });
    expect(DEFAULT_RATE_LIMITS.submitScore).toEqual({ limit: 60, windowMs: 60_000 });
    expect(DEFAULT_RATE_LIMITS.leaderboard).toEqual({ limit: 120, windowMs: 60_000 });
    // ADR-025
    expect(DEFAULT_RATE_LIMITS.authRegister).toEqual({ limit: 10, windowMs: 600_000 });
    expect(DEFAULT_RATE_LIMITS.authLogin).toEqual({ limit: 30, windowMs: 300_000 });
    expect(DEFAULT_RATE_LIMITS.accountWrite).toEqual({ limit: 20, windowMs: 900_000 });
    expect(DEFAULT_RATE_LIMITS.accountRead).toEqual({ limit: 120, windowMs: 60_000 });
    expect(DEFAULT_KEYED_RATE_LIMITS.authLoginAccount).toEqual({ limit: 10, windowMs: 900_000 });
    expect(DEFAULT_KEYED_RATE_LIMITS.passwordChangeAccount).toEqual({
      limit: 10,
      windowMs: 900_000,
    });
  });
});

describe('normalizeIpKey', () => {
  it.each([
    ['1.2.3.4', '1.2.3.4'],
    ['::ffff:1.2.3.4', '1.2.3.4'],
    ['::FFFF:102:304', '1.2.3.4'],
    ['0:0:0:0:0:ffff:1.2.3.4', '1.2.3.4'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['2001:DB8:0:0:ffff:ffff:ffff:ffff', '2001:db8:0:0::/64'],
    ['2001:0db8:0000:0001::5', '2001:db8:0:1::/64'],
    ['2001:db8:0:1:2:3:4:5', '2001:db8:0:1::/64'],
    ['::1', '0:0:0:0::/64'],
    ['::', '0:0:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['fe80::1%3', 'fe80:0:0:0::/64'],
    ['2001:db8:1:2:3:4:1.2.3.4', '2001:db8:1:2::/64'],
    ['not-an-ip', 'not-an-ip'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeIpKey(input)).toBe(expected);
  });

  it('different /64 prefixes stay different', () => {
    expect(normalizeIpKey('2001:db8:0:1::1')).not.toBe(normalizeIpKey('2001:db8:0:2::1'));
  });
});

describe('rate limit hook overflow logging', () => {
  it('warns at most once per window and limits the overflow bucket', async () => {
    const t = { now: 1_000_000 };
    const warn: unknown[] = [];
    const hook = createRateLimitHook('b', { limit: 2, windowMs: 60_000 }, () => t.now, 1);
    const call = (ip: string) =>
      hook.call(
        {} as never,
        { ip, log: { warn: (o: unknown) => warn.push(o) } } as never,
        {} as never,
      );
    await call('1.1.1.1'); // chiếm khoá duy nhất
    await call('2.2.2.2');
    await call('3.3.3.3');
    await expect(call('4.4.4.4')).rejects.toMatchObject({ statusCode: 429 });
    expect(warn).toHaveLength(1);
    t.now += 30_000;
    await expect(call('5.5.5.5')).rejects.toMatchObject({ statusCode: 429 });
    expect(warn).toHaveLength(1);
    t.now += 30_000; // cửa sổ mới
    await call('1.1.1.1');
    await call('6.6.6.6');
    expect(warn).toHaveLength(2);
  });
});

describe('rate limit hook in Fastify', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  function make(
    trustProxy?: number | false,
    limit = 2,
  ): { app: FastifyInstance; t: { now: number } } {
    const t = { now: 5_000_000 };
    const a = buildApp({
      gamesRepository: createInMemoryGamesRepository([]),
      ...(trustProxy !== undefined ? { trustProxy } : {}),
      rateLimits: { createSession: { limit, windowMs: 60_000 } },
      clock: () => t.now,
    });
    a.post(
      '/api/limited',
      {
        onRequest: a.rateLimitHooks.createSession,
        bodyLimit: POST_BODY_LIMIT,
        schema: { body: { type: 'object', required: ['x'] } },
      },
      async () => ({ ok: true }),
    );
    app = a;
    return { app: a, t };
  }

  const post = (a: FastifyInstance, payload: string, headers: Record<string, string> = {}) =>
    a.inject({
      method: 'POST',
      url: '/api/limited',
      headers: { 'content-type': 'application/json', ...headers },
      payload,
    });

  it('request N+1 -> 429 RATE_LIMITED with Retry-After, then resets', async () => {
    const { app: a, t } = make();
    expect((await post(a, '{"x":1}')).statusCode).toBe(200);
    expect((await post(a, '{"x":1}')).statusCode).toBe(200);
    const res = await post(a, '{"x":1}');
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ code: 'RATE_LIMITED', message: 'Too many requests' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    t.now += 60_000;
    expect((await post(a, '{"x":1}')).statusCode).toBe(200);
  });

  it('runs before body parse/validate: broken body still gets 429 once over limit', async () => {
    const { app: a } = make();
    expect((await post(a, '{broken')).statusCode).toBe(400);
    expect((await post(a, '{"y":1}')).statusCode).toBe(400);
    const res = await post(a, '{broken');
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('RATE_LIMITED');
  });

  it('runs before content-type and size checks', async () => {
    const { app: a } = make(undefined, 1);
    await post(a, '{"x":1}');
    const res = await a.inject({
      method: 'POST',
      url: '/api/limited',
      headers: { 'content-type': 'text/plain' },
      payload: 'x'.repeat(5000),
    });
    expect(res.statusCode).toBe(429);
  });

  it('spoofed X-Forwarded-For does not bypass limit when trustProxy=false', async () => {
    const { app: a } = make(false);
    await post(a, '{"x":1}', { 'x-forwarded-for': '9.9.9.1' });
    await post(a, '{"x":1}', { 'x-forwarded-for': '9.9.9.2' });
    const res = await post(a, '{"x":1}', { 'x-forwarded-for': '9.9.9.3' });
    expect(res.statusCode).toBe(429);
  });

  it('trustProxy=1 keys on the IP from X-Forwarded-For', async () => {
    const { app: a } = make(1);
    const h1 = { 'x-forwarded-for': '9.9.9.1' };
    const h2 = { 'x-forwarded-for': '9.9.9.2' };
    await post(a, '{"x":1}', h1);
    await post(a, '{"x":1}', h1);
    expect((await post(a, '{"x":1}', h1)).statusCode).toBe(429);
    expect((await post(a, '{"x":1}', h2)).statusCode).toBe(200);
  });
});

describe('createKeyedRateLimit (ADR-025)', () => {
  function setup(maxKeys?: number) {
    const t = { now: 5_000_000 };
    const limiter = createKeyedRateLimit('k', { limit: 2, windowMs: 60_000 }, () => t.now, maxKeys);
    return { t, limiter };
  }
  const retryAfter = (fn: () => void): number | undefined => {
    try {
      fn();
    } catch (err) {
      return Number((err as { headers?: Record<string, string> }).headers?.['Retry-After']);
    }
    return undefined;
  };

  it('allows up to limit per key, then throws 429 RATE_LIMITED with Retry-After >= 1', () => {
    const { t, limiter } = setup();
    limiter.check('a');
    limiter.check('a');
    expect(() => limiter.check('a')).toThrowError(
      expect.objectContaining({ statusCode: 429, code: 'RATE_LIMITED' }),
    );
    expect(retryAfter(() => limiter.check('a'))).toBe(60);
    t.now += 59_500;
    expect(retryAfter(() => limiter.check('a'))).toBe(1);
  });

  it('keys are independent and a new window resets', () => {
    const { t, limiter } = setup();
    for (let i = 0; i < 3; i++) retryAfter(() => limiter.check('a'));
    expect(() => limiter.check('b')).not.toThrow();
    t.now += 60_000;
    expect(() => limiter.check('a')).not.toThrow();
  });

  it('full table: new keys count in a shard bucket (no fail-open); onFull fires at most once per window; known keys keep their own entry', () => {
    const { t, limiter } = setup(1);
    let full = 0;
    const onFull = () => void (full += 1);
    limiter.check('a', onFull);
    // khoá mới "target" khi bảng đầy: vẫn bị chặn sau `limit` (= 2) lần
    limiter.check('target', onFull);
    limiter.check('target', onFull);
    expect(() => limiter.check('target', onFull)).toThrowError(
      expect.objectContaining({ statusCode: 429, code: 'RATE_LIMITED' }),
    );
    expect(full).toBe(1);
    expect(limiter.size()).toBe(1);
    // khoá khác shard không bị ảnh hưởng
    const shard = (k: string) => fnv1a(`k\u0000${k}`) % KEYED_OVERFLOW_SHARDS;
    let other = 0;
    while (shard(`other${other}`) === shard('target')) other += 1;
    expect(() => limiter.check(`other${other}`, onFull)).not.toThrow();
    // khoá cùng shard dùng chung bucket
    let same = 0;
    while (shard(`same${same}`) !== shard('target')) same += 1;
    expect(() => limiter.check(`same${same}`, onFull)).toThrow();
    // khoá đã có vẫn dùng entry riêng
    limiter.check('a', onFull);
    expect(() => limiter.check('a', onFull)).toThrow();
    t.now += 60_000;
    limiter.check('zz', onFull); // đã hết hạn → quét → có chỗ
    expect(limiter.size()).toBe(1);
    limiter.check('yy', onFull); // lại đầy → cảnh báo cửa sổ mới
    expect(full).toBe(2);
  });

  it('fnv1a is stable', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
  });

  it('sweeps expired keys before declaring the table full', () => {
    const { t, limiter } = setup(2);
    limiter.check('a');
    limiter.check('b');
    t.now += 60_000;
    let full = 0;
    limiter.check('c', () => void (full += 1));
    expect(full).toBe(0);
    expect(limiter.size()).toBe(1);
  });
});
