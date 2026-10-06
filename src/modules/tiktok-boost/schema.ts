import { z } from 'zod';

import { ValidationError } from '../../errors/app-error.js';
import { hasAtMostTwoDecimals, usdToCents } from '../../lib/money.js';
import { formatIssues, fromZodIssues, type FieldIssue } from '../../lib/validation.js';

import {
  AD_STATUSES,
  BUDGET_TYPES,
  CALL_TO_ACTION_TYPES,
  DEFAULT_COUNTRIES,
  DEFAULT_MAX_AGE,
  DEFAULT_MIN_AGE,
  GENDERS,
  GOALS,
  MAX_AD_NAME_LENGTH,
  MAX_AGE_VALUES,
  MAX_INTERESTS,
  MAX_LOCATIONS,
  MIN_AGE_VALUES,
  MIN_DAILY_BUDGET_CENTS,
  MIN_SCHEDULE_HOURS,
  START_DATE_GRACE_MS,
  type AdStatus,
  type BudgetType,
  type CallToActionType,
  type Gender,
  type Goal,
} from './constants.js';

// ---------------------------------------------------------------------------
// Field-level schema (types, formats, enums). Cross-field rules are below.
// ---------------------------------------------------------------------------

/** Case-insensitive enum; the error lists every accepted value. */
function enumOf<const T extends readonly [string, ...string[]]>(
  values: T,
  normalize: (s: string) => string = (s) => s.toLowerCase(),
) {
  return z.preprocess(
    (v) => (typeof v === 'string' ? normalize(v.trim()) : v),
    z.enum(values, { error: `must be one of: ${values.join(', ')}` }),
  );
}

function oneOfNumbers(values: readonly number[], hint: string) {
  return z
    .number()
    .refine((n) => values.includes(n), `must be one of: ${values.join(', ')} (${hint})`);
}

const usd = z
  .number()
  .refine((n) => n > 0, 'must be greater than 0')
  .refine(hasAtMostTwoDecimals, 'must have at most 2 decimal places (USD)');

const isoDateTime = z.iso.datetime({
  offset: true,
  error: 'must be an ISO 8601 date-time with a timezone, e.g. "2026-11-01T09:00:00Z"',
});

const AGE_HINT = 'TikTok targets the age ranges 18-24, 25-34, 35-44, 45-54 and 55+';

/** Numbers that survive JSON exactly are accepted; larger ones get a "quote it" error. */
const safeIntegerToString = (v: unknown): unknown =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? String(v) : v;

const numericId = (example: string) =>
  z.preprocess(
    safeIntegerToString,
    z
      .string()
      .trim()
      .regex(/^\d{1,32}$/, `must be a numeric ID, e.g. "${example}"`),
  );

export const boostRequestSchema = z.strictObject({
  postId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be an Ayrshare post ID, e.g. "DE6gpw8kxlonHy2b7Lo"')
    .optional(),
  tiktokPostId: z
    .preprocess(
      safeIntegerToString,
      z
        .string()
        .trim()
        .regex(/^\d{1,32}$/, 'must be the numeric TikTok video ID, e.g. "7301234567890123456"'),
    )
    .optional(),
  authCode: z
    .string()
    .trim()
    .min(1, 'must not be empty')
    .max(512, 'must be at most 512 characters')
    .optional(),
  adName: z
    .string()
    .trim()
    .min(1, 'must not be empty')
    .max(MAX_AD_NAME_LENGTH, `must be at most ${MAX_AD_NAME_LENGTH} characters`),
  goal: enumOf(GOALS).default('engagement'),
  budget: usd,
  budgetType: enumOf(BUDGET_TYPES).default('daily'),
  bidAmount: usd.optional(),
  status: enumOf(AD_STATUSES).default('active'),
  startDate: isoDateTime.optional(),
  endDate: isoDateTime,
  minAge: oneOfNumbers(MIN_AGE_VALUES, AGE_HINT).default(DEFAULT_MIN_AGE),
  maxAge: oneOfNumbers(MAX_AGE_VALUES, `${AGE_HINT}; 65 means 55+`).default(DEFAULT_MAX_AGE),
  gender: enumOf(GENDERS).default('all'),
  locations: z
    .strictObject({
      countries: z
        .array(
          z
            .string()
            .trim()
            .toUpperCase()
            .regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 country code, e.g. "US"'),
        )
        .max(MAX_LOCATIONS, `must have at most ${MAX_LOCATIONS} entries`)
        .optional(),
      locationIds: z
        .array(numericId('6252001'))
        .max(MAX_LOCATIONS, `must have at most ${MAX_LOCATIONS} entries`)
        .optional(),
    })
    .optional(),
  interests: z
    .array(numericId('25'))
    .max(MAX_INTERESTS, `must have at most ${MAX_INTERESTS} entries`)
    .optional(),
  callToAction: z
    .strictObject({
      type: enumOf(CALL_TO_ACTION_TYPES, (s) => s.toUpperCase()),
      link: z.url({ protocol: /^https?$/, error: 'must be an http(s) URL' }),
    })
    .optional(),
  dryRun: z.boolean().default(false),
});

