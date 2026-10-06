import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import { MIGRATIONS, type Migration } from './migrations.js';

export type Db = Database.Database;

export const IN_MEMORY = ':memory:';

/** Opens (creating if needed) the SQLite database and brings its schema up to date. */
export function openDatabase(path: string, migrations: readonly Migration[] = MIGRATIONS): Db {
  if (path !== IN_MEMORY) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db, migrations);
  return db;
}

/** Applies pending migrations in id order; returns the ids that were applied. */
export function runMigrations(db: Db, migrations: readonly Migration[]): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  const applied = new Set(
    db
      .prepare<[], { id: number }>('SELECT id FROM schema_migrations')
      .all()
      .map((row) => row.id),
  );
  const record = db.prepare<[number, string]>(
    'INSERT INTO schema_migrations (id, name) VALUES (?, ?)',
  );

  const pending = [...migrations].sort((a, b) => a.id - b.id).filter((m) => !applied.has(m.id));
  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.id, migration.name);
    })();
  }
  return pending.map((m) => m.id);
}
