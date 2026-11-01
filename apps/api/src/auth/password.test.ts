import { randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, SCRYPT_PARAMS, verifyPassword } from './password.ts';

const PREFIX = 'scrypt$v=1$n=32768,r=8,p=1$';

function legacyHash(password: string, n: number): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, { N: n, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  return `scrypt$v=1$n=${n},r=8,p=1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

describe('password (AC15)', () => {
  it('hash has the documented format and parameters', async () => {
    const h = await hashPassword('mat-khau-dai-9');
    expect(h.startsWith(PREFIX)).toBe(true);
    const parts = h.split('$');
    expect(parts).toHaveLength(5);
    expect(Buffer.from(parts[3] as string, 'base64url')).toHaveLength(SCRYPT_PARAMS.saltLen);
    expect(Buffer.from(parts[4] as string, 'base64url')).toHaveLength(SCRYPT_PARAMS.keyLen);
    expect(h.length).toBeLessThanOrEqual(200);
    expect(h).not.toContain('mat-khau');
  });

  it('hashing the same password twice gives different strings (random salt)', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same-password'),
      hashPassword('same-password'),
    ]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('verifies correct and rejects wrong passwords', async () => {
    const h = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('correct horse ', h)).toBe(false);
    expect(await verifyPassword('Correct horse', h)).toBe(false);
    expect(await verifyPassword('', h)).toBe(false);
  });

  it('tampered / malformed / out-of-range stored strings return false without throwing', async () => {
    const h = await hashPassword('pw-12345');
    const parts = h.split('$');
    const flipped = `${parts.slice(0, 4).join('$')}$${(parts[4] as string).replace(/^./, (c) => (c === 'A' ? 'B' : 'A'))}`;
    const bad = [
      flipped,
      '',
      'scrypt',
      'bcrypt$v=1$n=32768,r=8,p=1$YQ$YQ',
      h.replace('v=1', 'v=2'),
      h.replace('n=32768', 'n=32767'), // không phải lũy thừa 2
      h.replace('n=32768', 'n=8192'), // dưới 2^14
      h.replace('n=32768', 'n=2097152'), // trên 2^20
      h.replace('r=8', 'r=17'),
      h.replace('r=8', 'r=0'),
      h.replace('p=1', 'p=5'),
      h.replace('n=32768,r=8,p=1', 'n=1048576,r=16,p=1'), // trong khoảng ADR nhưng quá tốn bộ nhớ
      `${parts.slice(0, 4).join('$')}$`,
      `${parts.slice(0, 3).join('$')}$$${parts[4]}`,
      `${h}$extra`,
      h.replace(/.$/, '!'),
      'x'.repeat(500),
    ];
    for (const stored of bad) {
      await expect(verifyPassword('pw-12345', stored)).resolves.toBe(false);
    }
  });

  it('needsRehash is true when parameters differ from the current ones', async () => {
    const h = await hashPassword('pw-12345');
    expect(needsRehash(h)).toBe(false);
    const old = legacyHash('pw-12345', 2 ** 14);
    expect(needsRehash(old)).toBe(true);
    expect(await verifyPassword('pw-12345', old)).toBe(true); // vẫn verify theo tham số lưu
    expect(needsRehash('garbage')).toBe(true);
  });

  it('NFC and NFD forms of the same Vietnamese password are interchangeable after NFC normalization', async () => {
    const nfc = 'mậtkhẩu12'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    expect(nfc).not.toBe(nfd);
    // Chuẩn hoá là việc của lớp trên (credentials.normalizePassword); ở đây xác nhận hash theo bytes.
    const h = await hashPassword(nfc);
    expect(await verifyPassword(nfd.normalize('NFC'), h)).toBe(true);
    expect(await verifyPassword(nfd, h)).toBe(false);
  });
});
