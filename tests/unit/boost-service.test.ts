import { describe, expect, it } from 'vitest';

import { DEMO } from '../../src/demo/fixtures.js';
import { TikTokError } from '../../src/integrations/tiktok/errors.js';
import type { TikTokCallRecord } from '../../src/integrations/tiktok/types.js';
import { boostRequest } from '../helpers/boost-request.js';
import { appError, setupBoostService } from '../helpers/boost-service.js';

const primary = DEMO.advertisers.primary;
const setup = setupBoostService;
type Setup = ReturnType<typeof setup>;

describe('BoostService — happy paths', () => {
  it('boosts an own post by tiktokPostId: creates disabled, then enables all three', async () => {
    const { service, boosts, auth, statuses } = setup();

    const record = await service.boost(auth(), boostRequest());

    expect(record).toMatchObject({
      id: 'bst_test1',
      status: 'live',
      advertiserId: primary.advertiserId,
      identityType: 'TT_USER',
      identityId: primary.identityId,
      tiktokItemId: primary.videoIds[0],
      postKind: 'tiktok_post',
      maxSpendCents: 14_000,
      errorCode: null,
    });
    expect(record.campaignId && record.adGroupId && record.adId).toBeTruthy();
    expect(statuses()).toEqual({ campaign: 'ENABLE', adgroup: 'ENABLE', ad: 'ENABLE' });
    expect(boosts.findById('bst_test1')).toEqual(record);
  });

  it('creates every object DISABLED and enables ad → ad group → campaign last', async () => {
    const { service, tiktok, auth } = setup();

    await service.boost(auth(), boostRequest());

    const creates = tiktok.calls.filter((c) => c.method.startsWith('create'));
    for (const { args } of creates) {
      expect(JSON.stringify(args)).toContain('"operation_status":"DISABLE"');
    }
    const enables = tiktok.calls
      .filter((c) => c.method === 'updateStatus')
      .map((c) => [c.args[0], c.args[2]]);
    expect(enables).toEqual([
      ['ad', 'ENABLE'],
      ['adgroup', 'ENABLE'],
      ['campaign', 'ENABLE'],
    ]);
  });

  it('embeds the boost ID in every TikTok object name and request_id', async () => {
    const { service, tiktok, auth } = setup();

    await service.boost(auth(), boostRequest({ adName: 'Spring' }));

    expect(tiktok.listObjects().map((o) => o.name)).toEqual([
      'Spring - bst_test1',
      'Spring - bst_test1',
      'Spring - bst_test1',
    ]);
    expect(tiktok.listObjects('campaign')[0]?.payload).toMatchObject({
      request_id: 'bst_test1-campaign',
    });
  });

  it('resolves an Ayrshare postId to its TikTok video', async () => {
    const { service, auth } = setup();
    const post = DEMO.ayrsharePosts.primarySecond;

    const record = await service.boost(
      auth(),
      boostRequest({ tiktokPostId: undefined, postId: post.postId }),
    );

    expect(record).toMatchObject({
      postKind: 'ayrshare_post',
      ayrsharePostId: post.postId,
      tiktokItemId: post.video,
    });
  });

  it('boosts a creator post with a Spark authCode (AUTH_CODE identity), masking the code', async () => {
    const { service, tiktok, auth } = setup();

    const record = await service.boost(
      auth(),
      boostRequest({ tiktokPostId: undefined, authCode: DEMO.sparkCodes.valid }),
    );

    expect(record).toMatchObject({
      status: 'live',
      identityType: 'AUTH_CODE',
      identityId: DEMO.sparkVideo.identityId,
      tiktokItemId: DEMO.sparkVideo.itemId,
    });
    expect(tiktok.callCount('authorizeSparkCode')).toBe(1);
    expect(JSON.stringify(record.request)).not.toContain(DEMO.sparkCodes.valid);
    expect(record.request['post']).toEqual({ kind: 'spark_auth_code', authCode: '****CODE' });
  });

  it('status "paused" leaves every object disabled and never enables anything', async () => {
    const { service, tiktok, auth, statuses } = setup();

    const record = await service.boost(auth(), boostRequest({ status: 'paused' }));

    expect(record.status).toBe('paused');
    expect(statuses()).toEqual({ campaign: 'DISABLE', adgroup: 'DISABLE', ad: 'DISABLE' });
    expect(tiktok.callCount('updateStatus')).toBe(0);
  });

  it('records TikTok request_ids and forwards every call to onTikTokCall', async () => {
    const { service, auth } = setup();
    const seen: TikTokCallRecord[] = [];

    const record = await service.boost(auth(), boostRequest(), {
      onTikTokCall: (r) => seen.push(r),
    });

    expect(seen.length).toBeGreaterThanOrEqual(10);
    expect(record.tiktokRequestIds).toEqual(seen.map((r) => r.requestId));
  });
});

