import { describe, expect, it } from 'vitest';

import {
  buildAdGroupPayload,
  buildAdPayload,
  buildCampaignPayload,
  resolveLocationIds,
  toAgeGroups,
  fromTikTokDateTime,
  toTikTokDateTime,
} from '../../src/integrations/tiktok/mapper.js';
import { boostRequest } from '../helpers/boost-request.js';

const ADVERTISER = '7100000000000000001';
const TT_USER = { identityType: 'TT_USER', identityId: 'id-1', authorizedBcId: null } as const;

describe('toTikTokDateTime', () => {
  it('formats in UTC as "YYYY-MM-DD HH:MM:SS"', () => {
    expect(toTikTokDateTime(new Date('2026-01-02T03:04:05.678+02:00'))).toBe('2026-01-02 01:04:05');
  });
});

describe('fromTikTokDateTime', () => {
  it('reads "YYYY-MM-DD HH:MM:SS" as UTC and round-trips with toTikTokDateTime', () => {
    const date = fromTikTokDateTime('2026-11-01 10:00:00');
    expect(date).toEqual(new Date('2026-11-01T10:00:00Z'));
    expect(date && toTikTokDateTime(date)).toBe('2026-11-01 10:00:00');
  });

  it.each([
    ['2026-11-01T10:00:00Z', '2026-11-01T10:00:00.000Z'],
    ['2026-11-01T12:00:00+02:00', '2026-11-01T10:00:00.000Z'],
    ['2026-11-01T10:00:00.250Z', '2026-11-01T10:00:00.250Z'],
  ])('accepts ISO 8601 with an offset: %s', (input, expected) => {
    expect(fromTikTokDateTime(input)?.toISOString()).toBe(expected);
  });

  it.each(['', '2026-11-01', '2026-11-01T10:00:00', '1 Nov 2026', '2026-13-45 99:00:00'])(
    'returns null for %j',
    (input) => {
      expect(fromTikTokDateTime(input)).toBeNull();
    },
  );
});

describe('toAgeGroups', () => {
  it.each([
    [18, 65, ['AGE_18_24', 'AGE_25_34', 'AGE_35_44', 'AGE_45_54', 'AGE_55_100']],
    [25, 44, ['AGE_25_34', 'AGE_35_44']],
    [55, 65, ['AGE_55_100']],
    [18, 24, ['AGE_18_24']],
  ])('maps %i-%i to TikTok buckets', (min, max, expected) => {
    expect(toAgeGroups(min, max)).toEqual(expected);
  });
});

describe('resolveLocationIds', () => {
  const map = new Map([
    ['US', '6252001'],
    ['GB', '2635167'],
  ]);

  it('maps countries and merges explicit location IDs without duplicates', () => {
    const { targeting } = boostRequest({
      locations: { countries: ['US', 'GB'], locationIds: ['6252001', '5128581'] },
    });

    expect(resolveLocationIds(targeting, map)).toEqual({
      locationIds: ['6252001', '2635167', '5128581'],
      unknownCountries: [],
    });
  });

  it('reports country codes TikTok does not know', () => {
    const { targeting } = boostRequest({ locations: { countries: ['US', 'ZZ'] } });

    expect(resolveLocationIds(targeting, map).unknownCountries).toEqual(['ZZ']);
  });
});

describe('buildCampaignPayload', () => {
  it('creates a disabled, uncapped campaign for the goal objective', () => {
    expect(
      buildCampaignPayload({
        advertiserId: ADVERTISER,
        request: boostRequest({ goal: 'video_views' }),
        name: 'Fall launch - bst_1',
        requestId: 'bst_1-campaign',
      }),
    ).toEqual({
      advertiser_id: ADVERTISER,
      campaign_name: 'Fall launch - bst_1',
      objective_type: 'VIDEO_VIEWS',
      budget_mode: 'BUDGET_MODE_INFINITE',
      operation_status: 'DISABLE',
      request_id: 'bst_1-campaign',
    });
  });
});

