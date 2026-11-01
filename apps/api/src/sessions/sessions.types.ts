import type { ScoreOrder } from '../games/games.types.ts';

export type { ScoreOrder };

/** Luật tính điểm của một game (`game_scoring_rules`); không công khai qua API. */
export interface ScoringRule {
  gameId: string;
  scoreOrder: ScoreOrder;
  minScore: number;
  maxScore: number;
  minDurationMs: number;
  scoreSlack: number;
  maxScorePerSec: number | null;
  minMsPerScore: number | null;
}

export type SessionStatus = 'active' | 'finished';
export type SessionResult = 'accepted' | 'rejected';

export interface SessionRecord {
  id: string;
  gameId: string;
  status: SessionStatus;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
  score: number | null;
  playerName: string | null;
  playerKey: string | null;
  result: SessionResult | null;
  rejectReason: string | null;
  /** Chủ sở hữu (tài khoản); `null` = phiên khách. Nội bộ: không bao giờ đưa vào response. */
  userId: string | null;
}

/** Kết quả tra cứu game để tạo phiên: `rule = null` nghĩa là game tồn tại nhưng không xếp hạng. */
export interface GameRuleLookup {
  rule: ScoringRule | null;
}

export interface NewSession {
  id: string;
  gameId: string;
  tokenHash: Buffer;
  startedAt: Date;
  expiresAt: Date;
  /** Tài khoản tạo phiên (cookie hợp lệ) hoặc `null` (khách). */
  userId: string | null;
}

export interface FinishInput {
  id: string;
  tokenHash: Buffer;
  /** Thời điểm server nhận điểm; cũng là mốc kiểm `expires_at > now`. */
  now: Date;
  durationMs: number;
  score: number;
  playerName: string;
  playerKey: string;
  result: SessionResult;
  rejectReason: string | null;
  /**
   * Danh tính của request: tài khoản → ghi/gắn `user_id`; khách → `null`. Câu cập nhật chỉ khớp khi
   * `user_id IS NULL OR user_id = userId` (ADR-027).
   */
  userId: string | null;
}

export interface LeaderboardRow {
  /** Thành viên: tên hiển thị hiện tại của tài khoản; khách: tên lúc nộp. */
  playerName: string;
  isMember: boolean;
  score: number;
  durationMs: number;
  achievedAt: Date;
}

export interface RankInfo {
  rank: number;
  personalBest: boolean;
}

export interface PlayHistoryRow {
  sessionId: string;
  gameId: string;
  gameTitle: string;
  /** `null` nếu game hiện không còn xếp hạng. */
  scoreOrder: ScoreOrder | null;
  score: number;
  durationMs: number;
  result: SessionResult;
  endedAt: Date;
}

export interface PersonalBestRow {
  gameId: string;
  gameTitle: string;
  scoreOrder: ScoreOrder;
  score: number;
  durationMs: number;
  achievedAt: Date;
  plays: number;
}

/** Khoá gộp "một người một dòng" (ADR-026) — cùng giá trị với cột generated `rank_key`. */
export function rankKeyOf(s: Pick<SessionRecord, 'userId' | 'playerKey'>): string | null {
  if (s.userId !== null) return `u:${s.userId}`;
  if (s.playerKey !== null) return `g:${s.playerKey}`;
  return null;
}

export interface SessionsRepository {
  /** `null` = game không tồn tại. */
  findGameRule(gameId: string): Promise<GameRuleLookup | null>;
  create(input: NewSession): Promise<SessionRecord>;
  /** `null` khi không có phiên với id này hoặc token không khớp (không phân biệt). */
  findByIdAndTokenHash(
    id: string,
    tokenHash: Buffer,
  ): Promise<{ session: SessionRecord; rule: ScoringRule | null } | null>;
  /**
   * Kết thúc phiên một cách atomic (`WHERE status = 'active' AND expires_at > now`).
   * Trả `null` khi không cập nhật được dòng nào (đã có yêu cầu khác thắng, hết hạn, hoặc sai token).
   */
  finish(input: FinishInput): Promise<SessionRecord | null>;
  /** Hạng và personalBest của một phiên đã `accepted` (cùng quy tắc sắp xếp với leaderboard). */
  rankOf(session: SessionRecord, scoreOrder: ScoreOrder): Promise<RankInfo>;
  leaderboard(gameId: string, scoreOrder: ScoreOrder, limit: number): Promise<LeaderboardRow[]>;
  /** Lịch sử của `userId`: phiên `finished` (accepted + rejected), `ended_at` giảm dần rồi `id` giảm dần. */
  listHistory(
    userId: string,
    page: { limit: number; offset: number },
  ): Promise<{ items: PlayHistoryRow[]; total: number }>;
  /** Kỷ lục mỗi game xếp hạng (accepted, không hidden); `achievedAt` giảm dần rồi `gameId`. */
  personalBests(userId: string): Promise<PersonalBestRow[]>;
}
