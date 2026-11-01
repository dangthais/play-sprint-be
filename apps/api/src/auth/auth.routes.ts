import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { validationError } from '../errors.ts';
import { normalizeNickname } from '../sessions/nickname.ts';
import { AUTH_BODY_LIMIT, type AuthSetup } from './auth.plugin.ts';
import type { AuthUser } from './auth.types.ts';
import { normalizeEmail, normalizePassword, PASSWORD_MIN_CODE_POINTS } from './credentials.ts';
import {
  hasCookie,
  readAllSessionCookies,
  readSessionCookie,
  serializeClearCookie,
  serializeSessionCookie,
} from './cookie.ts';

export function toUserDto(u: AuthUser): Record<string, unknown> {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    createdAt: u.createdAt.toISOString(),
  };
}

const stringField = { type: 'string' } as const;

export function registerAuthRoutes(app: FastifyInstance, setup: AuthSetup): void {
  const { api, service, accountLimiter, passwordChangeLimiter } = setup;
  const { rateLimitHooks } = app;

  const oldToken = (request: FastifyRequest): string | null =>
    readSessionCookie(request.headers.cookie, api.cookieName);
  const setSessionCookie = (reply: FastifyReply, token: string): void => {
    void reply.header(
      'set-cookie',
      serializeSessionCookie(api.cookieName, token, api.cookieSecure),
    );
  };
  const clearSessionCookie = (reply: FastifyReply): void => {
    void reply.header('set-cookie', serializeClearCookie(api.cookieName, api.cookieSecure));
  };

  app.post(
    '/api/auth/register',
    {
      onRequest: [rateLimitHooks.authRegister, api.requireSameOrigin],
      bodyLimit: AUTH_BODY_LIMIT,
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password', 'displayName'],
          properties: { email: stringField, password: stringField, displayName: stringField },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { email: string; password: string; displayName: string };
      const email = normalizeEmail(body.email);
      if (email === null) throw validationError('email is invalid');
      const password = normalizePassword(body.password, PASSWORD_MIN_CODE_POINTS);
      if (password === null) throw validationError('password must be 8 to 128 characters');
      const nick = normalizeNickname(body.displayName);
      if (!nick.ok) throw validationError('displayName is invalid');

      const { user, token } = await service.register({
        email,
        password,
        displayName: nick.name,
        displayNameKey: nick.key,
        oldToken: oldToken(request),
      });
      setSessionCookie(reply, token);
      return reply.status(201).send({ user: toUserDto(user) });
    },
  );

  app.post(
    '/api/auth/login',
    {
      onRequest: [rateLimitHooks.authLogin, api.requireSameOrigin],
      bodyLimit: AUTH_BODY_LIMIT,
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: { email: stringField, password: stringField },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { email: string; password: string };
      const email = normalizeEmail(body.email);
      if (email === null) throw validationError('email is invalid');
      const password = normalizePassword(body.password, 1);
      if (password === null) throw validationError('password must be 1 to 128 characters');

      // Hạn mức theo tài khoản (email đã chuẩn hoá, tính cả email không tồn tại) — trước khi băm.
      try {
        accountLimiter.check(email, () =>
          request.log.warn(
            { bucket: 'authLoginAccount' },
            'rate limiter key table full; using shard buckets',
          ),
        );
      } catch (err) {
        request.log.warn({ event: 'login_failed', reason: 'RATE_LIMITED' }, 'login failed');
        throw err;
      }

      const { user, token } = await service.login(
        { email, password, oldToken: oldToken(request) },
        request.log,
      );
      setSessionCookie(reply, token);
      return reply.status(200).send({ user: toUserDto(user) });
    },
  );

  // Logout không cần body: parser JSON riêng (trong scope này) bỏ qua nội dung (kể cả rỗng), vẫn áp
  // dụng giới hạn kích thước và Content-Type (khác JSON → 415).
  void app.register(async (scope) => {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: AUTH_BODY_LIMIT },
      (_request, _body, done) => done(null, undefined),
    );
    scope.post(
      '/api/auth/logout',
      { onRequest: api.requireSameOrigin, bodyLimit: AUTH_BODY_LIMIT },
      async (request, reply) => {
        // Cookie trùng tên: xoá phía server mọi phiên đúng định dạng (tối đa 3), vẫn 204 + xoá cookie.
        await service.logout(readAllSessionCookies(request.headers.cookie, api.cookieName));
        clearSessionCookie(reply);
        return reply.status(204).send();
      },
    );
  });

  app.get('/api/auth/me', async (request, reply) => {
    const auth = await api.resolve(request);
    if (auth === null) {
      // Cookie (bất kể sai định dạng/hết hạn/không khớp) mà không ra người dùng → xoá cookie.
      if (hasCookie(request.headers.cookie, api.cookieName)) {
        clearSessionCookie(reply);
      }
      return reply.status(200).send({ user: null });
    }
    return reply.status(200).send({ user: toUserDto(auth.user) });
  });

  app.patch(
    '/api/me',
    {
      onRequest: [rateLimitHooks.accountWrite, api.requireSameOrigin, api.requireUser],
      bodyLimit: AUTH_BODY_LIMIT,
      schema: {
        body: {
          type: 'object',
          required: ['displayName'],
          properties: { displayName: stringField },
        },
      },
    },
    async (request, reply) => {
      const user = request.authUser as AuthUser;
      const { displayName } = request.body as { displayName: string };
      const nick = normalizeNickname(displayName);
      if (!nick.ok) throw validationError('displayName is invalid');
      const updated = await service.updateDisplayName(user.id, {
        displayName: nick.name,
        displayNameKey: nick.key,
      });
      return reply.status(200).send({ user: toUserDto(updated) });
    },
  );

  app.post(
    '/api/me/password',
    {
      onRequest: [rateLimitHooks.accountWrite, api.requireSameOrigin, api.requireUser],
      bodyLimit: AUTH_BODY_LIMIT,
      schema: {
        body: {
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          properties: { currentPassword: stringField, newPassword: stringField },
        },
      },
    },
    async (request, reply) => {
      const user = request.authUser as AuthUser;
      // Hạn mức theo tài khoản (ngoài hạn mức IP): chặn dò currentPassword từ nhiều IP (L1).
      try {
        passwordChangeLimiter.check(user.id, () =>
          request.log.warn(
            { bucket: 'passwordChangeAccount' },
            'rate limiter key table full; using shard buckets',
          ),
        );
      } catch (err) {
        request.log.warn(
          { event: 'password_change_failed', reason: 'RATE_LIMITED' },
          'password change failed',
        );
        throw err;
      }
      const body = request.body as { currentPassword: string; newPassword: string };
      const currentPassword = normalizePassword(body.currentPassword, 1);
      if (currentPassword === null)
        throw validationError('currentPassword must be 1 to 128 characters');
      const newPassword = normalizePassword(body.newPassword, PASSWORD_MIN_CODE_POINTS);
      if (newPassword === null) throw validationError('newPassword must be 8 to 128 characters');
      const { token } = await service.changePassword(
        user,
        { currentPassword, newPassword },
        request.log,
      );
      setSessionCookie(reply, token);
      return reply.status(204).send();
    },
  );
}