describe('BoostService — pre-flight failures create nothing', () => {
  it.each([
    [
      'profile without TikTok ads',
      (s: Setup) => s.service.boost(s.auth(DEMO.profileKeys.noTikTok), boostRequest()),
      601,
      /no linked TikTok ads account/,
    ],
    [
      'non-USD ad account',
      (s: Setup) => {
        s.tiktok.setAdvertiserCurrency(primary.advertiserId, 'EUR');
        return s.service.boost(s.auth(), boostRequest());
      },
      601,
      /billed in EUR/,
    ],
    [
      'unknown Ayrshare postId',
      (s: Setup) =>
        s.service.boost(s.auth(), boostRequest({ tiktokPostId: undefined, postId: 'nope' })),
      603,
      /postId "nope" is not a TikTok post published by this profile/,
    ],
    [
      "another profile's Ayrshare postId",
      (s: Setup) =>
        s.service.boost(
          s.auth(),
          boostRequest({ tiktokPostId: undefined, postId: DEMO.ayrsharePosts.creator.postId }),
        ),
      603,
      /not a TikTok post published by this profile/,
    ],
    [
      'video not owned by the linked account',
      (s: Setup) =>
        s.service.boost(
          s.auth(),
          boostRequest({ tiktokPostId: DEMO.advertisers.other.videoIds[0] }),
        ),
      603,
      /could not load the post/,
    ],
    [
      'invalid Spark code',
      (s: Setup) =>
        s.service.boost(s.auth(), boostRequest({ tiktokPostId: undefined, authCode: 'BAD' })),
      602,
      /Ask the creator for a new Spark authorization code/,
    ],
    [
      'Spark authorization ending before endDate',
      (s: Setup) => {
        s.tiktok.setSparkAuthEndTime(new Date('2026-10-10T00:00:00Z'));
        return s.service.boost(
          s.auth(),
          boostRequest({ tiktokPostId: undefined, authCode: DEMO.sparkCodes.valid }),
        );
      },
      602,
      /authorization for this post ends at 2026-10-10T00:00:00.000Z, before endDate/,
    ],
    [
      'country TikTok cannot target',
      (s: Setup) =>
        s.service.boost(s.auth(), boostRequest({ locations: { countries: ['US', 'ZZ'] } })),
      101,
      /locations.countries contains codes TikTok cannot target for this ad account: ZZ/,
    ],
    [
      'TikTok rejecting the access token',
      (s: Setup) => {
        s.tiktok.failNext('getAdvertiser', { kind: 'api', code: 40105, message: 'expired' });
        return s.service.boost(s.auth(), boostRequest());
      },
      601,
      /Re-link the TikTok Ads Manager account/,
    ],
  ])('%s → %i', async (_name, run, code, details) => {
    const s = setup();

    const env = await appError(run(s));

    expect(env.code).toBe(code);
    expect(env.details).toMatch(details);
    expect(s.tiktok.listObjects()).toEqual([]);
    expect(s.boosts.findById('bst_test1')).toBeUndefined();
  });

  it('plan() with dryRun inspects a Spark code without authorizing it', async () => {
    const { service, tiktok, auth } = setup();

    const plan = await service.plan(
      auth(),
      boostRequest({ tiktokPostId: undefined, authCode: DEMO.sparkCodes.valid }),
      { dryRun: true },
    );

    expect(plan).toMatchObject({
      identity: { identityType: 'AUTH_CODE' },
      tiktokItemId: DEMO.sparkVideo.itemId,
      locationIds: ['6252001'],
    });
    expect(tiktok.callCount('authorizeSparkCode')).toBe(0);
    expect(tiktok.listObjects()).toEqual([]);
  });
});

