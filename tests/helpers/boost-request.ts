import { DEMO } from '../../src/demo/fixtures.js';
import { validateBoostRequest, type BoostRequest } from '../../src/modules/tiktok-boost/schema.js';

export const TEST_NOW = new Date('2026-10-06T12:00:00Z');

/** A valid request body for the primary demo profile's first video: 7 days at $20/day. */
export function boostBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tiktokPostId: DEMO.advertisers.primary.videoIds[0],
    adName: 'Fall launch',
    budget: 20,
    endDate: '2026-10-13T12:00:00Z',
    ...overrides,
  };
}

export function boostRequest(overrides: Record<string, unknown> = {}): BoostRequest {
  return validateBoostRequest(boostBody(overrides), { now: TEST_NOW, maxCampaignDays: 90 });
}
