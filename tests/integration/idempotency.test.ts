import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { DEMO } from '../../src/demo/fixtures.js';
import { AppError, ValidationError } from '../../src/errors/app-error.js';
import { authenticate } from '../../src/middleware/authenticate.js';
import { idempotency } from '../../src/middleware/idempotency.js';
import { SqliteAuditLog } from '../../src/modules/audit/audit-log.js';
import { SqliteAuthRepository } from '../../src/modules/auth/auth-repository.js';
import { SqliteIdempotencyRepository } from '../../src/modules/idempotency/repository.js';
import { createTestDb, harnessApp, testDeps } from '../helpers/test-app.js';

const T0 = new Date('2026-10-06T12:00:00Z');
const MINUTE = 60_000;

/**
 * POST /api/thing behind authenticate + idempotency. The body's `mode` picks the outcome, and
 * `executions` counts how often the handler actually ran.
 */
function setup() {
  const db = createTestDb();
  const clock = { now: T0 };
  const audit = new SqliteAuditLog(db, () => clock.now);
  let executions = 0;
  let release: (() => void) | undefined;

  const app = harnessApp(
    (a, deps) => {
      a.use('/api', authenticate(deps.authRepository));
      a.post(
        '/api/thing',
        idempotency({ repo: new SqliteIdempotencyRepository(db), now: () => clock.now, audit }),
        async (req, res) => {
          executions++;
          const { mode } = req.body as { mode?: string };
          if (mode === 'invalid') throw new ValidationError('Missing required fields: budget.');
          if (mode === 'unavailable') throw new AppError('TIKTOK_UNAVAILABLE', 'try later');
          if (mode === 'rate_limited') throw new AppError('TIKTOK_RATE_LIMITED', 'slow down');
          if (mode === 'crash') throw new Error('boom');
          if (mode === 'slow') {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          res.json({ status: 'success', execution: executions });
        },
      );
    },
    testDeps({ authRepository: new SqliteAuthRepository(db) }),
  );

  const post = (body: object, key?: string, apiKey: string = DEMO.apiKey) => {
    const req = request(app).post('/api/thing').set('Authorization', `Bearer ${apiKey}`);
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req.send(body);
  };

  return {
    post,
    audit,
    clock,
    executions: () => executions,
    finishSlow: () => release?.(),
  };
}

describe('Idempotency-Key', () => {
  it('without a key, every request executes', async () => {
    const s = setup();

    await s.post({ mode: 'ok' });
    await s.post({ mode: 'ok' });

    expect(s.executions()).toBe(2);
  });

  it('replays the stored response for the same key and body, without re-executing', async () => {
    const s = setup();

    const first = await s.post({ mode: 'ok' }, 'key-1');
    const second = await s.post({ mode: 'ok' }, 'key-1');

    expect(s.executions()).toBe(1);
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.headers['idempotent-replayed']).toBe('true');
  });

  it('treats a body with the same content but different key order as the same request', async () => {
    const s = setup();

    await s.post({ mode: 'ok', a: 1, b: { c: 2, d: 3 } }, 'key-1');
    const replay = await s.post({ b: { d: 3, c: 2 }, a: 1, mode: 'ok' }, 'key-1');

    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(s.executions()).toBe(1);
  });

  it('rejects the same key with a different body (608)', async () => {
    const s = setup();

    await s.post({ mode: 'ok', budget: 20 }, 'key-1');
    const res = await s.post({ mode: 'ok', budget: 2000 }, 'key-1');

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 608, action: 'request' });
    expect((res.body as { details: string }).details).toMatch(
      /was first used at 2026-10-06T12:00:00.000Z for a different request/,
    );
    expect(s.executions()).toBe(1);
  });

  it('rejects a concurrent duplicate while the first is still running (609)', async () => {
    const s = setup();

    // Supertest requests are lazy: .then() actually sends this one now.
    const first = s.post({ mode: 'slow' }, 'key-1').then((res) => res);
    // Let the first request reach the handler and claim the key.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await s.post({ mode: 'slow' }, 'key-1');
    s.finishSlow();

    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 609 });
    expect((await first).status).toBe(200);
    expect(s.executions()).toBe(1);
  });

  it('replays permanent client errors (a 400 stays a 400)', async () => {
    const s = setup();

    await s.post({ mode: 'invalid' }, 'key-1');
    const replay = await s.post({ mode: 'invalid' }, 'key-1');

    expect(replay.status).toBe(400);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(s.executions()).toBe(1);
  });

  it.each([
    ['unavailable', 503],
    ['rate_limited', 429],
    ['crash', 500],
  ])(
    'does not store retryable outcomes (%s → %i): a retry with the same key re-executes',
    async (mode, status) => {
      const s = setup();

      const first = await s.post({ mode }, 'key-1');
      const retry = await s.post({ mode }, 'key-1');

      expect(first.status).toBe(status);
      expect(retry.headers['idempotent-replayed']).toBeUndefined();
      expect(s.executions()).toBe(2);
    },
  );

  it('scopes keys per account', async () => {
    const s = setup();

    await s.post({ mode: 'ok' }, 'shared-key');
    const other = await s.post({ mode: 'ok' }, 'shared-key', DEMO.otherAccountApiKey);

    expect(other.headers['idempotent-replayed']).toBeUndefined();
    expect(s.executions()).toBe(2);
  });

  it('expires completed keys after 24 hours', async () => {
    const s = setup();

    await s.post({ mode: 'ok' }, 'key-1');
    s.clock.now = new Date(T0.getTime() + 24 * 60 * MINUTE + 1);
    const later = await s.post({ mode: 'ok' }, 'key-1');

    expect(later.headers['idempotent-replayed']).toBeUndefined();
    expect(s.executions()).toBe(2);
  });

  it('lets a retry through once an in-progress claim is stale (crashed process)', async () => {
    const s = setup();

    // Sent now (.then) and never finishes, like a crashed worker holding the claim.
    const stuck = s.post({ mode: 'slow' }, 'key-1').then((res) => res);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const blocked = await s.post({ mode: 'ok' }, 'key-1');
    s.clock.now = new Date(T0.getTime() + 11 * MINUTE);
    const retry = await s.post({ mode: 'ok' }, 'key-1');
    s.finishSlow();
    await stuck;

    expect(blocked.status).toBe(409); // still within the 10-minute lock
    expect(retry.status).toBe(200);
  });

  it.each(['', 'has space', 'x'.repeat(256)])('rejects a malformed key %j (101)', async (key) => {
    const s = setup();

    const res = await s.post({ mode: 'ok' }, key);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 101 });
    expect(s.executions()).toBe(0);
  });

  it('audits replays', async () => {
    const s = setup();

    await s.post({ mode: 'ok' }, 'key-1');
    const replay = await s.post({ mode: 'ok' }, 'key-1');
    const requestId = String(replay.headers['x-request-id']);

    expect(s.audit.listByRequestId(requestId)).toEqual([
      expect.objectContaining({
        type: 'idempotency.replayed',
        data: { key: 'key-1', originalStatus: 200 },
      }),
    ]);
  });
});
