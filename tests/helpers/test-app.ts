import express, { type Express } from 'express';

import { installCoreMiddleware, installErrorHandling, type AppDeps } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/logger.js';

export function testDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_PATH: ':memory:' });
  return { config, logger: createLogger(config), ...overrides };
}

/**
 * An app with the real core middleware and error handling, plus routes defined by the test.
 * Lets tests exercise error paths without adding test-only routes to production code.
 */
export function harnessApp(defineRoutes: (app: Express) => void, deps = testDeps()): Express {
  const app = express();
  installCoreMiddleware(app, deps);
  defineRoutes(app);
  installErrorHandling(app);
  return app;
}
