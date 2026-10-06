import { z } from 'zod';

import type { Logger } from '../../logger.js';

import type { TikTokAdsClient } from './client.js';
import { ENDPOINTS, type IdentityType, type OperationStatus, PLACEMENTS } from './constants.js';
import { kindForCode, TikTokError, type TikTokErrorKind } from './errors.js';
import { fromTikTokDateTime } from './mapper.js';
import { realSleep, type RateLimiter, type Sleep } from './rate-limiter.js';
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

// ---------------------------------------------------------------------------
// Response schemas. The envelope is ✅; `data` shapes are UNVERIFIED (M0) unless noted, and
// deliberately lenient (unknown keys are ignored) so additive TikTok changes don't break us.
// ---------------------------------------------------------------------------

const envelopeSchema = z.object({
  code: z.number(),
  message: z.string().default(''),
  request_id: z.string().optional(),
  data: z.unknown(),
});

const advertiserInfoData = z.object({
  list: z
    .array(
      z.object({
        advertiser_id: z.string(),
        name: z.string(),
        currency: z.string(),
        timezone: z.string().nullish(),
        status: z.string(),
      }),
    )
    .min(1),
});

const identityListData = z.object({
  identity_list: z.array(
    z.object({
      identity_id: z.string(),
      identity_type: z.enum(['AUTH_CODE', 'TT_USER', 'BC_AUTH_TT', 'CUSTOMIZED_USER']),
      display_name: z.string().nullish(),
      identity_authorized_bc_id: z.string().nullish(),
    }),
  ),
});

const itemInfo = z.object({ item_id: z.string(), text: z.string().nullish() });

const identityVideoData = z.object({ video_detail: itemInfo });

const sparkInfoData = z.object({
  item_info: itemInfo,
  user_info: z.object({ identity_id: z.string() }),
  auth_info: z
    .object({
      auth_end_time: z
        .string()
        .nullish()
        .transform((value, ctx) => {
          if (!value) return null;
          const date = fromTikTokDateTime(value);
          if (date) return date;
          ctx.addIssue({ code: 'custom', message: 'not a recognised date-time' });
          return z.NEVER;
        }),
    })
    .nullish(),
});

const regionData = z.object({
  region_info: z.array(
    z.object({ location_id: z.string(), region_code: z.string(), level: z.string() }),
  ),
});

const campaignCreateData = z.object({ campaign_id: z.string() }); // ✅ field name
const adGroupCreateData = z.object({ adgroup_id: z.string() }); // ✅ field name
const adCreateData = z.object({ ad_ids: z.array(z.string()).min(1) });

const NAME_FIELD: Record<ObjectLevel, { id: string; name: string }> = {
  campaign: { id: 'campaign_id', name: 'campaign_name' },
  adgroup: { id: 'adgroup_id', name: 'adgroup_name' },
  ad: { id: 'ad_id', name: 'ad_name' },
};

const listData = z.object({ list: z.array(z.record(z.string(), z.unknown())) });

const STATUS_ENDPOINT: Record<ObjectLevel, { path: string; idsField: string }> = {
  campaign: { path: ENDPOINTS.campaignStatus, idsField: 'campaign_ids' },
  adgroup: { path: ENDPOINTS.adGroupStatus, idsField: 'adgroup_ids' },
  ad: { path: ENDPOINTS.adStatus, idsField: 'ad_ids' },
};

const GET_ENDPOINT: Record<ObjectLevel, string> = {
  campaign: ENDPOINTS.campaignGet,
  adgroup: ENDPOINTS.adGroupGet,
  ad: ENDPOINTS.adGet,
};

const PARENT_FILTER: Record<ObjectLevel, string | null> = {
  campaign: null,
  adgroup: 'campaign_ids',
  ad: 'adgroup_ids',
};

// ---------------------------------------------------------------------------

export interface HttpTikTokClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly limiter: RateLimiter;
  readonly logger: Logger;
  /** Retries for safe, transient failures. */
  readonly maxRetries?: number;
  readonly retryBaseDelayMs?: number;
  readonly sleep?: Sleep;
  readonly fetch?: typeof fetch;
}

type Params = Record<string, unknown>;

/** TikTok GET params: scalars as-is, arrays/objects JSON-encoded. */
function toQuery(params: Params): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return search.toString();
}

