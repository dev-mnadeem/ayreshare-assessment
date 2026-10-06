import { describe, expect, it } from 'vitest';

import { IN_MEMORY, openDatabase, runMigrations } from '../../src/db/database.js';
import { MIGRATIONS } from '../../src/db/migrations.js';

function tableNames(db: ReturnType<typeof openDatabase>): string[] {
  return db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name);
}

describe('migrations', () => {
  it('creates the schema and records each migration', () => {
    const db = openDatabase(IN_MEMORY);

    expect(tableNames(db)).toEqual(
      expect.arrayContaining(['schema_migrations', 'accounts', 'profiles']),
    );
    const recorded = db.prepare<[], { id: number }>('SELECT id FROM schema_migrations').all();
    expect(recorded.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
  });

  it('is idempotent: re-running applies nothing', () => {
    const db = openDatabase(IN_MEMORY);

    expect(runMigrations(db, MIGRATIONS)).toEqual([]);
  });

  it('rolls back a failing migration and does not record it', () => {
    const db = openDatabase(IN_MEMORY);
    const broken = { id: 999, name: 'broken', sql: 'CREATE TABLE half_done (x INT); NOT SQL;' };

    expect(() => runMigrations(db, [...MIGRATIONS, broken])).toThrow();
    expect(tableNames(db)).not.toContain('half_done');
    expect(runMigrations(db, MIGRATIONS)).toEqual([]);
  });
});

describe('schema constraints', () => {
  const db = openDatabase(IN_MEMORY);
  db.prepare(
    "INSERT INTO accounts (id, name, api_key_hash, status) VALUES ('a1', 'A', 'h1', 'active')",
  ).run();

  const insertProfile = (sql: string) => () => db.prepare(sql).run();

  it('rejects an access token without an advertiser ID', () => {
    expect(
      insertProfile(`INSERT INTO profiles (id, account_id, title, is_primary, status, tiktok_access_token)
                     VALUES ('p1', 'a1', 'P', 1, 'active', 'tok')`),
    ).toThrow(/CHECK constraint/);
  });

  it('allows only one primary profile per account', () => {
    insertProfile(
      `INSERT INTO profiles (id, account_id, title, is_primary, status) VALUES ('p2', 'a1', 'P', 1, 'active')`,
    )();

    expect(
      insertProfile(
        `INSERT INTO profiles (id, account_id, title, is_primary, status) VALUES ('p3', 'a1', 'Q', 1, 'active')`,
      ),
    ).toThrow(/UNIQUE constraint/);
  });

  it('rejects profiles for unknown accounts (foreign keys on)', () => {
    expect(
      insertProfile(
        `INSERT INTO profiles (id, account_id, title, is_primary, status) VALUES ('p4', 'nope', 'P', 0, 'active')`,
      ),
    ).toThrow(/FOREIGN KEY/);
  });

  it('rejects unknown status values', () => {
    expect(
      insertProfile(
        `INSERT INTO profiles (id, account_id, title, is_primary, status) VALUES ('p5', 'a1', 'P', 0, 'deleted')`,
      ),
    ).toThrow(/CHECK constraint/);
  });
});
