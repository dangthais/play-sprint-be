import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCsp, createGamesServer, loadGamesConfig } from './games-server.ts';

const WEB = 'http://localhost:5173';
const GAME = 'http://localhost:5174';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

const GAME_IDS = [
  'snake',
  'merge-2048',
  'tic-tac-toe',
  'memory-match',
  'brick-breaker',
  'maze-chomp',
  'sky-hop',
  'block-drop',
  'space-shooter',
  'asteroid-blaster',
  'frog-crossing',
  'bubble-pop',
  'mole-smash',
  'typing-race',
  'simon-says',
  'minesweeper',
  'sliding-puzzle',
  'code-breaker',
  'word-guess',
  'reversi',
  'chess',
  'checkers',
  'sudoku',
  'solitaire',
  'sea-battle',
];

let server: http.Server;
let port: number;

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

// Dùng http.request với path thô (fetch sẽ chuẩn hoá "..").
function request(rawPath: string, method = 'GET'): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  server = createGamesServer({ root, webOrigin: WEB, gameOrigin: GAME });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('config', () => {
  it('chấp nhận mặc định và chuẩn hoá origin', () => {
    const cfg = loadGamesConfig({ WEB_ORIGIN: 'http://localhost:5173/' });
    expect(cfg).toEqual({
      host: '127.0.0.1',
      port: 5174,
      webOrigin: WEB,
      gameOrigin: GAME,
    });
  });

  it('từ chối origin không hợp lệ hoặc trùng nhau', () => {
    expect(() => loadGamesConfig({ GAME_ORIGIN: 'ftp://x' })).toThrow();
    expect(() => loadGamesConfig({ GAME_ORIGIN: 'http://localhost:5174/path' })).toThrow();
    expect(() => loadGamesConfig({ WEB_ORIGIN: 'not a url' })).toThrow();
    expect(() =>
      loadGamesConfig({
        WEB_ORIGIN: 'http://localhost:5174',
        GAME_ORIGIN: 'http://LOCALHOST:5174/',
      }),
    ).toThrow(/differ/);
    expect(() => loadGamesConfig({ GAMES_PORT: 'abc' })).toThrow();
    expect(() => createGamesServer({ root, webOrigin: WEB, gameOrigin: WEB })).toThrow();
  });
});

describe('path traversal và allowlist', () => {
  const blocked = [
    '/games/%2e%2e/%2e%2e/package.json',
    '/games/..%2f..%2fpackage.json',
    '/games/..%5c..%5cpackage.json',
    '/..%2f..%2fpackage.json',
    '/../package.json',
    '/../../package.json',
    '/games/snake/../../../package.json',
    '/src/server.ts',
    '/games/snake/.hidden',
    '/games/.git/config',
    '/games/snake/script.ts',
    '/package.json',
    '/games/snake/%00.html',
    '/games//snake/',
    '/games/snake/index.html::$DATA',
    '/C:/Windows/win.ini',
  ];
  for (const p of blocked) {
    it(`từ chối ${p}`, async () => {
      const r = await request(p);
      expect([400, 404]).toContain(r.status);
      expect(r.body).not.toContain('"name"');
      expect(r.body).not.toMatch(/[A-Za-z]:\\|apps[\\/]games/);
    });
  }

  it('decode lỗi trả 400', async () => {
    expect((await request('/games/%E0%A4%A')).status).toBe(400);
  });

  it('không liệt kê thư mục', async () => {
    expect((await request('/')).status).toBe(404);
    expect((await request('/games/')).status).toBe(404);
    expect((await request('/sdk/')).status).toBe(404);
  });
});

describe('phục vụ file', () => {
  it('/games/LICENSE.txt trả 200 text/plain', async () => {
    const r = await request('/games/LICENSE.txt');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(r.body).toContain('MIT License');
  });

  it('/games/<id> chuyển hướng 301 sang dạng có "/"', async () => {
    const r = await request('/games/snake');
    expect(r.status).toBe(301);
    expect(r.headers.location).toBe('/games/snake/');
  });

  for (const id of GAME_IDS) {
    it(`/games/${id}/ trả index.html`, async () => {
      const r = await request(`/games/${id}/`);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
      const iConfig = r.body.indexOf('/sdk/config.js');
      const iSdk = r.body.indexOf('/sdk/qp-sdk.js');
      expect(iConfig).toBeGreaterThan(-1);
      expect(iSdk).toBeGreaterThan(iConfig);
    });
  }

  it('/sdk/qp-sdk.js trả JS', async () => {
    const r = await request('/sdk/qp-sdk.js');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8');
  });

  it('ảnh PNG đúng Content-Type', async () => {
    const r = await request('/games/memory-match/images/img-1.png');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
  });

  it('HEAD không có body nhưng có header', async () => {
    const r = await request('/games/snake/', 'HEAD');
    expect(r.status).toBe(200);
    expect(r.body).toBe('');
    expect(Number(r.headers['content-length'])).toBeGreaterThan(0);
  });

  it('file không tồn tại trả 404 ngắn gọn', async () => {
    const r = await request('/games/snake/nope.js');
    expect(r.status).toBe(404);
    expect(r.body).toBe('Not Found');
  });
});

describe('method', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    it(`${method} trả 405`, async () => {
      const r = await request('/games/snake/', method);
      expect(r.status).toBe(405);
      expect(r.headers.allow).toBe('GET, HEAD');
    });
  }
});

describe('/sdk/config.js', () => {
  it('sinh động từ WEB_ORIGIN, không cache', async () => {
    const r = await request('/sdk/config.js');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(r.body).toBe(`self.QP_CONFIG = Object.freeze({"hostOrigin":"${WEB}"});\n`);
  });
});

describe('header bảo mật', () => {
  const paths = [
    '/games/snake/',
    '/sdk/qp-sdk.js',
    '/sdk/config.js',
    '/games/snake',
    '/nope',
    '/../package.json',
    '/games/snake/',
  ];
  for (const p of paths) {
    it(`mọi response có CSP/nosniff/no-referrer: ${p}`, async () => {
      const r = await request(p);
      expect(r.headers['content-security-policy']).toBe(buildCsp(WEB, GAME));
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(r.headers['cross-origin-resource-policy']).toBeUndefined();
      expect(r.headers['x-frame-options']).toBeUndefined();
    });
  }

  it('405 cũng có header bảo mật', async () => {
    const r = await request('/games/snake/', 'POST');
    expect(r.headers['content-security-policy']).toBeDefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('CSP ghi tường minh origin, chặn kết nối, không unsafe-inline cho script', () => {
    const csp = buildCsp(WEB, GAME);
    expect(csp).toContain(`script-src 'self' ${GAME};`);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain(`frame-ancestors ${WEB}`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
    const script = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(script).not.toContain('unsafe');
  });

  it('trang tĩnh dùng Cache-Control: no-cache', async () => {
    const r = await request('/games/snake/');
    expect(r.headers['cache-control']).toBe('no-cache');
  });
});
