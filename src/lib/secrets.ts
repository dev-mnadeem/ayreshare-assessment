import { createHash } from 'node:crypto';

/**
 * API and profile keys are stored only as SHA-256 digests and looked up by digest, so a
 * database leak doesn't expose usable keys. Keys are long random strings, so an unsalted
 * fast hash is appropriate here (unlike passwords).
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}
