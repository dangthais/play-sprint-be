import { describe, expect, it } from 'vitest';
import {
  cookieNameFor,
  hasCookie,
  readAllSessionCookies,
  readSessionCookie,
  serializeClearCookie,
  serializeSessionCookie,
} from './cookie.ts';

const TOKEN = 'A'.repeat(43);
const TOKEN2 = 'B-_'.repeat(14) + 'B';

describe('cookie', () => {
  it('names depend on Secure', () => {
    expect(cookieNameFor(true)).toBe('__Host-qp_sid');
    expect(cookieNameFor(false)).toBe('qp_sid');
  });

  it('serializes with the documented attributes and no Domain', () => {
    expect(serializeSessionCookie('qp_sid', TOKEN, false)).toBe(
      `qp_sid=${TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
    );
    const secure = serializeSessionCookie('__Host-qp_sid', TOKEN, true);
    expect(secure).toBe(
      `__Host-qp_sid=${TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure`,
    );
    expect(secure).not.toMatch(/Domain/i);
  });

  it('refuses to serialize a value that is not a known base64url token', () => {
    expect(() => serializeSessionCookie('qp_sid', 'abc; Domain=evil', false)).toThrow();
    expect(() => serializeSessionCookie('qp_sid', 'A'.repeat(42), false)).toThrow();
  });

  it('clear cookie has Max-Age=0 and the same attributes', () => {
    expect(serializeClearCookie('qp_sid', false)).toBe(
      'qp_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    );
    expect(serializeClearCookie('__Host-qp_sid', true)).toBe(
      '__Host-qp_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure',
    );
  });

  it('reads a valid cookie among others (spaces around ; and =)', () => {
    expect(readSessionCookie(`a=1; qp_sid=${TOKEN}; b=2`, 'qp_sid')).toBe(TOKEN);
    expect(readSessionCookie(`qp_sid=${TOKEN}`, 'qp_sid')).toBe(TOKEN);
    expect(readSessionCookie(`a=1;qp_sid=${TOKEN2}`, 'qp_sid')).toBe(TOKEN2);
  });

  it('missing, malformed, wrong-length or duplicated cookie -> null', () => {
    expect(readSessionCookie(undefined, 'qp_sid')).toBeNull();
    expect(readSessionCookie('', 'qp_sid')).toBeNull();
    expect(readSessionCookie('a=1', 'qp_sid')).toBeNull();
    expect(readSessionCookie('qp_sid=short', 'qp_sid')).toBeNull();
    expect(readSessionCookie(`qp_sid=${TOKEN}x`, 'qp_sid')).toBeNull();
    expect(readSessionCookie(`qp_sid=${'!'.repeat(43)}`, 'qp_sid')).toBeNull();
    expect(readSessionCookie(`qp_sid=${TOKEN}; qp_sid=${TOKEN2}`, 'qp_sid')).toBeNull();
    expect(readSessionCookie(`qp_sid=${TOKEN}; qp_sid=${TOKEN}`, 'qp_sid')).toBeNull();
  });

  it('does not confuse similarly named cookies', () => {
    expect(readSessionCookie(`__Host-qp_sid=${TOKEN}`, 'qp_sid')).toBeNull();
    expect(readSessionCookie(`xqp_sid=${TOKEN}`, 'qp_sid')).toBeNull();
    expect(readSessionCookie(`qp_sid=${TOKEN}`, '__Host-qp_sid')).toBeNull();
  });

  it('readAllSessionCookies: all well-formed distinct values, max 3, ignores junk', () => {
    expect(readAllSessionCookies(undefined, 'qp_sid')).toEqual([]);
    expect(readAllSessionCookies(`qp_sid=${TOKEN}`, 'qp_sid')).toEqual([TOKEN]);
    expect(
      readAllSessionCookies(
        `qp_sid=${TOKEN}; qp_sid=junk; qp_sid=${TOKEN}; qp_sid=${TOKEN2}`,
        'qp_sid',
      ),
    ).toEqual([TOKEN, TOKEN2]);
    const t3 = 'C'.repeat(43);
    const t4 = 'D'.repeat(43);
    expect(
      readAllSessionCookies(
        `qp_sid=${TOKEN}; qp_sid=${TOKEN2}; qp_sid=${t3}; qp_sid=${t4}`,
        'qp_sid',
      ),
    ).toEqual([TOKEN, TOKEN2, t3]);
  });

  it('hasCookie is true for any value of that name', () => {
    expect(hasCookie('qp_sid=junk', 'qp_sid')).toBe(true);
    expect(hasCookie('qp_sid=', 'qp_sid')).toBe(true);
    expect(hasCookie('other=1', 'qp_sid')).toBe(false);
    expect(hasCookie(undefined, 'qp_sid')).toBe(false);
    expect(hasCookie('__Host-qp_sid=x', 'qp_sid')).toBe(false);
  });
});
