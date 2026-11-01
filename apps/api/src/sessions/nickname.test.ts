import { describe, expect, it } from 'vitest';
import { normalizeNickname } from './nickname.ts';

describe('normalizeNickname', () => {
  it.each([
    ['  Lan  ', 'Lan'],
    ['Minh   Anh', 'Minh Anh'],
    ['Lan  Anh', 'Lan Anh'],
    ['Minh_2', 'Minh_2'],
    ['a.b-c', 'a.b-c'],
    ['é', 'é'],
    ['Nguyễn Văn Ệ', 'Nguyễn Văn Ệ'],
    ['Nguyễn Văn', 'Nguyễn Văn'],
    ['Trần Thị Ặ', 'Trần Thị Ặ'],
    ['x'.repeat(20), 'x'.repeat(20)],
    ['日本語', '日本語'],
  ])('accepts %j', (raw, expected) => {
    const r = normalizeNickname(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.name).toBe(expected.normalize('NFC'));
  });

  it('player key is lowercase of the normalized name', () => {
    expect(normalizeNickname('  Lan   NGUYỄN ')).toEqual({
      ok: true,
      name: 'Lan NGUYỄN',
      key: 'lan nguyễn',
    });
    const a = normalizeNickname('Lan');
    const b = normalizeNickname('lAN');
    expect(a.ok && b.ok && a.key === b.key).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['21 chars', 'x'.repeat(21)],
    ['html', 'a<b'],
    ['quote', "a'b"],
    ['ampersand', 'a&b'],
    ['rtl override', '‮abc'],
    ['zero width space', 'ab​'],
    ['zero width joiner', 'a‍b'],
    ['BOM inside', 'a﻿b'],
    ['control char', 'a\u0007b'],
    ['NUL', 'a\u0000b'],
    ['emoji', 'a\u{1f600}'],
    ['leading underscore', '_abc'],
    ['leading dash', '-abc'],
    ['leading dot', '.abc'],
    ['leading mark', '́abc'],
    ['a + 3 marks (separate)', 'à́̂'],
    ['precomposed a-grave + 2 marks', 'à́̂'],
    ['x + 3 marks', 'x̀́̂'],
    ['zalgo', 'z̀́̂̃̄'],
  ])('rejects %s', (_label, raw) => {
    expect(normalizeNickname(raw).ok).toBe(false);
  });

  // Bảng ca chung với frontend (repo FE play-sprint: src/features/scoring/nickname).
  it.each([
    ['newline', 'a\nb'],
    ['newline between words', 'Lan\nAnh'],
    ['tab between words', 'Lan\tAnh'],
    ['leading newline', '\nLan'],
    ['trailing CR', 'Lan\r'],
    ['NUL', 'La\u0000n'],
    ['tab', 'a\tb'],
    ['carriage return', 'a\rb'],
    ['NBSP', 'a\u00A0b'],
    ['ideographic space', 'a\u3000b'],
    ['trailing newline', 'Lan\n'],
    ['BOM leading', '﻿Lan'],
    ['BOM trailing', 'Lan﻿'],
    ['BOM middle', 'La﻿n'],
    ['Hangul filler U+3164', 'ㅤ'],
    ['Hangul filler then name', 'ㅤLan'],
    ['name then U+115F', 'Lanᅟ'],
    ['U+1160', 'Laᅠn'],
    ['halfwidth filler U+FFA0', 'ﾠ'],
    ['Braille blank U+2800', 'Lan⠀'],
    ['Khmer U+17B4', 'La឴n'],
    ['Khmer U+17B5', 'La឵n'],
    ['Mongolian vowel separator', 'La᠎n'],
    ['a + 3 combining (separate)', 'à́̂'],
    ['a-grave + 2 combining', 'à́̂'.normalize('NFC')],
  ])('rejects invisible/forbidden: %s', (_label, raw) => {
    expect(normalizeNickname(raw).ok).toBe(false);
  });

  it('shared accept cases', () => {
    for (const [raw, name] of [
      ['Nguyễn Văn Ệ', 'Nguyễn Văn Ệ'],
      ['Trần Thị Ặ', 'Trần Thị Ặ'],
      ['  Lan  ', 'Lan'],
      ['Lan Anh', 'Lan Anh'],
    ] as const) {
      const r = normalizeNickname(raw);
      expect(r.ok && r.name).toBe(name.normalize('NFC'));
    }
  });

  it('counts code points, not UTF-16 units', () => {
    const astral = '\u{1d504}';
    expect(normalizeNickname(astral.repeat(20)).ok).toBe(true);
    expect(normalizeNickname(astral.repeat(21)).ok).toBe(false);
  });

  it('allows up to 2 stacked marks', () => {
    expect(normalizeNickname('x̀́').ok).toBe(true);
  });
});
