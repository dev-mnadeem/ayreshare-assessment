import { describe, expect, it } from 'vitest';

import {
  kindForCode,
  TikTokError,
  type TikTokErrorKind,
} from '../../src/integrations/tiktok/errors.js';
import { translateTikTokError, type TikTokStep } from '../../src/integrations/tiktok/translate.js';

const error = (kind: TikTokErrorKind, method: 'GET' | 'POST' = 'POST') =>
  new TikTokError({
    kind,
    method,
    endpoint: '/campaign/create/',
    code: 40002,
    tiktokMessage: 'Budget must be at least 20.',
    requestId: 'req-123',
  });

describe('kindForCode', () => {
  it.each([
    [40100, 'rate_limited'],
    [40102, 'auth'],
    [40104, 'auth'],
    [40105, 'auth'],
    [50000, 'server'],
    [50002, 'server'],
    [40001, 'invalid_request'],
    [40002, 'invalid_request'],
    [41234, 'invalid_request'],
  ])('%i → %s', (code, kind) => {
    expect(kindForCode(code)).toBe(kind);
  });
});

describe('TikTokError flags', () => {
  it.each([
    ['rate_limited', 'POST', true, false],
    ['server', 'POST', true, true],
    ['timeout', 'POST', true, true],
    ['network', 'POST', true, true],
    ['malformed_response', 'POST', false, true],
    ['server', 'GET', true, false],
    ['timeout', 'GET', true, false],
    ['invalid_request', 'POST', false, false],
    ['auth', 'POST', false, false],
  ] as const)('%s on %s: transient=%s ambiguous=%s', (kind, method, transient, ambiguous) => {
    const err = error(kind, method);

    expect(err.transient).toBe(transient);
    expect(err.ambiguous).toBe(ambiguous);
  });
});

describe('translateTikTokError', () => {
  const translate = (kind: TikTokErrorKind, step: TikTokStep) =>
    translateTikTokError(error(kind), step).toEnvelope();

  it('rate limits → 606 (429) with retry advice', () => {
    const env = translate('rate_limited', 'campaign');

    expect(env.code).toBe(606);
    expect(env.details).toMatch(/Retry in a few seconds with the same Idempotency-Key/);
  });

  it.each(['server', 'timeout', 'network', 'malformed_response'] as const)(
    '%s → 607 (unavailable)',
    (kind) => {
      expect(translate(kind, 'adgroup').code).toBe(607);
    },
  );

  it('auth failures → 601 with re-link advice', () => {
    expect(translate('auth', 'campaign')).toMatchObject({
      code: 601,
      details: expect.stringMatching(/Re-link the TikTok Ads Manager account/) as unknown,
    });
  });

  it.each([
    ['spark_authorize', 602],
    ['spark_info', 602],
    ['identity', 603],
    ['video', 603],
    ['advertiser', 601],
    ['campaign', 605],
    ['adgroup', 605],
    ['ad', 605],
  ] as const)('invalid request during %s → %i', (step, code) => {
    expect(translate('invalid_request', step).code).toBe(code);
  });

  it("keeps TikTok's message, code and request_id in details", () => {
    expect(translate('invalid_request', 'adgroup').details).toBe(
      'TikTok rejected the request while creating the ad group: Budget must be at least 20. (TikTok code 40002, request_id req-123).',
    );
  });

  it('keeps the TikTokError as the cause', () => {
    const original = error('server');

    expect(translateTikTokError(original, 'ad').cause).toBe(original);
  });
});
