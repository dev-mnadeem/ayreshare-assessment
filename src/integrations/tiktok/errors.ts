import { AUTH_ERROR_CODES, RATE_LIMIT_CODES, SERVER_ERROR_CODES } from './constants.js';

export type TikTokErrorKind =
  | 'rate_limited'
  | 'auth'
  | 'invalid_request'
  | 'server'
  | 'timeout'
  | 'network'
  | 'malformed_response';

interface TikTokErrorInit {
  kind: TikTokErrorKind;
  method: 'GET' | 'POST';
  endpoint: string;
  code?: number | null;
  tiktokMessage?: string | null;
  requestId?: string | null;
  httpStatus?: number | null;
  cause?: unknown;
}

/**
 * Any failed TikTok call. `ambiguous` means TikTok may have acted on the request even though we
 * saw a failure (timeout / 5xx on a write), so the caller must reconcile, never blindly retry.
 */
export class TikTokError extends Error {
  readonly kind: TikTokErrorKind;
  readonly method: 'GET' | 'POST';
  readonly endpoint: string;
  readonly code: number | null;
  readonly tiktokMessage: string | null;
  readonly requestId: string | null;
  readonly httpStatus: number | null;

  constructor(init: TikTokErrorInit) {
    super(
      `TikTok ${init.method} ${init.endpoint} failed (${init.kind}${init.code === undefined || init.code === null ? '' : ` ${init.code}`}): ${init.tiktokMessage ?? 'no message'}`,
      { cause: init.cause },
    );
    this.name = 'TikTokError';
    this.kind = init.kind;
    this.method = init.method;
    this.endpoint = init.endpoint;
    this.code = init.code ?? null;
    this.tiktokMessage = init.tiktokMessage ?? null;
    this.requestId = init.requestId ?? null;
    this.httpStatus = init.httpStatus ?? null;
  }

  /** Transient failures; whether a retry is *safe* also depends on `ambiguous`. */
  get transient(): boolean {
    return ['rate_limited', 'server', 'timeout', 'network'].includes(this.kind);
  }

  /**
   * A rejected-before-processing error (rate limit, validation) is never ambiguous; reads never
   * are. A write that returned something unparseable may still have succeeded.
   */
  get ambiguous(): boolean {
    return (
      this.method === 'POST' &&
      ['server', 'timeout', 'network', 'malformed_response'].includes(this.kind)
    );
  }
}

/** Classifies a TikTok response `code` that is not 0. */
export function kindForCode(code: number): TikTokErrorKind {
  if (RATE_LIMIT_CODES.has(code)) return 'rate_limited';
  if (AUTH_ERROR_CODES.has(code)) return 'auth';
  if (SERVER_ERROR_CODES.has(code)) return 'server';
  return 'invalid_request';
}
