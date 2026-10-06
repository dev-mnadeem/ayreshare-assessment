import { describe, expect, it } from 'vitest';

import { DEMO, seedDemoData } from '../../src/db/seed.js';
import { SqliteAuthRepository } from '../../src/modules/auth/auth-repository.js';
import { requireTikTokAdsLink } from '../../src/modules/auth/tiktok-ads-link.js';
import { AppError } from '../../src/errors/app-error.js';
import { createTestDb } from '../helpers/test-app.js';

describe('SqliteAuthRepository', () => {
  const db = createTestDb();
  const repo = new SqliteAuthRepository(db);

  it('finds an account by its API key', () => {
    expect(repo.findAccountByApiKey(DEMO.apiKey)).toEqual({
      id: 'acc_demo',
      name: 'Demo Co',
      status: 'active',
    });
  });

  it('returns undefined for an unknown API key', () => {
    expect(repo.findAccountByApiKey('nope')).toBeUndefined();
  });

  it('never stores raw keys', () => {
    const dump = JSON.stringify(db.prepare('SELECT * FROM accounts, profiles').all());

    expect(dump).not.toContain(DEMO.apiKey);
    expect(dump).not.toContain(DEMO.profileKeys.creator);
  });

  it('maps the primary profile with its linked TikTok ads account', () => {
    expect(repo.findPrimaryProfile('acc_demo')).toEqual({
      id: 'prof_demo_primary',
      accountId: 'acc_demo',
      title: 'Demo Co (primary)',
      isPrimary: true,
      status: 'active',
      tiktokAds: {
        advertiserId: DEMO.advertiserIds.primary,
        accessToken: 'mock-access-token-primary',
        username: 'democo',
      },
    });
  });

  it('maps a profile without TikTok ads to tiktokAds: null', () => {
    expect(repo.findProfileByKey('acc_demo', DEMO.profileKeys.noTikTok)?.tiktokAds).toBeNull();
  });

  it('scopes profile keys to the account', () => {
    expect(repo.findProfileByKey('acc_demo', DEMO.profileKeys.creator)?.id).toBe(
      'prof_demo_creator',
    );
    expect(repo.findProfileByKey('acc_demo', DEMO.profileKeys.otherAccount)).toBeUndefined();
  });

  it('seeding twice is idempotent', () => {
    seedDemoData(db);
    const count = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM profiles').get();

    expect(count?.n).toBe(7);
  });
});

describe('requireTikTokAdsLink', () => {
  const repo = new SqliteAuthRepository(createTestDb());

  it('returns the link when present', () => {
    const profile = repo.findProfileByKey('acc_demo', DEMO.profileKeys.creator);
    if (!profile) throw new Error('fixture missing');

    expect(requireTikTokAdsLink(profile).advertiserId).toBe(DEMO.advertiserIds.creator);
  });

  it('throws a 601 naming the profile when absent', () => {
    const profile = repo.findProfileByKey('acc_demo', DEMO.profileKeys.noTikTok);
    if (!profile) throw new Error('fixture missing');

    expect(() => requireTikTokAdsLink(profile)).toThrow(AppError);
    try {
      requireTikTokAdsLink(profile);
    } catch (err) {
      expect((err as AppError).toEnvelope()).toMatchObject({
        code: 601,
        action: 'boost post',
        details: expect.stringContaining('"No TikTok Ads"') as unknown,
      });
    }
  });
});
