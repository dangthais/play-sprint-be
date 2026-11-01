-- F3: luật tính điểm theo game + phiên chơi (ADR-015 ... ADR-018, kiến trúc §5.5 / §5.6).
-- Chạy trong một transaction do runner (migrate.ts) quản lý.

-- Một dòng = game có xếp hạng; game không có dòng = không xếp hạng.
CREATE TABLE game_scoring_rules (
  game_id           text PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  score_order       text NOT NULL CHECK (score_order IN ('desc', 'asc')),
  min_score         integer NOT NULL CHECK (min_score >= 0),
  max_score         integer NOT NULL,
  min_duration_ms   integer NOT NULL DEFAULT 0 CHECK (min_duration_ms >= 0),
  score_slack       integer NOT NULL DEFAULT 0 CHECK (score_slack >= 0),
  max_score_per_sec numeric(10, 3) NULL
    CHECK (max_score_per_sec IS NULL OR (max_score_per_sec > 0 AND max_score_per_sec <= 100000)),
  min_ms_per_score  integer NULL CHECK (min_ms_per_score IS NULL OR min_ms_per_score >= 0),
  CONSTRAINT game_scoring_rules_range_chk CHECK (max_score >= min_score AND max_score <= 1000000000)
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY,
  game_id       text NOT NULL REFERENCES games(id),
  token_hash    bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  started_at    timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  ended_at      timestamptz NULL,
  duration_ms   integer NULL CHECK (duration_ms >= 0),
  score         integer NULL CHECK (score BETWEEN 0 AND 1000000000),
  player_name   text NULL CHECK (char_length(player_name) BETWEEN 1 AND 20),
  player_key    text NULL,
  result        text NULL CHECK (result IN ('accepted', 'rejected')),
  reject_reason text NULL CHECK (reject_reason ~ '^[A-Z_]{1,40}$'),
  hidden        boolean NOT NULL DEFAULT false,
  CONSTRAINT sessions_expires_after_start_chk CHECK (expires_at > started_at),
  -- active <=> 6 cột kết quả đều NULL; finished <=> đều NOT NULL.
  CONSTRAINT sessions_state_chk CHECK (
    (status = 'active'
      AND ended_at IS NULL AND duration_ms IS NULL AND score IS NULL
      AND player_name IS NULL AND player_key IS NULL AND result IS NULL)
    OR
    (status = 'finished'
      AND ended_at IS NOT NULL AND duration_ms IS NOT NULL AND score IS NOT NULL
      AND player_name IS NOT NULL AND player_key IS NOT NULL AND result IS NOT NULL)
  ),
  -- reject_reason có giá trị khi và chỉ khi result = 'rejected' (không để NULL làm "lọt").
  CONSTRAINT sessions_reject_reason_chk CHECK (
    (result IS NOT DISTINCT FROM 'rejected') = (reject_reason IS NOT NULL)
  )
);

-- Phục vụ DISTINCT ON (player_key) của leaderboard và tính hạng.
CREATE INDEX sessions_leaderboard_idx
  ON sessions (game_id, player_key, score, duration_ms, ended_at)
  WHERE result = 'accepted' AND NOT hidden;

-- Cho job dọn phiên bỏ dở sau này.
CREATE INDEX sessions_active_expires_idx ON sessions (expires_at) WHERE status = 'active';
