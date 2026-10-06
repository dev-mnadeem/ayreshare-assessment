import { DEMO, MOCK_COUNTRY_LOCATION_IDS } from '../../demo/fixtures.js';

import type { TikTokAdsClient } from './client.js';
import { ENDPOINTS, RESPONSE_CODES, type IdentityType, type OperationStatus } from './constants.js';
import { kindForCode, TikTokError } from './errors.js';
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

/** A failure to inject into the next call of a given method. */
export type MockFailure =
  | { readonly kind: 'api'; readonly code: number; readonly message?: string }
  | { readonly kind: 'rate_limit' }
  | { readonly kind: 'server' }
  /** `afterSend`: TikTok performs the operation, but the response is lost (ambiguous write). */
  | { readonly kind: 'timeout'; readonly afterSend?: boolean };

export type MockMethod = Exclude<keyof TikTokAdsClient, symbol>;

interface MockAdvertiser {
  readonly info: AdvertiserInfo;
  readonly accessToken: string;
  readonly identity: TikTokIdentity;
  readonly videoIds: ReadonlySet<string>;
}

export interface MockObject {
  readonly id: string;
  readonly level: ObjectLevel;
  readonly advertiserId: string;
  readonly name: string;
  readonly parentId: string | null;
  status: OperationStatus;
  readonly payload: CampaignCreatePayload | AdGroupCreatePayload | AdCreatePayload;
}

const ENDPOINT_FOR: Record<MockMethod, { method: 'GET' | 'POST'; endpoint: string }> = {
  getAdvertiser: { method: 'GET', endpoint: ENDPOINTS.advertiserInfo },
  getIdentities: { method: 'GET', endpoint: ENDPOINTS.identityGet },
  getIdentityVideo: { method: 'GET', endpoint: ENDPOINTS.identityVideoInfo },
  getCountryLocationIds: { method: 'GET', endpoint: ENDPOINTS.region },
  authorizeSparkCode: { method: 'POST', endpoint: ENDPOINTS.sparkAuthorize },
  getSparkCodeInfo: { method: 'GET', endpoint: ENDPOINTS.sparkInfo },
  createCampaign: { method: 'POST', endpoint: ENDPOINTS.campaignCreate },
  createAdGroup: { method: 'POST', endpoint: ENDPOINTS.adGroupCreate },
  createAd: { method: 'POST', endpoint: ENDPOINTS.adCreate },
  updateStatus: { method: 'POST', endpoint: '/{level}/status/update/' },
  findIdByName: { method: 'GET', endpoint: '/{level}/get/' },
};

const ID_PREFIX: Record<ObjectLevel, string> = { campaign: '1810', adgroup: '1820', ad: '1830' };
const MIN_DAILY_BUDGET_USD = 20;

/**
 * In-process TikTok Marketing API stand-in. Used in tests and in TIKTOK_MODE=mock (the Spark
 * authorization endpoints have no sandbox). It enforces enough of TikTok's behaviour to exercise
 * error paths: token checks, ownership of posts, Spark code validity, budget minimums, request_id
 * de-duplication, and object status. Failures can be injected per method.
 */
export class MockTikTokClient implements TikTokAdsClient {
  /** Every call in order, for assertions. */
  readonly calls: { method: MockMethod; args: unknown[] }[] = [];

  private readonly advertisers = new Map<string, MockAdvertiser>();
  private readonly objects = new Map<string, MockObject>();
  private readonly byRequestId = new Map<string, string>();
  private readonly authorizedSparkCodes = new Map<string, Set<string>>();
  private readonly failures = new Map<MockMethod, MockFailure[]>();
  private sequence = 0;
  private requestSequence = 0;

