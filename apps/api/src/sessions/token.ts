import { createHash, randomBytes } from 'node:crypto';

export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 32 byte ngẫu nhiên (256 bit) mã hoá base64url không padding → 43 ký tự (ADR-015). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 của token (32 byte) — thứ duy nhất được lưu trong DB. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
