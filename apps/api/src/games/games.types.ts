export type Orientation = 'landscape' | 'portrait' | 'any';
export type ScoreOrder = 'desc' | 'asc';

export interface GameRecord {
  id: string;
  title: string;
  description: string | null;
  thumbnailPath: string;
  embedPath: string;
  orientation: Orientation;
  tags: string[];
  createdAt: Date;
  /** `true` khi game có dòng trong `game_scoring_rules`. */
  ranked: boolean;
  /** Chỉ có khi `ranked = true`. */
  scoreOrder: ScoreOrder | null;
}

export interface GamesRepository {
  list(params: { limit: number; offset: number }): Promise<{ items: GameRecord[]; total: number }>;
  findById(id: string): Promise<GameRecord | null>;
}
