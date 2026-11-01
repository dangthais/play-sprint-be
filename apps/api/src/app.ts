import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { AUTH_BODY_LIMIT, setupAuth } from './auth/auth.plugin.ts';
import { createInMemoryAuthRepository } from './auth/auth.repository.memory.ts';
import { registerAuthRoutes } from './auth/auth.routes.ts';
import type { AuthRepository } from './auth/auth.types.ts';
import { AppError, type ErrorCode } from './errors.ts';
import { registerGamesRoutes } from './games/games.routes.ts';
import type { GamesRepository } from './games/games.types.ts';
import {
  createRateLimitHooks,
  type RateLimitHooks,
  type RateLimitOverrides,
} from './rate-limit.ts';
import { registerSecurityHeaders } from './security-headers.ts';
import { registerHistoryRoutes } from './sessions/history.routes.ts';
import { registerLeaderboardRoutes } from './sessions/leaderboard.routes.ts';
import { registerSessionsRoutes } from './sessions/sessions.routes.ts';
import { createInMemorySessionsRepository } from './sessions/sessions.repository.memory.ts';
import { createSessionsService } from './sessions/sessions.service.ts';
import type { SessionsRepository } from './sessions/sessions.types.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** Hook `onRequest` rate limit theo bucket; gắn vào route: `{ onRequest: app.rateLimitHooks.x }`. */
    rateLimitHooks: RateLimitHooks;
  }
}

/** Giới hạn body cho route POST (ADR-020): `{ bodyLimit: POST_BODY_LIMIT }`. */
export const POST_BODY_LIMIT = 1024;

/** Giới hạn body cho `/auth/*` và `/me*` (contract 0.5.0): 4 KiB. */
export { AUTH_BODY_LIMIT };

export interface BuildAppOptions {
  gamesRepository: GamesRepository;
  /** Mặc định: kho in-memory rỗng (mọi game → 404); server.ts luôn truyền repo thật. */
  sessionsRepository?: SessionsRepository;
  /** Mặc định: kho in-memory rỗng; server.ts luôn truyền repo thật. */
  authRepository?: AuthRepository;
  /** Cookie đăng nhập có `Secure` + tên `__Host-qp_sid`. Mặc định: suy từ `webOrigin` (https → true). */
  cookieSecure?: boolean;
  webOrigin?: string;
  gameOrigin?: string;
  logger?: FastifyServerOptions['logger'];
  trustProxy?: false | number | string[];
  rateLimits?: RateLimitOverrides;
  /** Số khoá tối đa của limiter theo email (`authLoginAccount`); đầy → khoá mới đếm vào shard bucket (FNV-1a mod 1024) + log warn, không cho qua. */
  keyedRateLimitMaxKeys?: number;
  /** Đồng hồ (ms) dùng chung cho rate limiter và phiên chơi (started/expires/ended); mặc định `Date.now`. */
  clock?: () => number;
}

