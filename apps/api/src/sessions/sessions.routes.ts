import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  AppError,
  notFoundError,
  scoreRejectedError,
  unauthorizedError,
  validationError,
} from '../errors.ts';
import { normalizeNickname } from './nickname.ts';
import { MAX_SCORE } from './scoring.ts';
import type { SessionsService, SubmitIdentity } from './sessions.service.ts';
import type { SessionRecord } from './sessions.types.ts';
import { SESSION_TOKEN_PATTERN } from './token.ts';

export interface SessionsRoutesOptions {
  service: SessionsService;
  bodyLimit: number;
}

const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function toSessionDto(s: SessionRecord): Record<string, unknown> {
  return {
    id: s.id,
    gameId: s.gameId,
    status: s.status,
    startedAt: s.startedAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    endedAt: s.endedAt === null ? null : s.endedAt.toISOString(),
    score: s.score,
    durationMs: s.durationMs,
    playerName: s.playerName,
  };
}

/**
 * Body nộp điểm: kiểm chặt kiểu (không ép kiểu), field lạ bị bỏ qua (contract). `playerName` chỉ được
 * kiểm khi request là khách (`guest = true`); với tài khoản nó bị bỏ qua hoàn toàn.
 */
export function parseScoreBody(
  body: unknown,
  guest: boolean,
): { score: number; guest: { name: string; key: string } | null } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw validationError('Request body must be a JSON object');
  }
  const { score, playerName } = body as Record<string, unknown>;
  if (typeof score !== 'number' || !Number.isSafeInteger(score) || score < 0 || score > MAX_SCORE) {
    throw validationError('score must be an integer between 0 and 1000000000');
  }
  if (!guest) return { score, guest: null };
  if (typeof playerName !== 'string') throw validationError('playerName must be a string');
  const nick = normalizeNickname(playerName);
  if (!nick.ok) throw validationError('playerName is invalid');
  return { score, guest: { name: nick.name, key: nick.key } };
}

// Lý do ghi log cho lỗi 4xx của framework (body quá lớn, Content-Type sai, JSON hỏng...).
function reasonOf(err: unknown): string | null {
  if (err instanceof AppError) return err.statusCode < 500 ? err.code : null;
  const status = (err as { statusCode?: unknown }).statusCode;
  if (typeof status !== 'number' || status < 400 || status >= 500) return null;
  if (status === 400) return 'VALIDATION_ERROR';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 415) return 'UNSUPPORTED_MEDIA_TYPE';
  return 'BAD_REQUEST';
}

export function registerSessionsRoutes(app: FastifyInstance, opts: SessionsRoutesOptions): void {
  const { service, bodyLimit } = opts;

  app.post(
    '/api/sessions',
    {
      onRequest: [app.rateLimitHooks.createSession, app.auth.requireSameOriginIfCookie],
      bodyLimit,
      schema: {
        body: {
          type: 'object',
          required: ['gameId'],
          properties: { gameId: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const { gameId } = request.body as { gameId: string };
      // Slug sai định dạng chắc chắn không tồn tại → 404 mà không truy vấn DB.
      if (!GAME_ID_PATTERN.test(gameId)) throw notFoundError('Game not found');
      // Cookie hợp lệ → phiên thuộc tài khoản (không lộ id trong response); ngược lại khách.
      const auth = await app.auth.resolve(request);
      const { session, sessionToken } = await service.createSession(gameId, auth?.user.id ?? null);
      return reply.status(201).send({ session: toSessionDto(session), sessionToken });
    },
  );

  // Bước 2-3 của contract: chạy ở `onRequest` (sau rate limit, trước parse body) để 404/401 đứng
  // trước mọi lỗi body và không đụng DB.
  async function checkIdAndToken(request: FastifyRequest): Promise<void> {
    const { sessionId } = request.params as { sessionId: string };
    if (!SESSION_ID_PATTERN.test(sessionId)) throw notFoundError('Session not found');
    const token = request.headers['x-session-token'];
    if (typeof token !== 'string' || !SESSION_TOKEN_PATTERN.test(token)) {
      throw unauthorizedError('Missing or malformed session token');
    }
  }

  app.post(
    '/api/sessions/:sessionId/score',
    {
      onRequest: [
        app.rateLimitHooks.submitScore,
        app.auth.requireSameOriginIfCookie,
        checkIdAndToken,
      ],
      bodyLimit,
      // AC17: mọi lần nộp bị từ chối log `warn` (không token, hash, IP, nickname).
      // `SCORE_REJECTED` được handler tự log (kèm lý do chi tiết).
      onError: async (request, _reply, err) => {
        if (err instanceof AppError && err.code === 'SCORE_REJECTED') return;
        const reason = reasonOf(err);
        if (reason !== null)
          request.log.warn({ event: 'score_rejected', reason }, 'score rejected');
      },
    },
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      // Đã được kiểm định dạng ở onRequest.
      const token = request.headers['x-session-token'] as string;
      // Danh tính: tài khoản (cookie hợp lệ) hoặc khách; cookie hỏng/hết hạn ⇒ khách.
      const auth = await app.auth.resolve(request);
      const body = parseScoreBody(request.body, auth === null);
      let identity: SubmitIdentity;
      if (auth) {
        identity = {
          kind: 'user',
          userId: auth.user.id,
          displayName: auth.user.displayName,
          displayNameKey: auth.user.displayNameKey,
        };
      } else if (body.guest) {
        identity = { kind: 'guest', playerName: body.guest.name, playerKey: body.guest.key };
      } else {
        throw validationError('playerName must be a string');
      }

      const outcome = await service.submitScore({ sessionId, token, score: body.score, identity });

      if (outcome.kind === 'rejected') {
        request.log.warn(
          {
            event: 'score_rejected',
            reason: outcome.reason,
            gameId: outcome.session.gameId,
            sessionId: outcome.session.id,
            score: outcome.session.score,
            durationMs: outcome.session.durationMs,
          },
          'score rejected',
        );
        throw scoreRejectedError('Score was not accepted');
      }
      return reply.status(200).send({
        session: toSessionDto(outcome.session),
        rank: outcome.rank,
        personalBest: outcome.personalBest,
      });
    },
  );
}
