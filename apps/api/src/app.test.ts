import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { POST_BODY_LIMIT, buildApp } from './app.ts';
import { AppError, gameNotRankedError, rateLimitedError } from './errors.ts';
import { createInMemoryGamesRepository } from './games/games.repository.memory.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function make(): FastifyInstance {
  const a = buildApp({ gamesRepository: createInMemoryGamesRepository([]) });
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
    throw new Error('connection to db-internal:5432 refused');
  });
  a.get('/api/app-error', async () => {
    throw gameNotRankedError('not ranked');
  });
  a.get('/api/limited', async () => {
    throw rateLimitedError(7);
  });
  a.get('/api/app-500', async () => {
    throw new AppError(500, 'INTERNAL_ERROR', 'x');
  });
  a.get('/api/fw-418', async () => {
    throw Object.assign(new Error('internal detail'), { statusCode: 418 });
  });
  app = a;
  return a;
}

function expectErrorBody(body: unknown, code: string): void {
  expect(Object.keys(body as object).sort()).toEqual(['code', 'message']);
  expect((body as { code: string }).code).toBe(code);
  expect(typeof (body as { message: unknown }).message).toBe('string');
}

const json = { 'content-type': 'application/json' };

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const a = make();
    const res = await a.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('error handler (ADR-020)', () => {
  it('404 for unknown route', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expectErrorBody(res.json(), 'NOT_FOUND');
  });

  it('keeps 400 VALIDATION_ERROR for games query', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/games?limit=0' });
    expect(res.statusCode).toBe(400);
    expectErrorBody(res.json(), 'VALIDATION_ERROR');
  });

  it('AppError keeps status and code', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/app-error' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ code: 'GAME_NOT_RANKED', message: 'not ranked' });
  });

  it('AppError extra headers are sent (Retry-After)', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/limited' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('7');
    expectErrorBody(res.json(), 'RATE_LIMITED');
  });

  it('AppError 500 keeps shape', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/app-500' });
    expect(res.statusCode).toBe(500);
    expectErrorBody(res.json(), 'INTERNAL_ERROR');
  });

  it('unexpected error -> 500 INTERNAL_ERROR without leaking details', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/boom' });
    expect(res.statusCode).toBe(500);
    expectErrorBody(res.json(), 'INTERNAL_ERROR');
    expect(res.body).not.toContain('db-internal');
  });

  it('other framework 4xx keeps status with BAD_REQUEST and generic message', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/fw-418' });
    expect(res.statusCode).toBe(418);
    expectErrorBody(res.json(), 'BAD_REQUEST');
    expect(res.body).not.toContain('internal detail');
  });

  it('valid JSON body passes', async () => {
    const res = await make().inject({
      method: 'POST',
      url: '/api/echo',
      headers: json,
      payload: '{"name":"a"}',
    });
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ['malformed JSON', '{"name":'],
    ['empty body', ''],
    ['schema violation', '{"name":1}'],
    ['extra property', '{"name":"a","x":1}'],
  ])('%s -> 400 VALIDATION_ERROR', async (_label, payload) => {
    const res = await make().inject({
      method: 'POST',
      url: '/api/echo',
      headers: json,
      payload,
    });
    expect(res.statusCode).toBe(400);
    expectErrorBody(res.json(), 'VALIDATION_ERROR');
  });

  it('body over POST_BODY_LIMIT -> 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await make().inject({
      method: 'POST',
      url: '/api/echo',
      headers: json,
      payload: JSON.stringify({ name: 'a'.repeat(POST_BODY_LIMIT) }),
    });
    expect(res.statusCode).toBe(413);
    expectErrorBody(res.json(), 'PAYLOAD_TOO_LARGE');
  });

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'application/xml'])(
    'content-type %s -> 415 UNSUPPORTED_MEDIA_TYPE',
    async (contentType) => {
      const res = await make().inject({
        method: 'POST',
        url: '/api/echo',
        headers: { 'content-type': contentType },
        payload: 'name=a',
      });
      expect(res.statusCode).toBe(415);
      expectErrorBody(res.json(), 'UNSUPPORTED_MEDIA_TYPE');
    },
  );
});

