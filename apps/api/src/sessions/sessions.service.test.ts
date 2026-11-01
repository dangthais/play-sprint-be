import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.ts';
import { createInMemorySessionsRepository } from './sessions.repository.memory.ts';
import { createSessionsService } from './sessions.service.ts';
import type { ScoringRule, SessionsRepository } from './sessions.types.ts';

const RULE: ScoringRule = {
  gameId: 'g1',
  scoreOrder: 'desc',
  minScore: 0,
  maxScore: 1000,
  minDurationMs: 0,
  scoreSlack: 0,
  maxScorePerSec: null,
  minMsPerScore: null,
};

function setup(wrap?: (repo: SessionsRepository) => SessionsRepository) {
  const base = createInMemorySessionsRepository({ gameIds: ['g1'], rules: [RULE] });
  const repo = wrap ? wrap(base) : base;
  const t = { now: 1_000_000 };
  const service = createSessionsService({ repository: repo, clock: () => t.now });
  return { service, t };
}

const submitInput = (sessionId: string, token: string) => ({
  sessionId,
  token,
  score: 10,
  identity: { kind: 'guest' as const, playerName: 'Lan', playerKey: 'lan' },
});

async function expectConflict(p: Promise<unknown>): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect(err).toMatchObject({ statusCode: 409, code: 'SESSION_NOT_ACTIVE' });
}

describe('submitScore edge cases', () => {
  it('accepted session whose scoring rule was deleted -> 409 on retry', async () => {
    const { service, t } = setup((repo) => ({
      ...repo,
      // Sau khi nộp, luật của game bị xoá: lần đọc lại không còn rule.
      findByIdAndTokenHash: async (id, hash) => {
        const found = await repo.findByIdAndTokenHash(id, hash);
        return found && found.session.status === 'finished' ? { ...found, rule: null } : found;
      },
    }));
    const { session, sessionToken } = await service.createSession('g1');
    t.now += 1000;
    const first = await service.submitScore(submitInput(session.id, sessionToken));
    expect(first.kind).toBe('accepted');
    await expectConflict(service.submitScore(submitInput(session.id, sessionToken)));
  });

  it('finish always returns null -> stops after 3 attempts with 409', async () => {
    let finishCalls = 0;
    const { service, t } = setup((repo) => ({
      ...repo,
      finish: async () => {
        finishCalls += 1;
        return null;
      },
    }));
    const { session, sessionToken } = await service.createSession('g1');
    t.now += 1000;
    await expectConflict(service.submitScore(submitInput(session.id, sessionToken)));
    expect(finishCalls).toBe(3);
  });
});