const GENERIC: Record<string, { code: ErrorCode; message: string }> = {
  '400': { code: 'VALIDATION_ERROR', message: 'Invalid request' },
  '404': { code: 'NOT_FOUND', message: 'Resource not found' },
  '413': { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' },
  '415': { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported media type' },
  '429': { code: 'RATE_LIMITED', message: 'Too many requests' },
};

function toFastifyTrustProxy(value: false | number | string[] | undefined) {
  if (value === undefined || value === false) return false;
  if (typeof value === 'number') return (_address: string, hop: number): boolean => hop < value;
  return value;
}

const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-session-token"]',
  'res.headers["set-cookie"]',
];

const SCORE_ROUTE = '/api/sessions/:sessionId/score';
const PG_CODE = /^[0-9A-Z]{5}$/;

/**
 * Serializer `err` an toàn: lỗi pg có `detail` ("Failing row contains ..."), `where`, `parameters`...
 * có thể chứa token hash / nickname → chỉ giữ `code`, `constraint`, `table` (và stack frame, bỏ dòng
 * message). Lỗi khác: `type`, `message`, `stack`.
 */
export function safeErrSerializer(err: unknown): Record<string, unknown> {
  if (typeof err !== 'object' || err === null) return { type: typeof err };
  const e = err as Record<string, unknown>;
  const name = typeof e.name === 'string' ? e.name : 'Error';
  const stack = typeof e.stack === 'string' ? e.stack : undefined;
  const isPg =
    typeof e.code === 'string' &&
    PG_CODE.test(e.code) &&
    ('severity' in e || 'detail' in e || 'routine' in e || 'schema' in e);
  if (isPg) {
    const frames = stack?.split('\n').filter((l) => l.trimStart().startsWith('at '));
    return {
      type: name,
      code: e.code,
      ...(typeof e.constraint === 'string' ? { constraint: e.constraint } : {}),
      ...(typeof e.table === 'string' ? { table: e.table } : {}),
      ...(frames ? { stack: frames.join('\n') } : {}),
    };
  }
  return {
    type: name,
    message: typeof e.message === 'string' ? e.message : '',
    ...(stack !== undefined ? { stack } : {}),
  };
}

/**
 * Bổ sung serializer cho log request: chỉ method + path (bỏ query string, host, IP) để không
 * lộ token đặt nhầm vào URL hoặc IP client vào log (security.md, AC17). Header không bao giờ được log.
 */
function withSafeSerializers(logger: BuildAppOptions['logger']): BuildAppOptions['logger'] {
  if (logger === undefined || logger === false) return false;
  const base = logger === true ? {} : logger;
  const existing = (base as { redact?: unknown }).redact;
  const existingPaths = Array.isArray(existing)
    ? (existing as string[])
    : ((existing as { paths?: string[] } | undefined)?.paths ?? []);
  return {
    ...base,
    // Lớp phòng thủ thứ hai (ADR-025/§6): serializer `req` đã bỏ header, redact đảm bảo cookie/token
    // không bao giờ vào log dù ai đó thêm header vào serializer.
    redact: {
      paths: [...new Set([...existingPaths, ...REDACT_PATHS])],
      censor: '[Redacted]',
    },
    serializers: {
      req: (req: { method?: string; url?: string }) => ({
        method: req.method,
        url: typeof req.url === 'string' ? req.url.split('?', 1)[0] : undefined,
      }),
      err: (err: unknown) => safeErrSerializer(err) as never,
      ...base.serializers,
    },
  };
}

export function buildApp(opts: BuildAppOptions): FastifyInstance {
  const clock = opts.clock ?? Date.now;
  const app = Fastify({
    logger: withSafeSerializers(opts.logger),
    trustProxy: toFastifyTrustProxy(opts.trustProxy),
    // Validate chặt: không ép kiểu, không âm thầm xoá field thừa (mặc định của Fastify làm cả hai).
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });

  // Body không phải JSON (text/plain...) → 415 UNSUPPORTED_MEDIA_TYPE.
  app.removeContentTypeParser('text/plain');

  // Header bảo mật cho mọi response (ADR-032); phải đăng ký trước mọi route.
  registerSecurityHeaders(app);

  app.decorate('rateLimitHooks', createRateLimitHooks(opts.rateLimits, clock));

  const webOrigin = opts.webOrigin ?? 'http://localhost:5173';
  const authSetup = setupAuth(app, {
    repository: opts.authRepository ?? createInMemoryAuthRepository(),
    webOrigin,
    cookieSecure: opts.cookieSecure ?? webOrigin.startsWith('https:'),
    clock,
    ...(opts.rateLimits !== undefined ? { rateLimits: opts.rateLimits } : {}),
    ...(opts.keyedRateLimitMaxKeys !== undefined
      ? { keyedRateLimitMaxKeys: opts.keyedRateLimitMaxKeys }
      : {}),
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      if (err.statusCode >= 500) {
        request.log.error({ err }, 'application error');
      } else if (err.code !== 'SCORE_REJECTED' && request.routeOptions?.url !== SCORE_ROUTE) {
        // ADR-020: log warn cho 4xx (không body/header). Route nộp điểm tự log `score_rejected`.
        request.log.warn({ code: err.code, statusCode: err.statusCode }, 'client error');
      }
      if (err.headers) void reply.headers(err.headers);
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }
    const status = (err as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 500) {
      request.log.warn({ err }, 'client error');
      const mapped = GENERIC[String(status)] ?? {
        code: 'BAD_REQUEST' as const,
        message: 'Bad request',
      };
      return reply.status(status).send({ code: mapped.code, message: mapped.message });
    }
    request.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ code: 'NOT_FOUND', message: 'Resource not found' }),
  );

  app.get('/api/health', async () => ({ status: 'ok' }));

  registerGamesRoutes(app, {
    repository: opts.gamesRepository,
    webOrigin,
    gameOrigin: opts.gameOrigin ?? 'http://localhost:5174',
  });

  const sessionsService = createSessionsService({
    repository:
      opts.sessionsRepository ?? createInMemorySessionsRepository({ gameIds: [], rules: [] }),
    clock,
    isDisplayNameKeyTaken: (key) => authSetup.api.isDisplayNameKeyTaken(key),
  });
  registerAuthRoutes(app, authSetup);
  registerSessionsRoutes(app, { service: sessionsService, bodyLimit: POST_BODY_LIMIT });
  registerLeaderboardRoutes(app, { service: sessionsService });
  registerHistoryRoutes(app, { service: sessionsService });

  return app;
}
