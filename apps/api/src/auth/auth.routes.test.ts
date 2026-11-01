import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuildAppOptions } from '../app.ts';
import { createInMemoryGamesRepository } from '../games/games.repository.memory.ts';
import { generateToken, hashToken } from '../sessions/token.ts';
import {
  createInMemoryAuthRepository,
  type InMemoryAuthRepository,
} from './auth.repository.memory.ts';
import { createAuthService } from './auth.service.ts';
import type { AuthRepository } from './auth.types.ts';
import { hashPassword } from './password.ts';

const WEB = 'http://localhost:5173';
const PW = 'mat-khau-dai-9';
const T0 = Date.UTC(2026, 9, 24, 8, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const COOKIE_RE = /^qp_sid=([A-Za-z0-9_-]{43}); Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/;

let HASH: string;
beforeAll(async () => {
  HASH = await hashPassword(PW);
});

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

interface H {
  app: FastifyInstance;
  repo: InMemoryAuthRepository;
  clock: { now: number };
  lines: string[];
  records(): Record<string, unknown>[];
}

function make(extra: Partial<BuildAppOptions> = {}, repo = createInMemoryAuthRepository()): H {
  const clock = { now: T0 };
  const lines: string[] = [];
  const app = buildApp({
    gamesRepository: createInMemoryGamesRepository([]),
    authRepository: repo,
    clock: () => clock.now,
    logger: { level: 'info', stream: { write: (l: string) => void lines.push(l) } } as never,
    ...extra,
  });
  // Route phụ để kiểm các hook dùng chung cho T2 (`/sessions*`, `/me/sessions`...).
  app.post('/api/_t/if-cookie', { onRequest: app.auth.requireSameOriginIfCookie }, async () => ({
    ok: true,
  }));
  app.get('/api/_t/user', { onRequest: app.auth.requireUser }, async (request) => ({
    id: request.authUser?.id,
  }));
  app.get('/api/_t/user-prehandler', { preHandler: app.auth.requireUser }, async (request) => ({
    id: request.authUser?.id,
  }));
  app.get('/api/_t/resolve', async (request) => {
    const a = await app.auth.resolve(request);
    const b = await app.auth.resolve(request);
    return { same: a === b, id: a?.user.id ?? null };
  });
  apps.push(app);
  return { app, repo, clock, lines, records: () => lines.map((l) => JSON.parse(l)) };
}

type Hdrs = Record<string, string | undefined>;

function clean(h: Hdrs): Record<string, string> {
  return Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;
}

function call(
  h: H,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  body?: unknown,
  headers: Hdrs = {},
  remoteAddress?: string,
): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method,
    url,
    headers: clean({ 'content-type': 'application/json', origin: WEB, ...headers }),
    ...(body === undefined
      ? {}
      : { payload: typeof body === 'string' ? body : JSON.stringify(body) }),
    ...(remoteAddress !== undefined ? { remoteAddress } : {}),
  });
}

const setCookieOf = (res: LightMyRequestResponse): string => {
  const v = res.headers['set-cookie'];
  if (typeof v !== 'string') throw new Error(`expected a single Set-Cookie, got ${String(v)}`);
  return v;
};
const tokenOf = (res: LightMyRequestResponse): string =>
  (
    /^(?:__Host-)?qp_sid=([A-Za-z0-9_-]{43});/.exec(setCookieOf(res)) as RegExpExecArray
  )[1] as string;
const cookie = (token: string, name = 'qp_sid'): Hdrs => ({ cookie: `${name}=${token}` });

const REG = { email: '  Lan@Example.COM ', password: PW, displayName: ' Lan ' };

async function seed(
  h: H,
  over: { email?: string; name?: string; password?: string; sessions?: number } = {},
) {
  const name = over.name ?? 'Lan';
  const tokens: string[] = [];
  const now = new Date(h.clock.now);
  const mk = () => {
    const token = generateToken();
    tokens.push(token);
    return {
      id: randomUUID(),
      tokenHash: hashToken(token),
      createdAt: now,
      expiresAt: new Date(h.clock.now + 30 * DAY),
    };
  };
  const passwordHash = over.password === undefined ? HASH : await hashPassword(over.password);
  const user = await h.repo.register({
    id: randomUUID(),
    email: over.email ?? 'lan@example.com',
    passwordHash,
    displayName: name,
    displayNameKey: name.toLowerCase(),
    now,
    session: mk(),
    replaceTokenHash: null,
  });
  for (let i = 1; i < (over.sessions ?? 1); i++) {
    await h.repo.startSession({
      userId: user.id,
      verifiedPasswordHash: passwordHash,
      now,
      session: mk(),
      replaceTokenHash: null,
      rehash: null,
    });
  }
  return { user, tokens };
}

function expectError(res: LightMyRequestResponse, status: number, code: string): void {
  expect(res.statusCode).toBe(status);
  const body = res.json() as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(['code', 'message']);
  expect(body.code).toBe(code);
}