/** What callers may send (before defaults/normalisation). */
export type BoostRequestInput = z.input<typeof boostRequestSchema>;
type ParsedFields = z.output<typeof boostRequestSchema>;

// ---------------------------------------------------------------------------
// Normalised, validated request handed to the service.
// ---------------------------------------------------------------------------

export type PostReference =
  | { readonly kind: 'ayrshare_post'; readonly postId: string }
  | { readonly kind: 'tiktok_post'; readonly tiktokPostId: string }
  | { readonly kind: 'spark_auth_code'; readonly authCode: string };

export interface BoostRequest {
  readonly post: PostReference;
  readonly adName: string;
  readonly goal: Goal;
  readonly status: AdStatus;
  readonly budget: { readonly type: BudgetType; readonly amountCents: number };
  readonly bidAmountCents: number | null;
  readonly schedule: {
    readonly start: Date;
    readonly end: Date;
    /** Billing days, rounded up: the basis for minimum budgets and maxSpend. */
    readonly days: number;
    readonly startsImmediately: boolean;
  };
  readonly targeting: {
    readonly minAge: number;
    readonly maxAge: number;
    readonly gender: Gender;
    readonly countries: readonly string[];
    readonly locationIds: readonly string[];
    readonly interests: readonly string[];
  };
  readonly callToAction: { readonly type: CallToActionType; readonly link: string } | null;
  readonly dryRun: boolean;
  /** Worst-case spend for the whole boost; the figure spend caps are checked against. */
  readonly maxSpendCents: number;
}

export interface ValidationContext {
  readonly now: Date;
  readonly maxCampaignDays: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const POST_IDENTIFIERS = ['postId', 'tiktokPostId', 'authCode'] as const;

const formatUsd = (cents: number): string => (cents / 100).toFixed(2);

export function billingDays(start: Date, end: Date): number {
  return Math.ceil((end.getTime() - start.getTime()) / DAY_MS);
}

export function computeMaxSpendCents(
  budget: { type: BudgetType; amountCents: number },
  days: number,
): number {
  return budget.type === 'daily' ? budget.amountCents * days : budget.amountCents;
}

/** Exactly one post identifier. Checked on the raw body so it's reported with other errors. */
function postIdentifierIssues(body: Record<string, unknown>): FieldIssue[] {
  const present = POST_IDENTIFIERS.filter((key) => body[key] !== undefined);
  if (present.length === 0) {
    return [{ field: 'postId, tiktokPostId or authCode', message: 'is required', missing: true }];
  }
  if (present.length > 1) {
    return [
      {
        field: POST_IDENTIFIERS.join('/'),
        message: `send exactly one of these to identify the post (got ${present.join(' and ')})`,
      },
    ];
  }
  return [];
}

function toPostReference(fields: ParsedFields): PostReference {
  if (fields.postId !== undefined) return { kind: 'ayrshare_post', postId: fields.postId };
  if (fields.tiktokPostId !== undefined) {
    return { kind: 'tiktok_post', tiktokPostId: fields.tiktokPostId };
  }
  if (fields.authCode !== undefined) return { kind: 'spark_auth_code', authCode: fields.authCode };
  throw new Error('unreachable: post identifier presence is validated first');
}

/** Rules spanning several fields; only run once every field is individually valid. */
function crossFieldIssues(fields: ParsedFields, ctx: ValidationContext): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const start = fields.startDate ? new Date(fields.startDate) : ctx.now;
  const end = new Date(fields.endDate);

  if (start.getTime() < ctx.now.getTime() - START_DATE_GRACE_MS) {
    issues.push({
      field: 'startDate',
      message: `must not be in the past (current time is ${ctx.now.toISOString()}); omit it to start immediately`,
    });
  }