describe('BoostService — failures during creation roll back', () => {
  it('ad group rejected → campaign deleted, boost failed, 605 says nothing was spent', async () => {
    const { service, tiktok, boosts, auth } = setup();
    tiktok.failNext('createAdGroup', { kind: 'api', code: 40002, message: 'Invalid bid' });

    const env = await appError(service.boost(auth(), boostRequest()));

    expect(env.code).toBe(605);
    expect(env.details).toMatch(/creating the ad group: Invalid bid/);
    expect(env.details).toMatch(
      /Everything created for this boost was deleted.*no money was spent/,
    );
    expect(tiktok.listObjects().map((o) => [o.level, o.status])).toEqual([['campaign', 'DELETE']]);
    expect(boosts.findById('bst_test1')).toMatchObject({
      status: 'failed',
      errorCode: 605,
      orphans: [],
    });
  });

  it('ad rejected → ad group and campaign deleted (children first)', async () => {
    const { service, tiktok, auth } = setup();
    tiktok.failNext('createAd', { kind: 'api', code: 40002, message: 'Video not eligible' });

    await appError(service.boost(auth(), boostRequest()));

    const deletes = tiktok.calls
      .filter((c) => c.method === 'updateStatus')
      .map((c) => [c.args[0], c.args[2]]);
    expect(deletes).toEqual([
      ['adgroup', 'DELETE'],
      ['campaign', 'DELETE'],
    ]);
    expect(tiktok.listObjects().every((o) => o.status === 'DELETE')).toBe(true);
  });

  it('activation failure → everything deleted (nothing left enabled)', async () => {
    const { service, tiktok, boosts, auth } = setup();
    tiktok.failNext('updateStatus', { kind: 'api', code: 40002, message: 'Ad under review' });

    const env = await appError(service.boost(auth(), boostRequest()));

    expect(env.code).toBe(605);
    expect(env.details).toMatch(/activating the ad/);
    expect(tiktok.listObjects().map((o) => o.status)).toEqual(['DELETE', 'DELETE', 'DELETE']);
    expect(boosts.findById('bst_test1')?.status).toBe('failed');
  });

  it('rate limit during creation → 606 and cleanup', async () => {
    const { service, tiktok, auth } = setup();
    tiktok.failNext('createAd', { kind: 'rate_limit' });

    const env = await appError(service.boost(auth(), boostRequest()));

    expect(env.code).toBe(606);
    expect(tiktok.listObjects().every((o) => o.status === 'DELETE')).toBe(true);
  });

  it('a failed delete falls back to disabling and is reported as an orphan (610)', async () => {
    const { service, tiktok, boosts, auth } = setup();
    tiktok.failNext('createAdGroup', { kind: 'api', code: 40002, message: 'Invalid bid' });
    tiktok.failNext('updateStatus', { kind: 'server' }); // DELETE campaign fails; DISABLE works

    const env = await appError(service.boost(auth(), boostRequest()));
    const campaign = tiktok.listObjects('campaign')[0];

    expect(env.code).toBe(610);
    expect(env.details).toMatch(/Boost failed \(code 605\): .*Invalid bid/);
    expect(env.details).toContain(`campaign ${campaign?.id ?? ''} (disabled)`);
    expect(env.details).toMatch(/They are disabled, so they cannot spend/);
    expect(env.details).toContain('bst_test1');
    expect(campaign?.status).toBe('DISABLE');
    expect(boosts.findById('bst_test1')).toMatchObject({
      status: 'cleanup_failed',
      errorCode: 610,
      orphans: [{ level: 'campaign', id: campaign?.id, state: 'disabled' }],
    });
  });

  it('warns loudly when an enabled object could not be disabled', async () => {
    const { service, tiktok, auth } = setup();
    // Enabling the ad and ad group succeeds; from the campaign enable on, every status call fails.
    const original = tiktok.updateStatus.bind(tiktok);
    let calls = 0;
    tiktok.updateStatus = (...args) => {
      calls++;
      return calls >= 3
        ? Promise.reject(
            new TikTokError({ kind: 'server', method: 'POST', endpoint: '/x/status/update/' }),
          )
        : original(...args);
    };

    const env = await appError(service.boost(auth(), boostRequest()));

    expect(env.code).toBe(610);
    expect(env.details).toMatch(/ad \S+ \(enabled\)/);
    expect(env.details).toMatch(/adgroup \S+ \(enabled\)/);
    expect(env.details).toMatch(/campaign \S+ \(disabled\)/);
    expect(env.details).toMatch(/may still be enabled — pause it in TikTok Ads Manager now/);
  });
});

