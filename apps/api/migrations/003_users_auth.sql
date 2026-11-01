-- F4: tài khoản người dùng + phiên đăng nhập + gắn phiên chơi với tài khoản
-- (ADR-022 ... ADR-027, kiến trúc §5.7 / §5.8 / §5.9).
-- Chạy trong một transaction do runner (migrate.ts) quản lý. Không drop/đổi/xoá gì đã có.

CREATE TABLE users (
  id                  uuid PRIMARY KEY,
  email               text NOT NULL,
  password_hash       text NOT NULL,
  display_name        text NOT NULL,
  display_name_key    text NOT NULL,
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL,
  password_changed_at timestamptz NOT NULL,
  -- Tên constraint được app dùng để map lỗi unique -> EMAIL_TAKEN / NAME_TAKEN (không đọc `detail`).
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_display_name_key_key UNIQUE (display_name_key),
  CONSTRAINT users_email_chk CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT users_password_hash_chk
    CHECK (password_hash LIKE 'scrypt$%' AND char_length(password_hash) <= 200),
  CONSTRAINT users_display_name_chk CHECK (char_length(display_name) BETWEEN 1 AND 20)
);

-- Tên khác `sessions` (phiên chơi) để tránh nhầm.
CREATE TABLE auth_sessions (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT auth_sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT auth_sessions_token_hash_chk CHECK (octet_length(token_hash) = 32),
  CONSTRAINT auth_sessions_expires_chk CHECK (expires_at > created_at)
);

-- Xoá mọi phiên của user (đổi mật khẩu) và dọn phiên hết hạn của chính user.
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);
-- Cho job dọn phiên hết hạn sau này.
CREATE INDEX auth_sessions_expires_idx ON auth_sessions (expires_at);

-- Phiên chơi gắn tài khoản (ADR-027). Dòng cũ: user_id NULL.
ALTER TABLE sessions ADD COLUMN user_id uuid NULL REFERENCES users(id);

-- Khoá gộp "một người một dòng" của leaderboard/hạng (ADR-026): tài khoản theo user_id, khách theo
-- player_key; phiên active của khách (chưa có player_key) -> NULL. Cột generated STORED (PG >= 12).
ALTER TABLE sessions ADD COLUMN rank_key text GENERATED ALWAYS AS (
  CASE
    WHEN user_id IS NOT NULL THEN 'u:' || user_id::text
    WHEN player_key IS NOT NULL THEN 'g:' || player_key
  END
) STORED;

-- Thay vai trò của sessions_leaderboard_idx (index cũ giữ nguyên, không drop trong 003).
CREATE INDEX sessions_rank_idx
  ON sessions (game_id, rank_key, score, duration_ms, ended_at)
  WHERE result = 'accepted' AND NOT hidden;

-- Lịch sử chơi của một tài khoản (mới nhất trước).
CREATE INDEX sessions_user_history_idx
  ON sessions (user_id, ended_at DESC, id DESC)
  WHERE status = 'finished' AND user_id IS NOT NULL;
