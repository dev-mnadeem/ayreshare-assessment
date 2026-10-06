import type { IdentityType, OperationStatus } from './constants.js';

// ---------------------------------------------------------------------------
// Call context and tracing
// ---------------------------------------------------------------------------

/** One record per HTTP call to TikTok; the service persists these for the audit trail. */
export interface TikTokCallRecord {
  readonly method: 'GET' | 'POST';
  readonly endpoint: string;
  readonly requestId: string | null;
  readonly code: number | null;
  readonly outcome: 'ok' | 'api_error' | 'network_error';
  readonly durationMs: number;
}

export interface TikTokCallContext {
  readonly advertiserId: string;
  readonly accessToken: string;
  /** Invoked after every attempt (including retries). */
  readonly onCall?: (record: TikTokCallRecord) => void;
}

// ---------------------------------------------------------------------------
// Domain results returned by the client (camelCase; wire shapes stay inside the client)
// ---------------------------------------------------------------------------

export interface AdvertiserInfo {
  readonly advertiserId: string;
  readonly name: string;
  readonly currency: string;
  readonly timezone: string | null;
  readonly status: string;
}

export interface TikTokIdentity {
  readonly identityId: string;
  readonly identityType: IdentityType;
  readonly displayName: string | null;
  /** Only for BC_AUTH_TT identities. */
  readonly authorizedBcId: string | null;
}

export interface TikTokVideo {
  readonly itemId: string;
  readonly caption: string | null;
}

export interface SparkCodeInfo {
  readonly itemId: string;
  readonly identityId: string;
  readonly identityType: 'AUTH_CODE';
  readonly caption: string | null;
  /** When the creator's authorization expires; the ad must end before this. */
  readonly authEndTime: Date | null;
}

export interface ResolvedIdentity {
  readonly identityType: IdentityType;
  readonly identityId: string;
  readonly authorizedBcId: string | null;
}

export type ObjectLevel = 'campaign' | 'adgroup' | 'ad';

// ---------------------------------------------------------------------------
// Wire payloads (snake_case, exactly what TikTok receives). Built by mapper.ts.
// ---------------------------------------------------------------------------

export interface CampaignCreatePayload {
  advertiser_id: string;
  campaign_name: string;
  objective_type: string;
  budget_mode: string;
  operation_status: OperationStatus;
  request_id: string;
}

export interface AdGroupCreatePayload {
  advertiser_id: string;
  campaign_id: string;
  adgroup_name: string;
  placement_type: string;
  placements: string[];
  location_ids: string[];
  age_groups: string[];
  gender: string;
  interest_category_ids?: string[];
  budget_mode: string;
  budget: number;
  schedule_type: string;
  schedule_start_time: string;
  schedule_end_time: string;
  optimization_goal: string;
  billing_event: string;
  bid_type: string;
  bid_price?: number;
  pacing: string;
  operation_status: OperationStatus;
  request_id: string;
}

export interface AdCreativePayload {
  ad_name: string;
  ad_format: string;
  identity_type: IdentityType;
  identity_id: string;
  identity_authorized_bc_id?: string;
  tiktok_item_id: string;
  call_to_action?: string;
  landing_page_url?: string;
  operation_status: OperationStatus;
}

export interface AdCreatePayload {
  advertiser_id: string;
  adgroup_id: string;
  creatives: AdCreativePayload[];
}
