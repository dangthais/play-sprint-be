import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { POST_BODY_LIMIT, buildApp } from './app.ts';
import { AppError } from './errors.ts';
import { createInMemoryGamesRepository } from './games/games.repository.memory.ts';
import { API_SECURITY_HEADERS } from './security-headers.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function make(): FastifyInstance {
  const a = buildApp({
    gamesRepository: createInMemoryGamesRepository([]),
    rateLimits: { leaderboard: { limit: 1, windowMs: 60_000 } },
  });
  a.post(
    '/api/echo',
    {
      bodyLimit: POST_BODY_LIMIT,
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: { name: { type: 'string' } },
        },
      },
    },
    async () => ({ ok: true }),
  );
  a.get('/api/boom', async () => {
    throw new Error('internal detail');
  });
  a.get('/api/err401', async () => {
    throw new AppError(401, 'UNAUTHORIZED', 'x');
  });
  a.get('/api/err403', async () => {
    throw new AppError(403, 'FORBIDDEN', 'x');
  });
  a.get('/api/own-cache', async (_req, reply) => {
    void reply.header('Cache-Control', 'public, max-age=60');
    return { ok: true };
  });
  app = a;
  return a;
}

function expectSecurityHeaders(headers: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    expect(headers[name]).toBe(value);
  }
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
  expect(headers['cross-origin-resource-policy']).toBe('same-origin');
  expect(headers['referrer-policy']).toBe('no-referrer');
}

describe('security headers', () => {
  it('200: đủ header + Cache-Control no-store mặc định', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expectSecurityHeaders(res.headers);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('400: validation', async () => {
    const res = await make().inject({ method: 'POST', url: '/api/echo', payload: { x: 1 } });
    expect(res.statusCode).toBe(400);
    expectSecurityHeaders(res.headers);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('401', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/err401' });
    expect(res.statusCode).toBe(401);
    expectSecurityHeaders(res.headers);
  });

  it('403', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/err403' });
    expect(res.statusCode).toBe(403);
    expectSecurityHeaders(res.headers);
  });

  it('404: notFound handler', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/khong-ton-tai' });
    expect(res.statusCode).toBe(404);
    expectSecurityHeaders(res.headers);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('413: body quá giới hạn', async () => {
    const res = await make().inject({
      method: 'POST',
      url: '/api/echo',
      payload: { name: 'a'.repeat(POST_BODY_LIMIT + 10) },
    });
    expect(res.statusCode).toBe(413);
    expectSecurityHeaders(res.headers);
  });

  it('415: text/plain', async () => {
    const res = await make().inject({
      method: 'POST',
      url: '/api/echo',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    });
    expect(res.statusCode).toBe(415);
    expectSecurityHeaders(res.headers);
  });

  it('429: rate limit', async () => {
    const a = make();
    const url = '/api/games/abc/leaderboard';
    await a.inject({ method: 'GET', url });
    const res = await a.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(429);
    expectSecurityHeaders(res.headers);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('500: lỗi không xử lý', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/boom' });
    expect(res.statusCode).toBe(500);
    expectSecurityHeaders(res.headers);
    expect(res.body).not.toContain('internal detail');
  });

  it('không ghi đè Cache-Control do route tự đặt', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/own-cache' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expectSecurityHeaders(res.headers);
  });
});
