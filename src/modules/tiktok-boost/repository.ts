import type { Db } from '../../db/database.js';
import type { IdentityType } from '../../integrations/tiktok/constants.js';

import type { AdStatus, BudgetType, Goal } from './constants.js';
import type { PostReference } from './schema.js';
import type { BoostRecord, BoostStatus, BoostUpdate, NewBoost, OrphanedObject } from './types.js';

export interface PostRepository {
  /** The TikTok video ID for an Ayrshare post owned by `profileId`, if any. */
  findTikTokVideoId(profileId: string, postId: string): string | undefined;
}

export interface BoostRepository {
  create(boost: NewBoost): BoostRecord;
  update(id: string, patch: BoostUpdate, now: Date): BoostRecord;
  findById(id: string): BoostRecord | undefined;
}

export class SqlitePostRepository implements PostRepository {
  private readonly byId;

  constructor(db: Db) {
    this.byId = db.prepare<[string, string], { platform_post_id: string }>(
      "SELECT platform_post_id FROM posts WHERE id = ? AND profile_id = ? AND platform = 'tiktok'",
    );
  }

  findTikTokVideoId(profileId: string, postId: string): string | undefined {
    return this.byId.get(postId, profileId)?.platform_post_id;
  }
}

interface BoostRow {
  id: string;
  account_id: string;
  profile_id: string;
  advertiser_id: string;
  status: BoostStatus;
  requested_status: AdStatus;
  ad_name: string;
  goal: Goal;
  post_kind: PostReference['kind'];
  ayrshare_post_id: string | null;
  tiktok_item_id: string;
  identity_type: IdentityType;
  identity_id: string;
  budget_type: BudgetType;
  budget_cents: number;
  max_spend_cents: number;
  start_at: string;
  end_at: string;
  request_json: string;
  campaign_id: string | null;
  adgroup_id: string | null;
  ad_id: string | null;
  orphans_json: string;
  tiktok_request_ids: string;
  error_code: number | null;
  error_details: string | null;
  created_at: string;
  updated_at: string;
}

function toRecord(row: BoostRow): BoostRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    profileId: row.profile_id,
    advertiserId: row.advertiser_id,
    status: row.status,
    requestedStatus: row.requested_status,
    adName: row.ad_name,
    goal: row.goal,
    postKind: row.post_kind,
    ayrsharePostId: row.ayrshare_post_id,
    tiktokItemId: row.tiktok_item_id,
    identityType: row.identity_type,
    identityId: row.identity_id,
    budgetType: row.budget_type,
    budgetCents: row.budget_cents,
    maxSpendCents: row.max_spend_cents,
    startAt: new Date(row.start_at),
    endAt: new Date(row.end_at),
    request: JSON.parse(row.request_json) as Record<string, unknown>,
    campaignId: row.campaign_id,
    adGroupId: row.adgroup_id,
    adId: row.ad_id,
    orphans: JSON.parse(row.orphans_json) as OrphanedObject[],
    tiktokRequestIds: JSON.parse(row.tiktok_request_ids) as string[],
    errorCode: row.error_code,
    errorDetails: row.error_details,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Patch field → column, with serialisation. Keeps update() free of hand-written SQL per field. */
const UPDATE_COLUMNS: {
  [K in keyof Required<BoostUpdate>]: [
    column: string,
    toDb: (v: Required<BoostUpdate>[K]) => unknown,
  ];
} = {
  status: ['status', (v) => v],
  campaignId: ['campaign_id', (v) => v],
  adGroupId: ['adgroup_id', (v) => v],
  adId: ['ad_id', (v) => v],
  orphans: ['orphans_json', (v) => JSON.stringify(v)],
  tiktokRequestIds: ['tiktok_request_ids', (v) => JSON.stringify(v)],
  errorCode: ['error_code', (v) => v],
  errorDetails: ['error_details', (v) => v],
};

export class SqliteBoostRepository implements BoostRepository {
  private readonly insert;
  private readonly selectById;

  constructor(private readonly db: Db) {
    this.insert = db.prepare(`
      INSERT INTO boosts (
        id, account_id, profile_id, advertiser_id, status, requested_status, ad_name, goal,
        post_kind, ayrshare_post_id, tiktok_item_id, identity_type, identity_id, budget_type,
        budget_cents, max_spend_cents, start_at, end_at, request_json, created_at, updated_at
      ) VALUES (
        @id, @account_id, @profile_id, @advertiser_id, 'in_progress', @requested_status, @ad_name,
        @goal, @post_kind, @ayrshare_post_id, @tiktok_item_id, @identity_type, @identity_id,
        @budget_type, @budget_cents, @max_spend_cents, @start_at, @end_at, @request_json,
        @created_at, @created_at
      )
    `);
    this.selectById = db.prepare<[string], BoostRow>('SELECT * FROM boosts WHERE id = ?');
  }

  create(boost: NewBoost): BoostRecord {
    this.insert.run({
      id: boost.id,
      account_id: boost.accountId,
      profile_id: boost.profileId,
      advertiser_id: boost.advertiserId,
      requested_status: boost.requestedStatus,
      ad_name: boost.adName,
      goal: boost.goal,
      post_kind: boost.postKind,
      ayrshare_post_id: boost.ayrsharePostId,
      tiktok_item_id: boost.tiktokItemId,
      identity_type: boost.identityType,
      identity_id: boost.identityId,
      budget_type: boost.budgetType,
      budget_cents: boost.budgetCents,
      max_spend_cents: boost.maxSpendCents,
      start_at: boost.startAt.toISOString(),
      end_at: boost.endAt.toISOString(),
      request_json: JSON.stringify(boost.request),
      created_at: boost.createdAt.toISOString(),
    });
    return this.require(boost.id);
  }

  update(id: string, patch: BoostUpdate, now: Date): BoostRecord {
    const sets: string[] = ['updated_at = @updated_at'];
    const params: Record<string, unknown> = { id, updated_at: now.toISOString() };
    for (const key of Object.keys(patch) as (keyof BoostUpdate)[]) {
      const value = patch[key];
      if (value === undefined) continue;
      const [column, toDb] = UPDATE_COLUMNS[key] as [string, (v: unknown) => unknown];
      sets.push(`${column} = @${column}`);
      params[column] = toDb(value);
    }
    const result = this.db
      .prepare(`UPDATE boosts SET ${sets.join(', ')} WHERE id = @id`)
      .run(params);
    if (result.changes !== 1) throw new Error(`Boost ${id} not found`);
    return this.require(id);
  }

  findById(id: string): BoostRecord | undefined {
    const row = this.selectById.get(id);
    return row && toRecord(row);
  }

  private require(id: string): BoostRecord {
    const record = this.findById(id);
    if (!record) throw new Error(`Boost ${id} not found`);
    return record;
  }
}
