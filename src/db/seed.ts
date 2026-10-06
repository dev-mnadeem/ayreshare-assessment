import { DEMO } from '../demo/fixtures.js';
import { hashSecret } from '../lib/secrets.js';

import type { Db } from './database.js';

export { DEMO };

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
      advertiserId: DEMO.advertisers.primary.advertiserId,
      accessToken: DEMO.advertisers.primary.accessToken,
      username: DEMO.advertisers.primary.username,
    },
  },
  {
    id: 'prof_demo_creator',
    accountId: 'acc_demo',
    title: 'Creator Studio',
    profileKey: DEMO.profileKeys.creator,
    status: 'active',
    tiktok: {
      advertiserId: DEMO.advertisers.creator.advertiserId,
      accessToken: DEMO.advertisers.creator.accessToken,
      username: DEMO.advertisers.creator.username,
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
      advertiserId: DEMO.advertisers.other.advertiserId,
      accessToken: DEMO.advertisers.other.accessToken,
      username: DEMO.advertisers.other.username,
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

  const upsertPost = db.prepare<[string, string, string]>(`
    INSERT INTO posts (id, profile_id, platform, platform_post_id) VALUES (?, ?, 'tiktok', ?)
    ON CONFLICT (id) DO UPDATE SET
      profile_id = excluded.profile_id, platform_post_id = excluded.platform_post_id
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
    for (const post of Object.values(DEMO.ayrsharePosts)) {
      upsertPost.run(post.postId, post.profileId, post.video);
    }
  })();
}
