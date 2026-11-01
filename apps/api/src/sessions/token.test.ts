import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, SESSION_TOKEN_PATTERN } from './token.ts';

describe('token', () => {
  it('generates 43-char base64url tokens, unique', () => {
    const a = generateToken();
    expect(a).toMatch(SESSION_TOKEN_PATTERN);
    expect(a).toHaveLength(43);
    expect(generateToken()).not.toBe(a);
  });

  it('hashes to a deterministic 32-byte sha256 Buffer', () => {
    const h = hashToken('abc');
    expect(Buffer.isBuffer(h)).toBe(true);
    expect(h).toHaveLength(32);
    expect(h.toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashToken('abc').equals(h)).toBe(true);
    expect(hashToken('abd').equals(h)).toBe(false);
  });
});
