import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DEMO } from '../../src/demo/fixtures.js';
import { MockTikTokClient } from '../../src/integrations/tiktok/mock-client.js';
import { boostBody } from '../helpers/boost-request.js';
import { createTestDb, testDeps } from '../helpers/test-app.js';

const PATH = '/api/ads/tiktok/boost';

function setup(env: NodeJS.ProcessEnv = {}) {
  const db = createTestDb();
  const tiktok = new MockTikTokClient();
  let seq = 0;
  const deps = testDeps({}, { db, tiktok, env, newBoostId: () => `bst_e2e${String(++seq)}` });
  const app = createApp(deps);

  const post = (
    body: unknown,
    headers: Record<string, string> = {},
    apiKey: string = DEMO.apiKey,
  ) => {
    const req = request(app).post(PATH).set('Authorization', `Bearer ${apiKey}`);
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    return req.send(body as object);
  };
  const get = (id: string, headers: Record<string, string> = {}) => {
    const req = request(app).get(`${PATH}/${id}`).set('Authorization', `Bearer ${DEMO.apiKey}`);
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    return req;
  };
  const auditTypes = (requestId: string) =>
    deps.tiktokBoost.audit.listByRequestId(requestId).map((e) => e.type);

  return { app, db, tiktok, post, get, auditTypes };
}

describe('POST /api/ads/tiktok/boost — success', () => {
  it('boosts an own TikTok post and returns everything needed to render and look it up', async () => {
    const s = setup();

    const res = await s.post(boostBody({ adName: 'Fall launch', interests: ['25'] }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'success',
      id: 'bst_e2e1',
      boostStatus: 'live',
      adId: expect.stringMatching(/^1830\d+$/) as unknown,
      adGroupId: expect.stringMatching(/^1820\d+$/) as unknown,
      campaignId: expect.stringMatching(/^1810\d+$/) as unknown,
      adName: 'Fall launch - bst_e2e1',
      adStatus: 'active',
      advertiserId: DEMO.advertisers.primary.advertiserId,
      goal: {
        type: 'engagement',
        title: 'Get More Engagement',
        description: expect.any(String) as unknown,
      },
      budget: 20,
      budgetType: 'daily',
      bidAmount: null,
      maxSpend: 140,
      startDate: '2026-10-06T12:00:00.000Z',
      endDate: '2026-10-13T12:00:00.000Z',
      minAge: 18,
      maxAge: 65,
      gender: 'all',
      locations: { countries: ['US'], locationIds: [] },
      interests: ['25'],
      callToAction: null,
      postId: null,
      tiktokPostId: DEMO.advertisers.primary.videoIds[0],
      authorizationType: 'linked_account',
      createdAt: '2026-10-06T12:00:00.000Z',
    });
    expect(s.tiktok.listObjects().map((o) => o.status)).toEqual(['ENABLE', 'ENABLE', 'ENABLE']);
  });

  it('boosts by Ayrshare postId with a Profile-Key', async () => {
    const s = setup();
    const post = DEMO.ayrsharePosts.creator;

    const res = await s.post(boostBody({ tiktokPostId: undefined, postId: post.postId }), {
      'Profile-Key': DEMO.profileKeys.creator,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      postId: post.postId,
      tiktokPostId: post.video,
      advertiserId: DEMO.advertisers.creator.advertiserId,
    });
  });

  it('boosts a creator post with a Spark authCode, never echoing the code', async () => {
    const s = setup();

    const res = await s.post(
      boostBody({ tiktokPostId: undefined, authCode: DEMO.sparkCodes.valid }),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      authorizationType: 'spark_code',
      tiktokPostId: DEMO.sparkVideo.itemId,
    });
    expect(JSON.stringify(res.body)).not.toContain(DEMO.sparkCodes.valid);
  });

  it('a traffic boost returns its call to action; status "paused" creates it switched off', async () => {
    const s = setup();

    const res = await s.post(
      boostBody({
        goal: 'traffic',
        status: 'paused',
        callToAction: { type: 'shop_now', link: 'https://shop.example.com' },
      }),
    );

    expect(res.body).toMatchObject({
      boostStatus: 'paused',
      adStatus: 'paused',
      goal: { type: 'traffic' },
      callToAction: { type: 'SHOP_NOW', link: 'https://shop.example.com' },
    });
    expect(s.tiktok.listObjects().every((o) => o.status === 'DISABLE')).toBe(true);
  });
});

describe('POST /api/ads/tiktok/boost — dry run', () => {
  it('validates, runs pre-flight, returns the plan and creates nothing', async () => {
    const s = setup();

    const res = await s.post(boostBody({ dryRun: true, locations: { countries: ['US', 'GB'] } }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'success',
      dryRun: true,
      adName: 'Fall launch',
      adStatus: 'active',
      maxSpend: 140,
      committedSpend: 0,
      limits: { maxSpendPerBoost: 5000, maxSpendPerProfile: 20000 },
      targetLocationIds: ['6252001', '2635167'],
      tiktokPostId: DEMO.advertisers.primary.videoIds[0],
    });
    expect(res.body).not.toHaveProperty('id');
    expect(s.tiktok.listObjects()).toEqual([]);
    expect(s.auditTypes(String(res.headers['x-request-id']))).toContain('boost.dry_run');
  });
});

