CREATE TABLE games (
  id             text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  title          text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  description    text NULL CHECK (char_length(description) <= 500),
  thumbnail_path text NOT NULL CHECK (thumbnail_path ~ '^/[A-Za-z0-9/_.-]+$' AND position('..' in thumbnail_path) = 0),
  embed_path     text NOT NULL CHECK (embed_path ~ '^/[A-Za-z0-9/_.-]+$' AND position('..' in embed_path) = 0),
  orientation    text NOT NULL DEFAULT 'any' CHECK (orientation IN ('landscape', 'portrait', 'any')),
  tags           text[] NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- COLLATE "C": tie-breaker theo byte, không phụ thuộc collation của DB (khớp repository in-memory).
CREATE INDEX games_created_at_id_idx ON games (created_at DESC, id COLLATE "C" ASC);
