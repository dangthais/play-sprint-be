import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, type BuildAppOptions } from '../app.ts';
import {
  createInMemoryAuthRepository,
  type InMemoryAuthRepository,
} from '../auth/auth.repository.memory.ts';
import { SEED_GAMES, SEED_RULES } from '../db/seed.ts';
import { createInMemoryGamesRepository } from '../games/games.repository.memory.ts';
import { generateToken, hashToken } from './token.ts';
import {
  createInMemorySessionsRepository,
  type InMemorySessionsRepository,
} from './sessions.repository.memory.ts';

export const T0 = Date.UTC(2026, 9, 24, 8, 0, 0);

export const WEB = 'http://localhost:5173';

export interface Harness {
  app: FastifyInstance;
  repo: InMemorySessionsRepository;
  auth: InMemoryAuthRepository;
  clock: { now: number };
}

export function makeHarness(
  extra: Partial<BuildAppOptions> = {},
  repo?: InMemorySessionsRepository,
): Harness {
  const clock = { now: T0 };
  const auth =
    (extra.authRepository as InMemoryAuthRepository | undefined) ?? createInMemoryAuthRepository();
  const sessionsRepo =
    repo ??
    createInMemorySessionsRepository({
      gameIds: SEED_GAMES.map((g) => g.id),
      rules: SEED_RULES,
      titles: Object.fromEntries(SEED_GAMES.map((g) => [g.id, g.title])),
      memberName: (id) => auth.getUser(id)?.displayName,
    });
  const app = buildApp({
    gamesRepository: createInMemoryGamesRepository(SEED_GAMES),
    sessionsRepository: sessionsRepo,
    authRepository: auth,
    clock: () => clock.now,
    ...extra,
  });
  return { app, repo: sessionsRepo, auth, clock };
}

/** Tạo tài khoản + phiên đăng nhập trực tiếp qua repository; trả id, header cookie và Origin hợp lệ. */
export async function signUp(
  h: Harness,
  displayName: string,
): Promise<{ userId: string; cookie: Record<string, string>; token: string }> {
  const token = generateToken();
  const now = new Date(h.clock.now);
  const user = await h.auth.register({
    id: randomUUID(),
    email: `${randomUUID()}@example.com`,
    passwordHash: 'scrypt$test',
    displayName,
    displayNameKey: displayName.toLowerCase(),
    now,
    session: {
      id: randomUUID(),
      tokenHash: hashToken(token),
      createdAt: now,
      expiresAt: new Date(h.clock.now + 30 * 24 * 3600 * 1000),
    },
    replaceTokenHash: null,
  });
  return { userId: user.id, token, cookie: { cookie: `qp_sid=${token}`, origin: WEB } };
}

export const JSON_HEADERS = { 'content-type': 'application/json' };

export async function startSession(
  h: Harness,
  gameId = 'snake',
  headers: Record<string, string> = {},
): Promise<{ id: string; token: string }> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/sessions',
    headers: { ...JSON_HEADERS, ...headers },
    payload: { gameId },
  });
  if (res.statusCode !== 201) throw new Error(`create session failed: ${res.statusCode}`);
  const body = res.json();
  return { id: body.session.id, token: body.sessionToken };
}

export function submit(
  h: Harness,
  s: { id: string; token: string },
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return h.app.inject({
    method: 'POST',
    url: `/api/sessions/${s.id}/score`,
    headers: { ...JSON_HEADERS, 'x-session-token': s.token, ...headers },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}
