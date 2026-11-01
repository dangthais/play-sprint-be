import { describe, expect, it } from 'vitest';
import { normalizeEmail, normalizePassword } from './credentials.ts';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Lan@Example.COM ')).toBe('lan@example.com');
    expect(normalizeEmail('a.b+c_d%e-f@sub.example.co')).toBe('a.b+c_d%e-f@sub.example.co');
  });

  it.each([
    ['a@b', 'no dot in domain'],
    ['a b@c.de', 'space'],
    ['lan@ví.dụ', 'non-ASCII'],
    ['lán@example.com', 'non-ASCII local part'],
    [`${'a'.repeat(250)}@b.cc`, 'too long'],
    [`${'a'.repeat(65)}@b.cc`, 'local part > 64'],
    ['@b.cc', 'empty local'],
    ['a@.cc', 'empty label'],
    ['a@b..cc', 'double dot'],
    ['a@b.cc.', 'trailing dot'],
    ['', 'empty'],
    ['   ', 'blank'],
    ['a@b@c.dd', 'two @'],
    ['Kelvin@example.com', 'Kelvin sign would lowercase to ASCII k'],
  ])('rejects %j (%s)', (raw) => {
    expect(normalizeEmail(raw)).toBeNull();
  });

  it('accepts a 254-char email and rejects 255', () => {
    const label = 'a'.repeat(63);
    const tail = 'b'.repeat(61);
    const email254 = `${'x'.repeat(64)}@${label}.${label}.${tail}`;
    expect(email254.length).toBe(254);
    expect(normalizeEmail(email254)).toBe(email254);
    expect(normalizeEmail(`${email254}b`)).toBeNull();
  });
});

describe('normalizePassword', () => {
  it('enforces 8..128 code points (min 8) after NFC', () => {
    expect(normalizePassword('1234567', 8)).toBeNull();
    expect(normalizePassword('12345678', 8)).toBe('12345678');
    expect(normalizePassword('a'.repeat(128), 8)).toBe('a'.repeat(128));
    expect(normalizePassword('a'.repeat(129), 8)).toBeNull();
  });

  it('min 1 for login / current password', () => {
    expect(normalizePassword('', 1)).toBeNull();
    expect(normalizePassword('x', 1)).toBe('x');
  });

  it('does not trim', () => {
    expect(normalizePassword('  pass  ', 1)).toBe('  pass  ');
  });

  it('counts code points, not UTF-16 units', () => {
    expect(normalizePassword('😀'.repeat(8), 8)).toBe('😀'.repeat(8));
    expect(normalizePassword('😀'.repeat(128), 8)).not.toBeNull();
    expect(normalizePassword('😀'.repeat(129), 8)).toBeNull();
  });

  it('normalizes NFD to NFC', () => {
    const nfd = 'mậtkhẩu12'.normalize('NFD');
    expect(normalizePassword(nfd, 8)).toBe('mậtkhẩu12'.normalize('NFC'));
  });

  it('rejects lone surrogates', () => {
    expect(normalizePassword('abcdefg\ud800', 8)).toBeNull();
  });
});
