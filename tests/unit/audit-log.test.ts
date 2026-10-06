import { describe, expect, it } from 'vitest';

import { SqliteAuditLog } from '../../src/modules/audit/audit-log.js';
import { createTestDb } from '../helpers/test-app.js';

const NOW = new Date('2026-10-06T12:00:00Z');

describe('SqliteAuditLog', () => {
  it('stores events with redacted data and lists them by request and boost', () => {
    const log = new SqliteAuditLog(createTestDb(), () => NOW);

    log.record({
      type: 'boost.started',
      requestId: 'req-1',
      boostId: 'bst_1',
      data: { authCode: 'SPARK-SECRET-9876', budget: 20 },
    });

    const [event] = log.listByBoostId('bst_1');
    expect(event).toMatchObject({
      type: 'boost.started',
      requestId: 'req-1',
      createdAt: NOW,
      data: { authCode: '****9876', budget: 20 },
    });
    expect(log.listByRequestId('req-1')).toHaveLength(1);
  });

  it('never throws into the caller when a write fails; reports via onError', () => {
    const db = createTestDb();
    const errors: unknown[] = [];
    const log = new SqliteAuditLog(
      db,
      () => NOW,
      (err) => errors.push(err),
    );
    db.close();

    expect(() => {
      log.record({ type: 'boost.failed' });
    }).not.toThrow();
    expect(errors).toHaveLength(1);
  });
});
