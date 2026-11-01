import type pg from 'pg';
import {
  AuthConflictError,
  type AuthRepository,
  type AuthSessionInput,
  type AuthUser,
  type UserWithHash,
} from './auth.types.ts';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  display_name_key: string;
  created_at: Date;
}
interface UserWithHashRow extends UserRow {
  password_hash: string;
}

const USER_COLUMNS = 'id, email, display_name, display_name_key, created_at';

function toUser(r: UserRow): AuthUser {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    displayNameKey: r.display_name_key,
    createdAt: r.created_at,
  };
}

/** Map vi phạm unique (23505) theo **tên constraint** — không đọc `detail` (có thể chứa email/tên). */
export function mapUniqueViolation(err: unknown): AuthConflictError | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { code?: unknown; constraint?: unknown };
  if (e.code !== '23505') return null;
  if (e.constraint === 'users_email_key') return new AuthConflictError('EMAIL');
  if (e.constraint === 'users_display_name_key_key') return new AuthConflictError('NAME');
  return null;
}

async function insertSession(
  db: pg.PoolClient,
  userId: string,
  s: AuthSessionInput,
): Promise<void> {
  await db.query(
    `INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [s.id, userId, s.tokenHash, s.createdAt, s.expiresAt],
  );
}

/** `pool` phải là `pg.Pool` (cần client riêng cho transaction). */
export function createPgAuthRepository(pool: pg.Pool): AuthRepository {
  async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      try {
        const out = await fn(client);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    } finally {
      client.release();
    }
  }

  return {
    async register(input) {
      return tx(async (c) => {
        let row: UserRow | undefined;
        try {
          // Email và display_name_key đều UNIQUE; pg kiểm index theo thứ tự tạo (email trước) nên
          // khi cả hai trùng, EMAIL_TAKEN được báo (khớp contract).
          const res = await c.query<UserRow>(
            `INSERT INTO users (id, email, password_hash, display_name, display_name_key,
                                created_at, updated_at, password_changed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $6, $6)
             RETURNING ${USER_COLUMNS}`,
            [
              input.id,
              input.email,
              input.passwordHash,
              input.displayName,
              input.displayNameKey,
              input.now,
            ],
          );
          row = res.rows[0];
        } catch (err) {
          throw mapUniqueViolation(err) ?? err;
        }
        if (!row) throw new Error('insert returned no row');
        if (input.replaceTokenHash) {
          await c.query('DELETE FROM auth_sessions WHERE token_hash = $1', [
            input.replaceTokenHash,
          ]);
        }
        await insertSession(c, row.id, input.session);
        return toUser(row);
      });
    },

    async findByEmail(email): Promise<UserWithHash | null> {
      const res = await pool.query<UserWithHashRow>(
        `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`,
        [email],
      );
      const row = res.rows[0];
      return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
    },

    async findPasswordHash(userId) {
      const res = await pool.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [userId],
      );
      return res.rows[0]?.password_hash ?? null;
    },

    async findSession(tokenHash, now) {
      const res = await pool.query<UserRow & { session_id: string }>(
        `SELECT u.id, u.email, u.display_name, u.display_name_key, u.created_at,
                s.id AS session_id
           FROM auth_sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1 AND s.expires_at > $2`,
        [tokenHash, now],
      );
      const row = res.rows[0];
      return row ? { user: toUser(row), authSessionId: row.session_id } : null;
    },

    async startSession(input) {
      return tx(async (c) => {
        // Khoá dòng user: changePassword (UPDATE cùng dòng) phải chờ, hoặc ta thấy hash mới và dừng.
        const cur = await c.query<{ password_hash: string }>(
          'SELECT password_hash FROM users WHERE id = $1 FOR UPDATE',
          [input.userId],
        );
        if (cur.rows[0]?.password_hash !== input.verifiedPasswordHash) return false;
        if (input.rehash) {
          await c.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
            input.userId,
            input.rehash,
          ]);
        }
        if (input.replaceTokenHash) {
          await c.query('DELETE FROM auth_sessions WHERE token_hash = $1', [
            input.replaceTokenHash,
          ]);
        }
        await c.query('DELETE FROM auth_sessions WHERE user_id = $1 AND expires_at <= $2', [
          input.userId,
          input.now,
        ]);
        await insertSession(c, input.userId, input.session);
        return true;
      });
    },

    async deleteSession(tokenHash) {
      await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [tokenHash]);
    },

    async changePassword(input) {
      return tx(async (c) => {
        const res = await c.query(
          `UPDATE users
              SET password_hash = $2, password_changed_at = $3, updated_at = $3
            WHERE id = $1 AND password_hash = $4`,
          [input.userId, input.passwordHash, input.now, input.verifiedPasswordHash],
        );
        if (res.rowCount === 0) return false;
        await c.query('DELETE FROM auth_sessions WHERE user_id = $1', [input.userId]);
        await insertSession(c, input.userId, input.session);
        return true;
      });
    },

    async updateDisplayName(input) {
      try {
        const res = await pool.query<UserRow>(
          `UPDATE users SET display_name = $2, display_name_key = $3, updated_at = $4
            WHERE id = $1
            RETURNING ${USER_COLUMNS}`,
          [input.userId, input.displayName, input.displayNameKey, input.now],
        );
        const row = res.rows[0];
        return row ? toUser(row) : null;
      } catch (err) {
        throw mapUniqueViolation(err) ?? err;
      }
    },

    async isDisplayNameKeyTaken(key) {
      const res = await pool.query('SELECT 1 FROM users WHERE display_name_key = $1', [key]);
      return (res.rowCount ?? 0) > 0;
    },
  };
}
