import type { IdentityType, OperationStatus } from './constants.js';
import type {
  AdCreatePayload,
  AdGroupCreatePayload,
  AdvertiserInfo,
  CampaignCreatePayload,
  ObjectLevel,
  ResolvedIdentity,
  SparkCodeInfo,
  TikTokCallContext,
  TikTokIdentity,
  TikTokVideo,
} from './types.js';

/**
 * Everything the boost flow needs from the TikTok Marketing API. Implementations throw
 * TikTokError (see errors.ts) on failure; they never return partial results.
 */
export interface TikTokAdsClient {
  // Pre-flight (read-only)
  getAdvertiser(ctx: TikTokCallContext): Promise<AdvertiserInfo>;
  getIdentities(ctx: TikTokCallContext, identityType: IdentityType): Promise<TikTokIdentity[]>;
  getIdentityVideo(
    ctx: TikTokCallContext,
    identity: ResolvedIdentity,
    itemId: string,
  ): Promise<TikTokVideo>;
  /** Maps ISO country codes to TikTok location IDs; unknown codes are absent from the map. */
  getCountryLocationIds(
    ctx: TikTokCallContext,
    objectiveType: string,
  ): Promise<ReadonlyMap<string, string>>;

  // Spark authorization codes (not available in the Marketing API sandbox)
  authorizeSparkCode(ctx: TikTokCallContext, authCode: string): Promise<void>;
  getSparkCodeInfo(ctx: TikTokCallContext, authCode: string): Promise<SparkCodeInfo>;

  // Creation (spends money once enabled)
  createCampaign(ctx: TikTokCallContext, payload: CampaignCreatePayload): Promise<string>;
  createAdGroup(ctx: TikTokCallContext, payload: AdGroupCreatePayload): Promise<string>;
  createAd(ctx: TikTokCallContext, payload: AdCreatePayload): Promise<string[]>;
  updateStatus(
    ctx: TikTokCallContext,
    level: ObjectLevel,
    ids: readonly string[],
    status: OperationStatus,
  ): Promise<void>;

  // Reconciliation after an ambiguous create (names embed the Ayrshare boost ID, so are unique)
  findIdByName(
    ctx: TikTokCallContext,
    level: ObjectLevel,
    name: string,
    parentId?: string,
  ): Promise<string | null>;
}
