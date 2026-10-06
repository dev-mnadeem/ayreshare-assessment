/**
 * Ordered, append-only schema migrations. Never edit a migration that has shipped;
 * add a new one. Each runs once, inside a transaction, and is recorded in schema_migrations.
 */
export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'accounts_and_profiles',
    sql: `
      -- An Ayrshare customer account, authenticated by its primary API key.
      CREATE TABLE accounts (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        api_key_hash  TEXT NOT NULL UNIQUE,  -- sha256 hex; raw keys are never stored
        status        TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
        created_at    TEXT NOT NULL DEFAULT ${NOW}
      );

      -- A user profile under an account, selected with the Profile-Key header.
      -- The primary profile is used when no Profile-Key is sent.
      CREATE TABLE profiles (
        id                    TEXT PRIMARY KEY,
        account_id            TEXT NOT NULL REFERENCES accounts (id),
        title                 TEXT NOT NULL,
        profile_key_hash      TEXT UNIQUE,  -- NULL for the primary profile
        is_primary            INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
        status                TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
        -- Linked TikTok ads account. In production the token would be encrypted at rest (KMS).
        tiktok_advertiser_id  TEXT,
        tiktok_access_token   TEXT,
        tiktok_username       TEXT,
        created_at            TEXT NOT NULL DEFAULT ${NOW},
        CHECK ((tiktok_advertiser_id IS NULL) = (tiktok_access_token IS NULL)),
        CHECK (is_primary = 0 OR profile_key_hash IS NULL)
      );

      CREATE INDEX profiles_account_id ON profiles (account_id);
      CREATE UNIQUE INDEX profiles_one_primary_per_account ON profiles (account_id) WHERE is_primary = 1;
    `,
  },
];
