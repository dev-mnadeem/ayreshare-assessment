import type { Db } from '../../db/database.js';
import { hashSecret } from '../../lib/secrets.js';

import type { Account, EntityStatus, Profile } from './types.js';

/**
 * Synchronous on purpose: better-sqlite3 is synchronous and that keeps transactions simple.
 * A networked database would make these methods async.
 */
export interface AuthRepository {
  findAccountByApiKey(apiKey: string): Account | undefined;
  findPrimaryProfile(accountId: string): Profile | undefined;
  /** Only returns the profile if it belongs to `accountId`. */
  findProfileByKey(accountId: string, profileKey: string): Profile | undefined;
}

interface AccountRow {
  id: string;
  name: string;
  status: EntityStatus;
}

interface ProfileRow {
  id: string;
  account_id: string;
  title: string;
  is_primary: 0 | 1;
  status: EntityStatus;
  tiktok_advertiser_id: string | null;
  tiktok_access_token: string | null;
  tiktok_username: string | null;
}

const PROFILE_COLUMNS = `id, account_id, title, is_primary, status,
  tiktok_advertiser_id, tiktok_access_token, tiktok_username`;

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    accountId: row.account_id,
    title: row.title,
    isPrimary: row.is_primary === 1,
    status: row.status,
    tiktokAds:
      row.tiktok_advertiser_id !== null && row.tiktok_access_token !== null
        ? {
            advertiserId: row.tiktok_advertiser_id,
            accessToken: row.tiktok_access_token,
            username: row.tiktok_username,
          }
        : null,
  };
}

export class SqliteAuthRepository implements AuthRepository {
  private readonly accountByKeyHash;
  private readonly primaryProfile;
  private readonly profileByKeyHash;

  constructor(db: Db) {
    this.accountByKeyHash = db.prepare<[string], AccountRow>(
      'SELECT id, name, status FROM accounts WHERE api_key_hash = ?',
    );
    this.primaryProfile = db.prepare<[string], ProfileRow>(
      `SELECT ${PROFILE_COLUMNS} FROM profiles WHERE account_id = ? AND is_primary = 1`,
    );
    this.profileByKeyHash = db.prepare<[string, string], ProfileRow>(
      `SELECT ${PROFILE_COLUMNS} FROM profiles WHERE account_id = ? AND profile_key_hash = ?`,
    );
  }

  findAccountByApiKey(apiKey: string): Account | undefined {
    return this.accountByKeyHash.get(hashSecret(apiKey));
  }

  findPrimaryProfile(accountId: string): Profile | undefined {
    const row = this.primaryProfile.get(accountId);
    return row && toProfile(row);
  }

  findProfileByKey(accountId: string, profileKey: string): Profile | undefined {
    const row = this.profileByKeyHash.get(accountId, hashSecret(profileKey));
    return row && toProfile(row);
  }
}
