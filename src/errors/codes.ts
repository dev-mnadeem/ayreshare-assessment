/**
 * Every error this service can return, in Ayrshare's envelope vocabulary.
 *
 * 101/102 are existing Ayrshare codes. The published Ayrshare list tops out at 519 (plus 369
 * for Facebook boost), so codes for this endpoint live in a 6xx block to avoid collisions;
 * in the real codebase they would be assigned from Ayrshare's internal registry.
 */
export interface ErrorDefinition {
  readonly code: number;
  readonly httpStatus: number;
  readonly action: 'request' | 'boost post';
  readonly message: string;
}

const DOCS_URL = 'https://www.ayrshare.com/docs/apis';

export const ERROR_CODES = {
  INVALID_PARAMETERS: {
    code: 101,
    httpStatus: 400,
    action: 'request',
    message: `Missing or incorrect parameters. Please verify with the docs. ${DOCS_URL}`,
  },
  INVALID_API_KEY: {
    code: 102,
    httpStatus: 401,
    action: 'request',
    message: 'API Key not valid. Please verify your API Key in the Ayrshare dashboard.',
  },
  TIKTOK_ACCOUNT_NOT_LINKED: {
    code: 601,
    httpStatus: 400,
    action: 'boost post',
    message: 'No usable TikTok ads account is linked to this profile.',
  },
  SPARK_AUTH_CODE_INVALID: {
    code: 602,
    httpStatus: 400,
    action: 'boost post',
    message: 'The TikTok Spark authorization code is invalid, expired, or already used.',
  },
  POST_NOT_ELIGIBLE: {
    code: 603,
    httpStatus: 400,
    action: 'boost post',
    message: 'The TikTok post was not found or cannot be boosted.',
  },
  SPEND_CAP_EXCEEDED: {
    code: 604,
    httpStatus: 400,
    action: 'boost post',
    message: 'The requested budget exceeds the spend limit for this account.',
  },
  TIKTOK_REJECTED: {
    code: 605,
    httpStatus: 400,
    action: 'boost post',
    message: 'Unable to boost post. TikTok rejected the request.',
  },
  TIKTOK_RATE_LIMITED: {
    code: 606,
    httpStatus: 429,
    action: 'boost post',
    message: 'TikTok is rate limiting requests. Please retry shortly.',
  },
  TIKTOK_UNAVAILABLE: {
    code: 607,
    httpStatus: 503,
    action: 'boost post',
    message: 'TikTok is temporarily unavailable. Please retry shortly.',
  },
  IDEMPOTENCY_KEY_REUSED: {
    code: 608,
    httpStatus: 409,
    action: 'request',
    message: 'This Idempotency-Key was already used with a different request body.',
  },
  IDEMPOTENCY_IN_PROGRESS: {
    code: 609,
    httpStatus: 409,
    action: 'request',
    message: 'A request with this Idempotency-Key is still being processed.',
  },
  BOOST_CLEANUP_INCOMPLETE: {
    code: 610,
    httpStatus: 500,
    action: 'boost post',
    message: 'Unable to boost post, and some TikTok objects could not be cleaned up.',
  },
  ENDPOINT_NOT_FOUND: {
    code: 611,
    httpStatus: 404,
    action: 'request',
    message: `Endpoint not found. Please verify with the docs. ${DOCS_URL}`,
  },
  INTERNAL_ERROR: {
    code: 612,
    httpStatus: 500,
    action: 'request',
    message: 'An unexpected error occurred. Please try again or contact us if the issue persists.',
  },
  PROFILE_KEY_INVALID: {
    code: 613,
    httpStatus: 403,
    action: 'request',
    message: 'Profile-Key not valid for this API Key.',
  },
  ACCESS_SUSPENDED: {
    code: 614,
    httpStatus: 403,
    action: 'request',
    message: 'Access denied. The account or User Profile is suspended.',
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorKey = keyof typeof ERROR_CODES;
