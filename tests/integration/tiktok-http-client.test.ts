import nock from 'nock';
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';

import { TikTokError } from '../../src/integrations/tiktok/errors.js';
import { HttpTikTokClient } from '../../src/integrations/tiktok/http-client.js';
import {
  buildAdGroupPayload,
  buildAdPayload,
  buildCampaignPayload,
} from '../../src/integrations/tiktok/mapper.js';
import { RateLimiter } from '../../src/integrations/tiktok/rate-limiter.js';
import type { TikTokCallRecord } from '../../src/integrations/tiktok/types.js';
import { createLogger } from '../../src/logger.js';
import { boostRequest } from '../helpers/boost-request.js';

const HOST = 'https://sandbox-ads.tiktok.com';
const BASE = '/open_api/v1.3';

function makeClient(overrides: { timeoutMs?: number; maxRetries?: number } = {}) {
  const sleeps: number[] = [];
  const client = new HttpTikTokClient({
    baseUrl: `${HOST}${BASE}`,
    timeoutMs: overrides.timeoutMs ?? 5_000,
    limiter: new RateLimiter(0),
    logger: createLogger({ logLevel: 'silent', env: 'test' }),
    maxRetries: overrides.maxRetries ?? 2,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { client, sleeps };
}

const records: TikTokCallRecord[] = [];
const ctx = {
  advertiserId: '7100000000000000001',
  accessToken: 'tok-123',
  onCall: (r: TikTokCallRecord) => records.push(r),
};

const ok = (data: unknown, requestId = 'req-ok') => ({
  code: 0,
  message: 'OK',
  request_id: requestId,
  data,
});

const campaignPayload = () =>
  buildCampaignPayload({
    advertiserId: ctx.advertiserId,
    request: boostRequest(),
    name: 'Fall launch - bst_1',
    requestId: 'bst_1-campaign',
  });

async function caught(promise: Promise<unknown>): Promise<TikTokError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof TikTokError) return err;
    throw err;
  }
  throw new Error('expected a TikTokError');
}

beforeAll(() => {
  nock.disableNetConnect();
});
afterAll(() => {
  nock.enableNetConnect();
});
afterEach(() => {
  records.length = 0;
  expect(nock.pendingMocks()).toEqual([]);
  nock.cleanAll();
});

describe('HttpTikTokClient — success paths', () => {
  it('GET: sends Access-Token, JSON-encodes array params, maps the response', async () => {
    nock(HOST, { reqheaders: { 'Access-Token': 'tok-123' } })
      .get(`${BASE}/advertiser/info/`)
      .query({ advertiser_ids: '["7100000000000000001"]' })
      .reply(
        200,
        ok({
          list: [
            {
              advertiser_id: '7100000000000000001',
              name: 'Demo',
              currency: 'USD',
              timezone: 'Etc/GMT',
              status: 'STATUS_ENABLE',
              extra_field_we_ignore: true,
            },
          ],
        }),
      );

    await expect(makeClient().client.getAdvertiser(ctx)).resolves.toEqual({
      advertiserId: '7100000000000000001',
      name: 'Demo',
      currency: 'USD',
      timezone: 'Etc/GMT',
      status: 'STATUS_ENABLE',
    });
    expect(records).toEqual([
      expect.objectContaining({ method: 'GET', outcome: 'ok', code: 0, requestId: 'req-ok' }),
    ]);
  });

  it('POST: sends the payload as JSON and returns the new ID', async () => {
    nock(HOST)
      .post(`${BASE}/campaign/create/`, (body: Record<string, unknown>) => {
        return body['operation_status'] === 'DISABLE' && body['request_id'] === 'bst_1-campaign';
      })
      .reply(200, ok({ campaign_id: '1800000000000001' }));

    await expect(makeClient().client.createCampaign(ctx, campaignPayload())).resolves.toBe(
      '1800000000000001',
    );
  });

  it('status update posts the IDs under the level-specific field', async () => {
    nock(HOST)
      .post(`${BASE}/adgroup/status/update/`, {
        advertiser_id: ctx.advertiserId,
        adgroup_ids: ['g1'],
        operation_status: 'ENABLE',
      })
      .reply(200, ok({}));

    await makeClient().client.updateStatus(ctx, 'adgroup', ['g1'], 'ENABLE');
  });
});

