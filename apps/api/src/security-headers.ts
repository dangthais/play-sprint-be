import type { FastifyInstance } from 'fastify';

/** Header bảo mật áp cho mọi response của API (contract 0.5.1, ADR-032). */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
};

/**
 * Hook `onSend` cho MỌI response (kể cả lỗi và notFound). `Cache-Control: no-store` chỉ đặt khi
 * route chưa tự đặt. Gọi trước khi đăng ký route.
 */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      void reply.header(name, value);
    }
    if (reply.getHeader('cache-control') === undefined) {
      void reply.header('cache-control', 'no-store');
    }
    return payload;
  });
}