export class HttpTikTokClient implements TikTokAdsClient {
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: Sleep;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpTikTokClientOptions) {
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1000;
    this.sleep = options.sleep ?? realSleep;
    this.fetchImpl = options.fetch ?? fetch;
  }

  // ---- TikTokAdsClient ------------------------------------------------------

  async getAdvertiser(ctx: TikTokCallContext): Promise<AdvertiserInfo> {
    const data = await this.get(ctx, ENDPOINTS.advertiserInfo, advertiserInfoData, {
      advertiser_ids: [ctx.advertiserId],
    });
    const [first] = data.list;
    if (!first) throw new Error('unreachable: schema requires a non-empty list');
    return {
      advertiserId: first.advertiser_id,
      name: first.name,
      currency: first.currency,
      timezone: first.timezone ?? null,
      status: first.status,
    };
  }

  async getIdentities(
    ctx: TikTokCallContext,
    identityType: IdentityType,
  ): Promise<TikTokIdentity[]> {
    const data = await this.get(ctx, ENDPOINTS.identityGet, identityListData, {
      advertiser_id: ctx.advertiserId,
      identity_type: identityType,
    });
    return data.identity_list
      .filter((i) => i.identity_type !== 'CUSTOMIZED_USER')
      .map((i) => ({
        identityId: i.identity_id,
        identityType: i.identity_type as IdentityType,
        displayName: i.display_name ?? null,
        authorizedBcId: i.identity_authorized_bc_id ?? null,
      }));
  }

  async getIdentityVideo(
    ctx: TikTokCallContext,
    identity: ResolvedIdentity,
    itemId: string,
  ): Promise<TikTokVideo> {
    const data = await this.get(ctx, ENDPOINTS.identityVideoInfo, identityVideoData, {
      advertiser_id: ctx.advertiserId,
      identity_type: identity.identityType,
      identity_id: identity.identityId,
      identity_authorized_bc_id: identity.authorizedBcId ?? undefined,
      item_id: itemId,
    });
    return { itemId: data.video_detail.item_id, caption: data.video_detail.text ?? null };
  }

  async getCountryLocationIds(
    ctx: TikTokCallContext,
    objectiveType: string,
  ): Promise<ReadonlyMap<string, string>> {
    const data = await this.get(ctx, ENDPOINTS.region, regionData, {
      advertiser_id: ctx.advertiserId,
      placements: PLACEMENTS,
      objective_type: objectiveType,
    });
    return new Map(
      data.region_info
        .filter((r) => r.level === 'COUNTRY')
        .map((r) => [r.region_code.toUpperCase(), r.location_id]),
    );
  }

  async authorizeSparkCode(ctx: TikTokCallContext, authCode: string): Promise<void> {
    await this.post(ctx, ENDPOINTS.sparkAuthorize, z.unknown(), {
      advertiser_id: ctx.advertiserId,
      auth_code: authCode,
    });
  }

  async getSparkCodeInfo(ctx: TikTokCallContext, authCode: string): Promise<SparkCodeInfo> {
    const data = await this.get(ctx, ENDPOINTS.sparkInfo, sparkInfoData, {
      advertiser_id: ctx.advertiserId,
      auth_code: authCode,
    });
    return {
      itemId: data.item_info.item_id,
      identityId: data.user_info.identity_id,
      identityType: 'AUTH_CODE',
      caption: data.item_info.text ?? null,
      authEndTime: data.auth_info?.auth_end_time ?? null,
    };
  }

  async createCampaign(ctx: TikTokCallContext, payload: CampaignCreatePayload): Promise<string> {
    return (await this.post(ctx, ENDPOINTS.campaignCreate, campaignCreateData, payload))
      .campaign_id;
  }

  async createAdGroup(ctx: TikTokCallContext, payload: AdGroupCreatePayload): Promise<string> {
    return (await this.post(ctx, ENDPOINTS.adGroupCreate, adGroupCreateData, payload)).adgroup_id;
  }

  async createAd(ctx: TikTokCallContext, payload: AdCreatePayload): Promise<string[]> {
    return (await this.post(ctx, ENDPOINTS.adCreate, adCreateData, payload)).ad_ids;
  }

  async updateStatus(
    ctx: TikTokCallContext,
    level: ObjectLevel,
    ids: readonly string[],
    status: OperationStatus,
  ): Promise<void> {
    const { path, idsField } = STATUS_ENDPOINT[level];
    await this.post(ctx, path, z.unknown(), {
      advertiser_id: ctx.advertiserId,
      [idsField]: ids,
      operation_status: status,
    });
  }

  async findIdByName(
    ctx: TikTokCallContext,
    level: ObjectLevel,
    name: string,
    parentId?: string,
  ): Promise<string | null> {
    const parentFilter = PARENT_FILTER[level];
    const filtering =
      parentFilter && parentId
        ? { [parentFilter]: [parentId] }
        : { [NAME_FIELD[level].name]: name }; // UNVERIFIED (M0): name filter key
    const data = await this.get(ctx, GET_ENDPOINT[level], listData, {
      advertiser_id: ctx.advertiserId,
      filtering,
      page_size: 100,
    });
    const match = data.list.find((row) => row[NAME_FIELD[level].name] === name);
    const id = match?.[NAME_FIELD[level].id];
    return typeof id === 'string' ? id : null;
  }

  // ---- transport ------------------------------------------------------------

  private get<T>(ctx: TikTokCallContext, endpoint: string, schema: z.ZodType<T>, params: Params) {
    return this.request(ctx, 'GET', endpoint, schema, params);
  }

  private post<T>(ctx: TikTokCallContext, endpoint: string, schema: z.ZodType<T>, body: object) {
    return this.request(ctx, 'POST', endpoint, schema, body as Params);
  }

  /**
   * Retries only when it is provably safe: rate-limit rejections (TikTok didn't process the
   * call) for any method, and other transient failures for reads. Writes that fail ambiguously
   * surface immediately so the caller can reconcile instead of creating duplicates.
   */
  private async request<T>(
    ctx: TikTokCallContext,
    method: 'GET' | 'POST',
    endpoint: string,
    schema: z.ZodType<T>,
    params: Params,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.options.limiter.schedule(() =>
          this.attempt(ctx, method, endpoint, schema, params),
        );
      } catch (err) {
        const safeToRetry =
          err instanceof TikTokError &&
          (err.kind === 'rate_limited' || (method === 'GET' && err.transient));
        if (!safeToRetry || attempt >= this.maxRetries) throw err;
        await this.sleep(this.retryBaseDelayMs * 2 ** attempt);
      }
    }
  }

  private async attempt<T>(
    ctx: TikTokCallContext,
    method: 'GET' | 'POST',
    endpoint: string,
    schema: z.ZodType<T>,
    params: Params,
  ): Promise<T> {
    const url = new URL(`${this.options.baseUrl.replace(/\/$/, '')}${endpoint}`);
    if (method === 'GET') url.search = toQuery(params);

    const startedAt = Date.now();
    const record = (
      outcome: 'ok' | 'api_error' | 'network_error',
      code: number | null,
      requestId: string | null,
    ) => {
      const entry = {
        method,
        endpoint,
        requestId,
        code,
        outcome,
        durationMs: Date.now() - startedAt,
      };
      ctx.onCall?.(entry);
      this.options.logger.debug({ tiktok: entry }, 'tiktok call');
    };
    const fail = (
      kind: TikTokErrorKind,
      extra: Partial<ConstructorParameters<typeof TikTokError>[0]> = {},
    ) => new TikTokError({ kind, method, endpoint, ...extra });

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: { 'Access-Token': ctx.accessToken, 'Content-Type': 'application/json' },
        ...(method === 'POST' && { body: JSON.stringify(params) }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (err) {
      record('network_error', null, null);
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      throw fail(timedOut ? 'timeout' : 'network', { cause: err });
    }

    const raw: unknown = await response.json().catch(() => undefined);
    const envelope = envelopeSchema.safeParse(raw);
    const requestId = envelope.success ? (envelope.data.request_id ?? null) : null;
    const httpStatus = response.status;

    if (!envelope.success || (httpStatus >= 400 && envelope.data.code === 0)) {
      record('api_error', null, requestId);
      const kind: TikTokErrorKind =
        httpStatus === 429 ? 'rate_limited' : httpStatus >= 500 ? 'server' : 'malformed_response';
      throw fail(kind, { httpStatus, requestId, tiktokMessage: `HTTP ${httpStatus}` });
    }

    const { code, message } = envelope.data;
    if (code !== 0) {
      record('api_error', code, requestId);
      throw fail(kindForCode(code), { code, tiktokMessage: message, requestId, httpStatus });
    }

    const data = schema.safeParse(envelope.data.data);
    if (!data.success) {
      record('api_error', code, requestId);
      throw fail('malformed_response', {
        requestId,
        httpStatus,
        tiktokMessage: `unexpected response shape: ${data.error.issues.map((i) => i.path.join('.')).join(', ')}`,
      });
    }

    record('ok', code, requestId);
    return data.data;
  }
}
