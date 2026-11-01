import { isIP } from 'node:net';

export type TrustProxy = false | number | string[];

export interface Config {
  host: string;
  port: number;
  logLevel: string;
  databaseUrl?: string;
  webOrigin: string;
  gameOrigin: string;
  trustProxy: TrustProxy;
  /** ADR-023: cookie đăng nhập có `Secure` + tên `__Host-qp_sid` (true) hay `qp_sid` (false, dev HTTP). */
  cookieSecure: boolean;
  /** ADR-035: chu kỳ job dọn phiên (phút); 0 = tắt. */
  cleanupIntervalMinutes: number;
}

function parseOrigin(name: string, value: string): string {
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
  // Chấp nhận "http://host" và "http://host/" nhưng không chấp nhận "http://host?" hay "http://host#".
  if (!clean || /[?#]/.test(value)) {
    throw new Error(`${name} must be an origin without path, query or credentials`);
  }
  return url.origin;
}

function isIpOrCidr(entry: string): boolean {
  const slash = entry.indexOf('/');
  if (slash === -1) return isIP(entry) !== 0;
  const ip = entry.slice(0, slash);
  const prefix = entry.slice(slash + 1);
  const version = isIP(ip);
  if (version === 0 || !/^[0-9]{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (version === 4 ? 32 : 128);
}

export function parseTrustProxy(raw: string | undefined): TrustProxy {
  const value = (raw ?? '').trim();
  if (value === '' || value.toLowerCase() === 'false') return false;
  if (value.toLowerCase() === 'true') {
    throw new Error('TRUST_PROXY=true is not allowed; use a hop count or a list of proxy IP/CIDR');
  }
  if (/^[0-9]+$/.test(value)) {
    const hops = Number(value);
    if (!Number.isSafeInteger(hops) || hops > 32) {
      throw new Error('TRUST_PROXY hop count must be an integer between 0 and 32');
    }
    return hops === 0 ? false : hops;
  }
  const list = value.split(',').map((s) => s.trim());
  if (list.some((s) => s === '' || !isIpOrCidr(s))) {
    throw new Error('TRUST_PROXY must be empty, a hop count, or a comma-separated list of IP/CIDR');
  }
  return list;
}

/**
 * `COOKIE_SECURE`: rỗng/thiếu → suy từ WEB_ORIGIN (https → true). `true`/`false` (không phân biệt hoa
 * thường) → dùng đúng giá trị; giá trị khác → throw. `false` khi WEB_ORIGIN là https → throw.
 */
export function parseCookieSecure(raw: string | undefined, webOrigin: string): boolean {
  const httpsWeb = webOrigin.startsWith('https:');
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return httpsWeb;
  if (value !== 'true' && value !== 'false') {
    throw new Error('COOKIE_SECURE must be empty, "true" or "false"');
  }
  if (value === 'false' && httpsWeb) {
    throw new Error('COOKIE_SECURE=false is not allowed when WEB_ORIGIN uses https');
  }
  return value === 'true';
}

/** `CLEANUP_INTERVAL_MINUTES`: rỗng/thiếu → 60; số nguyên 0..1440 (0 = tắt); khác → throw. */
export function parseCleanupInterval(raw: string | undefined): number {
  const value = (raw ?? '').trim();
  if (value === '') return 60;
  if (!/^[0-9]{1,4}$/.test(value) || Number(value) > 1440) {
    throw new Error('CLEANUP_INTERVAL_MINUTES must be an integer between 0 and 1440');
  }
  return Number(value);
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const port = env.PORT === undefined || env.PORT === '' ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535');
  }
  const webOrigin = parseOrigin('WEB_ORIGIN', env.WEB_ORIGIN || 'http://localhost:5173');
  const gameOrigin = parseOrigin('GAME_ORIGIN', env.GAME_ORIGIN || 'http://localhost:5174');
  if (gameOrigin === webOrigin) {
    throw new Error('GAME_ORIGIN must differ from WEB_ORIGIN');
  }
  const cookieSecure = parseCookieSecure(env.COOKIE_SECURE, webOrigin);
  // Cookie không phân biệt port: cùng hostname thì cookie phiên (host-only) sẽ được gửi tới game.
  if (cookieSecure && new URL(gameOrigin).hostname === new URL(webOrigin).hostname) {
    throw new Error(
      'GAME_ORIGIN must have a different hostname than WEB_ORIGIN when cookies are Secure',
    );
  }
  const config: Config = {
    host: env.HOST || '127.0.0.1',
    port,
    logLevel: env.LOG_LEVEL || 'info',
    webOrigin,
    gameOrigin,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    cookieSecure,
    cleanupIntervalMinutes: parseCleanupInterval(env.CLEANUP_INTERVAL_MINUTES),
  };
  if (env.DATABASE_URL) config.databaseUrl = env.DATABASE_URL;
  return config;
}