describe('POST /api/auth/register (AC1, AC3)', () => {
  it('201: normalized user, cookie flags, DB stores only hashes', async () => {
    const h = make();
    const res = await call(h, 'POST', '/api/auth/register', REG);
    expect(res.statusCode).toBe(201);
    const body = res.json() as { user: Record<string, unknown> };
    expect(Object.keys(body)).toEqual(['user']);
    expect(Object.keys(body.user).sort()).toEqual(['createdAt', 'displayName', 'email', 'id']);
    expect(body.user).toMatchObject({
      email: 'lan@example.com',
      displayName: 'Lan',
      createdAt: new Date(T0).toISOString(),
    });
    expect(res.body).not.toContain(PW);
    expect(res.body).not.toContain('scrypt');

    const sc = setCookieOf(res);
    const m = COOKIE_RE.exec(sc);
    expect(m).not.toBeNull();
    expect(sc).not.toMatch(/Domain|Secure/i);
    const token = m?.[1] as string;
    expect(res.body).not.toContain(token);

    const user = h.repo.getUser(body.user.id as string);
    expect(user?.passwordHash.startsWith('scrypt$v=1$n=32768,r=8,p=1$')).toBe(true);
    expect(user?.passwordHash).not.toContain(token);
    expect(h.repo.hasSession(createHash('sha256').update(token).digest())).toBe(true);
    expect(h.repo.sessionCount()).toBe(1);
  });

  it('COOKIE_SECURE: __Host- name + Secure attribute (and the plain cookie name is ignored)', async () => {
    const h = make({ webOrigin: 'https://qp.example.com' });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'content-type': 'application/json', origin: 'https://qp.example.com' },
      payload: JSON.stringify(REG),
    });
    expect(res.statusCode).toBe(201);
    const sc = setCookieOf(res);
    expect(sc).toMatch(
      /^__Host-qp_sid=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/,
    );
    expect(sc).not.toMatch(/Domain/i);
    const token = tokenOf(res);
    const secureMe = await h.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: cookie(token, '__Host-qp_sid'),
    });
    expect((secureMe.json() as { user: unknown }).user).not.toBeNull();
    const plainMe = await h.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: cookie(token, 'qp_sid'),
    });
    expect(plainMe.json()).toEqual({ user: null });
  });

  it('explicit cookieSecure option overrides the origin-derived default', async () => {
    const h = make({ cookieSecure: true });
    const res = await call(h, 'POST', '/api/auth/register', REG);
    expect(setCookieOf(res)).toMatch(/^__Host-qp_sid=.*; Secure$/);
  });

  it('409 EMAIL_TAKEN for the same email in a different case', async () => {
    const h = make();
    await seed(h, { email: 'lan@example.com', name: 'Lan' });
    const res = await call(h, 'POST', '/api/auth/register', {
      email: 'LAN@EXAMPLE.COM',
      password: PW,
      displayName: 'Other',
    });
    expectError(res, 409, 'EMAIL_TAKEN');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('409 NAME_TAKEN for the same display name in a different case; email wins when both clash', async () => {
    const h = make();
    await seed(h, { email: 'lan@example.com', name: 'Lan' });
    const name = await call(h, 'POST', '/api/auth/register', {
      email: 'new@example.com',
      password: PW,
      displayName: 'LAN',
    });
    expectError(name, 409, 'NAME_TAKEN');
    const both = await call(h, 'POST', '/api/auth/register', {
      email: 'lan@example.com',
      password: PW,
      displayName: 'LAN',
    });
    expectError(both, 409, 'EMAIL_TAKEN');
    expect(h.repo.userCount()).toBe(1);
  });

  it('a name only ever used by a guest (nothing in accounts) can be registered', async () => {
    const h = make();
    const res = await call(h, 'POST', '/api/auth/register', {
      email: 'minh@example.com',
      password: PW,
      displayName: 'Minh',
    });
    expect(res.statusCode).toBe(201);
  });

  it('NFD and NFC passwords are interchangeable at login', async () => {
    const h = make();
    const nfc = 'mậtkhẩu12'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    expect(nfc).not.toBe(nfd);
    await call(h, 'POST', '/api/auth/register', {
      email: 'vn@example.com',
      password: nfd,
      displayName: 'Vn',
    });
    for (const password of [nfc, nfd]) {
      const res = await call(h, 'POST', '/api/auth/login', { email: 'vn@example.com', password });
      expect(res.statusCode).toBe(200);
    }
  });
});

