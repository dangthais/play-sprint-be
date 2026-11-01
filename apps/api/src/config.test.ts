import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('uses defaults', () => {
    expect(loadConfig({})).toEqual({
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
      webOrigin: 'http://localhost:5173',
      gameOrigin: 'http://localhost:5174',
      trustProxy: false,
      cookieSecure: false,
      cleanupIntervalMinutes: 60,
    });
  });

  it('reads values and normalizes trailing slash', () => {
    const c = loadConfig({
      PORT: '3999',
      DATABASE_URL: 'x',
      WEB_ORIGIN: 'https://qp.example.com/',
      GAME_ORIGIN: 'http://games.example.com:8080',
    });
    expect(c.port).toBe(3999);
    expect(c.databaseUrl).toBe('x');
    expect(c.webOrigin).toBe('https://qp.example.com');
    expect(c.gameOrigin).toBe('http://games.example.com:8080');
  });

  it.each([
    'ftp://a.com',
    'not a url',
    'http://a.com/path',
    'http://a.com/x/',
    'http://a.com?q=1',
    'http://a.com#x',
    'http://u:p@a.com',
    'javascript:alert(1)',
  ])('throws on bad origin %s', (bad) => {
    expect(() => loadConfig({ WEB_ORIGIN: bad })).toThrow(/WEB_ORIGIN/);
    expect(() => loadConfig({ GAME_ORIGIN: bad })).toThrow(/GAME_ORIGIN/);
  });

  it('throws when GAME_ORIGIN equals WEB_ORIGIN after normalization', () => {
    expect(() =>
      loadConfig({ WEB_ORIGIN: 'http://localhost:5173', GAME_ORIGIN: 'http://localhost:5173/' }),
    ).toThrow(/GAME_ORIGIN/);
    expect(() =>
      loadConfig({ WEB_ORIGIN: 'http://LOCALHOST:80', GAME_ORIGIN: 'http://localhost' }),
    ).toThrow(/GAME_ORIGIN/);
    expect(() => loadConfig({ GAME_ORIGIN: 'http://localhost:5173' })).toThrow(/GAME_ORIGIN/);
  });

  it('throws on bad port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
  });

  describe('COOKIE_SECURE', () => {
    it.each([
      [undefined, 'http://localhost:5173', false],
      ['', 'http://localhost:5173', false],
      ['  ', 'https://qp.example.com', true],
      [undefined, 'https://qp.example.com', true],
      ['true', 'http://localhost:5173', true],
      ['TRUE', 'https://qp.example.com', true],
      ['false', 'http://localhost:5173', false],
      [' False ', 'http://localhost:5173', false],
    ])('parses %j with WEB_ORIGIN %s', (raw, web, expected) => {
      const env: Record<string, string> = { WEB_ORIGIN: web, GAME_ORIGIN: 'http://127.0.0.1:5174' };
      if (raw !== undefined) env.COOKIE_SECURE = raw;
      expect(loadConfig(env).cookieSecure).toBe(expected);
    });

    it.each(['1', 'yes', 'on', '0', 'secure'])('throws on %j', (bad) => {
      expect(() => loadConfig({ COOKIE_SECURE: bad })).toThrow(/COOKIE_SECURE/);
    });

    it('throws when Secure cookies and GAME_ORIGIN shares the hostname of WEB_ORIGIN (cookies ignore ports)', () => {
      expect(() =>
        loadConfig({
          WEB_ORIGIN: 'https://qp.example.com',
          GAME_ORIGIN: 'https://qp.example.com:8443',
        }),
      ).toThrow(/GAME_ORIGIN/);
      expect(() =>
        loadConfig({
          WEB_ORIGIN: 'http://localhost:5173',
          GAME_ORIGIN: 'http://LOCALHOST:5174',
          COOKIE_SECURE: 'true',
        }),
      ).toThrow(/GAME_ORIGIN/);
      // cookie không Secure (dev HTTP): giữ hành vi cũ
      expect(loadConfig({}).gameOrigin).toBe('http://localhost:5174');
      expect(
        loadConfig({
          WEB_ORIGIN: 'https://qp.example.com',
          GAME_ORIGIN: 'https://games.example.com',
        }).cookieSecure,
      ).toBe(true);
    });

    it('throws when false but WEB_ORIGIN is https (fail fast)', () => {
      expect(() =>
        loadConfig({ WEB_ORIGIN: 'https://qp.example.com', COOKIE_SECURE: 'false' }),
      ).toThrow(/COOKIE_SECURE/);
    });
  });

  describe('TRUST_PROXY', () => {
    it.each([
      [undefined, false],
      ['', false],
      ['  ', false],
      ['0', false],
      ['1', 1],
      ['2', 2],
      ['10.0.0.1', ['10.0.0.1']],
      ['10.0.0.0/8, 192.168.1.5', ['10.0.0.0/8', '192.168.1.5']],
      ['::1,fd00::/8', ['::1', 'fd00::/8']],
    ])('parses %j', (raw, expected) => {
      const env = raw === undefined ? {} : { TRUST_PROXY: raw };
      expect(loadConfig(env).trustProxy).toEqual(expected);
    });

    it.each([
      'true',
      'TRUE',
      ' True ',
      'abc',
      '10.0.0.1,',
      '10.0.0.0/33',
      '1.2.3',
      '-1',
      '1.5',
      '999',
    ])('throws on %j', (bad) => {
      expect(() => loadConfig({ TRUST_PROXY: bad })).toThrow(/TRUST_PROXY/);
    });
  });

  describe('CLEANUP_INTERVAL_MINUTES', () => {
    it.each([
      [undefined, 60],
      ['', 60],
      ['0', 0],
      ['5', 5],
      [' 1440 ', 1440],
    ])('parses %j', (raw, expected) => {
      const env = raw === undefined ? {} : { CLEANUP_INTERVAL_MINUTES: raw };
      expect(loadConfig(env).cleanupIntervalMinutes).toBe(expected);
    });

    it.each(['abc', '-1', '1.5', '1441', '99999'])('throws on %j', (bad) => {
      expect(() => loadConfig({ CLEANUP_INTERVAL_MINUTES: bad })).toThrow(
        /CLEANUP_INTERVAL_MINUTES/,
      );
    });
  });
});
