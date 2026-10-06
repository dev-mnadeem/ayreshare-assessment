import { describe, expect, it } from 'vitest';

import { DEMO } from '../../src/demo/fixtures.js';
import { boostRequest } from '../helpers/boost-request.js';
import { appError, GENEROUS_LIMITS, setupBoostService } from '../helpers/boost-service.js';

// A 7-day, $20/day boost has a worst-case spend of $140.
const SEVEN_DAYS_AT_20 = 14_000;

describe('spend caps', () => {
  it('rejects a boost whose worst-case spend exceeds the per-boost cap (604), before any TikTok call', async () => {
    const s = setupBoostService({ ...GENEROUS_LIMITS, maxSpendPerBoostCents: 13_999 });

    const env = await appError(s.service.boost(s.auth(), boostRequest()));

    expect(env).toMatchObject({ code: 604, action: 'boost post' });
    expect(env.details).toBe(
      'This boost could spend up to 140.00 USD (20.00 USD/day × 7 days), above the per-boost limit of 139.99 USD. Lower the budget or shorten the schedule.',
    );
    expect(s.tiktok.calls).toEqual([]);
  });

  it('accepts a boost exactly at the per-boost cap', async () => {
    const s = setupBoostService({ ...GENEROUS_LIMITS, maxSpendPerBoostCents: SEVEN_DAYS_AT_20 });

    await expect(s.service.boost(s.auth(), boostRequest())).resolves.toMatchObject({
      status: 'live',
    });
  });

  it('counts running boosts towards the per-profile cap', async () => {
    const s = setupBoostService({
      maxSpendPerBoostCents: SEVEN_DAYS_AT_20,
      maxSpendPerProfileCents: 2 * SEVEN_DAYS_AT_20,
    });

    await s.service.boost(s.auth(), boostRequest());
    await s.service.boost(s.auth(), boostRequest({ status: 'paused' })); // paused still counts
    const env = await appError(s.service.boost(s.auth(), boostRequest()));

    expect(env.code).toBe(604);
    expect(env.details).toMatch(
      /running boosts could already spend up to 280.00 USD; this boost adds up to 140.00 USD, above the profile limit of 280.00 USD/,
    );
  });

  it('does not count failed boosts or boosts of other profiles', async () => {
    const s = setupBoostService({
      maxSpendPerBoostCents: SEVEN_DAYS_AT_20,
      maxSpendPerProfileCents: SEVEN_DAYS_AT_20,
    });
    s.tiktok.failNext('createAd', { kind: 'api', code: 40002, message: 'no' });

    await appError(s.service.boost(s.auth(), boostRequest())); // fails, rolled back
    await s.service.boost(
      s.auth(DEMO.profileKeys.creator),
      boostRequest({
        tiktokPostId: DEMO.advertisers.creator.videoIds[0],
      }),
    );

    await expect(s.service.boost(s.auth(), boostRequest())).resolves.toMatchObject({
      status: 'live',
    });
  });

  it('re-checks the profile cap atomically at insert (two boosts racing through pre-flight)', async () => {
    const s = setupBoostService({
      maxSpendPerBoostCents: SEVEN_DAYS_AT_20,
      maxSpendPerProfileCents: SEVEN_DAYS_AT_20,
    });

    const results = await Promise.allSettled([
      s.service.boost(s.auth(), boostRequest()),
      s.service.boost(s.auth(), boostRequest()),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ definition: { code: 604 } });
    expect(s.tiktok.listObjects('campaign')).toHaveLength(1);
  });
});

describe('dry run (preview)', () => {
  it('runs caps and pre-flight, returns the plan and spend picture, and creates nothing', async () => {
    const s = setupBoostService();

    const preview = await s.service.preview(s.auth(), boostRequest());

    expect(preview).toMatchObject({
      maxSpendCents: SEVEN_DAYS_AT_20,
      committedSpendCents: 0,
      limits: GENEROUS_LIMITS,
      plan: {
        advertiserId: DEMO.advertisers.primary.advertiserId,
        identity: { identityType: 'TT_USER' },
        tiktokItemId: DEMO.advertisers.primary.videoIds[0],
        locationIds: ['6252001'],
      },
    });
    expect(s.tiktok.listObjects()).toEqual([]);
    expect(s.tiktok.calls.map((c) => c.method)).not.toContain('authorizeSparkCode');
    expect(s.db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM boosts').get()?.n).toBe(0);
  });

  it('surfaces the same errors a real boost would', async () => {
    const s = setupBoostService();

    const env = await appError(
      s.service.preview(s.auth(), boostRequest({ tiktokPostId: undefined, authCode: 'BAD' })),
    );

    expect(env.code).toBe(602);
  });

  it('enforces spend caps too', async () => {
    const s = setupBoostService({ ...GENEROUS_LIMITS, maxSpendPerBoostCents: 100 });

    expect((await appError(s.service.preview(s.auth(), boostRequest()))).code).toBe(604);
  });
});

describe('audit trail', () => {
  it('records start, every TikTok call and success, correlated by request and boost ID', async () => {
    const s = setupBoostService();

    const record = await s.service.boost(s.auth(), boostRequest(), { requestId: 'req-1' });
    const events = s.audit.listByBoostId(record.id);
    const types = events.map((e) => e.type);

    expect(types[0]).toBe('tiktok.call');
    expect(types).toContain('boost.started');
    expect(types.at(-1)).toBe('boost.succeeded');
    expect(types.filter((t) => t === 'tiktok.call')).toHaveLength(record.tiktokRequestIds.length);
    expect(
      events.every((e) => e.requestId === 'req-1' && e.profileId === 'prof_demo_primary'),
    ).toBe(true);
    expect(events.at(-1)?.data).toEqual({
      status: 'live',
      campaignId: record.campaignId,
      adGroupId: record.adGroupId,
      adId: record.adId,
    });
  });

  it('records rejections with the error code', async () => {
    const s = setupBoostService();

    await appError(
      s.service.boost(
        s.auth(),
        boostRequest({ tiktokPostId: DEMO.advertisers.other.videoIds[0] }),
        {
          requestId: 'req-2',
        },
      ),
    );

    expect(s.audit.listByRequestId('req-2').at(-1)).toMatchObject({
      type: 'boost.rejected',
      data: { code: 603 },
    });
  });

  it('records failures with orphans and the step that failed', async () => {
    const s = setupBoostService();
    s.tiktok.failNext('createAdGroup', { kind: 'api', code: 40002, message: 'Invalid bid' });
    s.tiktok.failNext('updateStatus', { kind: 'server' });

    await appError(s.service.boost(s.auth(), boostRequest(), { requestId: 'req-3' }));
    const failed = s.audit.listByRequestId('req-3').find((e) => e.type === 'boost.failed');

    expect(failed?.data).toMatchObject({
      step: 'adgroup',
      code: 610,
      orphans: [expect.objectContaining({ level: 'campaign', state: 'disabled' })],
    });
  });

  it('never stores access tokens or Spark codes', async () => {
    const s = setupBoostService();

    await s.service.boost(
      s.auth(),
      boostRequest({ tiktokPostId: undefined, authCode: DEMO.sparkCodes.valid }),
      { requestId: 'req-4' },
    );
    const dump = JSON.stringify(s.db.prepare('SELECT * FROM audit_events, boosts').all());

    expect(dump).not.toContain(DEMO.sparkCodes.valid);
    expect(dump).not.toContain(DEMO.advertisers.primary.accessToken);
    expect(dump).toContain('****CODE');
  });
});
