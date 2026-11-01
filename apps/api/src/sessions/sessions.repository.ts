import type pg from 'pg';
import {
  rankKeyOf,
  type FinishInput,
  type GameRuleLookup,
  type LeaderboardRow,
  type RankInfo,
  type ScoreOrder,
  type ScoringRule,
  type SessionRecord,
  type SessionResult,
  type SessionStatus,
  type SessionsRepository,
} from './sessions.types.ts';

interface SessionRow {
  id: string;
  game_id: string;
  status: SessionStatus;
  started_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  duration_ms: number | null;
  score: number | null;
  player_name: string | null;
  player_key: string | null;
  result: SessionResult | null;
  reject_reason: string | null;
  user_id: string | null;
}

interface RuleColumns {
  score_order: ScoreOrder | null;
  min_score: number | null;
  max_score: number | null;
  min_duration_ms: number | null;
  score_slack: number | null;
  /** `numeric` → pg trả chuỗi. */
  max_score_per_sec: string | null;
  min_ms_per_score: number | null;
}

const SESSION_COLUMNS = `id, game_id, status, started_at, expires_at, ended_at, duration_ms, score,
       player_name, player_key, result, reject_reason, user_id`;

function toSession(r: SessionRow): SessionRecord {
  return {
    id: r.id,
    gameId: r.game_id,
    status: r.status,
    startedAt: r.started_at,
    expiresAt: r.expires_at,
    endedAt: r.ended_at,
    durationMs: r.duration_ms,
    score: r.score,
    playerName: r.player_name,
    playerKey: r.player_key,
    result: r.result,
    rejectReason: r.reject_reason,
    userId: r.user_id,
  };
}

function toRule(gameId: string, r: RuleColumns): ScoringRule | null {
  if (
    r.score_order === null ||
    r.min_score === null ||
    r.max_score === null ||
    r.min_duration_ms === null ||
    r.score_slack === null
  ) {
    return null;
  }
  return {
    gameId,
    scoreOrder: r.score_order,
    minScore: r.min_score,
    maxScore: r.max_score,
    minDurationMs: r.min_duration_ms,
    scoreSlack: r.score_slack,
    maxScorePerSec: r.max_score_per_sec === null ? null : Number(r.max_score_per_sec),
    minMsPerScore: r.min_ms_per_score,
  };
}

// Hai biến thể cố định cho asc/desc: chọn trong code, không nối chuỗi từ dữ liệu đầu vào.
// Gộp theo `rank_key` (ADR-026): tài khoản theo user_id, khách theo player_key. Thành viên hiển thị
// tên HIỆN TẠI của tài khoản (JOIN users); lượt khách cũ trùng tên không gộp vào tài khoản.
function leaderboardSql(scoreOrder: ScoreOrder): string {
  const dir = scoreOrder === 'desc' ? 'DESC' : 'ASC';
  return `SELECT COALESCE(u.display_name, best.player_name) AS player_name,
                 (best.user_id IS NOT NULL) AS is_member,
                 best.score, best.duration_ms, best.ended_at
            FROM (
              SELECT DISTINCT ON (rank_key) id, user_id, player_name, score, duration_ms, ended_at
                FROM sessions
               WHERE game_id = $1 AND result = 'accepted' AND NOT hidden
               ORDER BY rank_key, score ${dir}, duration_ms ASC, ended_at ASC, id ASC
            ) best
            LEFT JOIN users u ON u.id = best.user_id
           ORDER BY best.score ${dir}, best.duration_ms ASC, best.ended_at ASC, best.id ASC
           LIMIT $2`;
}
const LEADERBOARD_SQL: Record<ScoreOrder, string> = {
  desc: leaderboardSql('desc'),
  asc: leaderboardSql('asc'),
};

