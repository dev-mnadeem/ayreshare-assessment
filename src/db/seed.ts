import { hashSecret } from '../lib/secrets.js';

import type { Db } from './database.js';

/**
 * Demo fixtures covering every auth outcome. These keys are for local development and tests
 * only; they are documented in the README so the endpoint can be exercised with curl.
 */
export const DEMO = {
  apiKey: 'demo-api-key-active',
  suspendedApiKey: 'demo-api-key-suspended',
  otherAccountApiKey: 'demo-api-key-other',
  profileKeys: {
    creator: 'demo-profile-key-creator',
    noTikTok: 'demo-profile-key-no-tiktok',
    suspended: 'demo-profile-key-suspended',
    otherAccount: 'demo-profile-key-other-account',
  },
  /** Mock-mode advertiser IDs; the mock TikTok client recognises these. */
  advertiserIds: {
    primary: '7100000000000000001',
    creator: '7100000000000000002',
    other: '7100000000000000003',
  },
} as const;

interface SeedAccount {
  id: string;
  name: string;
  apiKey: string;
  status: 'active' | 'suspended';
}

interface SeedProfile {
  id: string;
  accountId: string;
  title: string;
  profileKey: string | null;
  status: 'active' | 'suspended';
  tiktok: { advertiserId: string; accessToken: string; username: string } | null;
}

const ACCOUNTS: SeedAccount[] = [
  { id: 'acc_demo', name: 'Demo Co', apiKey: DEMO.apiKey, status: 'active' },
  { id: 'acc_suspended', name: 'Suspended Co', apiKey: DEMO.suspendedApiKey, status: 'suspended' },
  { id: 'acc_other', name: 'Other Co', apiKey: DEMO.otherAccountApiKey, status: 'active' },
];

const PROFILES: SeedProfile[] = [
  {
    id: 'prof_demo_primary',
    accountId: 'acc_demo',
    title: 'Demo Co (primary)',
    profileKey: null,
    status: 'active',
    tiktok: {
      advertiserId: DEMO.advertiserIds.primary,
      accessToken: 'mock-access-token-primary',
      username: 'democo',
    },
  },
  {
    id: 'prof_demo_creator',
    accountId: 'acc_demo',
    title: 'Creator Studio',
    profileKey: DEMO.profileKeys.creator,
    status: 'active',
    tiktok: {
      advertiserId: DEMO.advertiserIds.creator,
      accessToken: 'mock-access-token-creator',
      username: 'creatorstudio',
    },
  },
  {
    id: 'prof_demo_no_tiktok',
    accountId: 'acc_demo',
    title: 'No TikTok Ads',
    profileKey: DEMO.profileKeys.noTikTok,
    status: 'active',
    tiktok: null,
  },
  {
    id: 'prof_demo_suspended',
    accountId: 'acc_demo',
    title: 'Suspended Profile',
    profileKey: DEMO.profileKeys.suspended,
    status: 'suspended',
    tiktok: null,
  },
  {
    id: 'prof_suspended_primary',
    accountId: 'acc_suspended',
    title: 'Suspended Co (primary)',
    profileKey: null,
    status: 'active',
    tiktok: null,
  },
  {
    id: 'prof_other_primary',
    accountId: 'acc_other',
    title: 'Other Co (primary)',
    profileKey: null,
    status: 'active',
    tiktok: null,
  },
  {
    id: 'prof_other_brand',
    accountId: 'acc_other',
    title: 'Other Co Brand',
    profileKey: DEMO.profileKeys.otherAccount,
    status: 'active',
    tiktok: {
      advertiserId: DEMO.advertiserIds.other,
      accessToken: 'mock-access-token-other',
      username: 'otherbrand',
    },
  },
];

/** Idempotent: re-running updates the fixtures in place. */
export function seedDemoData(db: Db): void {
  const upsertAccount = db.prepare<[string, string, string, string]>(`
    INSERT INTO accounts (id, name, api_key_hash, status) VALUES (?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name, api_key_hash = excluded.api_key_hash, status = excluded.status
  `);
  const upsertProfile = db.prepare<
    [
      string,
      string,
      string,
      string | null,
      number,
      string,
      string | null,
      string | null,
      string | null,
    ]
  >(`
    INSERT INTO profiles (id, account_id, title, profile_key_hash, is_primary, status,
                          tiktok_advertiser_id, tiktok_access_token, tiktok_username)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      title = excluded.title, profile_key_hash = excluded.profile_key_hash,
      status = excluded.status, tiktok_advertiser_id = excluded.tiktok_advertiser_id,
      tiktok_access_token = excluded.tiktok_access_token, tiktok_username = excluded.tiktok_username
  `);

  db.transaction(() => {
    for (const a of ACCOUNTS) {
      upsertAccount.run(a.id, a.name, hashSecret(a.apiKey), a.status);
    }
    for (const p of PROFILES) {
      upsertProfile.run(
        p.id,
        p.accountId,
        p.title,
        p.profileKey === null ? null : hashSecret(p.profileKey),
        p.profileKey === null ? 1 : 0,
        p.status,
        p.tiktok?.advertiserId ?? null,
        p.tiktok?.accessToken ?? null,
        p.tiktok?.username ?? null,
      );
    }
  })();
}