describe('HttpTikTokClient — errors', () => {
  it('code ≠ 0 → TikTokError keeping code, message and request_id (HTTP 200)', async () => {
    nock(HOST).post(`${BASE}/campaign/create/`).reply(200, {
      code: 40002,
      message: 'objective_type is invalid',
      request_id: 'req-bad',
      data: {},
    });

    const err = await caught(makeClient().client.createCampaign(ctx, campaignPayload()));

    expect(err).toMatchObject({
      kind: 'invalid_request',
      code: 40002,
      tiktokMessage: 'objective_type is invalid',
      requestId: 'req-bad',
      ambiguous: false,
    });
    expect(records).toEqual([
      expect.objectContaining({ outcome: 'api_error', code: 40002, requestId: 'req-bad' }),
    ]);
  });

  it('auth codes are classified as auth', async () => {
    nock(HOST)
      .get(`${BASE}/advertiser/info/`)
      .query(true)
      .reply(200, { code: 40105, message: 'Access token expired', request_id: 'r', data: {} });

    expect((await caught(makeClient().client.getAdvertiser(ctx))).kind).toBe('auth');
  });

  it('a 200 with an unexpected data shape → malformed_response (ambiguous for writes)', async () => {
    nock(HOST)
      .post(`${BASE}/campaign/create/`)
      .reply(200, ok({ id: 'wrong-field-name' }));

    const err = await caught(makeClient().client.createCampaign(ctx, campaignPayload()));

    expect(err.kind).toBe('malformed_response');
    expect(err.tiktokMessage).toMatch(/campaign_id/);
    expect(err.ambiguous).toBe(true);
  });

  it('a non-JSON body → malformed_response', async () => {
    nock(HOST).get(`${BASE}/advertiser/info/`).query(true).reply(200, '<html>oops</html>');

    expect((await caught(makeClient({ maxRetries: 0 }).client.getAdvertiser(ctx))).kind).toBe(
      'malformed_response',
    );
  });

  it('times out slow responses', async () => {
    nock(HOST)
      .get(`${BASE}/advertiser/info/`)
      .query(true)
      .delay(3_000)
      .reply(200, ok({ list: [] }));

    const err = await caught(
      makeClient({ timeoutMs: 1_000, maxRetries: 0 }).client.getAdvertiser(ctx),
    );

    expect(err.kind).toBe('timeout');
    expect(records).toEqual([expect.objectContaining({ outcome: 'network_error' })]);
  });
});

describe('HttpTikTokClient — retry policy', () => {
  it('retries a rate-limited POST (not processed by TikTok) with backoff', async () => {
    nock(HOST)
      .post(`${BASE}/campaign/create/`)
      .times(2)
      .reply(200, { code: 40100, message: 'Too many requests', request_id: 'r', data: {} })
      .post(`${BASE}/campaign/create/`)
      .reply(200, ok({ campaign_id: 'c-1' }));
    const { client, sleeps } = makeClient();

    await expect(client.createCampaign(ctx, campaignPayload())).resolves.toBe('c-1');
    expect(sleeps).toEqual([1000, 2000]);
    expect(records.map((r) => r.outcome)).toEqual(['api_error', 'api_error', 'ok']);
  });

  it('treats HTTP 429 as a rate limit', async () => {
    nock(HOST)
      .get(`${BASE}/advertiser/info/`)
      .query(true)
      .reply(429, 'slow down')
      .get(`${BASE}/advertiser/info/`)
      .query(true)
      .reply(
        200,
        ok({
          list: [{ advertiser_id: 'a', name: 'n', currency: 'USD', status: 'STATUS_ENABLE' }],
        }),
      );

    await expect(makeClient().client.getAdvertiser(ctx)).resolves.toMatchObject({
      advertiserId: 'a',
    });
  });

  it('retries a GET on a server error', async () => {
    nock(HOST)
      .get(`${BASE}/advertiser/info/`)
      .query(true)
      .reply(503, 'unavailable')
      .get(`${BASE}/advertiser/info/`)
      .query(true)
      .reply(
        200,
        ok({
          list: [{ advertiser_id: 'a', name: 'n', currency: 'USD', status: 'STATUS_ENABLE' }],
        }),
      );

    await expect(makeClient().client.getAdvertiser(ctx)).resolves.toBeDefined();
  });

  it('never retries a POST that failed ambiguously (5xx): TikTok may have created it', async () => {
    nock(HOST).post(`${BASE}/campaign/create/`).once().reply(500, 'internal');

    const err = await caught(makeClient().client.createCampaign(ctx, campaignPayload()));

    expect(err).toMatchObject({ kind: 'server', ambiguous: true });
    expect(records).toHaveLength(1);
  });

  it('never retries a validation error', async () => {
    nock(HOST)
      .post(`${BASE}/campaign/create/`)
      .once()
      .reply(200, { code: 40001, message: 'bad', request_id: 'r', data: {} });

    await caught(makeClient().client.createCampaign(ctx, campaignPayload()));

    expect(records).toHaveLength(1);
  });

  it('gives up after maxRetries', async () => {
    nock(HOST)
      .get(`${BASE}/advertiser/info/`)
      .query(true)
      .times(3)
      .reply(200, { code: 40100, message: 'Too many requests', request_id: 'r', data: {} });

    const err = await caught(makeClient({ maxRetries: 2 }).client.getAdvertiser(ctx));

    expect(err.kind).toBe('rate_limited');
    expect(records).toHaveLength(3);
  });
});

