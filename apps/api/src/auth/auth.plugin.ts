import type { FastifyInstance, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import { forbiddenError, unauthorizedError } from '../errors.ts';
import {
  createKeyedRateLimit,
  DEFAULT_KEYED_RATE_LIMITS,
  type KeyedRateLimit,
  type RateLimitOverrides,
} from '../rate-limit.ts';
import { cookieNameFor, hasCookie, readSessionCookie } from './cookie.ts';
import { createAuthService, type AuthService } from './auth.service.ts';
import type { AuthRepository, AuthUser, ResolvedAuth } from './auth.types.ts';

/** Giới hạn body cho `/auth/*` và `/me*` (contract 0.5.0): `{ bodyLimit: AUTH_BODY_LIMIT }`. */
export const AUTH_BODY_LIMIT = 4096;

export interface AuthApi {
  /** Tên cookie phiên đăng nhập (`__Host-qp_sid` khi Secure, `qp_sid` ở dev). */
  readonly cookieName: string;
  readonly cookieSecure: boolean;
  /**
   * Người dùng của request (hoặc `null` = khách). Kết quả được nhớ trên request: tối đa một truy vấn
   * DB mỗi request; không có cookie / cookie sai định dạng hoặc trùng tên → `null`, KHÔNG truy vấn.
   */
  resolve(request: FastifyRequest): Promise<ResolvedAuth | null>;
  /**
   * `onRequest`: `Origin` phải bằng đúng WEB_ORIGIN; thiếu hoặc sai → 403 `FORBIDDEN`.
   * Gắn cho POST/PATCH của `/auth/*`, `/me*`, sau hook rate limit.
   */
  readonly requireSameOrigin: onRequestAsyncHookHandler;
  /**
   * `onRequest` cho `/sessions*`: `Origin` có mà sai → 403; thiếu `Origin` → 403 chỉ khi request mang
   * cookie phiên đăng nhập (khách không có cookie vẫn qua).
   */
  readonly requireSameOriginIfCookie: onRequestAsyncHookHandler;
  /**
   * Hook bất đồng bộ dùng được ở `onRequest` (khuyến nghị cho `/me*`: 401 đứng trước lỗi body) hoặc
   * `preHandler`: gán `request.authUser`; chưa đăng nhập → 401 `UNAUTHORIZED`.
   */
  requireUser(request: FastifyRequest): Promise<void>;
  /** `true` nếu có tài khoản dùng khoá tên (`displayName.toLowerCase()`). */
  isDisplayNameKeyTaken(displayNameKey: string): Promise<boolean>;
}

declare module 'fastify' {
  interface FastifyInstance {
    auth: AuthApi;
  }
  interface FastifyRequest {
    /** Có giá trị sau khi `app.auth.requireUser` chạy; ngược lại `null`. */
    authUser: AuthUser | null;
  }
}

export interface AuthSetup {
  api: AuthApi;
  service: AuthService;
  accountLimiter: KeyedRateLimit;
  /** Dò `currentPassword` của `POST /me/password`, khoá theo `user.id` (L1). */
  passwordChangeLimiter: KeyedRateLimit;
}

export function setupAuth(
  app: FastifyInstance,
  opts: {
    repository: AuthRepository;
    webOrigin: string;
    cookieSecure: boolean;
    clock: () => number;
    rateLimits?: RateLimitOverrides;
    keyedRateLimitMaxKeys?: number;
  },
): AuthSetup {
  const { webOrigin, cookieSecure, clock } = opts;
  const cookieName = cookieNameFor(cookieSecure);
  const service = createAuthService({ repository: opts.repository, clock });
  const accountLimiter = createKeyedRateLimit(
    'authLoginAccount',
    opts.rateLimits?.authLoginAccount ?? DEFAULT_KEYED_RATE_LIMITS.authLoginAccount,
    clock,
    opts.keyedRateLimitMaxKeys,
  );
  const passwordChangeLimiter = createKeyedRateLimit(
    'passwordChangeAccount',
    opts.rateLimits?.passwordChangeAccount ?? DEFAULT_KEYED_RATE_LIMITS.passwordChangeAccount,
    clock,
    opts.keyedRateLimitMaxKeys,
  );

  const memo = new WeakMap<FastifyRequest, Promise<ResolvedAuth | null>>();

  function resolve(request: FastifyRequest): Promise<ResolvedAuth | null> {
    let p = memo.get(request);
    if (p === undefined) {
      const token = readSessionCookie(request.headers.cookie, cookieName);
      p = token === null ? Promise.resolve(null) : service.resolve(token);
      memo.set(request, p);
    }
    return p;
  }

  const api: AuthApi = {
    cookieName,
    cookieSecure,
    resolve,
    requireSameOrigin: async (request) => {
      if (request.headers.origin !== webOrigin) throw forbiddenError('Origin not allowed');
    },
    requireSameOriginIfCookie: async (request) => {
      const origin = request.headers.origin;
      if (origin !== undefined) {
        if (origin !== webOrigin) throw forbiddenError('Origin not allowed');
        return;
      }
      if (hasCookie(request.headers.cookie, cookieName)) throw forbiddenError('Origin required');
    },
    async requireUser(request) {
      const auth = await resolve(request);
      if (auth === null) throw unauthorizedError('Authentication required');
      request.authUser = auth.user;
    },
    isDisplayNameKeyTaken: (key) => service.isDisplayNameKeyTaken(key),
  };

  app.decorate('auth', api);
  app.decorateRequest('authUser', null);

  // Cache-Control: no-store cho mọi response (cả lỗi) của /api/auth/* và /api/me*. `onSend` chạy cho
  // cả response lỗi do hook (429/403/401) và 404.
  app.addHook('onSend', async (request, reply, payload) => {
    const path = request.url.split('?', 1)[0] ?? '';
    if (path.startsWith('/api/auth/') || path === '/api/me' || path.startsWith('/api/me/')) {
      void reply.header('cache-control', 'no-store');
    }
    return payload;
  });

  return { api, service, accountLimiter, passwordChangeLimiter };
}
