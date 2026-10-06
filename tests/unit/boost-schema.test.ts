import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../src/errors/app-error.js';
import {
  billingDays,
  computeMaxSpendCents,
  validateBoostRequest,
  type BoostRequest,
} from '../../src/modules/tiktok-boost/schema.js';

const NOW = new Date('2026-10-06T12:00:00Z');
const CTX = { now: NOW, maxCampaignDays: 90 };

/** A minimal valid request: 7 days, $20/day, engagement. */
const base = (): Record<string, unknown> => ({
  tiktokPostId: '7301234567890123456',
  adName: 'Fall launch',
  budget: 20,
  endDate: '2026-10-13T12:00:00Z',
});

const valid = (overrides: Record<string, unknown> = {}): BoostRequest =>
  validateBoostRequest({ ...base(), ...overrides }, CTX);

/** Returns the `details` string of the ValidationError thrown for this body. */
function details(body: unknown): string {
  try {
    validateBoostRequest(body, CTX);
  } catch (err) {
    if (err instanceof ValidationError) {
      expect(err.toEnvelope()).toMatchObject({ code: 101, action: 'request', status: 'error' });
      return err.details;
    }
    throw err;
  }
  throw new Error('expected a ValidationError');
}

const without = (key: string) => {
  const body = base();
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete body[key];
  return body;
};

describe('validateBoostRequest — defaults and normalisation', () => {
  it('applies Facebook-style defaults to a minimal request', () => {
    expect(valid()).toEqual({
      post: { kind: 'tiktok_post', tiktokPostId: '7301234567890123456' },
      adName: 'Fall launch',
      goal: 'engagement',
      status: 'active',
      budget: { type: 'daily', amountCents: 2000 },
      bidAmountCents: null,
      schedule: {
        start: NOW,
        end: new Date('2026-10-13T12:00:00Z'),
        days: 7,
        startsImmediately: true,
      },
      targeting: {
        minAge: 18,
        maxAge: 65,
        gender: 'all',
        countries: ['US'],
        locationIds: [],
        interests: [],
      },
      callToAction: null,
      dryRun: false,
      maxSpendCents: 14_000,
    });
  });

  it.each([
    [{ postId: 'DE6gpw8kxlonHy2b7Lo', tiktokPostId: undefined }, { kind: 'ayrshare_post' }],
    [{ authCode: '#Spark-Code_123', tiktokPostId: undefined }, { kind: 'spark_auth_code' }],
  ])('maps each post identifier to a PostReference', (overrides, expected) => {
    expect(valid(overrides).post).toMatchObject(expected);
  });

  it('accepts enums case-insensitively and normalises them', () => {
    const req = valid({
      goal: 'Traffic',
      gender: 'FEMALE',
      status: ' Paused ',
      budgetType: 'DAILY',
      callToAction: { type: 'learn_more', link: 'https://example.com' },
    });

    expect(req).toMatchObject({ goal: 'traffic', status: 'paused', budget: { type: 'daily' } });
    expect(req.targeting.gender).toBe('female');
    expect(req.callToAction).toEqual({ type: 'LEARN_MORE', link: 'https://example.com' });
  });

  it('accepts a small numeric tiktokPostId and keeps it as a string', () => {
    expect(valid({ tiktokPostId: 12345 }).post).toEqual({
      kind: 'tiktok_post',
      tiktokPostId: '12345',
    });
  });

  it('upper-cases and de-duplicates countries; stringifies numeric IDs', () => {
    const req = valid({
      locations: { countries: ['us', 'GB', 'gb'], locationIds: [6252001, '6252001'] },
      interests: [25, '25', '17'],
    });

    expect(req.targeting).toMatchObject({
      countries: ['US', 'GB'],
      locationIds: ['6252001'],
      interests: ['25', '17'],
    });
  });

  it('uses only locationIds when no countries are sent (no US default)', () => {
    expect(valid({ locations: { locationIds: ['6252001'] } }).targeting.countries).toEqual([]);
  });

  it('honours an explicit future startDate and accepts timezone offsets', () => {
    const req = valid({
      startDate: '2026-10-07T09:00:00+02:00',
      endDate: '2026-10-09T07:00:00Z',
    });

    expect(req.schedule).toMatchObject({
      start: new Date('2026-10-07T07:00:00Z'),
      days: 2,
      startsImmediately: false,
    });
  });

  it('trims adName and converts money to integer cents without float error', () => {
    const req = valid({ adName: '  Promo  ', budget: 20.29, bidAmount: 0.29 });

    expect(req.adName).toBe('Promo');
    expect(req.budget.amountCents).toBe(2029);
    expect(req.bidAmountCents).toBe(29);
  });
});

