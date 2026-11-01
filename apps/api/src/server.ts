import { buildApp } from './app.ts';
import { createPgAuthRepository } from './auth/auth.repository.ts';
import type { AuthRepository } from './auth/auth.types.ts';
import { warmupDummyHash } from './auth/password.ts';
import { loadConfig } from './config.ts';
import { startCleanupScheduler } from './db/cleanup.ts';
import { createPool } from './db/pool.ts';
import { createPgGamesRepository } from './games/games.repository.ts';
import type { GamesRepository } from './games/games.types.ts';
import { createPgSessionsRepository } from './sessions/sessions.repository.ts';
import type { SessionsRepository } from './sessions/sessions.types.ts';

const config = loadConfig(process.env);

const pool = config.databaseUrl ? createPool(config.databaseUrl) : undefined;

const missingDb: GamesRepository = {
  async list() {
    throw new Error('DATABASE_URL is not configured');
  },
  async findById() {
    throw new Error('DATABASE_URL is not configured');
  },
};

const missingSessionsDb: SessionsRepository = {
  async findGameRule() {
    throw new Error('DATABASE_URL is not configured');
  },
  async create() {
    throw new Error('DATABASE_URL is not configured');
  },
  async findByIdAndTokenHash() {
    throw new Error('DATABASE_URL is not configured');
  },
  async finish() {
    throw new Error('DATABASE_URL is not configured');
  },
  async rankOf() {
    throw new Error('DATABASE_URL is not configured');
  },
  async leaderboard() {
    throw new Error('DATABASE_URL is not configured');
  },
  async listHistory() {
    throw new Error('DATABASE_URL is not configured');
  },
  async personalBests() {
    throw new Error('DATABASE_URL is not configured');
  },
};

const notConfigured = async (): Promise<never> => {
  throw new Error('DATABASE_URL is not configured');
};
const missingAuthDb: AuthRepository = {
  register: notConfigured,
  findByEmail: notConfigured,
  findPasswordHash: notConfigured,
  findSession: notConfigured,
  startSession: notConfigured,
  deleteSession: notConfigured,
  changePassword: notConfigured,
  updateDisplayName: notConfigured,
  isDisplayNameKeyTaken: notConfigured,
};

const app = buildApp({
  logger: { level: config.logLevel },
  gamesRepository: pool ? createPgGamesRepository(pool) : missingDb,
  sessionsRepository: pool ? createPgSessionsRepository(pool) : missingSessionsDb,
  authRepository: pool ? createPgAuthRepository(pool) : missingAuthDb,
  webOrigin: config.webOrigin,
  gameOrigin: config.gameOrigin,
  trustProxy: config.trustProxy,
  cookieSecure: config.cookieSecure,
});

if (!pool) {
  app.log.warn(
    'DATABASE_URL is not set; routes that need the database will return 500 INTERNAL_ERROR',
  );
}

const cleanup =
  pool && config.cleanupIntervalMinutes > 0
    ? startCleanupScheduler({
        pool,
        intervalMs: config.cleanupIntervalMinutes * 60_000,
        clock: () => new Date(),
        log: app.log,
      })
    : undefined;

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await app.close();
    await cleanup?.stop();
    await pool?.end();
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

try {
  // Sinh hash giả (đăng nhập email không tồn tại) một lần lúc khởi động (ADR-022).
  await warmupDummyHash();
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  await cleanup?.stop();
  await pool?.end().catch(() => undefined);
  process.exit(1);
}
