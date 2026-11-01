export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'EMAIL_TAKEN'
  | 'NAME_TAKEN'
  | 'SESSION_NOT_ACTIVE'
  | 'SESSION_EXPIRED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'GAME_NOT_RANKED'
  | 'SCORE_REJECTED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly headers: Readonly<Record<string, string>> | undefined;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.headers = headers;
  }
}

export function validationError(message: string): AppError {
  return new AppError(400, 'VALIDATION_ERROR', message);
}

export function badRequestError(message: string, statusCode = 400): AppError {
  return new AppError(statusCode, 'BAD_REQUEST', message);
}

export function unauthorizedError(message: string): AppError {
  return new AppError(401, 'UNAUTHORIZED', message);
}

export function forbiddenError(message = 'Forbidden'): AppError {
  return new AppError(403, 'FORBIDDEN', message);
}

/** 401 ở `POST /auth/login`; 403 ở `POST /me/password` (mật khẩu hiện tại sai). */
export function invalidCredentialsError(
  statusCode: 401 | 403,
  message = 'Invalid email or password',
): AppError {
  return new AppError(statusCode, 'INVALID_CREDENTIALS', message);
}

export function emailTakenError(message = 'Email is already registered'): AppError {
  return new AppError(409, 'EMAIL_TAKEN', message);
}

export function nameTakenError(message = 'Display name is already taken'): AppError {
  return new AppError(409, 'NAME_TAKEN', message);
}

export function notFoundError(message: string): AppError {
  return new AppError(404, 'NOT_FOUND', message);
}

export function sessionNotActiveError(message: string): AppError {
  return new AppError(409, 'SESSION_NOT_ACTIVE', message);
}

export function sessionExpiredError(message: string): AppError {
  return new AppError(409, 'SESSION_EXPIRED', message);
}

export function payloadTooLargeError(message: string): AppError {
  return new AppError(413, 'PAYLOAD_TOO_LARGE', message);
}

export function unsupportedMediaTypeError(message: string): AppError {
  return new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', message);
}

export function gameNotRankedError(message: string): AppError {
  return new AppError(422, 'GAME_NOT_RANKED', message);
}

export function scoreRejectedError(message: string): AppError {
  return new AppError(422, 'SCORE_REJECTED', message);
}

export function rateLimitedError(retryAfterSec: number, message = 'Too many requests'): AppError {
  return new AppError(429, 'RATE_LIMITED', message, {
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterSec))),
  });
}

export function internalError(message = 'Internal server error'): AppError {
  return new AppError(500, 'INTERNAL_ERROR', message);
}