describe('validateBoostRequest — body shape', () => {
  it.each([undefined, null, 'text', 42, [base()]])('rejects a non-object body (%s)', (body) => {
    expect(details(body)).toMatch(/Request body must be a JSON object/);
  });

  it('reports every missing required field in one list', () => {
    expect(details({})).toBe(
      'Missing required fields: postId, tiktokPostId or authCode, adName, budget, endDate.',
    );
  });

  it('flags unknown fields so typos are caught', () => {
    const msg = details({ ...base(), budgt: 30, locations: { country: ['US'] } });

    expect(msg).toContain('budgt is not a supported field (check the spelling against the docs)');
    expect(msg).toContain('locations.country is not a supported field');
  });

  it('combines missing and invalid fields in one details string', () => {
    expect(details({ ...without('budget'), goal: 'sales', minAge: 21 })).toBe(
      'Missing required fields: budget. Invalid fields: ' +
        'goal must be one of: engagement, video_views, reach, traffic; ' +
        'minAge must be one of: 18, 25, 35, 45, 55 (TikTok targets the age ranges 18-24, 25-34, 35-44, 45-54 and 55+).',
    );
  });
});

describe('validateBoostRequest — post identifier', () => {
  it('requires one', () => {
    expect(details(without('tiktokPostId'))).toBe(
      'Missing required fields: postId, tiktokPostId or authCode.',
    );
  });

  it('rejects more than one and names them', () => {
    expect(details({ ...base(), authCode: 'abc' })).toMatch(
      /postId\/tiktokPostId\/authCode send exactly one of these to identify the post \(got tiktokPostId and authCode\)/,
    );
  });

  it.each([
    [{ tiktokPostId: 'abc' }, /tiktokPostId must be the numeric TikTok video ID/],
    // JSON.parse rounds 19-digit numbers; the error must explain that, not just "must be a string".
    [
      { tiktokPostId: JSON.parse('7301234567890123456') as number },
      /tiktokPostId must be sent as a string: this number is too large/,
    ],
    [{ tiktokPostId: true }, /tiktokPostId must be a string/],
    [{ tiktokPostId: undefined, postId: 'has spaces' }, /postId must be an Ayrshare post ID/],
    [{ tiktokPostId: undefined, authCode: '   ' }, /authCode must not be empty/],
  ])('validates identifier formats %#', (overrides, message) => {
    expect(details({ ...base(), ...overrides })).toMatch(message);
  });
});

describe('validateBoostRequest — field formats', () => {
  it.each([
    [{ adName: '' }, /adName must not be empty/],
    [{ adName: 'x'.repeat(101) }, /adName must be at most 100 characters/],
    [{ budget: '20' }, /budget must be a number/],
    [{ budget: 0 }, /budget must be greater than 0/],
    [{ budget: -5 }, /budget must be greater than 0/],
    [{ budget: 20.001 }, /budget must have at most 2 decimal places/],
    [{ bidAmount: 0.001 }, /bidAmount must have at most 2 decimal places/],
    [{ budgetType: 'weekly' }, /budgetType must be one of: daily, total/],
    [{ status: 'enabled' }, /status must be one of: active, paused/],
    [{ gender: 'other' }, /gender must be one of: all, male, female/],
    [{ endDate: '2026-10-13' }, /endDate must be an ISO 8601 date-time with a timezone/],
    [{ endDate: '2026-10-13T12:00:00' }, /endDate must be an ISO 8601 date-time/],
    [{ startDate: 'tomorrow' }, /startDate must be an ISO 8601 date-time/],
    [{ maxAge: 60 }, /maxAge must be one of: 24, 34, 44, 54, 65/],
    [{ dryRun: 'yes' }, /dryRun must be a boolean/],
    [{ locations: { countries: ['USA'] } }, /locations\.countries\[0\] must be an ISO 3166-1/],
    [{ locations: { locationIds: ['abc'] } }, /locations\.locationIds\[0\] must be a numeric ID/],
    [{ interests: ['x'] }, /interests\[0\] must be a numeric ID/],
    [{ interests: Array.from({ length: 101 }, (_, i) => i) }, /interests must have at most 100/],
    [
      { goal: 'traffic', callToAction: { type: 'BUY_NOW', link: 'https://x.com' } },
      /callToAction\.type must be one of: LEARN_MORE/,
    ],
    [
      { goal: 'traffic', callToAction: { type: 'LEARN_MORE', link: 'ftp://x.com' } },
      /callToAction\.link must be an http\(s\) URL/,
    ],
    [
      { goal: 'traffic', callToAction: { type: 'LEARN_MORE' } },
      /Missing required fields: callToAction\.link/,
    ],
  ])('rejects %j', (overrides, message) => {
    expect(details({ ...base(), ...overrides })).toMatch(message);
  });
});

