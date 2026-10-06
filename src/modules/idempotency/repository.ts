import type { Db } from '../../db/database.js';

export interface IdempotencyRecord {
  readonly accountId: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly status: 'in_progress' | 'completed';
  readonly responseStatus: number | null;
  readonly responseBody: unknown;
  readonly createdAt: Date;
}

export interface IdempotencyRepository {
  find(accountId: string, key: string): IdempotencyRecord | undefined;
  /** Claims the key; false if it already exists (another request owns it). */
  tryBegin(accountId: string, key: string, fingerprint: string, now: Date): boolean;
  complete(accountId: string, key: string, status: number, body: unknown, now: Date): void;
  /** Forgets the key so the same request may be retried (used for retryable outcomes). */
  release(accountId: string, key: string): void;
}

interface Row {
  account_id: string;
  key: string;
  fingerprint: string;
  status: 'in_progress' | 'completed';
  response_status: number | null;
  response_body: string | null;
  created_at: string;
}

export class SqliteIdempotencyRepository implements IdempotencyRepository {
  private readonly selectOne;
  private readonly insert;
  private readonly finish;
  private readonly remove;

  constructor(db: Db) {
    this.selectOne = db.prepare<[string, string], Row>(
      'SELECT * FROM idempotency_keys WHERE account_id = ? AND key = ?',
    );
    this.insert = db.prepare<[string, string, string, string]>(`
      INSERT INTO idempotency_keys (account_id, key, fingerprint, status, created_at)
      VALUES (?, ?, ?, 'in_progress', ?)
      ON CONFLICT (account_id, key) DO NOTHING
    `);
    this.finish = db.prepare<[number, string, string, string, string]>(`
      UPDATE idempotency_keys
      SET status = 'completed', response_status = ?, response_body = ?, completed_at = ?
      WHERE account_id = ? AND key = ?
    `);
    this.remove = db.prepare<[string, string]>(
      'DELETE FROM idempotency_keys WHERE account_id = ? AND key = ?',
    );
  }

  find(accountId: string, key: string): IdempotencyRecord | undefined {
    const row = this.selectOne.get(accountId, key);
    return (
      row && {
        accountId: row.account_id,
        key: row.key,
        fingerprint: row.fingerprint,
        status: row.status,
        responseStatus: row.response_status,
        responseBody:
          row.response_body === null ? null : (JSON.parse(row.response_body) as unknown),
        createdAt: new Date(row.created_at),
      }
    );
  }

  tryBegin(accountId: string, key: string, fingerprint: string, now: Date): boolean {
    return this.insert.run(accountId, key, fingerprint, now.toISOString()).changes === 1;
  }

  complete(accountId: string, key: string, status: number, body: unknown, now: Date): void {
    this.finish.run(status, JSON.stringify(body), now.toISOString(), accountId, key);
  }

  release(accountId: string, key: string): void {
    this.remove.run(accountId, key);
  }
}
