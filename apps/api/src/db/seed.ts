import type pg from 'pg';
import type { GameRecord, Orientation } from '../games/games.types.ts';
import type { ScoringRule } from '../sessions/sessions.types.ts';
import { createPool } from './pool.ts';

type SeedDef = [
  id: string,
  title: string,
  description: string,
  orientation: Orientation,
  tags: string[],
  createdAt: string,
];

const DEFS: SeedDef[] = [
  [
    'snake',
    'Snake',
    'Điều khiển con rắn bằng phím mũi tên để ăn mồi và dài ra; game kết thúc khi đụng tường hoặc thân.',
    'any',
    ['arcade', 'classic'],
    '2026-01-01T00:00:00Z',
  ],
  [
    'brick-breaker',
    'Brick Breaker',
    'Di chuyển thanh trượt để đỡ bóng và phá gạch; mất lượt khi bóng chạm đáy.',
    'landscape',
    ['arcade'],
    '2026-01-01T00:00:00Z',
  ],
  [
    'memory-match',
    'Memory Match',
    'Lật từng cặp thẻ để tìm hình giống nhau; khớp đủ 8 cặp là thắng.',
    'any',
    ['puzzle', 'memory'],
    '2026-01-04T00:00:00Z',
  ],
  [
    'merge-2048',
    'Merge 2048',
    'Dùng phím mũi tên trượt và gộp các ô số giống nhau để đạt ô 2048.',
    'any',
    ['puzzle', 'numbers'],
    '2026-01-07T00:00:00Z',
  ],
  [
    'tic-tac-toe',
    'Tic Tac Toe',
    'Hai người chơi luân phiên đánh X và O trên cùng máy; xếp ba ký hiệu liên tiếp để thắng.',
    'any',
    ['classic', 'board'],
    '2026-01-13T00:00:00Z',
  ],
];

// Luật tính điểm (ADR-016, §5.5). Game không có dòng (tic-tac-toe) = không xếp hạng.
export const SEED_RULES: ScoringRule[] = [
  {
    gameId: 'snake',
    scoreOrder: 'desc',
    minScore: 0,
    maxScore: 900,
    minDurationMs: 0,
    scoreSlack: 5,
    maxScorePerSec: 2.5,
    minMsPerScore: null,
  },
  {
    gameId: 'merge-2048',
    scoreOrder: 'desc',
    minScore: 0,
    maxScore: 250000,
    minDurationMs: 0,
    scoreSlack: 100,
    maxScorePerSec: 250,
    minMsPerScore: null,
  },
  {
    gameId: 'brick-breaker',
    scoreOrder: 'desc',
    minScore: 0,
    maxScore: 20000,
    minDurationMs: 0,
    scoreSlack: 45,
    maxScorePerSec: 10,
    minMsPerScore: null,
  },
  {
    gameId: 'memory-match',
    scoreOrder: 'asc',
    minScore: 8,
    maxScore: 1000,
    minDurationMs: 3000,
    scoreSlack: 0,
    maxScorePerSec: null,
    minMsPerScore: 1000,
  },
];

export const SEED_GAMES: GameRecord[] = DEFS.map(
  ([id, title, description, orientation, tags, createdAt]) => ({
    id,
    title,
    description,
    thumbnailPath: `/thumbnails/${id}.svg`,
    embedPath: `/games/${id}/`,
    orientation,
    tags,
    // snake và brick-breaker cố ý trùng created_at để kiểm tra tie-breaker theo id.
    createdAt: new Date(createdAt),
    ranked: SEED_RULES.some((r) => r.gameId === id),
    scoreOrder: SEED_RULES.find((r) => r.gameId === id)?.scoreOrder ?? null,
  }),
);

export async function seedGames(db: Pick<pg.Pool, 'query'> | pg.PoolClient): Promise<number> {
  for (const g of SEED_GAMES) {
    await db.query(
      `INSERT INTO games (id, title, description, thumbnail_path, embed_path, orientation, tags, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         thumbnail_path = EXCLUDED.thumbnail_path,
         embed_path = EXCLUDED.embed_path,
         orientation = EXCLUDED.orientation,
         tags = EXCLUDED.tags,
         created_at = EXCLUDED.created_at`,
      [
        g.id,
        g.title,
        g.description,
        g.thumbnailPath,
        g.embedPath,
        g.orientation,
        g.tags,
        g.createdAt,
      ],
    );
  }
  return SEED_GAMES.length;
}

/** Upsert luật tính điểm theo `game_id`; chạy lại an toàn. Cần seed `games` trước (FK). */
export async function seedScoringRules(
  db: Pick<pg.Pool, 'query'> | pg.PoolClient,
): Promise<number> {
  for (const r of SEED_RULES) {
    await db.query(
      `INSERT INTO game_scoring_rules
         (game_id, score_order, min_score, max_score, min_duration_ms, score_slack, max_score_per_sec, min_ms_per_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (game_id) DO UPDATE SET
         score_order = EXCLUDED.score_order,
         min_score = EXCLUDED.min_score,
         max_score = EXCLUDED.max_score,
         min_duration_ms = EXCLUDED.min_duration_ms,
         score_slack = EXCLUDED.score_slack,
         max_score_per_sec = EXCLUDED.max_score_per_sec,
         min_ms_per_score = EXCLUDED.min_ms_per_score`,
      [
        r.gameId,
        r.scoreOrder,
        r.minScore,
        r.maxScore,
        r.minDurationMs,
        r.scoreSlack,
        r.maxScorePerSec,
        r.minMsPerScore,
      ],
    );
  }
  return SEED_RULES.length;
}

// Không xoá dòng cũ (cần người dùng cho phép); chỉ đếm để cảnh báo.
export async function countNonSeedGames(
  db: Pick<pg.Pool, 'query'> | pg.PoolClient,
): Promise<number> {
  const res = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM games WHERE NOT (id = ANY($1))',
    [SEED_GAMES.map((g) => g.id)],
  );
  return res.rows[0]?.count ?? 0;
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set; cannot seed games.');
    process.exit(1);
  }
  const pool = createPool(url);
  try {
    const n = await seedGames(pool);
    console.log(`Seeded ${n} games.`);
    const rules = await seedScoringRules(pool);
    console.log(`Seeded ${rules} scoring rules.`);
    const extra = await countNonSeedGames(pool);
    if (extra > 0) {
      console.warn(`Cảnh báo: ${extra} game không thuộc seed vẫn còn trong DB (không bị xoá).`);
    }
  } catch (err) {
    console.error('Seed failed:', err instanceof Error ? err.message : 'unknown error');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
