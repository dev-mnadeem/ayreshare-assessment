import { describe, expect, it } from 'vitest';

import { DEMO } from '../../src/demo/fixtures.js';
import {
  buildAdGroupPayload,
  buildAdPayload,
  buildCampaignPayload,
} from '../../src/integrations/tiktok/mapper.js';
import { TikTokError } from '../../src/integrations/tiktok/errors.js';
import { MockTikTokClient } from '../../src/integrations/tiktok/mock-client.js';
import type { TikTokCallContext, TikTokCallRecord } from '../../src/integrations/tiktok/types.js';
import { boostRequest } from '../helpers/boost-request.js';

const primary = DEMO.advertisers.primary;
const ctx: TikTokCallContext = {
  advertiserId: primary.advertiserId,
  accessToken: primary.accessToken,
};
const identity = {
  identityType: 'TT_USER',
  identityId: primary.identityId,
  authorizedBcId: null,
} as const;

async function createAll(client: MockTikTokClient, request = boostRequest()) {
  const campaignId = await client.createCampaign(
    ctx,
    buildCampaignPayload({ advertiserId: ctx.advertiserId, request, name: 'C', requestId: 'r-c' }),
  );
  const adGroupId = await client.createAdGroup(
    ctx,
    buildAdGroupPayload({
      advertiserId: ctx.advertiserId,
      campaignId,
      request,
      name: 'G',
      locationIds: ['6252001'],
      requestId: 'r-g',
    }),
  );
  const [adId] = await client.createAd(
    ctx,
    buildAdPayload({
      advertiserId: ctx.advertiserId,
      adGroupId,
      request,
      name: 'A',
      identity,
      itemId: primary.videoIds[0],
    }),
  );
  return { campaignId, adGroupId, adId: adId ?? '' };
}

async function caught(promise: Promise<unknown>): Promise<TikTokError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof TikTokError) return err;
    throw err;
  }
  throw new Error('expected a TikTokError');
}

describe('MockTikTokClient — pre-flight', () => {
  const client = new MockTikTokClient();

  it('returns the advertiser for a valid token', async () => {
    await expect(client.getAdvertiser(ctx)).resolves.toMatchObject({
      advertiserId: primary.advertiserId,
      currency: 'USD',
    });
  });

  it('rejects a wrong access token as an auth error', async () => {
    const err = await caught(client.getAdvertiser({ ...ctx, accessToken: 'stolen' }));

    expect(err).toMatchObject({ kind: 'auth', code: 40104 });
  });

  it("lists the advertiser's TT_USER identity and only its own videos", async () => {
    await expect(client.getIdentities(ctx, 'TT_USER')).resolves.toEqual([
      expect.objectContaining({ identityId: primary.identityId }),
    ]);
    await expect(client.getIdentityVideo(ctx, identity, primary.videoIds[0])).resolves.toEqual({
      itemId: primary.videoIds[0],
      caption: expect.any(String) as unknown,
    });
    const err = await caught(
      client.getIdentityVideo(ctx, identity, DEMO.advertisers.creator.videoIds[0]),
    );
    expect(err.kind).toBe('invalid_request');
  });

  it('serves country → location ID mappings', async () => {
    expect((await client.getCountryLocationIds(ctx, 'ENGAGEMENT')).get('US')).toBe('6252001');
  });
});

describe('MockTikTokClient — Spark codes', () => {
  it('authorizes a valid code and returns its post and identity', async () => {
    const client = new MockTikTokClient();

    await client.authorizeSparkCode(ctx, DEMO.sparkCodes.valid);

    await expect(client.getSparkCodeInfo(ctx, DEMO.sparkCodes.valid)).resolves.toMatchObject({
      itemId: DEMO.sparkVideo.itemId,
      identityId: DEMO.sparkVideo.identityId,
      identityType: 'AUTH_CODE',
    });
  });

  it.each([
    [DEMO.sparkCodes.expired, /expired/],
    ['NOT-A-CODE', /Invalid auth code/],
  ])('rejects %s', async (code, message) => {
    const err = await caught(new MockTikTokClient().authorizeSparkCode(ctx, code));

    expect(err.kind).toBe('invalid_request');
    expect(err.tiktokMessage).toMatch(message);
  });
});

