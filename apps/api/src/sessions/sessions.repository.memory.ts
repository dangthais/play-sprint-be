import { timingSafeEqual } from 'node:crypto';
import {
  rankKeyOf,
  type LeaderboardRow,
  type PersonalBestRow,
  type PlayHistoryRow,
  type ScoreOrder,
  type ScoringRule,
  type SessionRecord,
  type SessionsRepository,
} from './sessions.types.ts';

interface StoredSession extends SessionRecord {
  tokenHash: Buffer;
  hidden: boolean;
}

export interface InMemorySessionsRepository extends SessionsRepository {
  /** Bản sao các phiên (không gồm token hash) — dành cho test. */
  all(): SessionRecord[];
  setHidden(id: string, hidden: boolean): void;
  /** Hash đã lưu của phiên (test kiểm DB chỉ lưu hash). */
  storedHash(id: string): Buffer | undefined;
}

function toPublic(s: StoredSession): SessionRecord {
  return {
    id: s.id,
    gameId: s.gameId,
    status: s.status,
    startedAt: s.startedAt,
    expiresAt: s.expiresAt,
    endedAt: s.endedAt,
    durationMs: s.durationMs,
    score: s.score,
    playerName: s.playerName,
    playerKey: s.playerKey,
    result: s.result,
    rejectReason: s.rejectReason,
    userId: s.userId,
  };
}

interface Rankable {
  id: string;
  score: number;
  durationMs: number;
  endedAt: number;
}

