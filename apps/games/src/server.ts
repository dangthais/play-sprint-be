import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGamesServer, loadGamesConfig } from './games-server.ts';
import type { GamesConfig } from './games-server.ts';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

if (import.meta.main) {
  let config: GamesConfig;
  try {
    config = loadGamesConfig(process.env);
  } catch (err) {
    console.error(`games server: cấu hình không hợp lệ: ${(err as Error).message}`);
    process.exit(1);
  }
  const server = createGamesServer({
    root: publicDir,
    webOrigin: config.webOrigin,
    gameOrigin: config.gameOrigin,
  });
  server.on('error', (err) => {
    console.error(`games server: ${err.message}`);
    process.exit(1);
  });
  server.listen(config.port, config.host, () => {
    console.log(
      `games server: http://${config.host}:${config.port} (game origin ${config.gameOrigin}, web origin ${config.webOrigin})`,
    );
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
