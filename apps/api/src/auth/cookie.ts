import { SESSION_TOKEN_PATTERN } from '../sessions/token.ts';

// ADR-023: parse/serialize cookie tự viết (không @fastify/cookie).

export const AUTH_COOKIE_NAME_SECURE = '__Host-qp_sid';
export const AUTH_COOKIE_NAME_PLAIN = 'qp_sid';
/** Hết hạn cố định 30 ngày kể từ lúc đăng nhập (không trượt). */
export const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const AUTH_SESSION_TTL_SEC = AUTH_SESSION_TTL_MS / 1000;

export function cookieNameFor(secure: boolean): string {
  return secure ? AUTH_COOKIE_NAME_SECURE : AUTH_COOKIE_NAME_PLAIN;
}

/** Các giá trị của cookie tên `name` trong header `Cookie` (tách theo `;`, trim, tách tại `=` đầu tiên). */
function valuesOf(header: string | undefined, name: string): string[] {
  if (typeof header !== 'string' || header === '') return [];
  const out: string[] = [];
  for (const part of header.split(';')) {
    const piece = part.trim();
    const eq = piece.indexOf('=');
    if (eq === -1) continue;
    if (piece.slice(0, eq).trim() === name) out.push(piece.slice(eq + 1).trim());
  }
  return out;
}

/** Request có mang cookie tên `name` hay không (bất kể giá trị). */
export function hasCookie(header: string | undefined, name: string): boolean {
  return valuesOf(header, name).length > 0;
}

/**
 * Giá trị token trong cookie phiên, hoặc `null` nếu: không có, xuất hiện nhiều lần (coi như không có),
 * hoặc không khớp `^[A-Za-z0-9_-]{43}$` (không truy vấn DB).
 */
export function readSessionCookie(header: string | undefined, name: string): string | null {
  const values = valuesOf(header, name);
  if (values.length !== 1) return null;
  const value = values[0] as string;
  return SESSION_TOKEN_PATTERN.test(value) ? value : null;
}

/** Tối đa số token đọc được cho logout khi cookie phiên bị trùng tên. */
export const MAX_LOGOUT_COOKIE_TOKENS = 3;

/**
 * Mọi token đúng định dạng của cookie phiên (không trùng lặp, tối đa `MAX_LOGOUT_COOKIE_TOKENS`) —
 * chỉ dùng cho logout, để xoá phía server mọi phiên mà request mang theo kể cả khi cookie trùng tên.
 */
export function readAllSessionCookies(header: string | undefined, name: string): string[] {
  const out: string[] = [];
  for (const value of valuesOf(header, name)) {
    if (!SESSION_TOKEN_PATTERN.test(value) || out.includes(value)) continue;
    out.push(value);
    if (out.length === MAX_LOGOUT_COOKIE_TOKENS) break;
  }
  return out;
}

/** `token` phải là giá trị base64url đã biết (sinh bởi `generateToken`). */
export function serializeSessionCookie(name: string, token: string, secure: boolean): string {
  if (!SESSION_TOKEN_PATTERN.test(token)) throw new Error('invalid session token');
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_SESSION_TTL_SEC}${secure ? '; Secure' : ''}`;
}

/** Xoá cookie: cùng tên/thuộc tính, `Max-Age=0`. (`__Host-` đòi `Secure` cả khi xoá.) */
export function serializeClearCookie(name: string, secure: boolean): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