describe('BoostService — ambiguous creates are reconciled, never retried', () => {
  it('lost response but object created → found by name, boost continues', async () => {
    const { service, tiktok, auth } = setup();
    tiktok.failNext('createCampaign', { kind: 'timeout', afterSend: true });

    const record = await service.boost(auth(), boostRequest());

    expect(record.status).toBe('live');
    expect(tiktok.listObjects('campaign')).toHaveLength(1);
    expect(tiktok.callCount('createCampaign')).toBe(1);
    expect(tiktok.callCount('findIdByName')).toBe(1);
    expect(record.campaignId).toBe(tiktok.listObjects('campaign')[0]?.id);
  });

  it('timeout and object absent → treated as a clean failure (607)', async () => {
    const { service, tiktok, boosts, auth } = setup();
    tiktok.failNext('createAdGroup', { kind: 'timeout' });

    const env = await appError(service.boost(auth(), boostRequest()));

    expect(env.code).toBe(607);
    expect(tiktok.callCount('createAdGroup')).toBe(1);
    expect(tiktok.listObjects('adgroup')).toEqual([]);
    expect(tiktok.listObjects('campaign')[0]?.status).toBe('DELETE');
    expect(boosts.findById('bst_test1')?.status).toBe('failed');
  });

  it('timeout and the lookup also fails → reported as possibly existing (disabled)', async () => {
    const { service, tiktok, boosts, auth } = setup();
    tiktok.failNext('createAd', { kind: 'timeout', afterSend: true });
    tiktok.failNext('findIdByName', { kind: 'server' }, 3);

    const env = await appError(service.boost(auth(), boostRequest({ adName: 'Lost' })));

    expect(env.code).toBe(610);
    expect(env.details).toMatch(/ad "Lost - bst_test1" may exist \(created disabled\)/);
    expect(boosts.findById('bst_test1')?.orphans).toEqual([
      { level: 'ad', id: null, name: 'Lost - bst_test1', state: 'disabled' },
    ]);
  });
});

describe('BoostService — unexpected errors', () => {
  it('rolls back and rethrows non-TikTok errors unchanged (→ 500 upstream)', async () => {
    const { service, tiktok, boosts, auth } = setup();
    tiktok.createAd = () => Promise.reject(new TypeError('bug'));

    await expect(service.boost(auth(), boostRequest())).rejects.toThrow(TypeError);
    expect(tiktok.listObjects().every((o) => o.status === 'DELETE')).toBe(true);
    expect(boosts.findById('bst_test1')).toMatchObject({ status: 'failed', errorCode: 612 });
  });
});
