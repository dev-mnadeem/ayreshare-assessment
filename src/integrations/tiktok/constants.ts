/**
 * Every TikTok Marketing API (v1.3) wire value in one place. Values tagged
 * UNVERIFIED (M0) come from prior knowledge (TikTok's reference pages couldn't be read) and are
 * confirmed against the sandbox in M9; fixing one should only ever touch this file.
 */
import type { Gender, Goal } from '../../modules/tiktok-boost/constants.js';

export const ENDPOINTS = {
  advertiserInfo: '/advertiser/info/',
  identityGet: '/identity/get/',
  identityVideoInfo: '/identity/video/info/',
  sparkAuthorize: '/tt_video/authorize/',
  sparkInfo: '/tt_video/info/',
  region: '/tool/region/',
  campaignCreate: '/campaign/create/',
  campaignGet: '/campaign/get/',
  campaignStatus: '/campaign/status/update/',
  adGroupCreate: '/adgroup/create/',
  adGroupGet: '/adgroup/get/',
  adGroupStatus: '/adgroup/status/update/',
  adCreate: '/ad/create/',
  adGet: '/ad/get/',
  adStatus: '/ad/status/update/',
} as const;

export type IdentityType = 'AUTH_CODE' | 'TT_USER' | 'BC_AUTH_TT';
export type OperationStatus = 'ENABLE' | 'DISABLE' | 'DELETE'; // DELETE: UNVERIFIED (M0)

export interface GoalWireMapping {
  readonly objectiveType: string;
  readonly optimizationGoal: string;
  readonly billingEvent: string;
}

// objective_type values ✅ (help center objectives); optimization/billing pairs UNVERIFIED (M0).
export const GOAL_MAPPING: Record<Goal, GoalWireMapping> = {
  engagement: { objectiveType: 'ENGAGEMENT', optimizationGoal: 'FOLLOWERS', billingEvent: 'OCPM' },
  video_views: {
    objectiveType: 'VIDEO_VIEWS',
    optimizationGoal: 'ENGAGED_VIEW',
    billingEvent: 'CPV',
  },
  reach: { objectiveType: 'REACH', optimizationGoal: 'REACH', billingEvent: 'CPM' },
  traffic: { objectiveType: 'TRAFFIC', optimizationGoal: 'CLICK', billingEvent: 'CPC' },
};

// GENDER_UNLIMITED ✅; MALE/FEMALE UNVERIFIED (M0).
export const GENDER_MAPPING: Record<Gender, string> = {
  all: 'GENDER_UNLIMITED',
  male: 'GENDER_MALE',
  female: 'GENDER_FEMALE',
};

// AGE_18_24 / AGE_25_34 ✅; the rest UNVERIFIED (M0). Edges match MIN/MAX_AGE_VALUES.
export const AGE_BUCKETS = [
  { min: 18, max: 24, value: 'AGE_18_24' },
  { min: 25, max: 34, value: 'AGE_25_34' },
  { min: 35, max: 44, value: 'AGE_35_44' },
  { min: 45, max: 54, value: 'AGE_45_54' },
  { min: 55, max: 65, value: 'AGE_55_100' },
] as const;

export const BUDGET_MODE = { daily: 'BUDGET_MODE_DAY', total: 'BUDGET_MODE_TOTAL' } as const; // ✅
/** Campaign has no cap of its own; the dedicated ad group carries the budget. UNVERIFIED (M0). */
export const CAMPAIGN_BUDGET_MODE = 'BUDGET_MODE_INFINITE';

export const PLACEMENT_TYPE = 'PLACEMENT_TYPE_NORMAL'; // ✅ (SDK default)
export const PLACEMENTS = ['PLACEMENT_TIKTOK'] as const; // UNVERIFIED (M0)
export const SCHEDULE_TYPE = 'SCHEDULE_START_END'; // UNVERIFIED (M0)
export const PACING = 'PACING_MODE_SMOOTH'; // UNVERIFIED (M0)
export const BID_TYPE = { lowestCost: 'BID_TYPE_NO_BID', custom: 'BID_TYPE_CUSTOM' } as const; // UNVERIFIED (M0)
export const AD_FORMAT = 'SINGLE_VIDEO'; // UNVERIFIED (M0)

/** Response `code` values. 0 ✅ (envelope convention); the rest UNVERIFIED (M0). */
export const RESPONSE_CODES = {
  ok: 0,
  invalidParam: 40001,
  invalidValue: 40002,
  rateLimited: 40100,
  noPermission: 40102,
  tokenInvalid: 40104,
  tokenExpired: 40105,
  internalError: 50000,
  serviceUnavailable: 50002,
} as const;

export const AUTH_ERROR_CODES: ReadonlySet<number> = new Set([
  RESPONSE_CODES.noPermission,
  RESPONSE_CODES.tokenInvalid,
  RESPONSE_CODES.tokenExpired,
]);
export const RATE_LIMIT_CODES: ReadonlySet<number> = new Set([RESPONSE_CODES.rateLimited]);
export const SERVER_ERROR_CODES: ReadonlySet<number> = new Set([
  RESPONSE_CODES.internalError,
  RESPONSE_CODES.serviceUnavailable,
]);
