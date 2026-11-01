import {
  AuthConflictError,
  type AuthRepository,
  type AuthSessionInput,
  type AuthUser,
  type ResolvedAuth,
  type UserWithHash,
} from './auth.types.ts';

interface StoredUser extends UserWithHash {
  updatedAt: Date;
  passwordChangedAt: Date;
}

interface StoredSession {
  id: string;
  userId: string;
  tokenHash: Buffer;
  createdAt: Date;
  expiresAt: Date;
}

export interface InMemoryAuthRepository extends AuthRepository {
  /** Số lần gọi phương thức repository (test: "không cookie → 0 truy vấn"). */
  readonly calls: number;
  userCount(): number;
  sessionCount(userId?: string): number;
  /** Bản sao user (có hash) — dành cho test. */
  getUser(id: string): UserWithHash | undefined;
  /** Ghi đè hash (test nâng cấp tham số). */
  setPasswordHash(id: string, hash: string): void;
  hasSession(tokenHash: Buffer): boolean;
}

function toPublic(u: StoredUser): AuthUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    displayNameKey: u.displayNameKey,
    createdAt: u.createdAt,
  };
}

/**
 * Cùng ngữ nghĩa với bản pg. Mỗi thao tác kiểm tra rồi ghi đồng bộ sau một lần nhường event loop
 * (không có `await` giữa kiểm tra và ghi) nên atomic trong một event loop.
 */
export function createInMemoryAuthRepository(): InMemoryAuthRepository {
  const users = new Map<string, StoredUser>();
  const sessions = new Map<string, StoredSession>();
  let calls = 0;

  const hex = (b: Buffer): string => b.toString('hex');
  const tick = async (): Promise<void> => {
    calls += 1;
    await Promise.resolve();
  };

  function byEmail(email: string): StoredUser | undefined {
    for (const u of users.values()) if (u.email === email) return u;
    return undefined;
  }
  function byNameKey(key: string): StoredUser | undefined {
    for (const u of users.values()) if (u.displayNameKey === key) return u;
    return undefined;
  }
  function addSession(userId: string, s: AuthSessionInput): void {
    if (sessions.has(hex(s.tokenHash))) throw new Error('duplicate token_hash');
    sessions.set(hex(s.tokenHash), {
      id: s.id,
      userId,
      tokenHash: Buffer.from(s.tokenHash),
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    });
  }

  return {
    get calls() {
      return calls;
    },
    userCount: () => users.size,
    sessionCount: (userId) =>
      userId === undefined
        ? sessions.size
        : [...sessions.values()].filter((s) => s.userId === userId).length,
    getUser: (id) => {
      const u = users.get(id);
      return u === undefined ? undefined : { ...toPublic(u), passwordHash: u.passwordHash };
    },
    setPasswordHash(id, hash) {
      const u = users.get(id);
      if (u) u.passwordHash = hash;
    },
    hasSession: (tokenHash) => sessions.has(hex(tokenHash)),

    async register(input) {
      await tick();
      if (byEmail(input.email)) throw new AuthConflictError('EMAIL');
      if (byNameKey(input.displayNameKey)) throw new AuthConflictError('NAME');
      const user: StoredUser = {
        id: input.id,
        email: input.email,
        passwordHash: input.passwordHash,
        displayName: input.displayName,
        displayNameKey: input.displayNameKey,
        createdAt: input.now,
        updatedAt: input.now,
        passwordChangedAt: input.now,
      };
      users.set(user.id, user);
      if (input.replaceTokenHash) sessions.delete(hex(input.replaceTokenHash));
      addSession(user.id, input.session);
      return toPublic(user);
    },

    async findByEmail(email) {
      await tick();
      const u = byEmail(email);
      return u === undefined ? null : { ...toPublic(u), passwordHash: u.passwordHash };
    },

    async findPasswordHash(userId) {
      await tick();
      return users.get(userId)?.passwordHash ?? null;
    },

    async findSession(tokenHash, now): Promise<ResolvedAuth | null> {
      await tick();
      const s = sessions.get(hex(tokenHash));
      if (!s || s.expiresAt.getTime() <= now.getTime()) return null;
      const u = users.get(s.userId);
      return u === undefined ? null : { user: toPublic(u), authSessionId: s.id };
    },

    async startSession(input) {
      await tick();
      const u = users.get(input.userId);
      if (!u || u.passwordHash !== input.verifiedPasswordHash) return false;
      if (input.rehash) u.passwordHash = input.rehash;
      if (input.replaceTokenHash) sessions.delete(hex(input.replaceTokenHash));
      for (const [k, s] of sessions) {
        if (s.userId === input.userId && s.expiresAt.getTime() <= input.now.getTime()) {
          sessions.delete(k);
        }
      }
      addSession(input.userId, input.session);
      return true;
    },

    async deleteSession(tokenHash) {
      await tick();
      sessions.delete(hex(tokenHash));
    },

    async changePassword(input) {
      await tick();
      const u = users.get(input.userId);
      if (!u || u.passwordHash !== input.verifiedPasswordHash) return false;
      u.passwordHash = input.passwordHash;
      u.passwordChangedAt = input.now;
      u.updatedAt = input.now;
      for (const [k, s] of sessions) if (s.userId === input.userId) sessions.delete(k);
      addSession(input.userId, input.session);
      return true;
    },

    async updateDisplayName(input) {
      await tick();
      const u = users.get(input.userId);
      if (!u) return null;
      const other = byNameKey(input.displayNameKey);
      if (other && other.id !== u.id) throw new AuthConflictError('NAME');
      u.displayName = input.displayName;
      u.displayNameKey = input.displayNameKey;
      u.updatedAt = input.now;
      return toPublic(u);
    },

    async isDisplayNameKeyTaken(key) {
      await tick();
      return byNameKey(key) !== undefined;
    },
  };
}
