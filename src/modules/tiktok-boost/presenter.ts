import { z } from 'zod';

import { centsToUsd } from '../../lib/money.js';

import {
  AD_STATUSES,
  BUDGET_TYPES,
  CALL_TO_ACTION_TYPES,
  GENDERS,
  GOAL_INFO,
  GOALS,
  type AdStatus,
  type Goal,
} from './constants.js';
import type { BoostRequest } from './schema.js';
import type { BoostPreview } from './service.js';
import type { BoostRecord, BoostStatus, OrphanedObject } from './types.js';

/**
 * Public response shapes, mirroring the Facebook boost response: flat, camelCase, USD amounts as
 * numbers, ISO dates, `goal` as { type, title, description }.
 */

interface BoostSettings {
  adStatus: AdStatus | null;
  goal: { type: Goal; title: string; description: string };
  budget: number;
  budgetType: 'daily' | 'total';
  bidAmount: number | null;
  maxSpend: number;
  startDate: string;
  endDate: string;
  minAge: number;
  maxAge: number;
  gender: 'all' | 'male' | 'female';
  locations: { countries: string[]; locationIds: string[] };
  interests: string[];
  callToAction: { type: string; link: string } | null;
  postId: string | null;
  tiktokPostId: string | null;
  authorizationType: 'linked_account' | 'spark_code';
}

export interface BoostResponse extends BoostSettings {
  status: 'success';
  id: string;
  boostStatus: BoostStatus;
  adId: string | null;
  adGroupId: string | null;
  campaignId: string | null;
  /** The name used for all three TikTok objects; search for it in TikTok Ads Manager. */
  adName: string;
  advertiserId: string;
  createdAt: string;
  /** Present only when the boost failed. */
  error?: { code: number; details: string };
  /** Present only when cleanup left objects behind. */
  orphans?: OrphanedObject[];
}

export interface DryRunResponse extends BoostSettings {
  status: 'success';
  dryRun: true;
  adName: string;
  advertiserId: string;
  /** TikTok location IDs the ad group would target (countries resolved). */
  targetLocationIds: string[];
  /** Worst-case spend of this profile's running boosts, and the caps it is checked against. */
  committedSpend: number;
  limits: { maxSpendPerBoost: number; maxSpendPerProfile: number };
  sparkAuthorizationEndsAt: string | null;
}

/** The normalised request as stored on the boost row (JSON of BoostRequest, secrets masked). */
const storedRequestSchema = z.object({
  goal: z.enum(GOALS),
  status: z.enum(AD_STATUSES),
  budget: z.object({ type: z.enum(BUDGET_TYPES), amountCents: z.number() }),
  bidAmountCents: z.number().nullable(),
  schedule: z.object({ start: z.string(), end: z.string() }),
  targeting: z.object({
    minAge: z.number(),
    maxAge: z.number(),
    gender: z.enum(GENDERS),
    countries: z.array(z.string()),
    locationIds: z.array(z.string()),
    interests: z.array(z.string()),
  }),
  callToAction: z.object({ type: z.enum(CALL_TO_ACTION_TYPES), link: z.string() }).nullable(),
  maxSpendCents: z.number(),
});
type StoredRequest = z.infer<typeof storedRequestSchema>;

function settings(
  req: StoredRequest,
  post: Pick<BoostSettings, 'postId' | 'tiktokPostId' | 'authorizationType'>,
  adStatus: AdStatus | null,
): BoostSettings {
  return {
    adStatus,
    goal: { type: req.goal, ...GOAL_INFO[req.goal] },
    budget: centsToUsd(req.budget.amountCents),
    budgetType: req.budget.type,
    bidAmount: req.bidAmountCents === null ? null : centsToUsd(req.bidAmountCents),
    maxSpend: centsToUsd(req.maxSpendCents),
    startDate: req.schedule.start,
    endDate: req.schedule.end,
    minAge: req.targeting.minAge,
    maxAge: req.targeting.maxAge,
    gender: req.targeting.gender,
    locations: { countries: req.targeting.countries, locationIds: req.targeting.locationIds },
    interests: req.targeting.interests,
    callToAction: req.callToAction,
    ...post,
  };
}

const ACTIVE_STATUS: Partial<Record<BoostStatus, AdStatus>> = { live: 'active', paused: 'paused' };

export function toBoostResponse(record: BoostRecord): BoostResponse {
  const stored = storedRequestSchema.parse(record.request);
  const failed = record.status === 'failed' || record.status === 'cleanup_failed';

  return {
    status: 'success',
    id: record.id,
    boostStatus: record.status,
    adId: record.adId,
    adGroupId: record.adGroupId,
    campaignId: record.campaignId,
    adName: `${record.adName} - ${record.id}`,
    advertiserId: record.advertiserId,
    ...settings(
      stored,
      {
        postId: record.ayrsharePostId,
        tiktokPostId: record.tiktokItemId,
        authorizationType: record.identityType === 'AUTH_CODE' ? 'spark_code' : 'linked_account',
      },
      ACTIVE_STATUS[record.status] ?? null,
    ),
    createdAt: record.createdAt.toISOString(),
    ...(failed &&
      record.errorCode !== null && {
        error: { code: record.errorCode, details: record.errorDetails ?? '' },
      }),
    ...(record.orphans.length > 0 && { orphans: [...record.orphans] }),
  };
}

export function toDryRunResponse(request: BoostRequest, preview: BoostPreview): DryRunResponse {
  const stored = storedRequestSchema.parse(JSON.parse(JSON.stringify(request)));
  const { plan } = preview;

  return {
    status: 'success',
    dryRun: true,
    adName: request.adName,
    advertiserId: plan.advertiserId,
    ...settings(
      stored,
      {
        postId: plan.ayrsharePostId,
        tiktokPostId: plan.tiktokItemId,
        authorizationType:
          plan.identity.identityType === 'AUTH_CODE' ? 'spark_code' : 'linked_account',
      },
      request.status,
    ),
    targetLocationIds: [...plan.locationIds],
    committedSpend: centsToUsd(preview.committedSpendCents),
    limits: {
      maxSpendPerBoost: centsToUsd(preview.limits.maxSpendPerBoostCents),
      maxSpendPerProfile: centsToUsd(preview.limits.maxSpendPerProfileCents),
    },
    sparkAuthorizationEndsAt: plan.sparkAuthEndTime?.toISOString() ?? null,
  };
}
