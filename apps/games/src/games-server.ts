import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export interface GamesConfig {
  host: string;
  port: number;
  webOrigin: string;
  gameOrigin: string;
}

export interface GamesServerOptions {
  /** Thư mục gốc được phục vụ (apps/games/public). */
  root: string;
  webOrigin: string;
  gameOrigin: string;
}

/** Chuẩn hoá và kiểm tra một origin http(s) (không path/query/credentials), giống apps/api. */
export function parseOrigin(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid http(s) origin`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https`);
  }
  const clean =
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === '';
  if (!clean || /[?#]/.test(value)) {
    throw new Error(`${name} must be an origin without path, query or credentials`);
  }
  return url.origin;
}

export function loadGamesConfig(env: NodeJS.ProcessEnv): GamesConfig {
  const port =
    env.GAMES_PORT === undefined || env.GAMES_PORT === '' ? 5174 : Number(env.GAMES_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('GAMES_PORT must be an integer between 0 and 65535');
  }
  const webOrigin = parseOrigin('WEB_ORIGIN', env.WEB_ORIGIN || 'http://localhost:5173');
  const gameOrigin = parseOrigin('GAME_ORIGIN', env.GAME_ORIGIN || 'http://localhost:5174');
  if (gameOrigin === webOrigin) {
    throw new Error('GAME_ORIGIN must differ from WEB_ORIGIN');
  }
  return { host: env.GAMES_HOST || '127.0.0.1', port, webOrigin, gameOrigin };
}

/**
 * CSP của trang game (ADR-013). Ghi tường minh GAME_ORIGIN cạnh 'self' vì tài liệu
 * trong iframe sandbox (không allow-same-origin) có origin opaque.
 * Script không có 'unsafe-inline'/'unsafe-eval'; style cần 'unsafe-inline' (Snake chèn style attr).
 */
export function buildCsp(webOrigin: string, gameOrigin: string): string {
  return [
    "default-src 'none'",
    `script-src 'self' ${gameOrigin}`,
    `style-src 'self' ${gameOrigin} 'unsafe-inline'`,
    `img-src 'self' ${gameOrigin}`,
    `font-src 'self' ${gameOrigin}`,
    `media-src 'self' ${gameOrigin}`,
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${webOrigin}`,
    // Giữ origin opaque kể cả khi trang game được mở trực tiếp ở top-level.
    'sandbox allow-scripts',
  ].join('; ');
}

const TEXT = 'text/plain; charset=utf-8';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.txt': TEXT,
};

type ParsedPath =
  { ok: true; segments: string[]; trailingSlash: boolean } | { ok: false; status: 400 | 404 };

/** Tách và giải mã path an toàn; từ chối mọi segment nguy hiểm. */
function parsePath(rawUrl: string | undefined): ParsedPath {
  if (!rawUrl || !rawUrl.startsWith('/')) return { ok: false, status: 400 };
  const rawPath = rawUrl.split('?')[0]!.split('#')[0]!;
  const parts = rawPath.slice(1).split('/');
  const segments: string[] = [];
  let trailingSlash = false;
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i]!;
    if (raw === '') {
      if (i === parts.length - 1) {
        trailingSlash = true;
        continue;
      }
      return { ok: false, status: 404 };
    }
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return { ok: false, status: 400 };
    }
    // Từ chối: ".", "..", dotfile, dấu phân cách (kể cả %2f, %5c), ":" (ổ đĩa/ADS Windows), ký tự điều khiển.
    // eslint-disable-next-line no-control-regex
    if (seg.startsWith('.') || /[\\/:\u0000-\u001f\u007f]/.test(seg)) {
      return { ok: false, status: 404 };
    }
    segments.push(seg);
  }
  return { ok: true, segments, trailingSlash };
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  405: 'Method Not Allowed',
  500: 'Internal Server Error',
};

export function createGamesServer(options: GamesServerOptions): Server {
  const webOrigin = parseOrigin('WEB_ORIGIN', options.webOrigin);
  const gameOrigin = parseOrigin('GAME_ORIGIN', options.gameOrigin);
  if (webOrigin === gameOrigin) {
    throw new Error('GAME_ORIGIN must differ from WEB_ORIGIN');
  }
  const root = path.resolve(options.root);
  const csp = buildCsp(webOrigin, gameOrigin);
  const configJs = `self.QP_CONFIG = Object.freeze(${JSON.stringify({ hostOrigin: webOrigin })});\n`;

  function send(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    headers: Record<string, string>,
    body: Buffer | string,
  ): void {
    const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    res.writeHead(status, {
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-cache',
      ...headers,
      'Content-Length': String(payload.length),
    });
    res.end(req.method === 'HEAD' ? undefined : payload);
  }

  function sendError(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    extra: Record<string, string> = {},
  ): void {
    send(req, res, status, { 'Content-Type': TEXT, ...extra }, STATUS_TEXT[status] ?? 'Error');
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendError(req, res, 405, { Allow: 'GET, HEAD' });
      return;
    }
    const parsed = parsePath(req.url);
    if (!parsed.ok) {
      sendError(req, res, parsed.status);
      return;
    }
    const { segments, trailingSlash } = parsed;

    if (
      !trailingSlash &&
      segments.length === 2 &&
      segments[0] === 'sdk' &&
      segments[1] === 'config.js'
    ) {
      send(
        req,
        res,
        200,
        { 'Content-Type': CONTENT_TYPES['.js']!, 'Cache-Control': 'no-store' },
        configJs,
      );
      return;
    }

    let target = path.resolve(root, ...segments);
    if (!isInside(root, target)) {
      sendError(req, res, 404);
      return;
    }
    let info;
    try {
      info = await stat(target);
    } catch {
      sendError(req, res, 404);
      return;
    }
    if (info.isDirectory()) {
      if (segments.length === 0) {
        sendError(req, res, 404); // không liệt kê/phục vụ thư mục gốc
        return;
      }
      if (!trailingSlash) {
        const location = '/' + segments.map(encodeURIComponent).join('/') + '/';
        send(req, res, 301, { Location: location, 'Content-Type': TEXT }, 'Moved Permanently');
        return;
      }
      target = path.join(target, 'index.html');
      try {
        info = await stat(target);
      } catch {
        sendError(req, res, 404);
        return;
      }
    } else if (trailingSlash) {
      sendError(req, res, 404);
      return;
    }
    const contentType = info.isFile()
      ? CONTENT_TYPES[path.extname(target).toLowerCase()]
      : undefined;
    if (!contentType) {
      sendError(req, res, 404);
      return;
    }
    // Chặn symlink trỏ ra ngoài root.
    const realTarget = await realpath(target);
    if (!isInside(await realpath(root), realTarget)) {
      sendError(req, res, 404);
      return;
    }
    send(req, res, 200, { 'Content-Type': contentType }, await readFile(realTarget));
  }

  return createServer((req, res) => {
    handle(req, res).catch(() => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendError(req, res, 500);
    });
  });
}