describe('register validation (AC2)', () => {
  const ok = { email: 'a@example.com', password: PW, displayName: 'Lan' };
  const RLO = String.fromCharCode(0x202e);
  const ZWSP = String.fromCharCode(0x200b);

  it.each([
    ['a@b'],
    ['a b@c.de'],
    ['lan@ví.dụ'],
    [`${'a'.repeat(250)}@b.cc`],
    [5],
    [null],
    [undefined],
  ])('email %j -> 400', async (email) => {
    const res = await call(make(), 'POST', '/api/auth/register', { ...ok, email });
    expectError(res, 400, 'VALIDATION_ERROR');
  });

  it('email of 255 characters -> 400', async () => {
    const label = 'a'.repeat(63);
    const email = `${'x'.repeat(64)}@${label}.${label}.${'b'.repeat(62)}`;
    expect(email.length).toBe(255);
    const res = await call(make(), 'POST', '/api/auth/register', { ...ok, email });
    expectError(res, 400, 'VALIDATION_ERROR');
  });

  it('password length boundaries: 7 -> 400, 8 -> 201, 128 -> 201, 129 -> 400; not a string -> 400', async () => {
    const h = make();
    const try_ = (password: unknown, n: number) =>
      call(h, 'POST', '/api/auth/register', {
        email: `p${n}@example.com`,
        password,
        displayName: `P${n}`,
      });
    expectError(await try_('1234567', 1), 400, 'VALIDATION_ERROR');
    expect((await try_('12345678', 2)).statusCode).toBe(201);
    expect((await try_('a'.repeat(128), 3)).statusCode).toBe(201);
    expectError(await try_('a'.repeat(129), 4), 400, 'VALIDATION_ERROR');
    expectError(await try_(12345678, 5), 400, 'VALIDATION_ERROR');
    expectError(await try_(undefined, 6), 400, 'VALIDATION_ERROR');
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['21 chars', 'a'.repeat(21)],
    ['html', 'a<b'],
    ['bidi', `${RLO}abc`],
    ['zero width', `ab${ZWSP}`],
    ['emoji', '😀'],
    ['3 combining marks', `a${'́'.repeat(3)}`],
    ['number', 5],
  ])('displayName %s -> 400', async (_label, displayName) => {
    const res = await call(make(), 'POST', '/api/auth/register', { ...ok, displayName });
    expectError(res, 400, 'VALIDATION_ERROR');
  });

  it('error messages never echo submitted values', async () => {
    const res = await call(make(), 'POST', '/api/auth/register', {
      email: 'Sup3rSecretEmailValue',
      password: 'Sup3rSecretPw',
      displayName: 'Sup3rSecretName<',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('Sup3rSecret');
    const pw = await call(make(), 'POST', '/api/auth/register', { ...ok, password: 'Sec7' });
    expect(pw.body).not.toContain('Sec7');
  });

  it('body > 4 KiB -> 413; 1-4 KiB bodies are still parsed (limit is 4 KiB, not 1 KiB)', async () => {
    const h = make();
    const big = await call(h, 'POST', '/api/auth/register', {
      ...ok,
      displayName: 'a'.repeat(5000),
    });
    expectError(big, 413, 'PAYLOAD_TOO_LARGE');
    const medium = await call(h, 'POST', '/api/auth/register', {
      ...ok,
      displayName: 'a'.repeat(2000),
    });
    expectError(medium, 400, 'VALIDATION_ERROR');
  });

  it.each(['text/plain', 'application/x-www-form-urlencoded'])(
    'content-type %s -> 415',
    async (contentType) => {
      const res = await call(make(), 'POST', '/api/auth/register', 'a=b', {
        'content-type': contentType,
      });
      expectError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    },
  );

  it.each([['{"email":'], ['']])('malformed or empty JSON %j -> 400', async (payload) => {
    const res = await call(make(), 'POST', '/api/auth/register', payload);
    expectError(res, 400, 'VALIDATION_ERROR');
  });
});

describe('POST /api/auth/login (AC4)', () => {
  it('200 with a fresh cookie on success; email is normalized', async () => {
    const h = make();
    const { user } = await seed(h);
    const res = await call(h, 'POST', '/api/auth/login', {
      email: ' LAN@example.com ',
      password: PW,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      user: {
        id: user.id,
        email: 'lan@example.com',
        displayName: 'Lan',
        createdAt: new Date(T0).toISOString(),
      },
    });
    expect(COOKIE_RE.test(setCookieOf(res))).toBe(true);
  });

  it('wrong password and unknown email give byte-identical 401 INVALID_CREDENTIALS', async () => {
    const h = make();
    await seed(h);
    const wrong = await call(h, 'POST', '/api/auth/login', {
      email: 'lan@example.com',
      password: 'wrong-pw',
    });
    const unknown = await call(h, 'POST', '/api/auth/login', {
      email: 'nobody@example.com',
      password: PW,
    });
    expectError(wrong, 401, 'INVALID_CREDENTIALS');
    expectError(unknown, 401, 'INVALID_CREDENTIALS');
    expect(wrong.body).toBe(unknown.body);
    expect(wrong.headers['set-cookie']).toBeUndefined();
    expect(unknown.headers['set-cookie']).toBeUndefined();
    expect(h.repo.sessionCount()).toBe(1);
  });

  it('validation: bad email format / password length outside 1-128 -> 400', async () => {
    const h = make();
    for (const body of [
      { email: 'nope', password: PW },
      { email: 'lan@example.com', password: '' },
      { email: 'lan@example.com', password: 'a'.repeat(129) },
      { email: 'lan@example.com', password: 5 },
      { email: 'lan@example.com' },
    ]) {
      expectError(await call(h, 'POST', '/api/auth/login', body), 400, 'VALIDATION_ERROR');
    }
    // 1 ký tự là hợp lệ về định dạng (sai mật khẩu → 401, không phải 400)
    expectError(
      await call(h, 'POST', '/api/auth/login', { email: 'lan@example.com', password: 'x' }),
      401,
      'INVALID_CREDENTIALS',
    );
  });

  it('verifyPassword still runs with a (dummy) hash when the email does not exist', async () => {
    const repo = createInMemoryAuthRepository();
    const stored: string[] = [];
    const service = createAuthService({
      repository: repo,
      clock: () => T0,
      verify: async (_pw, hash) => {
        stored.push(hash);
        return false;
      },
    });
    const log = { warn: () => undefined, error: () => undefined };
    await expect(
      service.login({ email: 'nobody@example.com', password: PW, oldToken: null }, log),
    ).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.startsWith('scrypt$v=1$')).toBe(true);
  });

  it('upgrades a hash with old parameters on successful login (AC15)', async () => {
    const h = make();
    const { scryptSync, randomBytes } = await import('node:crypto');
    const salt = randomBytes(16);
    const legacy = `scrypt$v=1$n=16384,r=8,p=1$${salt.toString('base64url')}$${scryptSync(PW, salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64url')}`;
    const { user } = await seed(h);
    h.repo.setPasswordHash(user.id, legacy);
    const res = await call(h, 'POST', '/api/auth/login', {
      email: 'lan@example.com',
      password: PW,
    });
    expect(res.statusCode).toBe(200);
    const upgraded = h.repo.getUser(user.id)?.passwordHash as string;
    expect(upgraded).not.toBe(legacy);
    expect(upgraded.startsWith('scrypt$v=1$n=32768,r=8,p=1$')).toBe(true);
    const again = await call(h, 'POST', '/api/auth/login', {
      email: 'lan@example.com',
      password: PW,
    });
    expect(again.statusCode).toBe(200);
  });

  it('logs login_failed (no email) on a wrong password', async () => {
    const h = make();
    await seed(h);
    await call(h, 'POST', '/api/auth/login', { email: 'lan@example.com', password: 'wrong-pw' });
    const rec = h.records().find((r) => r.event === 'login_failed');
    expect(rec).toMatchObject({ level: 40, event: 'login_failed', reason: 'INVALID_CREDENTIALS' });
    expect(JSON.stringify(rec)).not.toContain('lan@example.com');
  });

  it('M1: login racing a password change -> 401, the session minted with the old password is not valid', async () => {
    const repo = createInMemoryAuthRepository();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let reached!: () => void;
    const atGate = new Promise<void>((r) => (reached = r));
    // Giữ startSession của login (đã verify mật khẩu cũ) cho tới khi đổi mật khẩu xong.
    const gated: InMemoryAuthRepository = Object.assign(Object.create(repo), {
      startSession: async (input: Parameters<AuthRepository['startSession']>[0]) => {
        reached();
        await gate;
        return repo.startSession(input);
      },
    });
    const h = make({}, gated);
    const { tokens } = await seed(h);
    const login = call(h, 'POST', '/api/auth/login', { email: 'lan@example.com', password: PW });
    await atGate;
    const change = await call(
      h,
      'POST',
      '/api/me/password',
      { currentPassword: PW, newPassword: 'new-password-1' },
      cookie(tokens[0] as string),
    );
    expect(change.statusCode).toBe(204);
    release();
    const res = await login;
    expectError(res, 401, 'INVALID_CREDENTIALS');
    expect(res.headers['set-cookie']).toBeUndefined();
    // Chỉ còn phiên do đổi mật khẩu tạo.
    expect(repo.sessionCount()).toBe(1);
    expect(h.records().some((r) => r.event === 'login_failed')).toBe(true);
  });

  it('L2: a malformed stored hash logs error password_hash_invalid (no hash in log) and login stays a generic 401', async () => {
    const h = make();
    const { user } = await seed(h);
    const garbage = 'scrypt$v=1$n=3,r=8,p=1$c2FsdHNhbHRzYWx0$aGFzaA';
    h.repo.setPasswordHash(user.id, garbage);
    const res = await call(h, 'POST', '/api/auth/login', {
      email: 'lan@example.com',
      password: PW,
    });
    expectError(res, 401, 'INVALID_CREDENTIALS');
    const rec = h.records().find((r) => r.event === 'password_hash_invalid');
    expect(rec).toMatchObject({ level: 50, event: 'password_hash_invalid' });
    expect(h.lines.join('')).not.toContain(garbage);
    expect(JSON.stringify(rec)).not.toContain('lan@example.com');
  });
});

describe('GET /api/auth/me (AC5, AC6)', () => {
  it('no cookie -> { user: null } with ZERO repository calls and no Set-Cookie', async () => {
    const h = make();
    const res = await call(h, 'GET', '/api/auth/me');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(h.repo.calls).toBe(0);
  });

  it('valid cookie -> { user } (exactly one query)', async () => {
    const h = make();
    const { user, tokens } = await seed(h);
    const before = h.repo.calls;
    const res = await call(h, 'GET', '/api/auth/me', undefined, cookie(tokens[0] as string));
    expect(res.json()).toEqual({
      user: {
        id: user.id,
        email: 'lan@example.com',
        displayName: 'Lan',
        createdAt: new Date(T0).toISOString(),
      },
    });
    expect(h.repo.calls - before).toBe(1);
  });

  it('malformed cookie or the cookie name twice -> { user: null }, no repository call', async () => {
    const h = make();
    const { tokens } = await seed(h);
    const before = h.repo.calls;
    for (const cookieHeader of [
      'qp_sid=short',
      `qp_sid=${'!'.repeat(43)}`,
      `qp_sid=${tokens[0]}; qp_sid=${tokens[0]}`,
      `qp_sid=${tokens[0]}x`,
    ]) {
      const res = await call(h, 'GET', '/api/auth/me', undefined, { cookie: cookieHeader });
      expect(res.json()).toEqual({ user: null });
    }
    expect(h.repo.calls).toBe(before);
  });

  it('unknown but well-formed cookie -> { user: null } + cookie cleared', async () => {
    const h = make();
    const res = await call(h, 'GET', '/api/auth/me', undefined, cookie(generateToken()));
    expect(res.json()).toEqual({ user: null });
    expect(setCookieOf(res)).toBe('qp_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  });

  it('expires exactly 30 days after login (fixed, not sliding)', async () => {
    const h = make();
    await call(h, 'POST', '/api/auth/register', REG);
    const login = await call(h, 'POST', '/api/auth/login', {
      email: 'lan@example.com',
      password: PW,
    });
    const token = tokenOf(login);
    const me = (): Promise<LightMyRequestResponse> =>
      call(h, 'GET', '/api/auth/me', undefined, cookie(token));

    h.clock.now = T0 + 10 * DAY; // dùng giữa chừng không gia hạn
    expect((await me()).json()).toMatchObject({ user: { email: 'lan@example.com' } });
    h.clock.now = T0 + 30 * DAY - 1;
    expect((await me()).json()).toMatchObject({ user: { email: 'lan@example.com' } });
    h.clock.now = T0 + 30 * DAY;
    const expired = await me();
    expect(expired.json()).toEqual({ user: null });
    expect(setCookieOf(expired)).toContain('Max-Age=0');
  });

  it('app.auth.resolve memoizes per request (one query)', async () => {
    const h = make();
    const { user, tokens } = await seed(h);
    const before = h.repo.calls;
    const res = await call(h, 'GET', '/api/_t/resolve', undefined, cookie(tokens[0] as string));
    expect(res.json()).toEqual({ same: true, id: user.id });
    expect(h.repo.calls - before).toBe(1);
  });
});

describe('POST /api/auth/logout (AC7)', () => {
  it('204 + cookie cleared, session removed server-side, old cookie value is dead', async () => {
    const h = make();
    const { tokens } = await seed(h);
    const token = tokens[0] as string;
    const res = await call(h, 'POST', '/api/auth/logout', undefined, cookie(token));
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(setCookieOf(res)).toBe('qp_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    expect(h.repo.hasSession(hashToken(token))).toBe(false);

    expect((await call(h, 'GET', '/api/auth/me', undefined, cookie(token))).json()).toEqual({
      user: null,
    });
    expectError(
      await call(h, 'GET', '/api/_t/user', undefined, cookie(token)),
      401,
      'UNAUTHORIZED',
    );
    expectError(
      await call(h, 'PATCH', '/api/me', { displayName: 'New' }, cookie(token)),
      401,
      'UNAUTHORIZED',
    );
  });

  it('is idempotent: no cookie / bad cookie / empty JSON body / JSON body all give 204 + clear cookie', async () => {
    const h = make();
    for (const [body, headers] of [
      [undefined, {}],
      [undefined, { cookie: 'qp_sid=junk' }],
      ['', {}],
      [{}, {}],
      [undefined, cookie(generateToken())],
    ] as [unknown, Hdrs][]) {
      const res = await call(h, 'POST', '/api/auth/logout', body, headers);
      expect(res.statusCode).toBe(204);
      expect(setCookieOf(res)).toContain('Max-Age=0');
    }
  });

  it('logout without Origin -> 403 FORBIDDEN and nothing is removed', async () => {
    const h = make();
    const { tokens } = await seed(h);
    const res = await call(h, 'POST', '/api/auth/logout', undefined, {
      ...cookie(tokens[0] as string),
      origin: undefined,
    });
    expectError(res, 403, 'FORBIDDEN');
    expect(h.repo.hasSession(hashToken(tokens[0] as string))).toBe(true);
  });

  it('L3: cookie name repeated -> every well-formed session in the request is removed server-side (max 3), still 204', async () => {
    const h = make();
    const { tokens } = await seed(h, { sessions: 5 });
    const [a, b, c, d, e] = tokens as [string, string, string, string, string];
    const res = await call(h, 'POST', '/api/auth/logout', undefined, {
      cookie: `qp_sid=${a}; qp_sid=junk; qp_sid=${b}; qp_sid=${c}; qp_sid=${d}`,
    });
    expect(res.statusCode).toBe(204);
    expect(setCookieOf(res)).toContain('Max-Age=0');
    for (const t of [a, b, c]) expect(h.repo.hasSession(hashToken(t))).toBe(false);
    // vượt trần 3 token đọc → phiên thứ 4 và phiên không nằm trong request vẫn còn
    expect(h.repo.hasSession(hashToken(d))).toBe(true);
    expect(h.repo.hasSession(hashToken(e))).toBe(true);
  });

  it('only the current session is removed (other devices stay signed in)', async () => {
    const h = make();
    const { tokens } = await seed(h, { sessions: 2 });
    await call(h, 'POST', '/api/auth/logout', undefined, cookie(tokens[0] as string));
    expect(h.repo.hasSession(hashToken(tokens[1] as string))).toBe(true);
  });

  it('still enforces content type and size when a body is present', async () => {
    const h = make();
    expectError(
      await call(h, 'POST', '/api/auth/logout', 'x', { 'content-type': 'text/plain' }),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
    expectError(
      await call(h, 'POST', '/api/auth/logout', { pad: 'a'.repeat(5000) }),
      413,
      'PAYLOAD_TOO_LARGE',
    );
  });
});

describe('session fixation (AC8)', () => {
  it('login with an attacker-chosen cookie issues a different token; the chosen value stays invalid', async () => {
    const h = make();
    await seed(h);
    const attacker = 'Z'.repeat(43);
    const res = await call(
      h,
      'POST',
      '/api/auth/login',
      { email: 'lan@example.com', password: PW },
      cookie(attacker),
    );
    expect(res.statusCode).toBe(200);
    expect(tokenOf(res)).not.toBe(attacker);
    const me = await call(h, 'GET', '/api/auth/me', undefined, cookie(attacker));
    expect(me.json()).toEqual({ user: null });
  });

  it('login while holding a valid session S1 deletes S1', async () => {
    const h = make();
    const { tokens } = await seed(h);
    const res = await call(
      h,
      'POST',
      '/api/auth/login',
      { email: 'lan@example.com', password: PW },
      cookie(tokens[0] as string),
    );
    expect(res.statusCode).toBe(200);
    expect(h.repo.hasSession(hashToken(tokens[0] as string))).toBe(false);
    expect(h.repo.hasSession(hashToken(tokenOf(res)))).toBe(true);
  });

  it('register while holding a valid session S1 deletes S1 and issues a new token', async () => {
    const h = make();
    const { tokens } = await seed(h, { email: 'first@example.com', name: 'First' });
    const res = await call(
      h,
      'POST',
      '/api/auth/register',
      { email: 'second@example.com', password: PW, displayName: 'Second' },
      cookie(tokens[0] as string),
    );
    expect(res.statusCode).toBe(201);
    expect(tokenOf(res)).not.toBe(tokens[0]);
    expect(h.repo.hasSession(hashToken(tokens[0] as string))).toBe(false);
  });

  it('a failed register (409) keeps the existing session', async () => {
    const h = make();
    const { tokens } = await seed(h);
    const res = await call(h, 'POST', '/api/auth/register', REG, cookie(tokens[0] as string));
    expectError(res, 409, 'EMAIL_TAKEN');
    expect(h.repo.hasSession(hashToken(tokens[0] as string))).toBe(true);
  });
});

describe('PATCH /api/me (AC9)', () => {
  it('renames, /auth/me reflects it, 200 { user }', async () => {
    const h = make();
    const { tokens } = await seed(h);
    const c = cookie(tokens[0] as string);
    const res = await call(h, 'PATCH', '/api/me', { displayName: ' Lan   Anh ' }, c);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      user: { displayName: 'Lan Anh', email: 'lan@example.com' },
    });
    const me = await call(h, 'GET', '/api/auth/me', undefined, c);
    expect(me.json()).toMatchObject({ user: { displayName: 'Lan Anh' } });
  });

  it("another account's name (any case) -> 409 NAME_TAKEN; own name in another case -> 200", async () => {
    const h = make();
    const { tokens } = await seed(h);
    await seed(h, { email: 'minh@example.com', name: 'Minh' });
    const c = cookie(tokens[0] as string);
    expectError(await call(h, 'PATCH', '/api/me', { displayName: 'MINH' }, c), 409, 'NAME_TAKEN');
    const own = await call(h, 'PATCH', '/api/me', { displayName: 'LAN' }, c);
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ user: { displayName: 'LAN' } });
  });

  it('401 when signed out - even before the body is validated', async () => {
    const h = make();
    expectError(await call(h, 'PATCH', '/api/me', { displayName: 'New' }), 401, 'UNAUTHORIZED');
    expectError(await call(h, 'PATCH', '/api/me', { displayName: 5 }), 401, 'UNAUTHORIZED');
    expectError(
      await call(h, 'PATCH', '/api/me', { displayName: 'New' }, cookie(generateToken())),
      401,
      'UNAUTHORIZED',
    );
  });

  it('400 on invalid names; the name is unchanged', async () => {
    const h = make();
    const { tokens, user } = await seed(h);
    const c = cookie(tokens[0] as string);
    for (const displayName of ['', '   ', 'a<b', 'a'.repeat(21), 7, undefined]) {
      expectError(await call(h, 'PATCH', '/api/me', { displayName }, c), 400, 'VALIDATION_ERROR');
    }
    expect(h.repo.getUser(user.id)?.displayName).toBe('Lan');
  });
});

describe('POST /api/me/password (AC10)', () => {
  it('R1: two concurrent changes with the same old password -> one 204, the other 403 and its session is not minted', async () => {
    const h = make();
    const { tokens } = await seed(h, { sessions: 2 });
    const [r1, r2] = await Promise.all([
      call(
        h,
        'POST',
        '/api/me/password',
        { currentPassword: PW, newPassword: 'victim-new-pw-1' },
        cookie(tokens[0] as string),
      ),
      call(
        h,
        'POST',
        '/api/me/password',
        { currentPassword: PW, newPassword: 'attacker-new-pw-1' },
        cookie(tokens[1] as string),
      ),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([204, 403]);
    const loser = r1.statusCode === 403 ? r1 : r2;
    expectError(loser, 403, 'INVALID_CREDENTIALS');
    expect(loser.headers['set-cookie']).toBeUndefined();
    const winnerPw = r1.statusCode === 204 ? 'victim-new-pw-1' : 'attacker-new-pw-1';
    expect(
      (await call(h, 'POST', '/api/auth/login', { email: 'lan@example.com', password: winnerPw }))
        .statusCode,
    ).toBe(200);
    expect(h.records().some((r) => r.event === 'password_change_failed')).toBe(true);
  });

  it('wrong current password -> 403 INVALID_CREDENTIALS and nobody is signed out', async () => {
    const h = make();
    const { tokens } = await seed(h, { sessions: 2 });
    const res = await call(
      h,
      'POST',
      '/api/me/password',
      { currentPassword: 'wrong-pw', newPassword: 'new-password-1' },
      cookie(tokens[0] as string),
    );
    expectError(res, 403, 'INVALID_CREDENTIALS');
    expect(res.headers['set-cookie']).toBeUndefined();
    for (const t of tokens) {
      expect(h.repo.hasSession(hashToken(t))).toBe(true);
    }
  });

  it('success: 204 + new cookie; every old session (both devices) dies; old password stops working', async () => {
    const h = make();
    const { tokens } = await seed(h, { sessions: 2 });
    const [a, b] = tokens as [string, string];
    const res = await call(
      h,
      'POST',
      '/api/me/password',
      { currentPassword: PW, newPassword: 'new-password-1' },
      cookie(a),
    );
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    const fresh = tokenOf(res);
    expect(COOKIE_RE.test(setCookieOf(res))).toBe(true);
    expect(fresh).not.toBe(a);

    expectError(await call(h, 'GET', '/api/_t/user', undefined, cookie(a)), 401, 'UNAUTHORIZED');
    expectError(await call(h, 'GET', '/api/_t/user', undefined, cookie(b)), 401, 'UNAUTHORIZED');
    expect((await call(h, 'GET', '/api/_t/user', undefined, cookie(fresh))).statusCode).toBe(200);

    expectError(
      await call(h, 'POST', '/api/auth/login', { email: 'lan@example.com', password: PW }),
      401,
      'INVALID_CREDENTIALS',
    );
    const ok = await call(h, 'POST', '/api/auth/login', {
      email: 'lan@example.com',
      password: 'new-password-1',
    });
    expect(ok.statusCode).toBe(200);
  });

  it('validation (newPassword 8-128, currentPassword 1-128) happens before the current password check', async () => {
    const h = make();
    const { tokens } = await seed(h);
    const c = cookie(tokens[0] as string);
    for (const body of [
      { currentPassword: PW, newPassword: '1234567' },
      { currentPassword: PW, newPassword: 'a'.repeat(129) },
      { currentPassword: '', newPassword: 'new-password-1' },
      { currentPassword: 'a'.repeat(129), newPassword: 'new-password-1' },
      { currentPassword: PW },
    ]) {
      expectError(await call(h, 'POST', '/api/me/password', body, c), 400, 'VALIDATION_ERROR');
    }
  });

  it('401 when signed out', async () => {
    const h = make();
    expectError(
      await call(h, 'POST', '/api/me/password', {
        currentPassword: PW,
        newPassword: 'new-password-1',
      }),
      401,
      'UNAUTHORIZED',
    );
  });
});

describe('CSRF: Origin check (AC11)', () => {
  const endpoints: [string, 'POST' | 'PATCH', string, unknown][] = [
    [
      'register',
      'POST',
      '/api/auth/register',
      { email: 'x@example.com', password: PW, displayName: 'X' },
    ],
    ['login', 'POST', '/api/auth/login', { email: 'lan@example.com', password: PW }],
    ['logout', 'POST', '/api/auth/logout', undefined],
    ['patch me', 'PATCH', '/api/me', { displayName: 'Hacked' }],
    [
      'password',
      'POST',
      '/api/me/password',
      { currentPassword: PW, newPassword: 'hacked-password' },
    ],
  ];

  it.each(endpoints)(
    '%s: wrong Origin, missing Origin, trailing slash, "null" -> 403 FORBIDDEN, no Set-Cookie, DB untouched',
    async (_label, method, url, body) => {
      const h = make();
      const { user, tokens } = await seed(h);
      const sessions = h.repo.sessionCount();
      for (const origin of [
        'https://evil.example',
        undefined,
        `${WEB}/`,
        'null',
        'http://localhost:5174',
      ]) {
        const res = await call(h, method, url, body, { origin, ...cookie(tokens[0] as string) });
        expectError(res, 403, 'FORBIDDEN');
        expect(res.headers['set-cookie']).toBeUndefined();
      }
      expect(h.repo.userCount()).toBe(1);
      expect(h.repo.sessionCount()).toBe(sessions);
      expect(h.repo.hasSession(hashToken(tokens[0] as string))).toBe(true);
      expect(h.repo.getUser(user.id)).toMatchObject({ displayName: 'Lan', passwordHash: HASH });
    },
  );

  it('the exact WEB_ORIGIN passes', async () => {
    const h = make();
    const res = await call(h, 'POST', '/api/auth/logout', undefined, { origin: WEB });
    expect(res.statusCode).toBe(204);
  });

  it('requireSameOriginIfCookie: wrong Origin -> 403; missing Origin -> 403 only with cookie; guests pass', async () => {
    const h = make();
    const { tokens } = await seed(h);
    const url = '/api/_t/if-cookie';
    expectError(
      await call(h, 'POST', url, {}, { origin: 'https://evil.example' }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call(
        h,
        'POST',
        url,
        {},
        { origin: 'https://evil.example', ...cookie(tokens[0] as string) },
      ),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call(h, 'POST', url, {}, { origin: undefined, ...cookie(tokens[0] as string) }),
      403,
      'FORBIDDEN',
    );
    // cookie hỏng vẫn tính là "có cookie phiên"
    expectError(
      await call(h, 'POST', url, {}, { origin: undefined, cookie: 'qp_sid=junk' }),
      403,
      'FORBIDDEN',
    );
    expect((await call(h, 'POST', url, {}, { origin: undefined })).statusCode).toBe(200);
    expect(
      (await call(h, 'POST', url, {}, { origin: undefined, cookie: 'theme=dark' })).statusCode,
    ).toBe(200);
    expect(
      (await call(h, 'POST', url, {}, { origin: WEB, ...cookie(tokens[0] as string) })).statusCode,
    ).toBe(200);
  });

  it('requireUser works as onRequest and as preHandler, sets request.authUser', async () => {
    const h = make();
    const { user, tokens } = await seed(h);
    for (const url of ['/api/_t/user', '/api/_t/user-prehandler']) {
      const ok = await call(h, 'GET', url, undefined, cookie(tokens[0] as string));
      expect(ok.json()).toEqual({ id: user.id });
      expectError(await call(h, 'GET', url), 401, 'UNAUTHORIZED');
    }
  });
});

describe('rate limits (AC12)', () => {
  it('register: 10 per window per IP, 11th -> 429 + Retry-After >= 1, before the Origin check; new window recovers', async () => {
    const h = make();
    const bad = { email: 'x', password: PW, displayName: 'X' };
    for (let i = 0; i < 10; i++) {
      expectError(await call(h, 'POST', '/api/auth/register', bad), 400, 'VALIDATION_ERROR');
    }
    const limited = await call(h, 'POST', '/api/auth/register', bad, {
      origin: 'https://evil.example',
    });
    expectError(limited, 429, 'RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    // IP khác không bị ảnh hưởng
    expectError(
      await call(h, 'POST', '/api/auth/register', bad, {}, '10.9.9.9'),
      400,
      'VALIDATION_ERROR',
    );
    h.clock.now += 10 * 60_000;
    expectError(await call(h, 'POST', '/api/auth/register', bad), 400, 'VALIDATION_ERROR');
  });

  it('login: 30 per 5 minutes per IP, 31st -> 429', async () => {
    const h = make();
    const bad = { email: 'x', password: PW };
    for (let i = 0; i < 30; i++) {
      expectError(await call(h, 'POST', '/api/auth/login', bad), 400, 'VALIDATION_ERROR');
    }
    const limited = await call(h, 'POST', '/api/auth/login', bad);
    expectError(limited, 429, 'RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    h.clock.now += 5 * 60_000;
    expectError(await call(h, 'POST', '/api/auth/login', bad), 400, 'VALIDATION_ERROR');
  });

  it('login per email: 10 attempts / 15 min across IPs, 11th -> 429 even with the right password; other emails unaffected', async () => {
    const h = make({ trustProxy: 1 });
    await seed(h);
    const fromIp = (n: number) => ({ 'x-forwarded-for': `203.0.113.${n}` });
    for (let i = 0; i < 10; i++) {
      const res = await call(
        h,
        'POST',
        '/api/auth/login',
        { email: 'Lan@example.com', password: 'wrong-pw' },
        fromIp(i + 1),
      );
      expectError(res, 401, 'INVALID_CREDENTIALS');
    }
    const blocked = await call(
      h,
      'POST',
      '/api/auth/login',
      { email: ' LAN@example.com', password: PW },
      fromIp(99),
    );
    expectError(blocked, 429, 'RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(blocked.headers['set-cookie']).toBeUndefined();

    // email khác không bị ảnh hưởng (kể cả email không tồn tại → vẫn 401, không 429)
    expectError(
      await call(
        h,
        'POST',
        '/api/auth/login',
        { email: 'other@example.com', password: PW },
        fromIp(99),
      ),
      401,
      'INVALID_CREDENTIALS',
    );

    h.clock.now += 15 * 60_000;
    const again = await call(
      h,
      'POST',
      '/api/auth/login',
      { email: 'lan@example.com', password: PW },
      fromIp(99),
    );
    expect(again.statusCode).toBe(200);
    const events = h.records().filter((r) => r.event === 'login_failed');
    expect(events.some((r) => r.reason === 'RATE_LIMITED')).toBe(true);
  });

  it('login per email: unknown emails are counted too', async () => {
    const h = make({ rateLimits: { authLoginAccount: { limit: 2, windowMs: 60_000 } } });
    const body = { email: 'ghost@example.com', password: PW };
    expectError(await call(h, 'POST', '/api/auth/login', body), 401, 'INVALID_CREDENTIALS');
    expectError(await call(h, 'POST', '/api/auth/login', body), 401, 'INVALID_CREDENTIALS');
    expectError(await call(h, 'POST', '/api/auth/login', body), 429, 'RATE_LIMITED');
  });

  it('M2: email table full -> the target email is STILL limited (shard bucket), single warn per window', async () => {
    const h = make({
      keyedRateLimitMaxKeys: 1,
      rateLimits: { authLoginAccount: { limit: 2, windowMs: 60_000 } },
    });
    const attempt = (email: string) => call(h, 'POST', '/api/auth/login', { email, password: PW });
    expectError(await attempt('one@example.com'), 401, 'INVALID_CREDENTIALS');
    // bảng đầy: email mục tiêu chưa có trong bảng vẫn bị chặn sau 2 lần
    expectError(await attempt('target@example.com'), 401, 'INVALID_CREDENTIALS');
    expectError(await attempt('target@example.com'), 401, 'INVALID_CREDENTIALS');
    expectError(await attempt('target@example.com'), 429, 'RATE_LIMITED');
    // email đã có trong bảng vẫn dùng entry riêng
    expectError(await attempt('one@example.com'), 401, 'INVALID_CREDENTIALS');
    expectError(await attempt('one@example.com'), 429, 'RATE_LIMITED');
    const warns = h.records().filter((r) => String(r.msg).includes('shard buckets'));
    expect(warns).toHaveLength(1);
  });

  it('L1: POST /me/password is limited per account (10 / 15 min) with a password_change_failed warn log', async () => {
    const h = make({ rateLimits: { accountWrite: { limit: 1000, windowMs: 60_000 } } });
    const { tokens } = await seed(h);
    const c = cookie(tokens[0] as string);
    const wrong = { currentPassword: 'wrong-pw', newPassword: 'new-password-1' };
    for (let i = 0; i < 10; i++) {
      expectError(await call(h, 'POST', '/api/me/password', wrong, c), 403, 'INVALID_CREDENTIALS');
    }
    // lần thứ 11: bị chặn dù IP còn hạn mức, kể cả với mật khẩu đúng
    const blocked = await call(
      h,
      'POST',
      '/api/me/password',
      { currentPassword: PW, newPassword: 'new-password-1' },
      c,
    );
    expectError(blocked, 429, 'RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    const all = h.records().filter((r) => r.event === 'password_change_failed');
    expect(all.at(-1)).toMatchObject({ level: 40, reason: 'RATE_LIMITED' });
    const fails = all.slice(0, 10);
    expect(all).toHaveLength(11);
    expect(fails[0]).toMatchObject({ level: 40 });
    expect(JSON.stringify(fails)).not.toMatch(/lan@example\.com|wrong-pw/);
    // hết cửa sổ → dùng lại được
    h.clock.now += 15 * 60_000 + 1;
    expect(
      (
        await call(
          h,
          'POST',
          '/api/me/password',
          { currentPassword: PW, newPassword: 'new-password-1' },
          c,
        )
      ).statusCode,
    ).toBe(204);
  });

  it('PATCH /me and POST /me/password: 21st request in 15 minutes -> 429 (before Origin)', async () => {
    const h = make();
    const { tokens } = await seed(h);
    const c = cookie(tokens[0] as string);
    for (let i = 0; i < 20; i++) {
      expect((await call(h, 'PATCH', '/api/me', { displayName: 'Lan' }, c)).statusCode).toBe(200);
    }
    expectError(await call(h, 'PATCH', '/api/me', { displayName: 'Lan' }, c), 429, 'RATE_LIMITED');
    // bucket accountWrite dùng chung với /me/password
    expectError(
      await call(
        h,
        'POST',
        '/api/me/password',
        { currentPassword: PW, newPassword: 'new-password-1' },
        { origin: 'https://evil.example', ...c },
      ),
      429,
      'RATE_LIMITED',
    );
    h.clock.now += 15 * 60_000;
    expect((await call(h, 'PATCH', '/api/me', { displayName: 'Lan' }, c)).statusCode).toBe(200);
  });

  it('GET /auth/me and logout are not rate limited', async () => {
    const h = make();
    for (let i = 0; i < 200; i++) {
      const res = await call(h, 'GET', '/api/auth/me');
      expect(res.statusCode).toBe(200);
    }
    for (let i = 0; i < 40; i++) {
      expect((await call(h, 'POST', '/api/auth/logout')).statusCode).toBe(204);
    }
  });

  it('accountRead bucket exists with 120 / minute (for T2 endpoints)', () => {
    const h = make();
    expect(typeof h.app.rateLimitHooks.accountRead).toBe('function');
    expect(typeof h.app.rateLimitHooks.authRegister).toBe('function');
    expect(typeof h.app.rateLimitHooks.authLogin).toBe('function');
    expect(typeof h.app.rateLimitHooks.accountWrite).toBe('function');
  });
});

describe('no sensitive data in logs or errors (AC13)', () => {
  const EMAIL = 'zorbax9@example.com';
  const NAME = 'Zorbax9';
  const SECRET = 'P4ss-w0rd-Zq9-unique';
  const SECRET2 = 'N3w-P4ss-w0rd-Zq9-unique';

  it('a full account lifecycle never writes email, password, token, cookie, name or hash to the log', async () => {
    const h = make();
    const seen: string[] = [EMAIL, NAME, SECRET, SECRET2];
    const reg = await call(h, 'POST', '/api/auth/register', {
      email: EMAIL,
      password: SECRET,
      displayName: NAME,
    });
    expect(reg.statusCode).toBe(201);
    const t1 = tokenOf(reg);
    seen.push(t1, setCookieOf(reg));
    await call(h, 'POST', '/api/auth/login', { email: EMAIL, password: 'wrong-pw-x' }, cookie(t1));
    const login = await call(
      h,
      'POST',
      '/api/auth/login',
      { email: EMAIL, password: SECRET },
      cookie(t1),
    );
    const t2 = tokenOf(login);
    seen.push(t2);
    await call(h, 'GET', '/api/auth/me', undefined, cookie(t2));
    await call(h, 'GET', '/api/auth/me', undefined, cookie(t1)); // cookie đã chết → xoá cookie
    await call(h, 'PATCH', '/api/me', { displayName: 'Zorbax10' }, cookie(t2));
    await call(h, 'POST', '/api/auth/register', {
      email: EMAIL,
      password: SECRET,
      displayName: NAME,
    }); // 409
    await call(h, 'POST', '/api/auth/register', {
      email: 'bad',
      password: SECRET,
      displayName: NAME,
    }); // 400
    const pw = await call(
      h,
      'POST',
      '/api/me/password',
      { currentPassword: SECRET, newPassword: SECRET2 },
      cookie(t2),
    );
    const t3 = tokenOf(pw);
    seen.push(t3);
    await call(
      h,
      'POST',
      '/api/me/password',
      { currentPassword: 'nope-nope', newPassword: SECRET2 },
      cookie(t3),
    );
    await call(h, 'POST', '/api/auth/logout', undefined, cookie(t3));
    await call(
      h,
      'POST',
      '/api/auth/login',
      { email: EMAIL, password: SECRET },
      { origin: 'https://evil.example' },
    );

    const log = h.lines.join('\n');
    for (const s of seen) expect(log).not.toContain(s);
    expect(log).not.toMatch(/scrypt\$/);
    expect(log).not.toMatch(/HttpOnly|Max-Age/);
    expect(log).not.toMatch(/Zorbax/i);
    expect(log).toContain('login_failed');
    // request log chỉ có method + url
    const reqLogs = h.records().filter((r) => typeof r.req === 'object');
    expect(reqLogs.length).toBeGreaterThan(0);
    for (const r of reqLogs) {
      expect(Object.keys(r.req as object).sort()).toEqual(['method', 'url']);
    }
  });

  it('a DB unique-violation error never leaks `detail` to the client or the log', async () => {
    const base = createInMemoryAuthRepository();
    const leaky: AuthRepository = {
      ...base,
      register: async () => {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          name: 'error',
          severity: 'ERROR',
          code: '23505',
          constraint: 'some_other_constraint',
          table: 'users',
          detail: 'Key (email)=(leaky-detail@example.com) already exists.',
        });
      },
    };
    const h = make({ authRepository: leaky }, base);
    const res = await call(h, 'POST', '/api/auth/register', {
      email: 'x@example.com',
      password: PW,
      displayName: 'Xx',
    });
    expectError(res, 500, 'INTERNAL_ERROR');
    expect(res.body).not.toContain('leaky-detail');
    expect(h.lines.join('\n')).not.toContain('leaky-detail');
  });
});

describe('Cache-Control: no-store (AC14)', () => {
  it('is on every /api/auth/* and /api/me* response, errors included', async () => {
    const h = make();
    const { tokens } = await seed(h);
    const c = cookie(tokens[0] as string);
    const responses: LightMyRequestResponse[] = [
      await call(h, 'POST', '/api/auth/register', {
        email: 'n@example.com',
        password: PW,
        displayName: 'N',
      }), // 201
      await call(h, 'POST', '/api/auth/register', REG), // 409
      await call(h, 'POST', '/api/auth/register', { email: 'x' }), // 400
      await call(h, 'POST', '/api/auth/register', 'a', { 'content-type': 'text/plain' }), // 415
      await call(h, 'POST', '/api/auth/register', { pad: 'a'.repeat(5000) }), // 413
      await call(h, 'POST', '/api/auth/register', REG, { origin: undefined }), // 403
      await call(h, 'POST', '/api/auth/login', { email: 'lan@example.com', password: PW }), // 200
      await call(h, 'POST', '/api/auth/login', { email: 'lan@example.com', password: 'bad-pw' }), // 401
      await call(h, 'GET', '/api/auth/me'),
      await call(h, 'GET', '/api/auth/me', undefined, c),
      await call(h, 'POST', '/api/auth/logout'),
      await call(h, 'PATCH', '/api/me', { displayName: 'Ok' }, c),
      await call(h, 'PATCH', '/api/me', { displayName: 'Ok' }), // 401
      await call(
        h,
        'POST',
        '/api/me/password',
        { currentPassword: 'bad-pw', newPassword: 'new-password-1' },
        c,
      ), // 403
      await call(h, 'GET', '/api/auth/nope'), // 404
      await call(h, 'GET', '/api/me/nope', undefined, c), // 404
    ];
    for (const res of responses) {
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('429 responses are no-store too; other API routes default to no-store (ADR-032)', async () => {
    const h = make();
    const bad = { email: 'x', password: PW };
    let last: LightMyRequestResponse | undefined;
    for (let i = 0; i < 31; i++) last = await call(h, 'POST', '/api/auth/login', bad);
    expect(last?.statusCode).toBe(429);
    expect(last?.headers['cache-control']).toBe('no-store');
    const health = await call(h, 'GET', '/api/health');
    expect(health.headers['cache-control']).toBe('no-store');
  });
});

describe('error codes', () => {
  it('helpers produce the contract codes and statuses', async () => {
    const e = await import('../errors.ts');
    expect(e.forbiddenError()).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(e.invalidCredentialsError(401)).toMatchObject({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(e.invalidCredentialsError(403)).toMatchObject({
      statusCode: 403,
      code: 'INVALID_CREDENTIALS',
    });
    expect(e.emailTakenError()).toMatchObject({ statusCode: 409, code: 'EMAIL_TAKEN' });
    expect(e.nameTakenError()).toMatchObject({ statusCode: 409, code: 'NAME_TAKEN' });
  });
});