/** Âm nếu `a` xếp trên `b` (cùng quy tắc ORDER BY của SQL: score, duration_ms, ended_at, id). */
function compare(order: ScoreOrder, a: Rankable, b: Rankable): number {
  if (a.score !== b.score) return order === 'desc' ? b.score - a.score : a.score - b.score;
  if (a.durationMs !== b.durationMs) return a.durationMs - b.durationMs;
  if (a.endedAt !== b.endedAt) return a.endedAt - b.endedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function hashEquals(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Cùng ngữ nghĩa với bản pg. `finish` kiểm tra rồi ghi đồng bộ (không có `await` ở giữa) nên atomic
 * trong một event loop: hai `finish` đồng thời chỉ một cái thành công. Mỗi phương thức nhường
 * event loop một lần ở đầu để các yêu cầu đồng thời thực sự đan xen như với DB thật.
 */
export function createInMemorySessionsRepository(opts: {
  gameIds: string[];
  rules: ScoringRule[];
  /** Tiêu đề game cho lịch sử/kỷ lục (mặc định: id). */
  titles?: Record<string, string>;
  /** Tên hiển thị hiện tại của tài khoản (thay cho JOIN users); không có → dùng tên lúc nộp. */
  memberName?: (userId: string) => string | undefined;
}): InMemorySessionsRepository {
  const games = new Set(opts.gameIds);
  const rules = new Map(opts.rules.map((r) => [r.gameId, r]));
  const sessions = new Map<string, StoredSession>();
  const titleOf = (id: string): string => opts.titles?.[id] ?? id;

  function bestPerPlayer(gameId: string, order: ScoreOrder): StoredSession[] {
    const best = new Map<string, StoredSession>();
    for (const s of sessions.values()) {
      if (s.gameId !== gameId || s.result !== 'accepted' || s.hidden) continue;
      const key = rankKeyOf(s);
      if (key === null) continue;
      const cur = best.get(key);
      if (!cur || compare(order, rankable(s), rankable(cur)) < 0) best.set(key, s);
    }
    return [...best.values()];
  }

  function rankable(s: SessionRecord): Rankable {
    return {
      id: s.id,
      score: s.score ?? 0,
      durationMs: s.durationMs ?? 0,
      endedAt: s.endedAt?.getTime() ?? 0,
    };
  }

  return {
    async findGameRule(gameId) {
      await Promise.resolve();
      if (!games.has(gameId)) return null;
      return { rule: rules.get(gameId) ?? null };
    },

    async create(input) {
      await Promise.resolve();
      const stored: StoredSession = {
        id: input.id,
        gameId: input.gameId,
        status: 'active',
        startedAt: input.startedAt,
        expiresAt: input.expiresAt,
        endedAt: null,
        durationMs: null,
        score: null,
        playerName: null,
        playerKey: null,
        result: null,
        rejectReason: null,
        userId: input.userId,
        tokenHash: Buffer.from(input.tokenHash),
        hidden: false,
      };
      sessions.set(stored.id, stored);
      return toPublic(stored);
    },

    async findByIdAndTokenHash(id, tokenHash) {
      await Promise.resolve();
      const s = sessions.get(id);
      if (!s || !hashEquals(s.tokenHash, tokenHash)) return null;
      return { session: toPublic(s), rule: rules.get(s.gameId) ?? null };
    },

    async finish(input) {
      await Promise.resolve();
      const s = sessions.get(input.id);
      if (!s || !hashEquals(s.tokenHash, input.tokenHash)) return null;
      if (s.status !== 'active' || !(s.expiresAt.getTime() > input.now.getTime())) return null;
      if (s.userId !== null && s.userId !== input.userId) return null;
      s.userId = s.userId ?? input.userId;
      s.status = 'finished';
      s.endedAt = input.now;
      s.durationMs = input.durationMs;
      s.score = input.score;
      s.playerName = input.playerName;
      s.playerKey = input.playerKey;
      s.result = input.result;
      s.rejectReason = input.rejectReason;
      return toPublic(s);
    },

    async rankOf(session, scoreOrder) {
      await Promise.resolve();
      const myKey = rankKeyOf(session);
      if (session.score === null || myKey === null) {
        throw new Error('rankOf requires a finished session');
      }
      const me = rankable(session);
      const best = bestPerPlayer(session.gameId, scoreOrder);
      const better = best.filter(
        (b) => rankKeyOf(b) !== myKey && compare(scoreOrder, rankable(b), me) < 0,
      ).length;
      const mine = best.find((b) => rankKeyOf(b) === myKey);
      return { rank: better + 1, personalBest: mine?.id === session.id };
    },

    async leaderboard(gameId, scoreOrder, limit): Promise<LeaderboardRow[]> {
      await Promise.resolve();
      return bestPerPlayer(gameId, scoreOrder)
        .sort((a, b) => compare(scoreOrder, rankable(a), rankable(b)))
        .slice(0, limit)
        .map((s) => ({
          playerName:
            (s.userId !== null ? opts.memberName?.(s.userId) : undefined) ?? s.playerName ?? '',
          isMember: s.userId !== null,
          score: s.score ?? 0,
          durationMs: s.durationMs ?? 0,
          achievedAt: s.endedAt ?? s.startedAt,
        }));
    },

    async listHistory(userId, page) {
      await Promise.resolve();
      const mine = [...sessions.values()]
        .filter((s) => s.userId === userId && s.status === 'finished')
        .sort((a, b) => {
          const d = (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0);
          return d !== 0 ? d : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
        });
      const items: PlayHistoryRow[] = mine
        .slice(page.offset, page.offset + page.limit)
        .map((s) => ({
          sessionId: s.id,
          gameId: s.gameId,
          gameTitle: titleOf(s.gameId),
          scoreOrder: rules.get(s.gameId)?.scoreOrder ?? null,
          score: s.score ?? 0,
          durationMs: s.durationMs ?? 0,
          result: s.result ?? 'rejected',
          endedAt: s.endedAt ?? s.startedAt,
        }));
      return { items, total: mine.length };
    },

    async personalBests(userId) {
      await Promise.resolve();
      const out: PersonalBestRow[] = [];
      for (const [gameId, rule] of rules) {
        const played = [...sessions.values()].filter(
          (s) => s.userId === userId && s.status === 'finished' && s.gameId === gameId,
        );
        let best: StoredSession | undefined;
        for (const s of played) {
          if (s.result !== 'accepted' || s.hidden) continue;
          if (!best || compare(rule.scoreOrder, rankable(s), rankable(best)) < 0) best = s;
        }
        if (!best) continue;
        out.push({
          gameId,
          gameTitle: titleOf(gameId),
          scoreOrder: rule.scoreOrder,
          score: best.score ?? 0,
          durationMs: best.durationMs ?? 0,
          achievedAt: best.endedAt ?? best.startedAt,
          plays: played.length,
        });
      }
      return out.sort(
        (a, b) =>
          b.achievedAt.getTime() - a.achievedAt.getTime() ||
          (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0),
      );
    },

    all: () => [...sessions.values()].map(toPublic),
    setHidden(id, hidden) {
      const s = sessions.get(id);
      if (s) s.hidden = hidden;
    },
    storedHash: (id) => sessions.get(id)?.tokenHash,
  };
}
