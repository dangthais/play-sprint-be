import type pg from 'pg';
import type { GameRecord, GamesRepository, Orientation, ScoreOrder } from './games.types.ts';

interface GameRow {
  id: string;
  title: string;
  description: string | null;
  thumbnail_path: string;
  embed_path: string;
  orientation: Orientation;
  tags: string[];
  created_at: Date;
  score_order: ScoreOrder | null;
}

function toRecord(r: GameRow): GameRecord {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    thumbnailPath: r.thumbnail_path,
    embedPath: r.embed_path,
    orientation: r.orientation,
    tags: r.tags,
    createdAt: r.created_at,
    // Game không có dòng luật (LEFT JOIN không khớp) → không xếp hạng.
    ranked: r.score_order !== null,
    scoreOrder: r.score_order,
  };
}

const COLUMNS = `g.id, g.title, g.description, g.thumbnail_path, g.embed_path, g.orientation,
       g.tags, g.created_at, r.score_order`;

export function createPgGamesRepository(
  db: Pick<pg.Pool, 'query'> | pg.PoolClient,
): GamesRepository {
  return {
    async list({ limit, offset }) {
      const rows = await db.query<GameRow>(
        `SELECT ${COLUMNS}
           FROM games g
           LEFT JOIN game_scoring_rules r ON r.game_id = g.id
          ORDER BY g.created_at DESC, g.id COLLATE "C" ASC
          LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      const count = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM games');
      return { items: rows.rows.map(toRecord), total: count.rows[0]?.count ?? 0 };
    },
    async findById(id) {
      const rows = await db.query<GameRow>(
        `SELECT ${COLUMNS}
           FROM games g
           LEFT JOIN game_scoring_rules r ON r.game_id = g.id
          WHERE g.id = $1`,
        [id],
      );
      const row = rows.rows[0];
      return row ? toRecord(row) : null;
    },
  };
}