describe('buildAdGroupPayload', () => {
  const base = {
    advertiserId: ADVERTISER,
    campaignId: 'c1',
    name: 'Fall launch - bst_1',
    locationIds: ['6252001'],
    requestId: 'bst_1-adgroup',
  };

  it('carries budget (USD), schedule (UTC), targeting and goal mapping; created disabled', () => {
    const payload = buildAdGroupPayload({
      ...base,
      request: boostRequest({ budget: 25.5, gender: 'female', minAge: 25, maxAge: 34 }),
    });

    expect(payload).toEqual({
      advertiser_id: ADVERTISER,
      campaign_id: 'c1',
      adgroup_name: 'Fall launch - bst_1',
      placement_type: 'PLACEMENT_TYPE_NORMAL',
      placements: ['PLACEMENT_TIKTOK'],
      location_ids: ['6252001'],
      age_groups: ['AGE_25_34'],
      gender: 'GENDER_FEMALE',
      budget_mode: 'BUDGET_MODE_DAY',
      budget: 25.5,
      schedule_type: 'SCHEDULE_START_END',
      schedule_start_time: '2026-10-06 12:00:00',
      schedule_end_time: '2026-10-13 12:00:00',
      optimization_goal: 'FOLLOWERS',
      billing_event: 'OCPM',
      bid_type: 'BID_TYPE_NO_BID',
      pacing: 'PACING_MODE_SMOOTH',
      operation_status: 'DISABLE',
      request_id: 'bst_1-adgroup',
    });
  });

  it('uses a custom bid and total budget when given; includes interests', () => {
    const payload = buildAdGroupPayload({
      ...base,
      request: boostRequest({
        budgetType: 'total',
        budget: 200,
        bidAmount: 0.35,
        interests: ['25', '17'],
      }),
    });

    expect(payload).toMatchObject({
      budget_mode: 'BUDGET_MODE_TOTAL',
      budget: 200,
      bid_type: 'BID_TYPE_CUSTOM',
      bid_price: 0.35,
      interest_category_ids: ['25', '17'],
    });
  });

  it('omits interest_category_ids and bid_price when not set', () => {
    const payload = buildAdGroupPayload({ ...base, request: boostRequest() });

    expect(payload).not.toHaveProperty('interest_category_ids');
    expect(payload).not.toHaveProperty('bid_price');
  });
});

describe('buildAdPayload', () => {
  it('builds a disabled Spark creative for the post and identity', () => {
    const payload = buildAdPayload({
      advertiserId: ADVERTISER,
      adGroupId: 'g1',
      request: boostRequest(),
      name: 'Fall launch - bst_1',
      identity: TT_USER,
      itemId: '7300000000000000001',
    });

    expect(payload).toEqual({
      advertiser_id: ADVERTISER,
      adgroup_id: 'g1',
      creatives: [
        {
          ad_name: 'Fall launch - bst_1',
          ad_format: 'SINGLE_VIDEO',
          identity_type: 'TT_USER',
          identity_id: 'id-1',
          tiktok_item_id: '7300000000000000001',
          operation_status: 'DISABLE',
        },
      ],
    });
  });

  it('adds the CTA and landing page for traffic, and the BC id for BC_AUTH_TT', () => {
    const payload = buildAdPayload({
      advertiserId: ADVERTISER,
      adGroupId: 'g1',
      request: boostRequest({
        goal: 'traffic',
        callToAction: { type: 'SHOP_NOW', link: 'https://shop.example.com' },
      }),
      name: 'n',
      identity: { identityType: 'BC_AUTH_TT', identityId: 'id-2', authorizedBcId: 'bc-9' },
      itemId: '7300000000000000001',
    });

    expect(payload.creatives[0]).toMatchObject({
      identity_type: 'BC_AUTH_TT',
      identity_authorized_bc_id: 'bc-9',
      call_to_action: 'SHOP_NOW',
      landing_page_url: 'https://shop.example.com',
    });
  });
});
