import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// ADR-022: scrypt async (thread pool, không chặn event loop). Định dạng lưu tự mô tả để nâng cấp được:
//   scrypt$v=1$n=32768,r=8,p=1$<salt base64url>$<hash base64url>

export const SCRYPT_PARAMS = {
  n: 2 ** 15,
  r: 8,
  p: 1,
  keyLen: 32,
  saltLen: 16,
} as const;

/** maxmem cho scrypt: 128 * N * r = 32 MiB ở tham số hiện tại, vượt mặc định (32 MiB) của Node. */
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
/** Chặn hash lưu có tham số quá tốn bộ nhớ (128 * N * r > 64 MiB) dù nằm trong khoảng ADR. */
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;

const PARAMS_PATTERN = /^n=([0-9]{1,8}),r=([0-9]{1,3}),p=([0-9]{1,3})$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

export const MAX_PASSWORD_CODE_POINTS = 128;

interface ParsedHash {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function parseStored(stored: string): ParsedHash | null {
  if (typeof stored !== 'string' || stored.length > 200) return null;
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'scrypt' || parts[1] !== 'v=1') return null;
  const m = PARAMS_PATTERN.exec(parts[2] ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  const r = Number(m[2]);
  const p = Number(m[3]);
  // n lũy thừa 2 trong 2^14..2^20, r 1..16, p 1..4 (ADR-022) + trần bộ nhớ.
  if (!Number.isInteger(n) || n < 2 ** 14 || n > 2 ** 20 || (n & (n - 1)) !== 0) return null;
  if (r < 1 || r > 16 || p < 1 || p > 4) return null;
  if (128 * n * r > MAX_MEMORY_BYTES) return null;
  const saltStr = parts[3] ?? '';
  const hashStr = parts[4] ?? '';
  if (!B64URL.test(saltStr) || !B64URL.test(hashStr)) return null;
  const salt = Buffer.from(saltStr, 'base64url');
  const hash = Buffer.from(hashStr, 'base64url');
  if (salt.length < 8 || salt.length > 64 || hash.length < 16 || hash.length > 64) return null;
  return { n, r, p, salt, hash };
}

export async function hashPassword(password: string): Promise<string> {
  const { n, r, p, keyLen, saltLen } = SCRYPT_PARAMS;
  const salt = randomBytes(saltLen);
  const key = await scryptAsync(password, salt, keyLen, { N: n, r, p, maxmem: SCRYPT_MAXMEM });
  return `scrypt$v=1$n=${n},r=${r},p=${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** Chuỗi lưu sai dạng / tham số ngoài khoảng / bị sửa → `false` (không throw, không log chuỗi). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStored(stored);
  if (parsed === null) return false;
  try {
    const key = await scryptAsync(password, parsed.salt, parsed.hash.length, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
      maxmem: 2 * SCRYPT_MAXMEM,
    });
    return key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash);
  } catch {
    return false;
  }
}

/** `false` khi chuỗi lưu sai dạng / tham số ngoài khoảng ADR-022 (service log `password_hash_invalid`). */
export function isStoredHashValid(stored: string): boolean {
  return parseStored(stored) !== null;
}

/** `true` khi tham số của chuỗi lưu khác tham số hiện tại (hoặc chuỗi không đọc được). */
export function needsRehash(stored: string): boolean {
  const parsed = parseStored(stored);
  if (parsed === null) return true;
  return (
    parsed.n !== SCRYPT_PARAMS.n ||
    parsed.r !== SCRYPT_PARAMS.r ||
    parsed.p !== SCRYPT_PARAMS.p ||
    parsed.hash.length !== SCRYPT_PARAMS.keyLen
  );
}

// Hash giả cho email không tồn tại (thời gian phản hồi tương đương). Sinh một lần; server.ts gọi
// `warmupDummyHash()` lúc khởi động. Mật khẩu của nó là chuỗi ngẫu nhiên bị bỏ đi.
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64url'));
  return dummyHash;
}
export async function warmupDummyHash(): Promise<void> {
  await getDummyHash();
}
