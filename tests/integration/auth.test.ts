import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DEMO } from '../../src/db/seed.js';
import { authenticate, getAuth } from '../../src/middleware/authenticate.js';
import { harnessApp, testDeps } from '../helpers/test-app.js';

const app = harnessApp((a, deps) => {
  a.use('/api', authenticate(deps.authRepository));
  a.get('/api/whoami', (req, res) => {
    const { account, profile } = getAuth(req);
    res.json({ accountId: account.id, profileId: profile.id, hasTikTokAds: !!profile.tiktokAds });
  });
});

const whoami = (headers: Record<string, string> = {}) => {
  const req = request(app).get('/api/whoami');
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  return req;
};

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

describe('authenticate', () => {
  describe('401 — API key problems (code 102)', () => {
    it.each([
      ['missing header', {}, /Missing Authorization header/],
      ['non-Bearer scheme', { Authorization: `Basic ${DEMO.apiKey}` }, /Bearer scheme/],
      ['empty Bearer', { Authorization: 'Bearer ' }, /Bearer scheme/],
      ['unknown key', bearer('not-a-real-key'), /API Key not found/],
    ])('%s', async (_name, headers, details) => {
      const res = await whoami(headers);

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ status: 'error', code: 102, action: 'request' });
      expect((res.body as { details: string }).details).toMatch(details);
    });

    it('does not echo the submitted key back', async () => {
      const res = await whoami(bearer('super-secret-wrong-key'));

      expect(JSON.stringify(res.body)).not.toContain('super-secret-wrong-key');
    });
  });

  describe('success', () => {
    it('uses the primary profile when no Profile-Key is sent', async () => {
      const res = await whoami(bearer(DEMO.apiKey));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        accountId: 'acc_demo',
        profileId: 'prof_demo_primary',
        hasTikTokAds: true,
      });
    });

    it('selects the profile named by Profile-Key', async () => {
      const res = await whoami({
        ...bearer(DEMO.apiKey),
        'Profile-Key': DEMO.profileKeys.creator,
      });

      expect(res.body).toMatchObject({ profileId: 'prof_demo_creator' });
    });

    it('accepts a lowercase bearer scheme', async () => {
      const res = await whoami({ Authorization: `bearer ${DEMO.apiKey}` });

      expect(res.status).toBe(200);
    });

    it('authenticates profiles without TikTok ads (the 601 check is per endpoint)', async () => {
      const res = await whoami({
        ...bearer(DEMO.apiKey),
        'Profile-Key': DEMO.profileKeys.noTikTok,
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ hasTikTokAds: false });
    });
  });

  describe('403 — access denied', () => {
    it('rejects a suspended account (614)', async () => {
      const res = await whoami(bearer(DEMO.suspendedApiKey));

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 614 });
    });

    it('rejects a suspended profile (614) and names it', async () => {
      const res = await whoami({
        ...bearer(DEMO.apiKey),
        'Profile-Key': DEMO.profileKeys.suspended,
      });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 614 });
      expect((res.body as { details: string }).details).toContain('Suspended Profile');
    });

    it.each([
      ['unknown Profile-Key', 'no-such-profile'],
      ["another account's Profile-Key", DEMO.profileKeys.otherAccount],
    ])('rejects an %s identically (613)', async (_name, profileKey) => {
      const res = await whoami({ ...bearer(DEMO.apiKey), 'Profile-Key': profileKey });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 613, action: 'request' });
      expect((res.body as { details: string }).details).toMatch(/Omit the Profile-Key header/);
    });
  });
});

describe('createApp /api wiring', () => {
  const realApp = createApp(testDeps());

  it('authenticates before routing: unknown /api route without a key is 401', async () => {
    const res = await request(realApp).post('/api/ads/tiktok/boost');

    expect(res.status).toBe(401);
  });

  it('unknown /api route with a valid key is 404', async () => {
    const res = await request(realApp).post('/api/nope').set(bearer(DEMO.apiKey));

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 611 });
  });

  it('/health stays public', async () => {
    expect((await request(realApp).get('/health')).status).toBe(200);
  });
});
