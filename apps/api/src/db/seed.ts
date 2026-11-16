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
  // F5 (ADR-038): createdAt = 2026-11-10T00:00:00Z + i giờ.
  [
    'sea-battle',
    'Sea Battle',
    'Xếp hạm đội rồi bắn từng ô để đánh chìm toàn bộ tàu của máy trước khi máy đánh chìm tàu của bạn.',
    'any',
    ['board', 'strategy'],
    '2026-11-10T00:00:00Z',
  ],
  [
    'solitaire',
    'Solitaire',
    'Xếp bài Klondike: chuyển các lá xen kẽ màu theo thứ tự giảm dần và đưa đủ bốn chất lên ô đích.',
    'any',
    ['classic', 'cards'],
    '2026-11-10T01:00:00Z',
  ],
  [
    'sudoku',
    'Sudoku',
    'Điền số vào lưới sao cho mỗi hàng, cột và khối đều không trùng số; chọn độ khó 4×4, 6×6 hoặc 9×9.',
    'any',
    ['puzzle', 'numbers'],
    '2026-11-10T02:00:00Z',
  ],
  [
    'checkers',
    'Checkers',
    'Cờ đam 8×8 với máy: đi chéo, nhảy qua quân đối thủ để ăn và phong vua khi chạm cuối bàn.',
    'any',
    ['board', 'classic'],
    '2026-11-10T03:00:00Z',
  ],
  [
    'chess',
    'Chess',
    'Cờ vua đầy đủ luật, chơi hai người cùng máy hoặc đấu với máy.',
    'any',
    ['board', 'classic'],
    '2026-11-10T04:00:00Z',
  ],
  [
    'reversi',
    'Reversi',
    'Đặt quân kẹp quân đối thủ theo hàng, cột hoặc đường chéo để lật màu; hết ván ai nhiều quân hơn thắng. Điểm là số quân của bạn.',
    'any',
    ['board', 'classic'],
    '2026-11-10T05:00:00Z',
  ],
  [
    'word-guess',
    'Word Guess',
    'Đoán từ tiếng Anh 5 chữ trong 6 lượt; màu ô cho biết chữ đúng vị trí, có trong từ hay không có. Càng ít lượt càng tốt.',
    'any',
    ['puzzle', 'words'],
    '2026-11-10T06:00:00Z',
  ],
  [
    'code-breaker',
    'Code Breaker',
    'Đoán mã 4 màu bí mật; mỗi lượt nhận gợi ý đúng màu đúng chỗ và đúng màu sai chỗ. Càng ít lượt càng tốt.',
    'any',
    ['puzzle', 'logic'],
    '2026-11-10T07:00:00Z',
  ],
  [
    'sliding-puzzle',
    'Sliding Puzzle',
    'Trượt các ô số trên bàn 3×3 để xếp lại theo thứ tự. Càng ít bước càng tốt.',
    'any',
    ['puzzle'],
    '2026-11-10T08:00:00Z',
  ],
  [
    'minesweeper',
    'Minesweeper',
    'Mở các ô trên bàn 8×8 có 10 quả mìn; số trên ô cho biết số mìn xung quanh. Mở hết ô an toàn để thắng.',
    'any',
    ['puzzle', 'classic'],
    '2026-11-10T09:00:00Z',
  ],
  [
    'simon-says',
    'Simon Says',
    'Nhớ và bấm lại chuỗi màu ngày càng dài; sai một lần là kết thúc.',
    'any',
    ['classic', 'memory'],
    '2026-11-10T10:00:00Z',
  ],
  [
    'typing-race',
    'Typing Race',
    'Gõ thật nhanh từ tiếng Anh hiện trên màn hình; mỗi từ đúng được cộng thêm thời gian.',
    'any',
    ['arcade', 'words'],
    '2026-11-10T11:00:00Z',
  ],
  [
    'mole-smash',
    'Mole Smash',
    'Đập chuột chũi trồi lên khỏi hang trong 10 giây.',
    'any',
    ['arcade', 'reflex'],
    '2026-11-10T12:00:00Z',
  ],
  [
    'bubble-pop',
    'Bubble Pop',
    'Ngắm và bắn bóng màu; ghép từ 3 bóng cùng màu để làm nổ và làm rơi các bóng treo.',
    'portrait',
    ['arcade', 'puzzle'],
    '2026-11-10T13:00:00Z',
  ],
  [
    'frog-crossing',
    'Frog Crossing',
    'Đưa ếch băng qua đường xe chạy và dòng sông về đủ 5 tổ trước khi hết giờ.',
    'any',
    ['arcade', 'classic'],
    '2026-11-10T14:00:00Z',
  ],
  [
    'asteroid-blaster',
    'Asteroid Blaster',
    'Lái phi thuyền xoay, tăng tốc và bắn vỡ thiên thạch qua 5 đợt; coi chừng đĩa bay.',
    'portrait',
    ['arcade', 'shooter'],
    '2026-11-10T15:00:00Z',
  ],
  [
    'space-shooter',
    'Space Shooter',
    'Di chuyển khẩu pháo và bắn hạ đội hình người ngoài hành tinh trước khi chúng xuống tới nơi.',
    'portrait',
    ['arcade', 'shooter'],
    '2026-11-10T16:00:00Z',
  ],
  [
    'sky-hop',
    'Sky Hop',
    'Nhảy từ bệ này sang bệ khác để lên cao nhất có thể; rơi khỏi màn hình là thua.',
    'portrait',
    ['arcade'],
    '2026-11-10T17:00:00Z',
  ],
  [
    'block-drop',
    'Block Drop',
    'Xoay và thả các khối rơi để lấp đầy hàng ngang; hàng đầy sẽ biến mất.',
    'any',
    ['arcade', 'classic'],
    '2026-11-10T18:00:00Z',
  ],
  [
    'maze-chomp',
    'Maze Chomp',
    'Ăn hết các viên trong mê cung bằng phím mũi tên và né hai bóng ma; có 3 mạng.',
    'portrait',
    ['arcade', 'classic'],
    '2026-11-10T19:00:00Z',
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
  // F5 (ADR-039, §5.5)
  ...(
    [
      // id, order, min, max, minDurationMs, slack, maxPerSec, minMsPerScore
      ['maze-chomp', 'desc', 0, 3800, 0, 200, 90, null],
      ['sky-hop', 'desc', 0, 1000000, 0, 100, 200, null],
      ['block-drop', 'desc', 0, 1000000, 0, 500, 250, null],
      ['space-shooter', 'desc', 0, 100000, 0, 100, 200, null],
      ['asteroid-blaster', 'desc', 0, 200000, 0, 2000, 300, null],
      ['frog-crossing', 'desc', 0, 5000, 0, 2500, 150, null],
      ['bubble-pop', 'desc', 0, 1000000, 0, 600, 60, null],
      ['mole-smash', 'desc', 0, 50, 9500, 0, null, null],
      ['typing-race', 'desc', 0, 5000, 9000, 0, null, 1900],
      ['simon-says', 'desc', 0, 200, 0, 0, null, 3000],
      ['minesweeper', 'desc', 0, 54, 3000, 0, null, null],
      ['sliding-puzzle', 'asc', 1, 5000, 2000, 0, null, 100],
      ['code-breaker', 'asc', 1, 11, 3000, 0, null, 2000],
      ['word-guess', 'asc', 1, 7, 3000, 0, null, 1500],
      ['reversi', 'desc', 0, 64, 3000, 0, null, null],
    ] satisfies [
      string,
      'asc' | 'desc',
      number,
      number,
      number,
      number,
      number | null,
      number | null,
    ][]
  ).map(
    ([
      gameId,
      scoreOrder,
      minScore,
      maxScore,
      minDurationMs,
      scoreSlack,
      maxScorePerSec,
      minMsPerScore,
    ]): ScoringRule => ({
      gameId,
      scoreOrder,
      minScore,
      maxScore,
      minDurationMs,
      scoreSlack,
      maxScorePerSec,
      minMsPerScore,
    }),
  ),
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
