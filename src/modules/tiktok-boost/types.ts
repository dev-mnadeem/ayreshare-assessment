import type { IdentityType } from '../../integrations/tiktok/constants.js';
import type { ObjectLevel } from '../../integrations/tiktok/types.js';

import type { AdStatus, BudgetType, Goal } from './constants.js';
import type { PostReference } from './schema.js';

/**
 * in_progress → live | paused (success), or → failed (cleaned up) | cleanup_failed (orphans left).
 */
export type BoostStatus = 'in_progress' | 'live' | 'paused' | 'failed' | 'cleanup_failed';

/** A TikTok object we created but could not delete after a failure. */
export interface OrphanedObject {
  readonly level: ObjectLevel;
  /** null when a create failed ambiguously and the object could not be looked up. */
  readonly id: string | null;
  readonly name: string;
  /** What we know about it: `disabled` objects cannot spend. */
  readonly state: 'disabled' | 'enabled' | 'unknown';
}

export interface BoostRecord {
  readonly id: string;
  readonly accountId: string;
  readonly profileId: string;
  readonly advertiserId: string;
  readonly status: BoostStatus;
  readonly requestedStatus: AdStatus;
  readonly adName: string;
  readonly goal: Goal;
  readonly postKind: PostReference['kind'];
  readonly ayrsharePostId: string | null;
  readonly tiktokItemId: string;
  readonly identityType: IdentityType;
  readonly identityId: string;
  readonly budgetType: BudgetType;
  readonly budgetCents: number;
  readonly maxSpendCents: number;
  readonly startAt: Date;
  readonly endAt: Date;
  /** Normalised request with secrets masked; enough to render and audit the boost. */
  readonly request: Record<string, unknown>;
  readonly campaignId: string | null;
  readonly adGroupId: string | null;
  readonly adId: string | null;
  readonly orphans: readonly OrphanedObject[];
  readonly tiktokRequestIds: readonly string[];
  readonly errorCode: number | null;
  readonly errorDetails: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type NewBoost = Omit<
  BoostRecord,
  | 'status'
  | 'campaignId'
  | 'adGroupId'
  | 'adId'
  | 'orphans'
  | 'tiktokRequestIds'
  | 'errorCode'
  | 'errorDetails'
  | 'updatedAt'
>;

export type BoostUpdate = Partial<
  Pick<
    BoostRecord,
    | 'status'
    | 'campaignId'
    | 'adGroupId'
    | 'adId'
    | 'orphans'
    | 'tiktokRequestIds'
    | 'errorCode'
    | 'errorDetails'
  >
>;
