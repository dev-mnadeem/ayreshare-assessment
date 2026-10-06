import { z } from 'zod';

import { hasAtMostTwoDecimals, usdToCents } from '../lib/money.js';

const TIKTOK_HOSTS = {
  sandbox: 'sandbox-ads.tiktok.com',
  live: 'business-api.tiktok.com',
} as const;

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const usdAmount = z.coerce
  .number()
  .positive()
  .refine(hasAtMostTwoDecimals, 'must have at most 2 decimal places');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    DATABASE_PATH: z.string().min(1).default('./data/ayrshare.db'),
    TIKTOK_MODE: z.enum(['mock', 'sandbox', 'live']).default('mock'),
    TIKTOK_BASE_URL: z.url().default(`https://${TIKTOK_HOSTS.sandbox}/open_api/v1.3`),
    /** Outbound request rate; the Marketing API sandbox allows 1 QPS. */
    TIKTOK_MAX_QPS: z.coerce.number().positive().max(50).default(1),
    TIKTOK_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
    MAX_SPEND_PER_BOOST: usdAmount.default(5_000),
    MAX_SPEND_PER_PROFILE: usdAmount.default(20_000),
    MAX_CAMPAIGN_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  })
  // Guard against real spend by accident: the mode and the host must agree.
  .superRefine((env, ctx) => {
    if (env.TIKTOK_MODE === 'mock') return;
    const expectedHost = TIKTOK_HOSTS[env.TIKTOK_MODE];
    if (new URL(env.TIKTOK_BASE_URL).host !== expectedHost) {
      ctx.addIssue({
        code: 'custom',
        path: ['TIKTOK_BASE_URL'],
        message: `must point at ${expectedHost} when TIKTOK_MODE=${env.TIKTOK_MODE}`,
      });
    }
  })
  .refine((env) => env.MAX_SPEND_PER_BOOST <= env.MAX_SPEND_PER_PROFILE, {
    path: ['MAX_SPEND_PER_BOOST'],
    message: 'must not exceed MAX_SPEND_PER_PROFILE',
  });

export type TikTokMode = z.infer<typeof envSchema>['TIKTOK_MODE'];

export interface Config {
  readonly env: 'development' | 'test' | 'production';
  readonly port: number;
  readonly logLevel: (typeof LOG_LEVELS)[number];
  readonly databasePath: string;
  readonly tiktok: {
    readonly mode: TikTokMode;
    readonly baseUrl: string;
    readonly maxQps: number;
    readonly timeoutMs: number;
  };
  readonly limits: {
    /** Money is held as integer cents everywhere inside the app. */
    /** Cap on one boost's worst-case spend (daily × days, or the total budget). */
    readonly maxSpendPerBoostCents: number;
    /** Cap on the summed worst-case spend of a profile's running boosts. */
    readonly maxSpendPerProfileCents: number;
    readonly maxCampaignDays: number;
  };
}

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Parses and validates configuration once at startup; throws ConfigError listing every problem. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }

  const env = parsed.data;
  return {
    env: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databasePath: env.DATABASE_PATH,
    tiktok: {
      mode: env.TIKTOK_MODE,
      baseUrl: env.TIKTOK_BASE_URL,
      maxQps: env.TIKTOK_MAX_QPS,
      timeoutMs: env.TIKTOK_TIMEOUT_MS,
    },
    limits: {
      maxSpendPerBoostCents: usdToCents(env.MAX_SPEND_PER_BOOST),
      maxSpendPerProfileCents: usdToCents(env.MAX_SPEND_PER_PROFILE),
      maxCampaignDays: env.MAX_CAMPAIGN_DAYS,
    },
  };
}