describe('MockTikTokClient — creation', () => {
  it('creates campaign, ad group and ad, all DISABLED, linked to their parents', async () => {
    const client = new MockTikTokClient();
    const { campaignId, adGroupId, adId } = await createAll(client);

    expect(client.getObject(campaignId)).toMatchObject({ level: 'campaign', status: 'DISABLE' });
    expect(client.getObject(adGroupId)).toMatchObject({
      level: 'adgroup',
      status: 'DISABLE',
      parentId: campaignId,
    });
    expect(client.getObject(adId)).toMatchObject({
      level: 'ad',
      status: 'DISABLE',
      parentId: adGroupId,
    });
  });

  it('de-duplicates creates with the same request_id', async () => {
    const client = new MockTikTokClient();
    const payload = buildCampaignPayload({
      advertiserId: ctx.advertiserId,
      request: boostRequest(),
      name: 'C',
      requestId: 'same',
    });

    const first = await client.createCampaign(ctx, payload);
    const second = await client.createCampaign(ctx, payload);

    expect(second).toBe(first);
    expect(client.listObjects('campaign')).toHaveLength(1);
  });

  it('rejects an ad for a post the identity does not own', async () => {
    const client = new MockTikTokClient();
    const request = boostRequest();
    const { adGroupId } = await createAll(client, request);

    const err = await caught(
      client.createAd(
        ctx,
        buildAdPayload({
          advertiserId: ctx.advertiserId,
          adGroupId,
          request,
          name: 'A2',
          identity,
          itemId: DEMO.advertisers.other.videoIds[0],
        }),
      ),
    );

    expect(err.tiktokMessage).toMatch(/not authorized/);
  });

  it("refuses to touch another advertiser's objects", async () => {
    const client = new MockTikTokClient();
    const { campaignId } = await createAll(client);
    const other = DEMO.advertisers.other;

    const err = await caught(
      client.updateStatus(
        { advertiserId: other.advertiserId, accessToken: other.accessToken },
        'campaign',
        [campaignId],
        'ENABLE',
      ),
    );

    expect(err.kind).toBe('invalid_request');
    expect(client.getObject(campaignId)?.status).toBe('DISABLE');
  });

  it('updates status and finds objects by name', async () => {
    const client = new MockTikTokClient();
    const { campaignId, adGroupId } = await createAll(client);

    await client.updateStatus(ctx, 'adgroup', [adGroupId], 'ENABLE');

    expect(client.getObject(adGroupId)?.status).toBe('ENABLE');
    await expect(client.findIdByName(ctx, 'campaign', 'C')).resolves.toBe(campaignId);
    await expect(client.findIdByName(ctx, 'adgroup', 'G', campaignId)).resolves.toBe(adGroupId);
    await expect(client.findIdByName(ctx, 'ad', 'missing')).resolves.toBeNull();
  });
});

describe('MockTikTokClient — failure injection and tracing', () => {
  it('fails the next call with an injected API error, then recovers', async () => {
    const client = new MockTikTokClient().failNext('getAdvertiser', {
      kind: 'api',
      code: 40002,
      message: 'nope',
    });

    expect(await caught(client.getAdvertiser(ctx))).toMatchObject({
      kind: 'invalid_request',
      code: 40002,
      tiktokMessage: 'nope',
    });
    await expect(client.getAdvertiser(ctx)).resolves.toBeDefined();
  });

  it.each([
    [{ kind: 'rate_limit' } as const, 'rate_limited'],
    [{ kind: 'server' } as const, 'server'],
    [{ kind: 'timeout' } as const, 'timeout'],
  ])('injects %j', async (failure, kind) => {
    const client = new MockTikTokClient().failNext('createCampaign', failure);
    const payload = buildCampaignPayload({
      advertiserId: ctx.advertiserId,
      request: boostRequest(),
      name: 'C',
      requestId: 'r',
    });

    expect((await caught(client.createCampaign(ctx, payload))).kind).toBe(kind);
    expect(client.listObjects('campaign')).toHaveLength(0);
  });

  it('timeout afterSend creates the object yet reports an ambiguous failure', async () => {
    const client = new MockTikTokClient().failNext('createCampaign', {
      kind: 'timeout',
      afterSend: true,
    });
    const payload = buildCampaignPayload({
      advertiserId: ctx.advertiserId,
      request: boostRequest(),
      name: 'Lost response',
      requestId: 'r',
    });

    const err = await caught(client.createCampaign(ctx, payload));

    expect(err.ambiguous).toBe(true);
    await expect(client.findIdByName(ctx, 'campaign', 'Lost response')).resolves.not.toBeNull();
  });

  it('reports every call through onCall with a request ID', async () => {
    const records: TikTokCallRecord[] = [];
    const client = new MockTikTokClient().failNext('getIdentities', { kind: 'rate_limit' });
    const traced = { ...ctx, onCall: (r: TikTokCallRecord) => records.push(r) };

    await client.getAdvertiser(traced);
    await caught(client.getIdentities(traced, 'TT_USER'));

    expect(records).toEqual([
      expect.objectContaining({ endpoint: '/advertiser/info/', outcome: 'ok', code: 0 }),
      expect.objectContaining({ endpoint: '/identity/get/', outcome: 'api_error', code: 40100 }),
    ]);
    expect(records.every((r) => r.requestId?.startsWith('mock-req-'))).toBe(true);
  });
});
