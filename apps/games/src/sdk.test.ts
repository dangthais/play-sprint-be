import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/sdk/qp-sdk.js'),
  'utf8',
);

interface Sent {
  message: unknown;
  targetOrigin: unknown;
}

interface Qp {
  version: number;
  ready(): void;
  score(n: unknown): void;
  gameOver(n: unknown): void;
}

function load(opts: { embedded: boolean; config?: unknown; throwOnPost?: boolean }) {
  const sent: Sent[] = [];
  const parent = {
    postMessage(message: unknown, targetOrigin: unknown) {
      if (opts.throwOnPost) throw new Error('boom');
      sent.push({ message, targetOrigin });
    },
  };
  const win: Record<string, unknown> = { parent };
  win.window = win;
  if (!opts.embedded) win.parent = win;
  win.self = win;
  win.QP_CONFIG = opts.config;
  win.console = { warn() {} };
  win.URL = URL;
  win.Object = Object;
  win.Number = Number;
  vm.runInNewContext(source, win);
  return { sent, QP: win.QP as Qp };
}

const CONFIG = Object.freeze({ hostOrigin: 'http://localhost:5173' });

describe('qp-sdk', () => {
  it('gửi đúng message v1 tới hostOrigin cụ thể (không "*")', () => {
    const { sent, QP } = load({ embedded: true, config: CONFIG });
    QP.ready();
    QP.score(5);
    QP.gameOver(7);
    expect(sent).toEqual([
      { message: { qp: 1, type: 'ready' }, targetOrigin: 'http://localhost:5173' },
      { message: { qp: 1, type: 'score', score: 5 }, targetOrigin: 'http://localhost:5173' },
      { message: { qp: 1, type: 'gameOver', score: 7 }, targetOrigin: 'http://localhost:5173' },
    ]);
    expect(QP.version).toBe(1);
  });

  it('QP bị freeze', () => {
    const { QP } = load({ embedded: true, config: CONFIG });
    expect(Object.isFrozen(QP)).toBe(true);
  });

  it('bỏ qua score không hợp lệ', () => {
    const { sent, QP } = load({ embedded: true, config: CONFIG });
    for (const bad of [-1, 1.5, NaN, Infinity, 1_000_000_001, '5', null, undefined, 2 ** 53]) {
      QP.score(bad);
      QP.gameOver(bad);
    }
    expect(sent).toEqual([]);
    QP.score(0);
    QP.gameOver(1_000_000_000);
    expect(sent).toHaveLength(2);
  });

  it('no-op khi chạy top-level', () => {
    const { sent, QP } = load({ embedded: false, config: CONFIG });
    QP.ready();
    QP.score(1);
    expect(sent).toEqual([]);
  });

  it('no-op khi thiếu hoặc sai hostOrigin', () => {
    const bads: unknown[] = [
      undefined,
      {},
      { hostOrigin: 5 },
      { hostOrigin: '*' },
      { hostOrigin: 'null' },
      { hostOrigin: 'javascript:alert(1)' },
      { hostOrigin: 'http://localhost:5173/path' },
      { hostOrigin: 'ftp://example.com' },
    ];
    for (const config of bads) {
      const { sent, QP } = load({ embedded: true, config });
      QP.ready();
      expect(sent).toEqual([]);
    }
  });

  it('không bao giờ throw ra mã game', () => {
    const { QP } = load({ embedded: true, config: CONFIG, throwOnPost: true });
    expect(() => {
      QP.ready();
      QP.score(1);
      QP.gameOver(1);
    }).not.toThrow();
  });
});
