import type { Db } from '../../db/database.js';
import { redactSecrets } from '../../lib/secrets.js';

export type AuditEventType =
  | 'boost.rejected' // failed validation or a safety check before any TikTok write
  | 'boost.dry_run'
  | 'boost.started' // passed pre-flight and caps; boost row created
  | 'boost.succeeded'
  | 'boost.failed'
  | 'tiktok.call'
  | 'idempotency.replayed';

export interface AuditEvent {
  readonly type: AuditEventType;
  readonly requestId?: string | null;
  readonly accountId?: string | null;
  readonly profileId?: string | null;
  readonly boostId?: string | null;
  readonly data?: Record<string, unknown>;
}

export interface StoredAuditEvent extends Required<Omit<AuditEvent, 'data'>> {
  readonly id: number;
  readonly createdAt: Date;
  readonly data: Record<string, unknown>;
}

/** Append-only. Writes never throw into the caller: losing an audit line must not fail a boost. */
export interface AuditLog {
  record(event: AuditEvent): void;
  listByRequestId(requestId: string): StoredAuditEvent[];
  listByBoostId(boostId: string): StoredAuditEvent[];
}

interface AuditRow {
  id: number;
  created_at: string;
  request_id: string | null;
  account_id: string | null;
  profile_id: string | null;
  boost_id: string | null;
  type: AuditEventType;
  data_json: string;
}

const toEvent = (row: AuditRow): StoredAuditEvent => ({
  id: row.id,
  createdAt: new Date(row.created_at),
  requestId: row.request_id,
  accountId: row.account_id,
  profileId: row.profile_id,
  boostId: row.boost_id,
  type: row.type,
  data: JSON.parse(row.data_json) as Record<string, unknown>,
});

export class SqliteAuditLog implements AuditLog {
  private readonly insert;
  private readonly byRequestId;
  private readonly byBoostId;

  constructor(
    db: Db,
    private readonly now: () => Date,
    private readonly onError: (err: unknown) => void = () => undefined,
  ) {
    this.insert = db.prepare(`
      INSERT INTO audit_events (created_at, request_id, account_id, profile_id, boost_id, type, data_json)
      VALUES (@created_at, @request_id, @account_id, @profile_id, @boost_id, @type, @data_json)
    `);
    this.byRequestId = db.prepare<[string], AuditRow>(
      'SELECT * FROM audit_events WHERE request_id = ? ORDER BY id',
    );
    this.byBoostId = db.prepare<[string], AuditRow>(
      'SELECT * FROM audit_events WHERE boost_id = ? ORDER BY id',
    );
  }

  record(event: AuditEvent): void {
    try {
      this.insert.run({
        created_at: this.now().toISOString(),
        request_id: event.requestId ?? null,
        account_id: event.accountId ?? null,
        profile_id: event.profileId ?? null,
        boost_id: event.boostId ?? null,
        type: event.type,
        data_json: JSON.stringify(redactSecrets(event.data ?? {})),
      });
    } catch (err) {
      this.onError(err);
    }
  }

  listByRequestId(requestId: string): StoredAuditEvent[] {
    return this.byRequestId.all(requestId).map(toEvent);
  }

  listByBoostId(boostId: string): StoredAuditEvent[] {
    return this.byBoostId.all(boostId).map(toEvent);
  }
}