describe('HttpTikTokClient — remaining endpoints (documents the expected response shapes)', () => {
  const identity = { identityType: 'TT_USER', identityId: 'id-1', authorizedBcId: null } as const;

  it('getIdentities: filters by type and drops non-Spark CUSTOMIZED_USER identities', async () => {
    nock(HOST)
      .get(`${BASE}/identity/get/`)
      .query({ advertiser_id: ctx.advertiserId, identity_type: 'TT_USER' })
      .reply(
        200,
        ok({
          identity_list: [
            { identity_id: 'id-1', identity_type: 'TT_USER', display_name: 'democo' },
            { identity_id: 'id-2', identity_type: 'CUSTOMIZED_USER', display_name: 'brand' },
          ],
        }),
      );

    await expect(makeClient().client.getIdentities(ctx, 'TT_USER')).resolves.toEqual([
      { identityId: 'id-1', identityType: 'TT_USER', displayName: 'democo', authorizedBcId: null },
    ]);
  });

  it('getIdentityVideo: sends identity + item, maps video_detail', async () => {
    nock(HOST)
      .get(`${BASE}/identity/video/info/`)
      .query({
        advertiser_id: ctx.advertiserId,
        identity_type: 'TT_USER',
        identity_id: 'id-1',
        item_id: '7300000000000000001',
      })
      .reply(200, ok({ video_detail: { item_id: '7300000000000000001', text: 'hello' } }));

    await expect(
      makeClient().client.getIdentityVideo(ctx, identity, '7300000000000000001'),
    ).resolves.toEqual({ itemId: '7300000000000000001', caption: 'hello' });
  });

  it('getCountryLocationIds: keeps country-level regions keyed by ISO code', async () => {
    nock(HOST)
      .get(`${BASE}/tool/region/`)
      .query({
        advertiser_id: ctx.advertiserId,
        placements: '["PLACEMENT_TIKTOK"]',
        objective_type: 'ENGAGEMENT',
      })
      .reply(
        200,
        ok({
          region_info: [
            { location_id: '6252001', region_code: 'us', level: 'COUNTRY' },
            { location_id: '5128638', region_code: 'US-NY', level: 'PROVINCE' },
          ],
        }),
      );

    const map = await makeClient().client.getCountryLocationIds(ctx, 'ENGAGEMENT');

    expect([...map]).toEqual([['US', '6252001']]);
  });

  it('authorizeSparkCode posts the code; getSparkCodeInfo parses the expiry as UTC', async () => {
    nock(HOST)
      .post(`${BASE}/tt_video/authorize/`, { advertiser_id: ctx.advertiserId, auth_code: 'CODE' })
      .reply(200, ok({}))
      .get(`${BASE}/tt_video/info/`)
      .query({ advertiser_id: ctx.advertiserId, auth_code: 'CODE' })
      .reply(
        200,
        ok({
          item_info: { item_id: '7400000000000000001', text: null },
          user_info: { identity_id: 'spark-id' },
          auth_info: { auth_end_time: '2026-11-01 10:00:00' },
        }),
      );
    const { client } = makeClient();

    await client.authorizeSparkCode(ctx, 'CODE');
    await expect(client.getSparkCodeInfo(ctx, 'CODE')).resolves.toEqual({
      itemId: '7400000000000000001',
      identityId: 'spark-id',
      identityType: 'AUTH_CODE',
      caption: null,
      authEndTime: new Date('2026-11-01T10:00:00Z'),
    });
  });

  it('createAdGroup and createAd return the new IDs', async () => {
    nock(HOST)
      .post(`${BASE}/adgroup/create/`)
      .reply(200, ok({ adgroup_id: 'g-1' }))
      .post(`${BASE}/ad/create/`)
      .reply(200, ok({ ad_ids: ['a-1'] }));
    const { client } = makeClient();
    const request = boostRequest();

    await expect(
      client.createAdGroup(ctx, {
        ...buildAdGroupPayload({
          advertiserId: ctx.advertiserId,
          campaignId: 'c-1',
          request,
          name: 'n',
          locationIds: ['6252001'],
          requestId: 'r',
        }),
      }),
    ).resolves.toBe('g-1');
    await expect(
      client.createAd(
        ctx,
        buildAdPayload({
          advertiserId: ctx.advertiserId,
          adGroupId: 'g-1',
          request,
          name: 'n',
          identity,
          itemId: '7300000000000000001',
        }),
      ),
    ).resolves.toEqual(['a-1']);
  });

  it('findIdByName: filters children by parent and matches the exact name', async () => {
    nock(HOST)
      .get(`${BASE}/adgroup/get/`)
      .query({
        advertiser_id: ctx.advertiserId,
        filtering: '{"campaign_ids":["c-1"]}',
        page_size: '100',
      })
      .reply(
        200,
        ok({
          list: [
            { adgroup_id: 'g-0', adgroup_name: 'Fall launch - bst_1 (copy)' },
            { adgroup_id: 'g-1', adgroup_name: 'Fall launch - bst_1' },
          ],
        }),
      );

    await expect(
      makeClient().client.findIdByName(ctx, 'adgroup', 'Fall launch - bst_1', 'c-1'),
    ).resolves.toBe('g-1');
  });

  it('findIdByName: returns null when nothing matches', async () => {
    nock(HOST)
      .get(`${BASE}/campaign/get/`)
      .query(true)
      .reply(200, ok({ list: [] }));

    await expect(makeClient().client.findIdByName(ctx, 'campaign', 'missing')).resolves.toBeNull();
  });
});
