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
  {
    id: 2,
    name: 'posts_and_boosts',
    sql: `
      -- Posts published through Ayrshare; maps an Ayrshare post ID to the TikTok video it created.
      CREATE TABLE posts (
        id                TEXT PRIMARY KEY,
        profile_id        TEXT NOT NULL REFERENCES profiles (id),
        platform          TEXT NOT NULL CHECK (platform IN ('tiktok')),
        platform_post_id  TEXT NOT NULL,
        created_at        TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX posts_profile_id ON posts (profile_id);

      -- One row per boost attempt that reached the creation phase. Written before the first
      -- TikTok create and updated after every step, so a crash mid-flow still leaves a trail.
      CREATE TABLE boosts (
        id                  TEXT PRIMARY KEY,
        account_id          TEXT NOT NULL REFERENCES accounts (id),
        profile_id          TEXT NOT NULL REFERENCES profiles (id),
        advertiser_id       TEXT NOT NULL,
        status              TEXT NOT NULL
                            CHECK (status IN ('in_progress', 'live', 'paused', 'failed', 'cleanup_failed')),
        requested_status    TEXT NOT NULL CHECK (requested_status IN ('active', 'paused')),
        ad_name             TEXT NOT NULL,
        goal                TEXT NOT NULL,
        post_kind           TEXT NOT NULL,
        ayrshare_post_id    TEXT,
        tiktok_item_id      TEXT NOT NULL,
        identity_type       TEXT NOT NULL,
        identity_id         TEXT NOT NULL,
        budget_type         TEXT NOT NULL CHECK (budget_type IN ('daily', 'total')),
        budget_cents        INTEGER NOT NULL CHECK (budget_cents > 0),
        max_spend_cents     INTEGER NOT NULL CHECK (max_spend_cents > 0),
        start_at            TEXT NOT NULL,
        end_at              TEXT NOT NULL,
        request_json        TEXT NOT NULL,  -- normalised request; secrets (authCode) masked
        campaign_id         TEXT,
        adgroup_id          TEXT,
        ad_id               TEXT,
        orphans_json        TEXT NOT NULL DEFAULT '[]',
        tiktok_request_ids  TEXT NOT NULL DEFAULT '[]',
        error_code          INTEGER,
        error_details       TEXT,
        created_at          TEXT NOT NULL DEFAULT ${NOW},
        updated_at          TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX boosts_profile_id ON boosts (profile_id, created_at);
    `,
  },
  {
    id: 3,
    name: 'idempotency_and_audit',
    sql: `
      -- Idempotency-Key records, scoped per account. A row is 'in_progress' while the first
      -- request runs; its final response is stored so retries replay instead of re-executing.
      CREATE TABLE idempotency_keys (
        account_id       TEXT NOT NULL REFERENCES accounts (id),
        key              TEXT NOT NULL,
        fingerprint      TEXT NOT NULL,  -- sha256 of profile + method + path + canonical body
        status           TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
        response_status  INTEGER,
        response_body    TEXT,
        created_at       TEXT NOT NULL,
        completed_at     TEXT,
        PRIMARY KEY (account_id, key)
      );

      -- Append-only trail of boost attempts, outcomes and every TikTok call. Secrets are
      -- redacted before insert.
      CREATE TABLE audit_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at  TEXT NOT NULL,
        request_id  TEXT,
        account_id  TEXT,
        profile_id  TEXT,
        boost_id    TEXT,
        type        TEXT NOT NULL,
        data_json   TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX audit_events_boost_id ON audit_events (boost_id);
      CREATE INDEX audit_events_request_id ON audit_events (request_id);
    `,
  },
];
