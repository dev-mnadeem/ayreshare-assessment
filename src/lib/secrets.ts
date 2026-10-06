import { createHash } from 'node:crypto';

/**
 * API and profile keys are stored only as SHA-256 digests and looked up by digest, so a
 * database leak doesn't expose usable keys. Keys are long random strings, so an unsalted
 * fast hash is appropriate here (unlike passwords).
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Field names whose values are credentials (case-insensitive, matched after removing `_`/`-`). */
const SECRET_KEYS = new Set([
  'apikey',
  'profilekey',
  'authorization',
  'accesstoken',
  'refreshtoken',
  'authcode',
  'token',
  'secret',
  'password',
]);

const isSecretKey = (key: string): boolean =>
  SECRET_KEYS.has(key.toLowerCase().replace(/[-_]/g, ''));

/** Keeps the last 4 characters so support can match a value without being able to use it. */
export function maskSecret(secret: string): string {
  return secret.length <= 4 ? '****' : `****${secret.slice(-4)}`;
}

/**
 * Deep copy with credential-named fields masked. Defence in depth for anything persisted or
 * logged outside pino (audit events, stored requests).
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        isSecretKey(key) && typeof v === 'string' ? maskSecret(v) : redactSecrets(v),
      ]),
    );
  }
  return value;
}
