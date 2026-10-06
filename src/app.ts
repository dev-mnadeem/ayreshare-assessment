import express, { type Express } from 'express';

import type { Config } from './config/env.js';
import type { Logger } from './logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestContext } from './middleware/request-context.js';

export interface AppDeps {
  readonly config: Config;
  readonly logger: Logger;
}

const JSON_BODY_LIMIT = '100kb';

/** Middleware every request passes through before routing. */
export function installCoreMiddleware(app: Express, deps: AppDeps): void {
  app.disable('x-powered-by');
  app.use(requestContext(deps.logger));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
}

/** Must be installed after all routes. */
export function installErrorHandling(app: Express): void {
  app.use(notFoundHandler);
  app.use(errorHandler);
}

/**
 * Builds the Express app without binding a port, so tests can drive it with Supertest.
 * All collaborators are injected through `deps`.
 */
export function createApp(deps: AppDeps): Express {
  const app = express();
  installCoreMiddleware(app, deps);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  installErrorHandling(app);
  return app;
}
