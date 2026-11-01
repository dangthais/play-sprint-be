// Chuẩn hoá + validate nickname (ADR-018). FE dùng cùng quy tắc để báo lỗi sớm.

const NICKNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} _.-]*$/u;
const MARK_RUN = /\p{M}{3,}/u;
// Khoảng trắng hợp lệ duy nhất là U+0020. Trên chuỗi thô bị từ chối: ký tự điều khiển (\p{Cc}, gồm
// \n \r \t), ký tự định dạng (\p{Cf}) và mọi khoảng trắng khác U+0020 (U+00A0, U+3000, ...).
const FORBIDDEN_CHARS = /[\p{Cc}\p{Cf}]|[^\S ]/u;
const SPACE_RUN = / {2,}/g;
// Ký tự "chữ" (\p{L}) hoặc định dạng nhưng vô hình / trông như khoảng trắng: Hangul filler
// (U+115F, U+1160, U+3164, U+FFA0), Braille blank (U+2800), Khmer inherent vowel (U+17B4, U+17B5),
// Mongolian vowel separator (U+180E), BOM (U+FEFF). Viết bằng mã số để file không chứa ký tự vô hình.
const FORBIDDEN_CODE_POINTS = new Set([
  0x115f, 0x1160, 0x3164, 0xffa0, 0x2800, 0x17b4, 0x17b5, 0x180e, 0xfeff,
]);
export const NICKNAME_MAX_CODE_POINTS = 20;

export type NicknameResult = { ok: true; name: string; key: string } | { ok: false };

function hasForbiddenCodePoint(text: string): boolean {
  for (const ch of text) {
    if (FORBIDDEN_CODE_POINTS.has(ch.codePointAt(0)!)) return true;
  }
  return false;
}

export function normalizeNickname(raw: string): NicknameResult {
  // Kiểm trên chuỗi thô, trước trim(): `trim()` sẽ xoá im lặng BOM và khoảng trắng Unicode ở đầu/cuối.
  if (FORBIDDEN_CHARS.test(raw) || hasForbiddenCodePoint(raw)) return { ok: false };
  const trimmed = raw.trim();
  // Kiểm dấu kết hợp trên dạng thô và NFD (xem dưới): "a" + 3 dấu có thể ghép thành "à" + 2 dấu sau NFC.
  if (MARK_RUN.test(trimmed)) return { ok: false };
  const name = trimmed.normalize('NFC').replace(SPACE_RUN, ' ');
  const length = [...name].length;
  if (length < 1 || length > NICKNAME_MAX_CODE_POINTS) return { ok: false };
  if (!NICKNAME_PATTERN.test(name)) return { ok: false };
  // Cũng kiểm trên NFD (giống FE): NFC có thể gộp dấu vào chữ cái nên che mất chuỗi dấu dài.
  if (MARK_RUN.test(name.normalize('NFD'))) return { ok: false };
  return { ok: true, name, key: name.toLowerCase() };
}
