import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../../src/config/env.js';

function configErrorIssues(env: NodeJS.ProcessEnv): readonly string[] {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.issues;
    throw err;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('applies safe defaults (mock TikTok, sandbox URL)', () => {
    const config = loadConfig({});

    expect(config).toMatchObject({
      env: 'development',
      port: 3000,
      logLevel: 'info',
      tiktok: { mode: 'mock', baseUrl: 'https://sandbox-ads.tiktok.com/open_api/v1.3' },
      limits: {
        maxBudgetPerRequestCents: 500_000,
        maxSpendPerProfileCents: 2_000_000,
        maxCampaignDays: 90,
      },
    });
  });

  it('coerces numeric env strings and converts USD limits to cents', () => {
    const config = loadConfig({ PORT: '8080', MAX_BUDGET_PER_REQUEST: '19.99' });

    expect(config.port).toBe(8080);
    expect(config.limits.maxBudgetPerRequestCents).toBe(1999);
  });

  it('reports every invalid variable at once', () => {
    const issues = configErrorIssues({ PORT: 'abc', TIKTOK_MODE: 'prod', LOG_LEVEL: 'loud' });

    expect(issues).toHaveLength(3);
    expect(issues.join('\n')).toMatch(/PORT/);
    expect(issues.join('\n')).toMatch(/TIKTOK_MODE/);
    expect(issues.join('\n')).toMatch(/LOG_LEVEL/);
  });

  it('rejects USD limits with more than 2 decimals', () => {
    expect(configErrorIssues({ MAX_SPEND_PER_PROFILE: '10.001' })[0]).toMatch(
      /MAX_SPEND_PER_PROFILE: must have at most 2 decimal places/,
    );
  });

  it('rejects a per-request cap above the per-profile cap', () => {
    expect(
      configErrorIssues({ MAX_BUDGET_PER_REQUEST: '500', MAX_SPEND_PER_PROFILE: '100' })[0],
    ).toMatch(/MAX_BUDGET_PER_REQUEST: must not exceed MAX_SPEND_PER_PROFILE/);
  });

  it('refuses live mode pointed at the sandbox host', () => {
    expect(configErrorIssues({ TIKTOK_MODE: 'live' })[0]).toMatch(
      /TIKTOK_BASE_URL: must point at business-api.tiktok.com when TIKTOK_MODE=live/,
    );
  });

  it('refuses sandbox mode pointed at the live host', () => {
    expect(
      configErrorIssues({
        TIKTOK_MODE: 'sandbox',
        TIKTOK_BASE_URL: 'https://business-api.tiktok.com/open_api/v1.3',
      })[0],
    ).toMatch(/must point at sandbox-ads.tiktok.com/);
  });

  it('accepts live mode with the live host', () => {
    const config = loadConfig({
      TIKTOK_MODE: 'live',
      TIKTOK_BASE_URL: 'https://business-api.tiktok.com/open_api/v1.3',
    });

    expect(config.tiktok.mode).toBe('live');
  });
});