  const durationMs = end.getTime() - start.getTime();
  if (durationMs <= 0) {
    issues.push({ field: 'endDate', message: 'must be after startDate' });
  } else if (durationMs < MIN_SCHEDULE_HOURS * HOUR_MS) {
    issues.push({
      field: 'endDate',
      message: `must be at least ${MIN_SCHEDULE_HOURS} hours after the start`,
    });
  } else if (durationMs > ctx.maxCampaignDays * DAY_MS) {
    issues.push({
      field: 'endDate',
      message: `must be within ${ctx.maxCampaignDays} days of the start`,
    });
  }

  if (fields.minAge >= fields.maxAge) {
    issues.push({ field: 'minAge', message: `must be lower than maxAge (${fields.maxAge})` });
  }

  const { countries, locationIds } = fields.locations ?? {};
  if (fields.locations && !countries?.length && !locationIds?.length) {
    issues.push({
      field: 'locations',
      message: 'must include at least one entry in countries or locationIds',
    });
  }

  const budgetCents = usdToCents(fields.budget);
  if (durationMs > 0) {
    const days = billingDays(start, end);
    if (fields.budgetType === 'daily' && budgetCents < MIN_DAILY_BUDGET_CENTS) {
      issues.push({
        field: 'budget',
        message: `must be at least ${formatUsd(MIN_DAILY_BUDGET_CENTS)} USD for a daily budget (TikTok minimum)`,
      });
    }
    const minTotal = MIN_DAILY_BUDGET_CENTS * days;
    if (fields.budgetType === 'total' && budgetCents < minTotal) {
      issues.push({
        field: 'budget',
        message: `must be at least ${formatUsd(minTotal)} USD for a total budget over ${days} days (TikTok minimum of ${formatUsd(MIN_DAILY_BUDGET_CENTS)} USD per day)`,
      });
    }
  }

  if (fields.bidAmount !== undefined && usdToCents(fields.bidAmount) >= budgetCents) {
    issues.push({ field: 'bidAmount', message: 'must be lower than budget' });
  }

  if (fields.goal === 'traffic' && !fields.callToAction) {
    issues.push({
      field: 'callToAction',
      message:
        'is required for the traffic goal: send { "type": "LEARN_MORE", "link": "https://..." } with your landing page',
    });
  }
  if (fields.goal !== 'traffic' && fields.callToAction) {
    issues.push({
      field: 'callToAction',
      message: `is only supported with the traffic goal (goal is "${fields.goal}")`,
    });
  }

  return issues;
}

function normalize(fields: ParsedFields, ctx: ValidationContext): BoostRequest {
  const start = fields.startDate ? new Date(fields.startDate) : ctx.now;
  const end = new Date(fields.endDate);
  const days = billingDays(start, end);
  const budget = { type: fields.budgetType, amountCents: usdToCents(fields.budget) };
  const countries = fields.locations?.countries ?? [];
  const locationIds = fields.locations?.locationIds ?? [];
  // No locations at all → Facebook-style default of US; otherwise use exactly what was sent.
  const useDefaultCountries = countries.length === 0 && locationIds.length === 0;

  return {
    post: toPostReference(fields),
    adName: fields.adName,
    goal: fields.goal,
    status: fields.status,
    budget,
    bidAmountCents: fields.bidAmount === undefined ? null : usdToCents(fields.bidAmount),
    schedule: { start, end, days, startsImmediately: fields.startDate === undefined },
    targeting: {
      minAge: fields.minAge,
      maxAge: fields.maxAge,
      gender: fields.gender,
      countries: useDefaultCountries ? [...DEFAULT_COUNTRIES] : [...new Set(countries)],
      locationIds: [...new Set(locationIds)],
      interests: [...new Set(fields.interests ?? [])],
    },
    callToAction: fields.callToAction ?? null,
    dryRun: fields.dryRun,
    maxSpendCents: computeMaxSpendCents(budget, days),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a raw request body. Throws ValidationError (code 101) whose `details` names every
 * problem found. Runs before anything that could cost the customer money.
 */
export function validateBoostRequest(body: unknown, ctx: ValidationContext): BoostRequest {
  if (!isPlainObject(body)) {
    throw new ValidationError(
      'Request body must be a JSON object. Send JSON with Content-Type: application/json.',
    );
  }

  const parsed = boostRequestSchema.safeParse(body, { reportInput: true });
  const issues = [
    ...postIdentifierIssues(body),
    ...(parsed.success ? crossFieldIssues(parsed.data, ctx) : fromZodIssues(parsed.error.issues)),
  ];

  if (issues.length > 0 || !parsed.success) {
    throw new ValidationError(formatIssues(issues));
  }
  return normalize(parsed.data, ctx);
}
