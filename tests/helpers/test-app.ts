import express, { type Express } from 'express';

import { installCoreMiddleware, installErrorHandling, type AppDeps } from '../../src/app.js';
import { buildAppDeps, type CompositionOverrides } from '../../src/composition.js';
import { loadConfig } from '../../src/config/env.js';
import { IN_MEMORY, openDatabase, type Db } from '../../src/db/database.js';
import { seedDemoData } from '../../src/db/seed.js';
import { createLogger } from '../../src/logger.js';
import { MockTikTokClient } from '../../src/integrations/tiktok/mock-client.js';

import { TEST_NOW } from './boost-request.js';

/** A fresh, migrated, seeded in-memory database. */
export function createTestDb(): Db {
  const db = openDatabase(IN_MEMORY);
  seedDemoData(db);
  return db;
}

export const testConfig = (env: NodeJS.ProcessEnv = {}) =>
  loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_PATH: IN_MEMORY, ...env });

/** The production dependency graph on an in-memory DB, mock TikTok and a fixed clock. */
export function testDeps(
  overrides: Partial<AppDeps> = {},
  options: CompositionOverrides & { db?: Db; env?: NodeJS.ProcessEnv } = {},
): AppDeps {
  const config = testConfig(options.env);
  const deps = buildAppDeps(config, options.db ?? createTestDb(), createLogger(config), {
    tiktok: options.tiktok ?? new MockTikTokClient(),
    now: options.now ?? (() => TEST_NOW),
    ...(options.newBoostId && { newBoostId: options.newBoostId }),
  });
  return { ...deps, ...overrides };
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