describe('validateBoostRequest — schedule rules', () => {
  it('rejects a startDate in the past', () => {
    expect(details({ ...base(), startDate: '2026-10-06T11:00:00Z' })).toMatch(
      /startDate must not be in the past \(current time is 2026-10-06T12:00:00.000Z\); omit it to start immediately/,
    );
  });

  it('tolerates a few minutes of clock skew on startDate', () => {
    expect(valid({ startDate: '2026-10-06T11:57:00Z' }).schedule.startsImmediately).toBe(false);
  });

  it('rejects an endDate before the start', () => {
    expect(details({ ...base(), endDate: '2026-10-05T12:00:00Z' })).toMatch(
      /endDate must be after startDate/,
    );
  });

  it('rejects a schedule shorter than 24 hours', () => {
    expect(details({ ...base(), endDate: '2026-10-07T11:59:00Z' })).toMatch(
      /endDate must be at least 24 hours after the start/,
    );
  });

  it('accepts exactly 24 hours', () => {
    expect(valid({ endDate: '2026-10-07T12:00:00Z' }).schedule.days).toBe(1);
  });

  it('rejects a schedule longer than the configured maximum', () => {
    expect(details({ ...base(), endDate: '2027-01-05T12:00:01Z' })).toMatch(
      /endDate must be within 90 days of the start/,
    );
  });
});

describe('validateBoostRequest — budget rules', () => {
  it('enforces the 20.00 USD daily minimum', () => {
    expect(details({ ...base(), budget: 19.99 })).toMatch(
      /budget must be at least 20.00 USD for a daily budget \(TikTok minimum\)/,
    );
  });

  it('enforces 20.00 USD per day for a total budget', () => {
    expect(details({ ...base(), budgetType: 'total', budget: 139.99 })).toMatch(
      /budget must be at least 140.00 USD for a total budget over 7 days/,
    );
  });

  it('accepts a total budget at the minimum and reports it as maxSpend', () => {
    expect(valid({ budgetType: 'total', budget: 140 }).maxSpendCents).toBe(14_000);
  });

  it('requires bidAmount to be lower than budget', () => {
    expect(details({ ...base(), bidAmount: 20 })).toMatch(/bidAmount must be lower than budget/);
  });
});

describe('validateBoostRequest — targeting and goal rules', () => {
  it('requires minAge below maxAge', () => {
    expect(details({ ...base(), minAge: 35, maxAge: 34 })).toMatch(
      /minAge must be lower than maxAge \(34\)/,
    );
  });

  it('accepts a single bucket', () => {
    expect(valid({ minAge: 25, maxAge: 34 }).targeting).toMatchObject({ minAge: 25, maxAge: 34 });
  });

  it('rejects empty locations', () => {
    expect(details({ ...base(), locations: { countries: [] } })).toMatch(
      /locations must include at least one entry in countries or locationIds/,
    );
  });

  it('requires callToAction for the traffic goal', () => {
    expect(details({ ...base(), goal: 'traffic' })).toMatch(
      /callToAction is required for the traffic goal/,
    );
  });

  it('rejects callToAction for other goals (as Facebook boost does)', () => {
    expect(
      details({ ...base(), callToAction: { type: 'LEARN_MORE', link: 'https://x.com' } }),
    ).toMatch(/callToAction is only supported with the traffic goal \(goal is "engagement"\)/);
  });

  it('reports several cross-field problems together', () => {
    const msg = details({ ...base(), minAge: 55, maxAge: 24, budget: 5, goal: 'traffic' });

    expect(msg).toMatch(/minAge must be lower than maxAge/);
    expect(msg).toMatch(/budget must be at least 20.00 USD/);
    expect(msg).toMatch(/callToAction is required/);
  });
});

describe('budget helpers', () => {
  it('rounds billing days up', () => {
    expect(billingDays(new Date('2026-10-06T00:00:00Z'), new Date('2026-10-07T00:00:01Z'))).toBe(2);
  });

  it('computes worst-case spend for daily and total budgets', () => {
    expect(computeMaxSpendCents({ type: 'daily', amountCents: 2500 }, 3)).toBe(7500);
    expect(computeMaxSpendCents({ type: 'total', amountCents: 9000 }, 3)).toBe(9000);
  });
});
