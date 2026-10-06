import express, { type Express } from 'express';

/**
 * Builds the Express app without binding a port, so tests can drive it with Supertest.
 * Collaborators (config, logger, repositories, TikTok client) are injected here from M2 on.
 */
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}