// $1 game, $2 rank_key, $3 score, $4 duration_ms, $5 ended_at, $6 id.
// better = số rank_key KHÁC có thành tích tốt nhất xếp trên lượt này;
// best_id = bản ghi tốt nhất của chính người chơi này. Hai biến thể cố định asc/desc.
function rankSql(scoreOrder: ScoreOrder): string {
  const cmp = scoreOrder === 'desc' ? '>' : '<';
  const bestOrder = scoreOrder === 'desc' ? 'DESC' : 'ASC';
  return `WITH best AS (
            SELECT DISTINCT ON (rank_key) rank_key, id, score, duration_ms, ended_at
              FROM sessions
             WHERE game_id = $1 AND result = 'accepted' AND NOT hidden
             ORDER BY rank_key, score ${bestOrder}, duration_ms ASC, ended_at ASC, id ASC
          )
          SELECT
            (SELECT count(*)::int FROM best
              WHERE rank_key <> $2
                AND (score ${cmp} $3
                     OR (score = $3 AND (duration_ms < $4
                         OR (duration_ms = $4 AND (ended_at < $5
                             OR (ended_at = $5 AND id < $6::uuid))))))) AS better,
            (SELECT id FROM best WHERE rank_key = $2) AS best_id`;
}
const RANK_SQL: Record<ScoreOrder, string> = { desc: rankSql('desc'), asc: rankSql('asc') };

// Kỷ lục: một câu lệnh, thứ tự "tốt nhất" theo score_order của game bằng CASE trên cột (không nối
// chuỗi). `plays` đếm mọi lượt đã kết thúc (cả rejected, cả hidden). $1 = user_id.
const BESTS_SQL = `WITH mine AS (
    SELECT s.id, s.game_id, s.score, s.duration_ms, s.ended_at, s.result, s.hidden, r.score_order
      FROM sessions s
      JOIN game_scoring_rules r ON r.game_id = s.game_id
     WHERE s.user_id = $1 AND s.status = 'finished'
  ), plays AS (
    SELECT game_id, count(*)::int AS n FROM mine GROUP BY game_id
  ), best AS (
    SELECT DISTINCT ON (game_id) game_id, score, duration_ms, ended_at, score_order
      FROM mine
     WHERE result = 'accepted' AND NOT hidden
     ORDER BY game_id,
              (CASE WHEN score_order = 'desc' THEN -score::bigint ELSE score::bigint END) ASC,
              duration_ms ASC, ended_at ASC, id ASC
  )
  SELECT b.game_id, g.title, b.score_order, b.score, b.duration_ms, b.ended_at, p.n AS plays
    FROM best b
    JOIN games g ON g.id = b.game_id
    JOIN plays p ON p.game_id = b.game_id
   ORDER BY b.ended_at DESC, b.game_id ASC`;