describe('POST /api/ads/tiktok/boost — rejected before anything is created', () => {
  it('401 without an API key', async () => {
    const s = setup();

    const res = await request(s.app).post(PATH).send(boostBody());

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 102 });
  });

  it('400/101 listing every problem, and audited', async () => {
    const s = setup();

    const res = await s.post({ adName: '', budget: 5, goal: 'sales' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      action: 'request',
      status: 'error',
      code: 101,
      message:
        'Missing or incorrect parameters. Please verify with the docs. https://www.ayrshare.com/docs/apis',
      details:
        'Missing required fields: postId, tiktokPostId or authCode, endDate. Invalid fields: adName must not be empty; goal must be one of: engagement, video_views, reach, traffic.',
    });
    expect(s.auditTypes(String(res.headers['x-request-id']))).toEqual(['boost.rejected']);
    expect(s.tiktok.calls).toEqual([]);
  });

  it('400/101 for a malformed JSON body', async () => {
    const s = setup();

    const res = await request(s.app)
      .post(PATH)
      .set('Authorization', `Bearer ${DEMO.apiKey}`)
      .set('Content-Type', 'application/json')
      .send('{"budget": ');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 101 });
  });

  it('601 for a profile without a linked TikTok ads account', async () => {
    const s = setup();

    const res = await s.post(boostBody(), { 'Profile-Key': DEMO.profileKeys.noTikTok });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 601, action: 'boost post' });
  });

  it('604 when the worst-case spend exceeds the per-boost cap', async () => {
    const s = setup({ MAX_SPEND_PER_BOOST: '100' });

    const res = await s.post(boostBody());

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 604 });
    expect(s.tiktok.calls).toEqual([]);
  });
});

describe('POST /api/ads/tiktok/boost — TikTok failures', () => {
  it('605 with a rollback note when TikTok rejects the ad group', async () => {
    const s = setup();
    s.tiktok.failNext('createAdGroup', { kind: 'api', code: 40002, message: 'Invalid bid' });

    const res = await s.post(boostBody());

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 605, action: 'boost post' });
    expect((res.body as { details: string }).details).toMatch(
      /Invalid bid .*Everything created for this boost was deleted.*no money was spent/,
    );
  });

  it('610 (500) listing orphans when cleanup fails', async () => {
    const s = setup();
    s.tiktok.failNext('createAd', { kind: 'api', code: 40002, message: 'nope' });
    s.tiktok.failNext('updateStatus', { kind: 'server' }, 4); // every delete and disable fails

    const res = await s.post(boostBody());

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: 610 });
    expect((res.body as { details: string }).details).toMatch(/adgroup \d+ \(disabled\)/);
  });
});

describe('POST /api/ads/tiktok/boost — Idempotency-Key', () => {
  it('a retried request replays the original response and creates nothing new', async () => {
    const s = setup();
    const headers = { 'Idempotency-Key': 'boost-123' };

    const first = await s.post(boostBody(), headers);
    const retry = await s.post(boostBody(), headers);

    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(s.tiktok.listObjects('campaign')).toHaveLength(1);
  });

  it('608 when the key is reused for a different boost', async () => {
    const s = setup();

    await s.post(boostBody(), { 'Idempotency-Key': 'boost-123' });
    const res = await s.post(boostBody({ budget: 50 }), { 'Idempotency-Key': 'boost-123' });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 608 });
  });

  it('after a 606 rate limit, the same key retries for real and succeeds', async () => {
    const s = setup();
    s.tiktok.failNext('createCampaign', { kind: 'rate_limit' });
    const headers = { 'Idempotency-Key': 'boost-456' };

    const first = await s.post(boostBody(), headers);
    const retry = await s.post(boostBody(), headers);

    expect(first.status).toBe(429);
    expect(first.body).toMatchObject({ code: 606 });
    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
  });
});

describe('GET /api/ads/tiktok/boost/:id', () => {
  it('returns a boost created by this profile in the same shape as POST', async () => {
    const s = setup();
    const created = await s.post(boostBody());

    const res = await s.get('bst_e2e1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(created.body);
  });

  it('shows the error and orphans of a failed boost', async () => {
    const s = setup();
    s.tiktok.failNext('createAd', { kind: 'api', code: 40002, message: 'nope' });
    s.tiktok.failNext('updateStatus', { kind: 'server' }, 4);
    await s.post(boostBody());

    const res = await s.get('bst_e2e1');

    expect(res.body).toMatchObject({
      boostStatus: 'cleanup_failed',
      adStatus: null,
      error: { code: 610 },
      orphans: [
        expect.objectContaining({ level: 'adgroup' }),
        expect.objectContaining({ level: 'campaign' }),
      ],
    });
  });

  it.each([
    ['an unknown ID', 'bst_missing', {}],
    ["another profile's boost", 'bst_e2e1', { 'Profile-Key': DEMO.profileKeys.creator }],
  ])('404/615 for %s', async (_name, id, headers) => {
    const s = setup();
    await s.post(boostBody());

    const res = await s.get(id, headers);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 615 });
  });
});
