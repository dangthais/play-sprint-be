import { randomUUID } from 'node:crypto';
import {
  gameNotRankedError,
  nameTakenError,
  notFoundError,
  sessionExpiredError,
  sessionNotActiveError,
} from '../errors.ts';
import { verifyScore } from './scoring.ts';
import { generateToken, hashToken } from './token.ts';
import type {
  LeaderboardRow,
  PersonalBestRow,
  PlayHistoryRow,
  ScoreOrder,
  SessionRecord,
  SessionsRepository,
} from './sessions.types.ts';

/** TTL cố định của phiên (ADR-017). */
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export type SubmitOutcome =
  | { kind: 'accepted'; session: SessionRecord; rank: number; personalBest: boolean }
  | { kind: 'rejected'; session: SessionRecord; reason: string };

/** Danh tính của request nộp điểm (ADR-027). */
export type SubmitIdentity =
  | { kind: 'user'; userId: string; displayName: string; displayNameKey: string }
  /** `playerName`/`playerKey` đã chuẩn hoá (`normalizeNickname`). */
  | { kind: 'guest'; playerName: string; playerKey: string };

export interface SubmitInput {
  sessionId: string;
  token: string;
  score: number;
  identity: SubmitIdentity;
}

export interface SessionsService {
  /** `userId` = tài khoản của request (cookie hợp lệ) hoặc `null` (khách). */
  createSession(
    gameId: string,
    userId?: string | null,
  ): Promise<{ session: SessionRecord; sessionToken: string }>;
  submitScore(input: SubmitInput): Promise<SubmitOutcome>;
  /** `null` = game không tồn tại. Game không xếp hạng → ném `GAME_NOT_RANKED`. */
  leaderboard(
    gameId: string,
    limit: number,
  ): Promise<{ scoreOrder: ScoreOrder; rows: LeaderboardRow[] } | null>;
  history(
    userId: string,
    page: { limit: number; offset: number },
  ): Promise<{ items: PlayHistoryRow[]; total: number }>;
  personalBests(userId: string): Promise<PersonalBestRow[]>;
}

export function createSessionsService(deps: {
  repository: SessionsRepository;
  /** Đồng hồ chung của app (ms). */
  clock: () => number;
  /** `true` nếu có tài khoản dùng khoá tên (`displayName.toLowerCase()`) — khách không được dùng. */
  isDisplayNameKeyTaken?: (key: string) => Promise<boolean>;
}): SessionsService {
  const { repository: repo, clock } = deps;
  const isNameKeyTaken = deps.isDisplayNameKeyTaken ?? (async () => false);

  async function outcomeOf(
    session: SessionRecord,
    scoreOrder: ScoreOrder | null,
  ): Promise<SubmitOutcome> {
    if (session.result === 'rejected') {
      return { kind: 'rejected', session, reason: session.rejectReason ?? 'SCORE_REJECTED' };
    }
    if (session.result !== 'accepted' || scoreOrder === null) {
      throw sessionNotActiveError('Session is no longer active');
    }
    const { rank, personalBest } = await repo.rankOf(session, scoreOrder);
    return { kind: 'accepted', session, rank, personalBest };
  }

  return {
    async createSession(gameId, userId = null) {
      const lookup = await repo.findGameRule(gameId);
      if (!lookup) throw notFoundError('Game not found');
      if (!lookup.rule) throw gameNotRankedError('Game is not ranked');
      const token = generateToken();
      const startedAt = new Date(clock());
      const session = await repo.create({
        id: randomUUID(),
        gameId,
        tokenHash: hashToken(token),
        startedAt,
        expiresAt: new Date(startedAt.getTime() + SESSION_TTL_MS),
        userId,
      });
      return { session, sessionToken: token };
    },

    async submitScore(input) {
      const tokenHash = hashToken(input.token);
      const { identity } = input;
      const requestUserId = identity.kind === 'user' ? identity.userId : null;
      const playerName = identity.kind === 'user' ? identity.displayName : identity.playerName;
      const playerKey = identity.kind === 'user' ? identity.displayNameKey : identity.playerKey;
      let found = await repo.findByIdAndTokenHash(input.sessionId, tokenHash);

      // Tối đa vài vòng: 0 dòng từ `finish` nghĩa là có yêu cầu khác thắng → đọc lại và đi nhánh 6.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!found) throw notFoundError('Session not found');
        const { session, rule } = found;

        // Bước 6: phiên của tài khoản khác (hoặc của tài khoản mà request là khách) → như không tồn tại.
        if (session.userId !== null && session.userId !== requestUserId) {
          throw notFoundError('Session not found');
        }

        // Bước 7: đã kết thúc → idempotent nếu trùng dữ liệu và danh tính, ngược lại 409.
        if (session.status === 'finished') {
          const sameIdentity =
            identity.kind === 'user'
              ? session.userId === identity.userId
              : session.userId === null && session.playerName === identity.playerName;
          if (session.score !== input.score || !sameIdentity) {
            throw sessionNotActiveError('Session is no longer active');
          }
          return outcomeOf(session, rule?.scoreOrder ?? null);
        }

        // Bước 8: quá hạn (phiên giữ nguyên trạng thái).
        const now = clock();
        if (now >= session.expiresAt.getTime()) throw sessionExpiredError('Session has expired');

        // Bước 9: khách không được dùng tên của tài khoản (phiên vẫn active, nộp lại tên khác được).
        if (identity.kind === 'guest' && (await isNameKeyTaken(identity.playerKey))) {
          throw nameTakenError('This name belongs to a registered player');
        }

        // Bước 10: xác minh theo luật; thời lượng do server đo.
        const durationMs = Math.max(0, Math.floor(now - session.startedAt.getTime()));
        const verdict = rule
          ? verifyScore(rule, input.score, durationMs)
          : { ok: false as const, reason: 'GAME_NOT_RANKED' };

        // Bước 10-11: ghi atomic; lượt bị từ chối vẫn kết thúc phiên.
        const finished = await repo.finish({
          id: session.id,
          tokenHash,
          now: new Date(now),
          durationMs,
          score: input.score,
          playerName,
          playerKey,
          result: verdict.ok ? 'accepted' : 'rejected',
          rejectReason: verdict.ok ? null : verdict.reason,
          userId: requestUserId,
        });
        if (finished) return outcomeOf(finished, rule?.scoreOrder ?? null);

        found = await repo.findByIdAndTokenHash(input.sessionId, tokenHash);
      }
      throw sessionNotActiveError('Session is no longer active');
    },

    async leaderboard(gameId, limit) {
      const lookup = await repo.findGameRule(gameId);
      if (!lookup) return null;
      if (!lookup.rule) throw gameNotRankedError('Game is not ranked');
      const rows = await repo.leaderboard(gameId, lookup.rule.scoreOrder, limit);
      return { scoreOrder: lookup.rule.scoreOrder, rows };
    },

    history: (userId, page) => repo.listHistory(userId, page),
    personalBests: (userId) => repo.personalBests(userId),
  };
}
