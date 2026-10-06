import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { AppError, ValidationError } from '../../src/errors/app-error.js';
import { harnessApp, testDeps } from '../helpers/test-app.js';

const ENVELOPE_KEYS = ['action', 'code', 'details', 'message', 'status'];

describe('GET /health', () => {
  it('responds ok', async () => {
    const res = await request(createApp(testDeps())).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('request ID', () => {
  const app = createApp(testDeps());

  it('generates one when absent', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a well-formed inbound ID', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'client-abc_123');

    expect(res.headers['x-request-id']).toBe('client-abc_123');
  });

  it('replaces an unsafe inbound ID', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'bad id\twith spaces');

    expect(res.headers['x-request-id']).not.toBe('bad id\twith spaces');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('error envelope', () => {
  const app = harnessApp((a) => {
    a.get('/validation', () => {
      throw new ValidationError('Missing required fields: budget');
    });
    a.get('/tiktok-rate-limited', () => {
      throw new AppError('TIKTOK_RATE_LIMITED', 'Retry after 1 second.');
    });
    a.get('/async-app-error', async () => {
      await Promise.resolve();
      throw new ValidationError('async failure');
    });
    a.get('/crash', () => {
      throw new Error('db password is hunter2');
    });
    a.get('/async-crash', async () => {
      await Promise.resolve();
      throw new Error('kaboom');
    });
    a.post('/echo', (req, res) => {
      res.json(req.body);
    });
  });

  it('formats an AppError as the Ayrshare envelope', async () => {
    const res = await request(app).get('/validation');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      action: 'request',
      status: 'error',
      code: 101,
      message:
        'Missing or incorrect parameters. Please verify with the docs. https://www.ayrshare.com/docs/apis',
      details: 'Missing required fields: budget',
    });
  });

  it('uses the HTTP status and action from the error registry', async () => {
    const res = await request(app).get('/tiktok-rate-limited');

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ action: 'boost post', code: 606 });
  });

  it('routes a rejected async handler to the error middleware', async () => {
    const res = await request(app).get('/async-app-error');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 101, details: 'async failure' });
  });

  it('returns a generic 500 for unknown errors without leaking internals', async () => {
    const res = await request(app).get('/crash').set('X-Request-Id', 'req-500');

    expect(res.status).toBe(500);
    expect(Object.keys(res.body as object).sort()).toEqual(ENVELOPE_KEYS);
    expect(res.body).toMatchObject({ status: 'error', code: 612 });
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|at .*\.ts/);
    expect((res.body as { details: string }).details).toContain('req-500');
  });

  it('handles unknown async errors the same way', async () => {
    const res = await request(app).get('/async-crash');

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: 612 });
  });

  it('turns malformed JSON into a 101 with a helpful detail', async () => {
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"budget": 20,');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 101, action: 'request' });
    expect((res.body as { details: string }).details).toMatch(/not valid JSON/);
  });

  it('rejects bodies over the size limit with a 101', async () => {
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ adName: 'x'.repeat(200_000) }));

    expect(res.status).toBe(400);
    expect((res.body as { details: string }).details).toMatch(/too large/);
  });

  it('returns a 404 envelope for unknown routes', async () => {
    const res = await request(app).post('/api/ads/tiktok/nope');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      status: 'error',
      code: 611,
      details: 'No endpoint matches POST /api/ads/tiktok/nope.',
    });
  });
});
