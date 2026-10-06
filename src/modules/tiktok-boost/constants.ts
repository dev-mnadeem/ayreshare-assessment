/**
 * Public API vocabulary for POST /api/ads/tiktok/boost (Ayrshare-facing names, lowercase
 * snake_case like the Facebook boost endpoint). Mapping to TikTok's wire values lives in
 * integrations/tiktok, never here.
 */

export const GOALS = ['engagement', 'video_views', 'reach', 'traffic'] as const;
export type Goal = (typeof GOALS)[number];

/** Returned as `goal: { type, title, description }`, mirroring the Facebook boost response. */
export const GOAL_INFO: Record<Goal, { title: string; description: string }> = {
  engagement: {
    title: 'Get More Engagement',
    description: 'Show the post to people likely to follow, like, comment and share.',
  },
  video_views: {
    title: 'Get More Video Views',
    description: 'Show the post to people likely to watch it for at least 6 seconds.',
  },
  reach: {
    title: 'Reach More People',
    description: 'Show the post to as many people in the audience as possible.',
  },
  traffic: {
    title: 'Get More Website Visits',
    description: 'Send people from the post to a website via a call-to-action button.',
  },
};

export const BUDGET_TYPES = ['daily', 'total'] as const;
export type BudgetType = (typeof BUDGET_TYPES)[number];

export const AD_STATUSES = ['active', 'paused'] as const;
export type AdStatus = (typeof AD_STATUSES)[number];

export const GENDERS = ['all', 'male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];

/** TikTok targets age buckets (18-24, 25-34, 35-44, 45-54, 55+), so ages must sit on bucket edges. */
export const MIN_AGE_VALUES = [18, 25, 35, 45, 55] as const;
export const MAX_AGE_VALUES = [24, 34, 44, 54, 65] as const;
export const DEFAULT_MIN_AGE = 18;
export const DEFAULT_MAX_AGE = 65;

// UNVERIFIED (M0): TikTok CTA enum subset; confirm in M9.
export const CALL_TO_ACTION_TYPES = [
  'LEARN_MORE',
  'SHOP_NOW',
  'SIGN_UP',
  'CONTACT_US',
  'DOWNLOAD',
  'APPLY_NOW',
  'BOOK_NOW',
  'ORDER_NOW',
  'SUBSCRIBE',
  'WATCH_NOW',
] as const;
export type CallToActionType = (typeof CALL_TO_ACTION_TYPES)[number];

/** TikTok ad-group daily budget minimum (help center: "must exceed $20"). */
export const MIN_DAILY_BUDGET_CENTS = 2_000;

/**
 * Our product rule, not a TikTok one: a boost runs at least one day, which keeps the
 * day-based budget math (and maxSpend) meaningful.
 */
export const MIN_SCHEDULE_HOURS = 24;

/** Clock skew allowance for a startDate that is "now" on the caller's side. */
export const START_DATE_GRACE_MS = 5 * 60 * 1000;

export const DEFAULT_COUNTRIES = ['US'] as const;
export const MAX_AD_NAME_LENGTH = 100;
export const MAX_LOCATIONS = 100;
export const MAX_INTERESTS = 100;
