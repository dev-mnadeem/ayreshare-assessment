import { randomBytes } from 'node:crypto';

/** Ayrshare-side boost ID, e.g. "bst_9f86d081884c7d659a2f". Embedded in TikTok object names. */
export function newBoostId(): string {
  return `bst_${randomBytes(10).toString('hex')}`;
}
