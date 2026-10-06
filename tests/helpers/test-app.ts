import express, { type Express } from 'express';

import { installCoreMiddleware, installErrorHandling, type AppDeps } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { IN_MEMORY, openDatabase, type Db } from '../../src/db/database.js';
import { seedDemoData } from '../../src/db/seed.js';
import { createLogger } from '../../src/logger.js';
import { SqliteAuthRepository } from '../../src/modules/auth/auth-repository.js';

/** A fresh, migrated, seeded in-memory database. */
export function createTestDb(): Db {
  const db = openDatabase(IN_MEMORY);
  seedDemoData(db);
  return db;
}

export function testDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_PATH: IN_MEMORY });
  return {
    config,
    logger: createLogger(config),
    authRepository: new SqliteAuthRepository(createTestDb()),
    ...overrides,
  };
}

/**
 * An app with the real core middleware and error handling, plus routes defined by the test.
 * Lets tests exercise error paths without adding test-only routes to production code.
 */
export function harnessApp(
  defineRoutes: (app: Express, deps: AppDeps) => void,
  deps = testDeps(),
): Express {
  const app = express();
  installCoreMiddleware(app, deps);
  defineRoutes(app, deps);
  installErrorHandling(app);
  return app;
}