describe('logging', () => {
  function makeLogged() {
    const lines: string[] = [];
    const a = buildApp({
      gamesRepository: createInMemoryGamesRepository([]),
      logger: { level: 'info', stream: { write: (l: string) => void lines.push(l) } } as never,
    });
    a.get('/api/pg-error', async () => {
      throw Object.assign(
        new Error('null value in column "player_name" violates not-null constraint'),
        {
          name: 'error',
          severity: 'ERROR',
          code: '23502',
          constraint: 'sessions_pkey',
          table: 'game_sessions',
          detail: 'Failing row contains (SECRET_TOKEN_HASH, SECRET_PLAYER_NAME)',
          where: 'SECRET_WHERE',
          hint: 'SECRET_HINT',
          parameters: ['SECRET_PARAM'],
        },
      );
    });
    a.get('/api/plain-error', async () => {
      throw new Error('plain failure');
    });
    a.get('/api/app-error', async () => {
      throw gameNotRankedError('not ranked');
    });
    app = a;
    const records = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    return { a, lines, records };
  }

  it('5xx pg error log keeps only code/constraint/table (no detail/where/parameters/hint)', async () => {
    const { a, lines, records } = makeLogged();
    const res = await a.inject({ method: 'GET', url: '/api/pg-error' });
    expect(res.statusCode).toBe(500);
    const all = lines.join('\n');
    expect(all).not.toContain('SECRET');
    expect(all).not.toContain('player_name');
    const rec = records().find((r) => r.msg === 'unhandled error');
    expect(rec?.err).toMatchObject({
      code: '23502',
      constraint: 'sessions_pkey',
      table: 'game_sessions',
    });
  });

  it('5xx non-pg error log keeps type, message and stack', async () => {
    const { a, records } = makeLogged();
    await a.inject({ method: 'GET', url: '/api/plain-error' });
    const rec = records().find((r) => r.msg === 'unhandled error');
    expect(rec?.err).toMatchObject({ type: 'Error', message: 'plain failure' });
    expect(typeof (rec?.err as { stack: unknown }).stack).toBe('string');
  });

  it('AppError 4xx logs warn with only code and statusCode', async () => {
    const { a, records } = makeLogged();
    await a.inject({ method: 'GET', url: '/api/app-error', headers: { 'x-session-token': 'abc' } });
    const rec = records().find((r) => r.msg === 'client error');
    expect(rec).toMatchObject({ level: 40, code: 'GAME_NOT_RANKED', statusCode: 422 });
    expect(rec).not.toHaveProperty('err');
    expect(JSON.stringify(rec)).not.toContain('abc');
  });

  it('redacts cookie / token / set-cookie headers even if a serializer exposes them (defence in depth)', async () => {
    const lines: string[] = [];
    const a = buildApp({
      gamesRepository: createInMemoryGamesRepository([]),
      logger: {
        level: 'info',
        stream: { write: (l: string) => void lines.push(l) },
        serializers: { req: (r: unknown) => r, res: (r: unknown) => r },
      } as never,
    });
    app = a;
    await a.ready();
    a.log.info(
      {
        req: {
          method: 'POST',
          headers: {
            cookie: 'qp_sid=SECRETCOOKIE',
            authorization: 'Bearer SECRETAUTH',
            'x-session-token': 'SECRETTOKEN',
            accept: 'visible-header',
          },
        },
        res: { headers: { 'set-cookie': 'qp_sid=SECRETSETCOOKIE; HttpOnly' } },
      },
      'probe',
    );
    const out = lines.join('\n');
    expect(out).not.toContain('SECRET');
    expect(out).toContain('visible-header');
    expect(out).toContain('[Redacted]');
  });

  it('keeps caller-provided redact paths', async () => {
    const lines: string[] = [];
    const a = buildApp({
      gamesRepository: createInMemoryGamesRepository([]),
      logger: {
        level: 'info',
        stream: { write: (l: string) => void lines.push(l) },
        redact: ['extra.secret'],
      } as never,
    });
    app = a;
    await a.ready();
    a.log.info({ extra: { secret: 'KEEPME-SECRET' } }, 'probe');
    expect(lines.join('\n')).not.toContain('KEEPME-SECRET');
  });
});
