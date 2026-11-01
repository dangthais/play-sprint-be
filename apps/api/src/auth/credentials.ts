import { MAX_PASSWORD_CODE_POINTS } from './password.ts';

// Chuẩn hoá + validate email / mật khẩu (contract: RegisterRequest, LoginRequest).

const EMAIL_PATTERN = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/;
// eslint-disable-next-line no-control-regex
const ASCII_ONLY = /^[\x00-\x7f]*$/;
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_CODE_POINTS = 8;

/** Email đã chuẩn hoá (trim + chữ thường) hoặc `null` nếu sai quy tắc. ASCII được kiểm trước khi hạ chữ. */
export function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > EMAIL_MAX_LENGTH) return null;
  // Kiểm ASCII TRƯỚC toLowerCase (vd. U+212A "K" Kelvin sẽ biến thành "k" ASCII).
  if (!ASCII_ONLY.test(trimmed)) return null;
  const email = trimmed.toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : null;
}

/**
 * Chuẩn hoá NFC (không trim) rồi kiểm độ dài theo code point. `min` = 8 khi đặt mới, 1 khi kiểm
 * (đăng nhập, mật khẩu hiện tại). Chuỗi có surrogate lẻ bị từ chối (mã hoá UTF-8 sẽ mất thông tin).
 */
export function normalizePassword(raw: string, min: number): string | null {
  if (!raw.isWellFormed()) return null;
  const password = raw.normalize('NFC');
  const length = [...password].length;
  if (length < min || length > MAX_PASSWORD_CODE_POINTS) return null;
  return password;
}
