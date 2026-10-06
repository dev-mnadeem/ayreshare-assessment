import { pino, type DestinationStream, type Logger } from 'pino';

import type { Config } from './config/env.js';

export type { Logger };

/**
 * Secrets that must never reach logs: Ayrshare API/profile keys, TikTok access tokens,
 * and creator Spark authorization codes (which grant ad rights over someone's post).
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["profile-key"]',
  'req.headers["access-token"]',
  'headers.authorization',
  'headers["profile-key"]',
  'headers["Access-Token"]',
  'headers["access-token"]',
  'apiKey',
  'profileKey',
  'accessToken',
  'access_token',
  'authCode',
  'auth_code',
  '*.apiKey',
  '*.profileKey',
  '*.accessToken',
  '*.access_token',
  '*.authCode',
  '*.auth_code',
] as const;

export function createLogger(
  config: Pick<Config, 'logLevel' | 'env'>,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: config.logLevel,
    base: { env: config.env },
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
  };
  return destination ? pino(options, destination) : pino(options);
}
