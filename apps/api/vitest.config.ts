import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Hash mật khẩu (scrypt) chậm khi nhiều worker chạy song song: 5 s mặc định gây timeout ngẫu nhiên.
    testTimeout: 20_000,
    env: loadEnv('test', rootDir, ''),
  },
});