export function createPgSessionsRepository(
  db: Pick<pg.Pool, 'query'> | pg.PoolClient,
): SessionsRepository {
  return {
    async findGameRule(gameId): Promise<GameRuleLookup | null> {
      const res = await db.query<RuleColumns & { id: string }>(
        `SELECT g.id, r.score_order, r.min_score, r.max_score, r.min_duration_ms, r.score_slack,
                r.max_score_per_sec, r.min_ms_per_score
           FROM games g
           LEFT JOIN game_scoring_rules r ON r.game_id = g.id
          WHERE g.id = $1`,
        [gameId],
      );
      const row = res.rows[0];
      if (!row) return null;
      return { rule: toRule(row.id, row) };
    },

    async create(input) {
      const res = await db.query<SessionRow>(
        `INSERT INTO sessions (id, game_id, token_hash, status, started_at, expires_at, user_id)
         VALUES ($1, $2, $3, 'active', $4, $5, $6)
         RETURNING ${SESSION_COLUMNS}`,
        [input.id, input.gameId, input.tokenHash, input.startedAt, input.expiresAt, input.userId],
      );
      const row = res.rows[0];
      if (!row) throw new Error('insert returned no row');
      return toSession(row);
    },

    async findByIdAndTokenHash(id, tokenHash) {
      const res = await db.query<SessionRow & RuleColumns>(
        `SELECT s.id, s.game_id, s.status, s.started_at, s.expires_at, s.ended_at, s.duration_ms,
                s.score, s.player_name, s.player_key, s.result, s.reject_reason, s.user_id,
                r.score_order, r.min_score, r.max_score, r.min_duration_ms, r.score_slack,
                r.max_score_per_sec, r.min_ms_per_score
           FROM sessions s
           LEFT JOIN game_scoring_rules r ON r.game_id = s.game_id
          WHERE s.id = $1 AND s.token_hash = $2`,
        [id, tokenHash],
      );
      const row = res.rows[0];
      if (!row) return null;
      return { session: toSession(row), rule: toRule(row.game_id, row) };
    },

    async finish(input: FinishInput) {
      // Một câu lệnh atomic: chỉ một yêu cầu đồng thời thấy status='active' và ghi được.
      const res = await db.query<SessionRow>(
        `UPDATE sessions
            SET status = 'finished', ended_at = $3, duration_ms = $4, score = $5,
                player_name = $6, player_key = $7, result = $8, reject_reason = $9,
                user_id = COALESCE(user_id, $10::uuid)
          WHERE id = $1 AND token_hash = $2 AND status = 'active' AND expires_at > $3
            AND (user_id IS NULL OR user_id = $10::uuid)
          RETURNING ${SESSION_COLUMNS}`,
        [
          input.id,
          input.tokenHash,
          input.now,
          input.durationMs,
          input.score,
          input.playerName,
          input.playerKey,
          input.result,
          input.rejectReason,
          input.userId,
        ],
      );
      const row = res.rows[0];
      return row ? toSession(row) : null;
    },

    async rankOf(session, scoreOrder): Promise<RankInfo> {
      if (
        session.score === null ||
        session.durationMs === null ||
        session.endedAt === null ||
        rankKeyOf(session) === null
      ) {
        throw new Error('rankOf requires a finished session');
      }
      const res = await db.query<{ better: number; best_id: string | null }>(RANK_SQL[scoreOrder], [
        session.gameId,
        rankKeyOf(session),
        session.score,
        session.durationMs,
        session.endedAt,
        session.id,
      ]);
      const row = res.rows[0];
      return { rank: (row?.better ?? 0) + 1, personalBest: row?.best_id === session.id };
    },

    async leaderboard(gameId, scoreOrder, limit): Promise<LeaderboardRow[]> {
      const res = await db.query<{
        player_name: string;
        is_member: boolean;
        score: number;
        duration_ms: number;
        ended_at: Date;
      }>(LEADERBOARD_SQL[scoreOrder], [gameId, limit]);
      return res.rows.map((r) => ({
        playerName: r.player_name,
        isMember: r.is_member,
        score: r.score,
        durationMs: r.duration_ms,
        achievedAt: r.ended_at,
      }));
    },

    async listHistory(userId, page) {
      const [rows, count] = await Promise.all([
        db.query<{
          id: string;
          game_id: string;
          title: string;
          score_order: ScoreOrder | null;
          score: number;
          duration_ms: number;
          result: SessionResult;
          ended_at: Date;
        }>(
          `SELECT s.id, s.game_id, g.title, r.score_order, s.score, s.duration_ms, s.result, s.ended_at
             FROM sessions s
             JOIN games g ON g.id = s.game_id
             LEFT JOIN game_scoring_rules r ON r.game_id = s.game_id
            WHERE s.user_id = $1 AND s.status = 'finished'
            ORDER BY s.ended_at DESC, s.id DESC
            LIMIT $2 OFFSET $3`,
          [userId, page.limit, page.offset],
        ),
        db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND status = 'finished'",
          [userId],
        ),
      ]);
      return {
        items: rows.rows.map((r) => ({
          sessionId: r.id,
          gameId: r.game_id,
          gameTitle: r.title,
          scoreOrder: r.score_order,
          score: r.score,
          durationMs: r.duration_ms,
          result: r.result,
          endedAt: r.ended_at,
        })),
        total: count.rows[0]?.n ?? 0,
      };
    },

    async personalBests(userId) {
      const res = await db.query<{
        game_id: string;
        title: string;
        score_order: ScoreOrder;
        score: number;
        duration_ms: number;
        ended_at: Date;
        plays: number;
      }>(BESTS_SQL, [userId]);
      return res.rows.map((r) => ({
        gameId: r.game_id,
        gameTitle: r.title,
        scoreOrder: r.score_order,
        score: r.score,
        durationMs: r.duration_ms,
        achievedAt: r.ended_at,
        plays: r.plays,
      }));
    },
  };
}
