import { randomUUID } from 'node:crypto';
import { SEED_GAMES, SEED_RULES } from '../db/seed.ts';
import { describeSessionsRepository } from './repository.suite.ts';
import { createInMemorySessionsRepository } from './sessions.repository.memory.ts';

describeSessionsRepository('in-memory', async () => {
  const names = new Map<string, string>();
  const repo = createInMemorySessionsRepository({
    gameIds: SEED_GAMES.map((g) => g.id),
    rules: SEED_RULES,
    titles: Object.fromEntries(SEED_GAMES.map((g) => [g.id, g.title])),
    memberName: (id) => names.get(id),
  });
  return {
    repo,
    async setHidden(id, hidden) {
      repo.setHidden(id, hidden);
    },
    async countFinished(gameId) {
      return repo.all().filter((s) => s.gameId === gameId && s.status === 'finished').length;
    },
    async addUser(displayName) {
      const id = randomUUID();
      names.set(id, displayName);
      return id;
    },
    async renameUser(id, displayName) {
      names.set(id, displayName);
    },
  };
});
