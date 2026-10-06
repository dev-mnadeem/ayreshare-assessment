import { centsToUsd } from '../../lib/money.js';
import type { BoostRequest } from '../../modules/tiktok-boost/schema.js';

import {
  AD_FORMAT,
  AGE_BUCKETS,
  BID_TYPE,
  BUDGET_MODE,
  CAMPAIGN_BUDGET_MODE,
  GENDER_MAPPING,
  GOAL_MAPPING,
  PACING,
  PLACEMENT_TYPE,
  PLACEMENTS,
  SCHEDULE_TYPE,
} from './constants.js';
import type {
  AdCreatePayload,
  AdGroupCreatePayload,
  CampaignCreatePayload,
  ResolvedIdentity,
} from './types.js';

/**
 * Pure translation from a validated BoostRequest to TikTok payloads. Every object is created
 * DISABLED: nothing can spend until the service has built all three and explicitly enables them.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

/** TikTok schedule format "YYYY-MM-DD HH:MM:SS", in UTC. UNVERIFIED (M0): format + timezone. */
export function toTikTokDateTime(date: Date): string {
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

const TIKTOK_DATE_TIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/;
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Parses a TikTok timestamp: "YYYY-MM-DD HH:MM:SS" in UTC, or ISO 8601 with an explicit offset
 * (accepted too, because the format is UNVERIFIED (M0)). Returns null for anything else, so a
 * surprise format is reported instead of becoming an Invalid Date that slips past comparisons.
 */
export function fromTikTokDateTime(value: string): Date | null {
  const plain = TIKTOK_DATE_TIME.exec(value);
  const iso = plain ? `${plain[1] ?? ''}T${plain[2] ?? ''}Z` : value;
  if (!plain && !ISO_WITH_OFFSET.test(value)) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** TikTok age buckets fully inside [minAge, maxAge] (schema guarantees bucket-edge values). */
export function toAgeGroups(minAge: number, maxAge: number): string[] {
  return AGE_BUCKETS.filter((b) => b.min >= minAge && b.max <= maxAge).map((b) => b.value);
}

/**
 * Countries → TikTok location IDs, plus any explicit locationIds. Returns unknown country codes
 * so the caller can reject them with a 101 instead of silently dropping targeting.
 */
export function resolveLocationIds(
  targeting: BoostRequest['targeting'],
  countryLocationIds: ReadonlyMap<string, string>,
): { locationIds: string[]; unknownCountries: string[] } {
  const unknownCountries: string[] = [];
  const fromCountries: string[] = [];
  for (const code of targeting.countries) {
    const id = countryLocationIds.get(code);
    if (id === undefined) unknownCountries.push(code);
    else fromCountries.push(id);
  }
  return {
    locationIds: [...new Set([...fromCountries, ...targeting.locationIds])],
    unknownCountries,
  };
}

export function buildCampaignPayload(input: {
  advertiserId: string;
  request: BoostRequest;
  name: string;
  requestId: string;
}): CampaignCreatePayload {
  return {
    advertiser_id: input.advertiserId,
    campaign_name: input.name,
    objective_type: GOAL_MAPPING[input.request.goal].objectiveType,
    budget_mode: CAMPAIGN_BUDGET_MODE,
    operation_status: 'DISABLE',
    request_id: input.requestId,
  };
}

export function buildAdGroupPayload(input: {
  advertiserId: string;
  campaignId: string;
  request: BoostRequest;
  name: string;
  locationIds: readonly string[];
  requestId: string;
}): AdGroupCreatePayload {
  const { request } = input;
  const goal = GOAL_MAPPING[request.goal];

  return {
    advertiser_id: input.advertiserId,
    campaign_id: input.campaignId,
    adgroup_name: input.name,
    placement_type: PLACEMENT_TYPE,
    placements: [...PLACEMENTS],
    location_ids: [...input.locationIds],
    age_groups: toAgeGroups(request.targeting.minAge, request.targeting.maxAge),
    gender: GENDER_MAPPING[request.targeting.gender],
    ...(request.targeting.interests.length > 0 && {
      interest_category_ids: [...request.targeting.interests],
    }),
    budget_mode: BUDGET_MODE[request.budget.type],
    budget: centsToUsd(request.budget.amountCents),
    schedule_type: SCHEDULE_TYPE,
    schedule_start_time: toTikTokDateTime(request.schedule.start),
    schedule_end_time: toTikTokDateTime(request.schedule.end),
    optimization_goal: goal.optimizationGoal,
    billing_event: goal.billingEvent,
    ...(request.bidAmountCents === null
      ? { bid_type: BID_TYPE.lowestCost }
      : { bid_type: BID_TYPE.custom, bid_price: centsToUsd(request.bidAmountCents) }),
    pacing: PACING,
    operation_status: 'DISABLE',
    request_id: input.requestId,
  };
}

export function buildAdPayload(input: {
  advertiserId: string;
  adGroupId: string;
  request: BoostRequest;
  name: string;
  identity: ResolvedIdentity;
  itemId: string;
}): AdCreatePayload {
  const { identity, request } = input;
  return {
    advertiser_id: input.advertiserId,
    adgroup_id: input.adGroupId,
    creatives: [
      {
        ad_name: input.name,
        ad_format: AD_FORMAT,
        identity_type: identity.identityType,
        identity_id: identity.identityId,
        ...(identity.authorizedBcId !== null && {
          identity_authorized_bc_id: identity.authorizedBcId,
        }),
        tiktok_item_id: input.itemId,
        ...(request.callToAction && {
          call_to_action: request.callToAction.type,
          landing_page_url: request.callToAction.link,
        }),
        operation_status: 'DISABLE',
      },
    ],
  };
}
