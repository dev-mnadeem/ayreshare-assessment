import { AppError } from '../../errors/app-error.js';

import type { Profile, TikTokAdsLink } from './types.js';

/** Every TikTok ads operation needs a linked ads account; fail with an actionable 601 if absent. */
export function requireTikTokAdsLink(profile: Profile): TikTokAdsLink {
  if (!profile.tiktokAds) {
    throw new AppError(
      'TIKTOK_ACCOUNT_NOT_LINKED',
      `User Profile "${profile.title}" has no linked TikTok ads account. Link a TikTok Ads Manager account to this profile in the Ayrshare dashboard, then retry.`,
    );
  }
  return profile.tiktokAds;
}
