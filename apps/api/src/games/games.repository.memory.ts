import type { GameRecord, GamesRepository } from './games.types.ts';

export function createInMemoryGamesRepository(records: GameRecord[]): GamesRepository {
  const sorted = [...records].sort((a, b) => {
    const diff = b.createdAt.getTime() - a.createdAt.getTime();
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return {
    async list({ limit, offset }) {
      return { items: sorted.slice(offset, offset + limit), total: sorted.length };
    },
    async findById(id) {
      return sorted.find((g) => g.id === id) ?? null;
    },
  };
}
