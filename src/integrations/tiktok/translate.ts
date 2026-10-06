import { AppError } from '../../errors/app-error.js';

import type { TikTokError } from './errors.js';

/** Which step of the boost flow failed; decides the Ayrshare code for TikTok rejections. */
export type TikTokStep =
  | 'advertiser'
  | 'identity'
  | 'video'
  | 'spark_authorize'
  | 'spark_info'
  | 'regions'
  | 'campaign'
  | 'adgroup'
  | 'ad'
  | 'activate'
  | 'cleanup'
  | 'reconcile';

const STEP_LABEL: Record<TikTokStep, string> = {
  advertiser: 'loading the TikTok ads account',
  identity: 'loading the linked TikTok account',
  video: 'loading the TikTok post',
  spark_authorize: 'authorizing the Spark code',
  spark_info: 'loading the Spark code',
  regions: 'resolving target locations',
  campaign: 'creating the campaign',
  adgroup: 'creating the ad group',
  ad: 'creating the ad',
  activate: 'activating the ad',
  cleanup: 'cleaning up',
  reconcile: 'checking what was created',
};

function reference(err: TikTokError): string {
  const parts = [
    err.code === null ? null : `TikTok code ${err.code}`,
    err.requestId === null ? null : `request_id ${err.requestId}`,
  ].filter(Boolean);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/**
 * Turns a TikTok failure into an Ayrshare error whose `details` tells the developer what
 * happened and what to do. TikTok's own message and request_id are kept for support.
 */
export function translateTikTokError(err: TikTokError, step: TikTokStep): AppError {
  const where = STEP_LABEL[step];
  const tiktokSays = err.tiktokMessage ? `: ${err.tiktokMessage}` : '';
  const ref = reference(err);

  switch (err.kind) {
    case 'rate_limited':
      return new AppError(
        'TIKTOK_RATE_LIMITED',
        `TikTok rate limited the request while ${where}${ref}. Retry in a few seconds with the same Idempotency-Key.`,
        { cause: err },
      );
    case 'server':
    case 'timeout':
    case 'network':
    case 'malformed_response':
      return new AppError(
        'TIKTOK_UNAVAILABLE',
        `TikTok did not respond normally while ${where} (${err.kind})${ref}. Retry later with the same Idempotency-Key.`,
        { cause: err },
      );
    case 'auth':
      return new AppError(
        'TIKTOK_ACCOUNT_NOT_LINKED',
        `TikTok rejected access to the linked ads account while ${where}${tiktokSays}${ref}. Re-link the TikTok Ads Manager account for this profile in the Ayrshare dashboard.`,
        { cause: err },
      );
    case 'invalid_request':
      switch (step) {
        case 'spark_authorize':
        case 'spark_info':
          return new AppError(
            'SPARK_AUTH_CODE_INVALID',
            `TikTok rejected the authCode${tiktokSays}${ref}. Ask the creator for a new Spark authorization code (TikTok app → post → Ad settings) and retry.`,
            { cause: err },
          );
        case 'identity':
        case 'video':
          return new AppError(
            'POST_NOT_ELIGIBLE',
            `TikTok could not load the post for boosting${tiktokSays}${ref}. Check that the post is public, belongs to the linked TikTok account, and has ad authorization turned on.`,
            { cause: err },
          );
        case 'advertiser':
          return new AppError(
            'TIKTOK_ACCOUNT_NOT_LINKED',
            `TikTok could not load the linked ads account${tiktokSays}${ref}. Re-link the TikTok Ads Manager account for this profile.`,
            { cause: err },
          );
        case 'regions':
        case 'campaign':
        case 'adgroup':
        case 'ad':
        case 'activate':
        case 'cleanup':
        case 'reconcile':
          return new AppError(
            'TIKTOK_REJECTED',
            `TikTok rejected the request while ${where}${tiktokSays}${ref}.`,
            { cause: err },
          );
      }
  }
}