  constructor() {
    for (const a of Object.values(DEMO.advertisers)) {
      this.advertisers.set(a.advertiserId, {
        info: {
          advertiserId: a.advertiserId,
          name: `${a.username} ads`,
          currency: 'USD',
          timezone: 'Etc/GMT',
          status: 'STATUS_ENABLE',
        },
        accessToken: a.accessToken,
        identity: {
          identityId: a.identityId,
          identityType: 'TT_USER',
          displayName: a.username,
          authorizedBcId: null,
        },
        videoIds: new Set(a.videoIds),
      });
    }
  }

  // ---- test controls ---------------------------------------------------------

  /** Queue a failure for the next call(s) of `method`. */
  failNext(method: MockMethod, failure: MockFailure, times = 1): this {
    const queue = this.failures.get(method) ?? [];
    for (let i = 0; i < times; i++) queue.push(failure);
    this.failures.set(method, queue);
    return this;
  }

  /** Simulate an advertiser account in a non-USD currency (pre-flight should reject it). */
  setAdvertiserCurrency(advertiserId: string, currency: string): void {
    const adv = this.requireAdvertiser(advertiserId);
    this.advertisers.set(advertiserId, { ...adv, info: { ...adv.info, currency } });
  }

  getObject(id: string): MockObject | undefined {
    return this.objects.get(id);
  }

  listObjects(level?: ObjectLevel): MockObject[] {
    return [...this.objects.values()].filter((o) => !level || o.level === level);
  }

  callCount(method: MockMethod): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  // ---- TikTokAdsClient -------------------------------------------------------

  getAdvertiser(ctx: TikTokCallContext): Promise<AdvertiserInfo> {
    return this.run('getAdvertiser', ctx, [], () => this.authorize(ctx).info);
  }

  getIdentities(ctx: TikTokCallContext, identityType: IdentityType): Promise<TikTokIdentity[]> {
    return this.run('getIdentities', ctx, [identityType], () => {
      const adv = this.authorize(ctx);
      return adv.identity.identityType === identityType ? [adv.identity] : [];
    });
  }

  getIdentityVideo(
    ctx: TikTokCallContext,
    identity: ResolvedIdentity,
    itemId: string,
  ): Promise<TikTokVideo> {
    return this.run('getIdentityVideo', ctx, [identity, itemId], () => {
      const adv = this.authorize(ctx);
      if (identity.identityId !== adv.identity.identityId || !adv.videoIds.has(itemId)) {
        throw this.apiError('getIdentityVideo', RESPONSE_CODES.invalidValue, 'Video not found.');
      }
      return { itemId, caption: `Demo video ${itemId}` };
    });
  }

  getCountryLocationIds(
    ctx: TikTokCallContext,
    objectiveType: string,
  ): Promise<ReadonlyMap<string, string>> {
    return this.run('getCountryLocationIds', ctx, [objectiveType], () => {
      this.authorize(ctx);
      return MOCK_COUNTRY_LOCATION_IDS;
    });
  }

  authorizeSparkCode(ctx: TikTokCallContext, authCode: string): Promise<void> {
    return this.run('authorizeSparkCode', ctx, [authCode], () => {
      this.authorize(ctx);
      this.checkSparkCode(authCode, 'authorizeSparkCode');
      const set = this.authorizedSparkCodes.get(ctx.advertiserId) ?? new Set<string>();
      set.add(authCode);
      this.authorizedSparkCodes.set(ctx.advertiserId, set);
    });
  }

  getSparkCodeInfo(ctx: TikTokCallContext, authCode: string): Promise<SparkCodeInfo> {
    return this.run('getSparkCodeInfo', ctx, [authCode], () => {
      this.authorize(ctx);
      this.checkSparkCode(authCode, 'getSparkCodeInfo');
      return {
        itemId: DEMO.sparkVideo.itemId,
        identityId: DEMO.sparkVideo.identityId,
        identityType: 'AUTH_CODE',
        caption: 'Creator Spark video',
        authEndTime: new Date('2099-01-01T00:00:00Z'),
      };
    });
  }

