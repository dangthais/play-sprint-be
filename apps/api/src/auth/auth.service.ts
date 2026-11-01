import { randomUUID } from 'node:crypto';
import {
  emailTakenError,
  invalidCredentialsError,
  nameTakenError,
  unauthorizedError,
} from '../errors.ts';
import { generateToken, hashToken } from '../sessions/token.ts';
import { AUTH_SESSION_TTL_MS } from './cookie.ts';
import {
  AuthConflictError,
  type AuthRepository,
  type AuthSessionInput,
  type AuthUser,
  type ResolvedAuth,
} from './auth.types.ts';
import {
  getDummyHash,
  hashPassword,
  isStoredHashValid,
  needsRehash,
  verifyPassword,
} from './password.ts';

/** Nơi ghi log tối thiểu (request.log): sự kiện auth chỉ có `event`/`reason`, không dữ liệu nhạy cảm. */
export interface AuthLog {
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface AuthService {
  register(input: {
    email: string;
    password: string;
    displayName: string;
    displayNameKey: string;
    /** Token cookie cũ (đã đúng định dạng) của request — bị xoá phía server. */
    oldToken: string | null;
  }): Promise<{ user: AuthUser; token: string }>;
  login(
    input: { email: string; password: string; oldToken: string | null },
    log: AuthLog,
  ): Promise<{ user: AuthUser; token: string }>;
  resolve(token: string): Promise<ResolvedAuth | null>;
  /** Xoá phía server từng phiên trong `tokens` (rỗng → không làm gì). */
  logout(tokens: string[]): Promise<void>;
  updateDisplayName(
    userId: string,
    input: { displayName: string; displayNameKey: string },
  ): Promise<AuthUser>;
  changePassword(
    user: AuthUser,
    input: { currentPassword: string; newPassword: string },
    log: AuthLog,
  ): Promise<{ token: string }>;
  isDisplayNameKeyTaken(displayNameKey: string): Promise<boolean>;
}

export function createAuthService(deps: {
  repository: AuthRepository;
  /** Đồng hồ (ms). */
  clock: () => number;
  /** Chỉ để test (xác nhận hash giả vẫn được verify); mặc định `verifyPassword`. */
  verify?: typeof verifyPassword;
}): AuthService {
  const { repository, clock } = deps;
  const verify = deps.verify ?? verifyPassword;

  function newSession(): { token: string; session: AuthSessionInput } {
    const token = generateToken();
    const now = clock();
    return {
      token,
      session: {
        id: randomUUID(),
        tokenHash: hashToken(token),
        createdAt: new Date(now),
        expiresAt: new Date(now + AUTH_SESSION_TTL_MS),
      },
    };
  }

  return {
    async register(input) {
      const passwordHash = await hashPassword(input.password);
      const { token, session } = newSession();
      try {
        const user = await repository.register({
          id: randomUUID(),
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          displayNameKey: input.displayNameKey,
          now: new Date(clock()),
          session,
          replaceTokenHash: input.oldToken === null ? null : hashToken(input.oldToken),
        });
        return { user, token };
      } catch (err) {
        if (err instanceof AuthConflictError) {
          throw err.field === 'EMAIL' ? emailTakenError() : nameTakenError();
        }
        throw err;
      }
    },

    async login(input, log) {
      const user = await repository.findByEmail(input.email);
      // Email không tồn tại: vẫn chạy scrypt với hash giả để thời gian phản hồi tương đương (ADR-022).
      const stored = user?.passwordHash ?? (await getDummyHash());
      if (user !== null && !isStoredHashValid(stored)) {
        log.error({ event: 'password_hash_invalid' }, 'stored password hash is invalid');
      }
      const ok = await verify(input.password, stored);
      if (user === null || !ok) {
        log.warn({ event: 'login_failed', reason: 'INVALID_CREDENTIALS' }, 'login failed');
        throw invalidCredentialsError(401);
      }
      // Tham số hash cũ → băm lại bằng tham số hiện tại (không ảnh hưởng response).
      const rehash = needsRehash(user.passwordHash) ? await hashPassword(input.password) : null;
      const { token, session } = newSession();
      // Repo chỉ cấp phiên nếu hash vẫn là hash vừa verify (mật khẩu có thể vừa được đổi: M1).
      const started = await repository.startSession({
        userId: user.id,
        verifiedPasswordHash: user.passwordHash,
        now: new Date(clock()),
        session,
        replaceTokenHash: input.oldToken === null ? null : hashToken(input.oldToken),
        rehash,
      });
      if (!started) {
        log.warn({ event: 'login_failed', reason: 'INVALID_CREDENTIALS' }, 'login failed');
        throw invalidCredentialsError(401);
      }
      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          displayNameKey: user.displayNameKey,
          createdAt: user.createdAt,
        },
        token,
      };
    },

    resolve(token) {
      return repository.findSession(hashToken(token), new Date(clock()));
    },

    async logout(tokens) {
      for (const token of tokens) await repository.deleteSession(hashToken(token));
    },

    async updateDisplayName(userId, input) {
      try {
        const user = await repository.updateDisplayName({
          userId,
          displayName: input.displayName,
          displayNameKey: input.displayNameKey,
          now: new Date(clock()),
        });
        if (user === null) throw unauthorizedError('Authentication required');
        return user;
      } catch (err) {
        if (err instanceof AuthConflictError) throw nameTakenError();
        throw err;
      }
    },

    async changePassword(user, input, log) {
      const stored = await repository.findPasswordHash(user.id);
      if (stored === null) throw unauthorizedError('Authentication required');
      if (!isStoredHashValid(stored)) {
        log.error({ event: 'password_hash_invalid' }, 'stored password hash is invalid');
      }
      if (!(await verify(input.currentPassword, stored))) {
        log.warn({ event: 'password_change_failed' }, 'password change failed');
        throw invalidCredentialsError(403, 'Current password is incorrect');
      }
      const passwordHash = await hashPassword(input.newPassword);
      const { token, session } = newSession();
      const ok = await repository.changePassword({
        userId: user.id,
        verifiedPasswordHash: stored,
        passwordHash,
        now: new Date(clock()),
        session,
      });
      if (!ok) {
        // Hash đã đổi đồng thời (hoặc user không còn): coi như sai mật khẩu hiện tại.
        log.warn({ event: 'password_change_failed' }, 'password change failed');
        throw invalidCredentialsError(403, 'Current password is incorrect');
      }
      return { token };
    },

    isDisplayNameKeyTaken: (key) => repository.isDisplayNameKeyTaken(key),
  };
}
