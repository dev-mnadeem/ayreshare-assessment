import { existsSync } from 'node:fs';

import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config/env.js';
import { createLogger } from './logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

function main(): void {
  const config = loadConfig();
  const logger = createLogger(config);
  const app = createApp({ config, logger });

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, tiktokMode: config.tiktok.mode }, 'server listening');
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'shutting down');
    server.close((err) => {
      if (err) logger.error({ err }, 'error during shutdown');
      process.exit(err ? 1 : 0);
    });
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

try {
  main();
} catch (err) {
  // The logger may not exist yet (config failed), so write straight to stderr.
  process.stderr.write(`${err instanceof ConfigError ? err.message : String(err)}\n`);
  process.exit(1);
}