  createCampaign(ctx: TikTokCallContext, payload: CampaignCreatePayload): Promise<string> {
    return this.run('createCampaign', ctx, [payload], () => {
      this.authorize(ctx);
      return this.create('campaign', ctx, payload.campaign_name, null, payload, payload.request_id);
    });
  }

  createAdGroup(ctx: TikTokCallContext, payload: AdGroupCreatePayload): Promise<string> {
    return this.run('createAdGroup', ctx, [payload], () => {
      this.authorize(ctx);
      this.requireOwned(ctx, payload.campaign_id, 'campaign', 'createAdGroup');
      if (payload.budget_mode === 'BUDGET_MODE_DAY' && payload.budget < MIN_DAILY_BUDGET_USD) {
        throw this.apiError(
          'createAdGroup',
          RESPONSE_CODES.invalidValue,
          'Budget must be at least 20.',
        );
      }
      if (payload.location_ids.length === 0) {
        throw this.apiError(
          'createAdGroup',
          RESPONSE_CODES.invalidParam,
          'location_ids is required.',
        );
      }
      return this.create(
        'adgroup',
        ctx,
        payload.adgroup_name,
        payload.campaign_id,
        payload,
        payload.request_id,
      );
    });
  }

  createAd(ctx: TikTokCallContext, payload: AdCreatePayload): Promise<string[]> {
    return this.run('createAd', ctx, [payload], () => {
      const adv = this.authorize(ctx);
      this.requireOwned(ctx, payload.adgroup_id, 'adgroup', 'createAd');
      const [creative] = payload.creatives;
      if (!creative) {
        throw this.apiError('createAd', RESPONSE_CODES.invalidParam, 'creatives is required.');
      }
      const ownPost =
        creative.identity_type === 'TT_USER' &&
        creative.identity_id === adv.identity.identityId &&
        adv.videoIds.has(creative.tiktok_item_id);
      const sparkPost =
        creative.identity_type === 'AUTH_CODE' &&
        creative.identity_id === DEMO.sparkVideo.identityId &&
        creative.tiktok_item_id === DEMO.sparkVideo.itemId &&
        (this.authorizedSparkCodes.get(ctx.advertiserId)?.size ?? 0) > 0;
      if (!ownPost && !sparkPost) {
        throw this.apiError(
          'createAd',
          RESPONSE_CODES.invalidValue,
          'The TikTok post is not authorized for this identity.',
        );
      }
      return [this.create('ad', ctx, creative.ad_name, payload.adgroup_id, payload, null)];
    });
  }

  updateStatus(
    ctx: TikTokCallContext,
    level: ObjectLevel,
    ids: readonly string[],
    status: OperationStatus,
  ): Promise<void> {
    return this.run('updateStatus', ctx, [level, ids, status], () => {
      this.authorize(ctx);
      const targets = ids.map((id) => this.requireOwned(ctx, id, level, 'updateStatus'));
      for (const t of targets) t.status = status;
    });
  }

  findIdByName(
    ctx: TikTokCallContext,
    level: ObjectLevel,
    name: string,
    parentId?: string,
  ): Promise<string | null> {
    return this.run('findIdByName', ctx, [level, name, parentId], () => {
      this.authorize(ctx);
      const match = this.listObjects(level).find(
        (o) =>
          o.advertiserId === ctx.advertiserId &&
          o.name === name &&
          (parentId === undefined || o.parentId === parentId),
      );
      return match?.id ?? null;
    });
  }

  // ---- internals ---------------------------------------------------------------

