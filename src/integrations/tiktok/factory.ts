import type { Config } from '../../config/env.js';
import type { Logger } from '../../logger.js';

import type { TikTokAdsClient } from './client.js';
import { HttpTikTokClient } from './http-client.js';
import { MockTikTokClient } from './mock-client.js';
import { RateLimiter } from './rate-limiter.js';

export function createTikTokClient(config: Config, logger: Logger): TikTokAdsClient {
  if (config.tiktok.mode === 'mock') return new MockTikTokClient();

  return new HttpTikTokClient({
    baseUrl: config.tiktok.baseUrl,
    timeoutMs: config.tiktok.timeoutMs,
    limiter: new RateLimiter(Math.ceil(1000 / config.tiktok.maxQps)),
    logger: logger.child({ component: 'tiktok', tiktokMode: config.tiktok.mode }),
  });
}
