/**
 * Demo identifiers shared by the database seed and the mock TikTok client, so a seeded profile's
 * linked advertiser, token and videos all exist in the mock. Local development and tests only.
 */
export const DEMO = {
  apiKey: 'demo-api-key-active',
  suspendedApiKey: 'demo-api-key-suspended',
  otherAccountApiKey: 'demo-api-key-other',
  profileKeys: {
    creator: 'demo-profile-key-creator',
    noTikTok: 'demo-profile-key-no-tiktok',
    suspended: 'demo-profile-key-suspended',
    otherAccount: 'demo-profile-key-other-account',
  },
  advertisers: {
    primary: {
      advertiserId: '7100000000000000001',
      accessToken: 'mock-access-token-primary',
      username: 'democo',
      identityId: 'mock-identity-democo',
      videoIds: ['7300000000000000001', '7300000000000000002'],
    },
    creator: {
      advertiserId: '7100000000000000002',
      accessToken: 'mock-access-token-creator',
      username: 'creatorstudio',
      identityId: 'mock-identity-creatorstudio',
      videoIds: ['7300000000000000101'],
    },
    other: {
      advertiserId: '7100000000000000003',
      accessToken: 'mock-access-token-other',
      username: 'otherbrand',
      identityId: 'mock-identity-otherbrand',
      videoIds: ['7300000000000000201'],
    },
  },
  /** Creator Spark authorization codes known to the mock. */
  sparkCodes: {
    valid: 'SPARK-DEMO-VALID-CODE',
    expired: 'SPARK-DEMO-EXPIRED-CODE',
  },
  sparkVideo: {
    itemId: '7400000000000000001',
    identityId: 'mock-identity-spark-creator',
  },
  /** Ayrshare post IDs (as returned by POST /api/post) for TikTok videos above. */
  ayrsharePosts: {
    primaryFirst: {
      postId: 'demoPostPrimary1',
      profileId: 'prof_demo_primary',
      video: '7300000000000000001',
    },
    primarySecond: {
      postId: 'demoPostPrimary2',
      profileId: 'prof_demo_primary',
      video: '7300000000000000002',
    },
    creator: {
      postId: 'demoPostCreator1',
      profileId: 'prof_demo_creator',
      video: '7300000000000000101',
    },
  },
} as const;

/** ISO country → TikTok location ID served by the mock (real IDs are TikTok's geoname-style IDs). */
export const MOCK_COUNTRY_LOCATION_IDS: ReadonlyMap<string, string> = new Map([
  ['US', '6252001'],
  ['CA', '6251999'],
  ['GB', '2635167'],
  ['DE', '2921044'],
  ['FR', '3017382'],
  ['FI', '660013'],
  ['PK', '1168579'],
  ['AU', '2077456'],
]);