  private async run<T>(
    method: MockMethod,
    ctx: TikTokCallContext,
    args: unknown[],
    operation: () => T,
  ): Promise<T> {
    await Promise.resolve(); // behave like real I/O: never resolve synchronously
    this.calls.push({ method, args });
    const { method: httpMethod, endpoint } = ENDPOINT_FOR[method];
    const requestId = `mock-req-${String(++this.requestSequence)}`;
    const record = (outcome: 'ok' | 'api_error' | 'network_error', code: number | null) =>
      ctx.onCall?.({ method: httpMethod, endpoint, requestId, code, outcome, durationMs: 0 });

    const failure = this.failures.get(method)?.shift();
    if (failure) {
      if (failure.kind === 'timeout') {
        if (failure.afterSend) operation();
        record('network_error', null);
        throw new TikTokError({ kind: 'timeout', method: httpMethod, endpoint });
      }
      const code =
        failure.kind === 'api'
          ? failure.code
          : failure.kind === 'rate_limit'
            ? RESPONSE_CODES.rateLimited
            : RESPONSE_CODES.internalError;
      record('api_error', code);
      throw new TikTokError({
        kind: kindForCode(code),
        method: httpMethod,
        endpoint,
        code,
        requestId,
        tiktokMessage:
          failure.kind === 'api' ? (failure.message ?? 'Injected failure') : failure.kind,
      });
    }

    try {
      const result = operation();
      record('ok', RESPONSE_CODES.ok);
      return result;
    } catch (err) {
      if (err instanceof TikTokError) record('api_error', err.code);
      throw err;
    }
  }

  private authorize(ctx: TikTokCallContext): MockAdvertiser {
    const adv = this.advertisers.get(ctx.advertiserId);
    if (adv?.accessToken !== ctx.accessToken) {
      throw this.apiError(
        'getAdvertiser',
        RESPONSE_CODES.tokenInvalid,
        'Access token is invalid or has no access to this advertiser.',
      );
    }
    return adv;
  }

  private requireAdvertiser(advertiserId: string): MockAdvertiser {
    const adv = this.advertisers.get(advertiserId);
    if (!adv) throw new Error(`Unknown mock advertiser ${advertiserId}`);
    return adv;
  }

  private checkSparkCode(authCode: string, method: MockMethod): void {
    if (authCode === DEMO.sparkCodes.expired) {
      throw this.apiError(method, RESPONSE_CODES.invalidValue, 'The auth code has expired.');
    }
    if (authCode !== DEMO.sparkCodes.valid) {
      throw this.apiError(method, RESPONSE_CODES.invalidValue, 'Invalid auth code.');
    }
  }

  private requireOwned(
    ctx: TikTokCallContext,
    id: string,
    level: ObjectLevel,
    method: MockMethod,
  ): MockObject {
    const obj = this.objects.get(id);
    if (obj?.level !== level || obj.advertiserId !== ctx.advertiserId) {
      throw this.apiError(method, RESPONSE_CODES.invalidValue, `${level} ${id} does not exist.`);
    }
    return obj;
  }

  private create(
    level: ObjectLevel,
    ctx: TikTokCallContext,
    name: string,
    parentId: string | null,
    payload: MockObject['payload'],
    requestId: string | null,
  ): string {
    // UNVERIFIED (M0): models TikTok's request_id as a de-duplication key.
    const dedupeKey = requestId && `${ctx.advertiserId}:${level}:${requestId}`;
    const existing = dedupeKey ? this.byRequestId.get(dedupeKey) : undefined;
    if (existing) return existing;

    const id = `${ID_PREFIX[level]}${String(++this.sequence).padStart(15, '0')}`;
    const status = 'operation_status' in payload ? payload.operation_status : 'ENABLE';
    this.objects.set(id, {
      id,
      level,
      advertiserId: ctx.advertiserId,
      name,
      parentId,
      status:
        level === 'ad'
          ? ((payload as AdCreatePayload).creatives[0]?.operation_status ?? 'ENABLE')
          : status,
      payload,
    });
    if (dedupeKey) this.byRequestId.set(dedupeKey, id);
    return id;
  }

  private apiError(method: MockMethod, code: number, message: string): TikTokError {
    const { method: httpMethod, endpoint } = ENDPOINT_FOR[method];
    return new TikTokError({
      kind: kindForCode(code),
      method: httpMethod,
      endpoint,
      code,
      tiktokMessage: message,
      requestId: `mock-req-${String(this.requestSequence)}`,
    });
  }
}
