import { AppError, ValidationError } from '../../errors/app-error.js';
import type { TikTokAdsClient } from '../../integrations/tiktok/client.js';
import { GOAL_MAPPING } from '../../integrations/tiktok/constants.js';
import { TikTokError } from '../../integrations/tiktok/errors.js';
import {
  buildAdGroupPayload,
  buildAdPayload,
  buildCampaignPayload,
  resolveLocationIds,
} from '../../integrations/tiktok/mapper.js';
import { translateTikTokError, type TikTokStep } from '../../integrations/tiktok/translate.js';
import type {
  ObjectLevel,
  ResolvedIdentity,
  TikTokCallContext,
  TikTokCallRecord,
} from '../../integrations/tiktok/types.js';
import { centsToUsd } from '../../lib/money.js';
import { maskSecret } from '../../lib/secrets.js';
import type { Logger } from '../../logger.js';
import type { AuditEvent, AuditLog } from '../audit/audit-log.js';
import { requireTikTokAdsLink } from '../auth/tiktok-ads-link.js';
import type { AuthContext, TikTokAdsLink } from '../auth/types.js';

import type { BoostRepository, PostRepository } from './repository.js';
import type { BoostRequest } from './schema.js';
import type { BoostRecord, OrphanedObject } from './types.js';

export interface BoostServiceDeps {
  readonly tiktok: TikTokAdsClient;
  readonly boosts: BoostRepository;
  readonly posts: PostRepository;
  readonly logger: Logger;
  readonly audit: AuditLog;
  readonly limits: {
    readonly maxSpendPerBoostCents: number;
    readonly maxSpendPerProfileCents: number;
  };
  readonly now: () => Date;
  readonly newBoostId: () => string;
}

export interface BoostCallOptions {
  /** Ayrshare X-Request-Id, for correlating audit events. */
  readonly requestId?: string;
  /** Receives every TikTok call record (in addition to the audit log). */
  readonly onTikTokCall?: (record: TikTokCallRecord) => void;
}

/** What a dry run returns: the resolved plan plus the spend picture, with nothing created. */
export interface BoostPreview {
  readonly plan: BoostPlan;
  readonly maxSpendCents: number;
  readonly committedSpendCents: number;
  readonly limits: BoostServiceDeps['limits'];
}

/** Everything resolved by pre-flight; creation needs nothing else from TikTok. */
export interface BoostPlan {
  readonly advertiserId: string;
  readonly advertiserName: string;
  readonly identity: ResolvedIdentity;
  readonly tiktokItemId: string;
  readonly ayrsharePostId: string | null;
  readonly locationIds: readonly string[];
  readonly sparkAuthEndTime: Date | null;
}

const SUPPORTED_CURRENCY = 'USD';
const usd = (cents: number): string => centsToUsd(cents).toFixed(2);
/** Activation order: the campaign is the top-level switch, so it is enabled last. */
const ENABLE_ORDER: readonly ObjectLevel[] = ['ad', 'adgroup', 'campaign'];
/** Cleanup order: children first. */
const ROLLBACK_ORDER: readonly ObjectLevel[] = ['ad', 'adgroup', 'campaign'];

/** A create failed ambiguously and we could not find out whether TikTok created the object. */
class UncertainCreateError extends Error {
  constructor(
    readonly level: ObjectLevel,
    readonly objectName: string,
    override readonly cause: TikTokError,
  ) {
    super(`Could not determine whether ${level} "${objectName}" was created`);
  }
}

interface CreatedObjects {
  campaign: string | null;
  adgroup: string | null;
  ad: string | null;
  readonly enabled: Set<ObjectLevel>;
  uncertain: UncertainCreateError | null;
}

/** The normalised request as stored on the boost row: JSON-safe, with the Spark code masked. */
function storableRequest(request: BoostRequest): Record<string, unknown> {
  const post =
    request.post.kind === 'spark_auth_code'
      ? { kind: request.post.kind, authCode: maskSecret(request.post.authCode) }
      : request.post;
  return JSON.parse(JSON.stringify({ ...request, post })) as Record<string, unknown>;
}

/**
 * Orchestrates one boost: pre-flight (read-only) → create campaign, ad group and ad, all
 * DISABLED → enable (ad, ad group, campaign) only if requested → persist. Any failure after the
 * first create triggers a compensating rollback; anything that cannot be removed is recorded and
 * reported as orphaned.
 */
export class BoostService {
  constructor(private readonly deps: BoostServiceDeps) {}

  /**
   * Read-only checks that must pass before anything is created. With `dryRun`, the Spark code is
   * inspected but not authorized, so a dry run has no side effects in TikTok.
   */
  async plan(
    auth: AuthContext,
    request: BoostRequest,
    options: BoostCallOptions & { dryRun?: boolean } = {},
  ): Promise<BoostPlan> {
    const link = requireTikTokAdsLink(auth.profile);
    const ctx = this.callContext(link, options.onTikTokCall);
    const { tiktok } = this.deps;

    const advertiser = await this.step('advertiser', () => tiktok.getAdvertiser(ctx));
    if (advertiser.currency !== SUPPORTED_CURRENCY) {
      throw new AppError(
        'TIKTOK_ACCOUNT_NOT_LINKED',
        `The linked TikTok ads account (${advertiser.advertiserId}) is billed in ${advertiser.currency}; boost budgets are in USD. Link a USD TikTok ads account to this profile.`,
      );
    }

    const post = await this.resolvePost(ctx, link, auth, request, options.dryRun ?? false);

    const { targeting } = request;
    const countryIds =
      targeting.countries.length > 0
        ? await this.step('regions', () =>
            tiktok.getCountryLocationIds(ctx, GOAL_MAPPING[request.goal].objectiveType),
          )
        : new Map<string, string>();
    const { locationIds, unknownCountries } = resolveLocationIds(targeting, countryIds);
    if (unknownCountries.length > 0) {
      throw new ValidationError(
        `Invalid fields: locations.countries contains codes TikTok cannot target for this ad account: ${unknownCountries.join(', ')}.`,
      );
    }

    return {
      advertiserId: link.advertiserId,
      advertiserName: advertiser.name,
      locationIds,
      ...post,
    };
  }

  /**
   * Dry run: spend caps + full pre-flight, returning what would be created. Nothing is written to
   * TikTok (Spark codes are inspected, not authorized) and no boost row is created.
   */
  async preview(
    auth: AuthContext,
    request: BoostRequest,
    options: BoostCallOptions = {},
  ): Promise<BoostPreview> {
    const audit = this.auditor(auth, options.requestId, null);
    try {
      const committedSpendCents = this.checkSpendCaps(auth, request);
      const plan = await this.plan(auth, request, {
        dryRun: true,
        onTikTokCall: this.tracer(audit, options.onTikTokCall),
      });
      audit({ type: 'boost.dry_run', data: { maxSpendCents: request.maxSpendCents, plan } });
      return {
        plan,
        maxSpendCents: request.maxSpendCents,
        committedSpendCents,
        limits: this.deps.limits,
      };
    } catch (err) {
      audit({ type: 'boost.rejected', data: { dryRun: true, ...this.errorSummary(err) } });
      throw err;
    }
  }

  async boost(
    auth: AuthContext,
    request: BoostRequest,
    options: BoostCallOptions = {},
  ): Promise<BoostRecord> {
    const boostId = this.deps.newBoostId();
    const audit = this.auditor(auth, options.requestId, boostId);
    const requestIds: string[] = [];
    const trace = this.tracer(audit, options.onTikTokCall);
    const collect = (record: TikTokCallRecord): void => {
      if (record.requestId) requestIds.push(record.requestId);
      trace(record);
    };

    let plan: BoostPlan;
    try {
      this.checkSpendCaps(auth, request);
      plan = await this.plan(auth, request, { onTikTokCall: collect });
    } catch (err) {
      audit({ type: 'boost.rejected', data: this.errorSummary(err) });
      throw err;
    }
    const ctx = this.callContext(requireTikTokAdsLink(auth.profile), collect);
    const name = `${request.adName} - ${boostId}`;
    const log = this.deps.logger.child({ boostId, advertiserId: plan.advertiserId });

    this.createBoostRow(auth, request, plan, boostId, audit);
    audit({
      type: 'boost.started',
      data: { request: storableRequest(request), plan, maxSpendCents: request.maxSpendCents },
    });

    const created: CreatedObjects = {
      campaign: null,
      adgroup: null,
      ad: null,
      enabled: new Set(),
      uncertain: null,
    };
    let step: TikTokStep = 'campaign';

    try {
      created.campaign = await this.createOrReconcile(ctx, 'campaign', name, undefined, () =>
        this.deps.tiktok.createCampaign(
          ctx,
          buildCampaignPayload({
            advertiserId: plan.advertiserId,
            request,
            name,
            requestId: `${boostId}-campaign`,
          }),
        ),
      );
      this.persist(boostId, { campaignId: created.campaign, tiktokRequestIds: requestIds });

      step = 'adgroup';
      const campaignId = created.campaign;
      created.adgroup = await this.createOrReconcile(ctx, 'adgroup', name, campaignId, () =>
        this.deps.tiktok.createAdGroup(
          ctx,
          buildAdGroupPayload({
            advertiserId: plan.advertiserId,
            campaignId,
            request,
            name,
            locationIds: plan.locationIds,
            requestId: `${boostId}-adgroup`,
          }),
        ),
      );
      this.persist(boostId, { adGroupId: created.adgroup, tiktokRequestIds: requestIds });

      step = 'ad';
      const adGroupId = created.adgroup;
      created.ad = await this.createOrReconcile(ctx, 'ad', name, adGroupId, async () => {
        const [adId] = await this.deps.tiktok.createAd(
          ctx,
          buildAdPayload({
            advertiserId: plan.advertiserId,
            adGroupId,
            request,
            name,
            identity: plan.identity,
            itemId: plan.tiktokItemId,
          }),
        );
        if (adId === undefined) throw new Error('TikTok returned no ad ID');
        return adId;
      });
      this.persist(boostId, { adId: created.ad, tiktokRequestIds: requestIds });

      if (request.status === 'active') {
        step = 'activate';
        for (const level of ENABLE_ORDER) {
          const id = created[level];
          if (id === null) throw new Error(`unreachable: ${level} missing before activation`);
          await this.deps.tiktok.updateStatus(ctx, level, [id], 'ENABLE');
          created.enabled.add(level);
        }
      }

      log.info({ status: request.status }, 'boost created');
      const record = this.persist(boostId, {
        status: request.status === 'active' ? 'live' : 'paused',
        tiktokRequestIds: requestIds,
      });
      audit({
        type: 'boost.succeeded',
        data: {
          status: record.status,
          campaignId: record.campaignId,
          adGroupId: record.adGroupId,
          adId: record.adId,
        },
      });
      return record;
    } catch (err) {
      if (err instanceof UncertainCreateError) created.uncertain = err;
      const failure = this.toAppError(err, step);
      log.warn({ err, step }, 'boost failed; rolling back');

      const orphans = await this.rollback(ctx, created, name, log);
      const reported =
        orphans.length > 0
          ? this.cleanupIncomplete(failure, orphans, boostId)
          : this.cleanedUp(failure, created);

      try {
        this.persist(boostId, {
          status: orphans.length > 0 ? 'cleanup_failed' : 'failed',
          orphans,
          tiktokRequestIds: requestIds,
          errorCode: reported?.definition.code ?? 612,
          errorDetails: reported?.details ?? 'Unexpected internal error',
        });
      } catch (persistErr) {
        // Never mask the boost failure; the orphans are still reported to the caller.
        log.error({ err: persistErr, orphans }, 'failed to record boost failure');
      }
      audit({
        type: 'boost.failed',
        data: {
          step,
          orphans,
          created: { ...created, enabled: [...created.enabled], uncertain: undefined },
          ...this.errorSummary(reported ?? err),
        },
      });

      // Programming errors keep their stack and become a generic 500 upstream.
      throw reported ?? err;
    }
  }

  // ---- safety helpers ------------------------------------------------------------

  /**
   * Fast, local spend checks before any TikTok call. Returns the profile's committed spend.
   * The profile cap is re-checked atomically when the boost row is inserted.
   */
  private checkSpendCaps(auth: AuthContext, request: BoostRequest): number {
    const { maxSpendPerBoostCents, maxSpendPerProfileCents } = this.deps.limits;
    const spend = request.maxSpendCents;
    const basis =
      request.budget.type === 'daily'
        ? `${usd(request.budget.amountCents)} USD/day × ${String(request.schedule.days)} days`
        : 'total budget';

    if (spend > maxSpendPerBoostCents) {
      throw new AppError(
        'SPEND_CAP_EXCEEDED',
        `This boost could spend up to ${usd(spend)} USD (${basis}), above the per-boost limit of ${usd(maxSpendPerBoostCents)} USD. Lower the budget or shorten the schedule.`,
      );
    }
    const committed = this.deps.boosts.committedSpendCents(auth.profile.id, this.deps.now());
    if (committed + spend > maxSpendPerProfileCents) {
      throw this.profileCapError(committed, spend);
    }
    return committed;
  }

  private profileCapError(committedCents: number, spendCents: number): AppError {
    return new AppError(
      'SPEND_CAP_EXCEEDED',
      `This profile's running boosts could already spend up to ${usd(committedCents)} USD; this boost adds up to ${usd(spendCents)} USD, above the profile limit of ${usd(this.deps.limits.maxSpendPerProfileCents)} USD. Lower the budget or wait for running boosts to end.`,
    );
  }

  /** Inserts the boost row, re-checking the profile cap in the same transaction. */
  private createBoostRow(
    auth: AuthContext,
    request: BoostRequest,
    plan: BoostPlan,
    boostId: string,
    audit: (event: Omit<AuditEvent, 'requestId' | 'accountId' | 'profileId' | 'boostId'>) => void,
  ): void {
    const result = this.deps.boosts.createWithinProfileCap(
      {
        id: boostId,
        accountId: auth.account.id,
        profileId: auth.profile.id,
        advertiserId: plan.advertiserId,
        requestedStatus: request.status,
        adName: request.adName,
        goal: request.goal,
        postKind: request.post.kind,
        ayrsharePostId: plan.ayrsharePostId,
        tiktokItemId: plan.tiktokItemId,
        identityType: plan.identity.identityType,
        identityId: plan.identity.identityId,
        budgetType: request.budget.type,
        budgetCents: request.budget.amountCents,
        maxSpendCents: request.maxSpendCents,
        startAt: request.schedule.start,
        endAt: request.schedule.end,
        request: storableRequest(request),
        createdAt: this.deps.now(),
      },
      this.deps.limits.maxSpendPerProfileCents,
      this.deps.now(),
    );
    if (!result.created) {
      // Another boost for this profile was committed while our pre-flight ran.
      const error = this.profileCapError(result.committedCents, request.maxSpendCents);
      audit({ type: 'boost.rejected', data: this.errorSummary(error) });
      throw error;
    }
  }

  /** Binds an audit writer to this request's account, profile, request ID and boost. */
  private auditor(auth: AuthContext, requestId: string | undefined, boostId: string | null) {
    return (event: Omit<AuditEvent, 'requestId' | 'accountId' | 'profileId' | 'boostId'>): void => {
      this.deps.audit.record({
        ...event,
        requestId: requestId ?? null,
        accountId: auth.account.id,
        profileId: auth.profile.id,
        boostId,
      });
    };
  }

  /** Every TikTok call goes to the audit log and the caller's optional hook. */
  private tracer(
    audit: ReturnType<BoostService['auditor']>,
    onTikTokCall: ((record: TikTokCallRecord) => void) | undefined,
  ): (record: TikTokCallRecord) => void {
    return (record) => {
      audit({ type: 'tiktok.call', data: { ...record } });
      onTikTokCall?.(record);
    };
  }

  private errorSummary(err: unknown): Record<string, unknown> {
    if (err instanceof AppError) {
      return { code: err.definition.code, details: err.details };
    }
    return { code: 612, details: err instanceof Error ? err.message : String(err) };
  }

  // ---- pre-flight helpers -------------------------------------------------------

  private async resolvePost(
    ctx: TikTokCallContext,
    link: TikTokAdsLink,
    auth: AuthContext,
    request: BoostRequest,
    dryRun: boolean,
  ): Promise<Pick<BoostPlan, 'identity' | 'tiktokItemId' | 'ayrsharePostId' | 'sparkAuthEndTime'>> {
    const { tiktok } = this.deps;
    const { post } = request;

    if (post.kind === 'spark_auth_code') {
      if (!dryRun) {
        await this.step('spark_authorize', () => tiktok.authorizeSparkCode(ctx, post.authCode));
      }
      const info = await this.step('spark_info', () => tiktok.getSparkCodeInfo(ctx, post.authCode));
      if (info.authEndTime && info.authEndTime < request.schedule.end) {
        throw new AppError(
          'SPARK_AUTH_CODE_INVALID',
          `The creator's authorization for this post ends at ${info.authEndTime.toISOString()}, before endDate ${request.schedule.end.toISOString()}. Ask the creator for a longer authorization, or end the ad earlier.`,
        );
      }
      return {
        identity: { identityType: 'AUTH_CODE', identityId: info.identityId, authorizedBcId: null },
        tiktokItemId: info.itemId,
        ayrsharePostId: null,
        sparkAuthEndTime: info.authEndTime,
      };
    }

    let itemId: string;
    let ayrsharePostId: string | null = null;
    if (post.kind === 'ayrshare_post') {
      const videoId = this.deps.posts.findTikTokVideoId(auth.profile.id, post.postId);
      if (videoId === undefined) {
        throw new AppError(
          'POST_NOT_ELIGIBLE',
          `postId "${post.postId}" is not a TikTok post published by this profile. Use the id returned by POST /api/post for a TikTok post, or send tiktokPostId instead.`,
        );
      }
      itemId = videoId;
      ayrsharePostId = post.postId;
    } else {
      itemId = post.tiktokPostId;
    }

    const identities = await this.step('identity', () => tiktok.getIdentities(ctx, 'TT_USER'));
    const identity =
      identities.find((i) => link.username !== null && i.displayName === link.username) ??
      (identities.length === 1 ? identities[0] : undefined);
    if (!identity) {
      throw new AppError(
        'POST_NOT_ELIGIBLE',
        identities.length === 0
          ? `No TikTok account is connected as an identity of ads account ${link.advertiserId}. Connect ${link.username ? `@${link.username}` : 'the TikTok account'} in TikTok Ads Manager, or boost with a creator's Spark authCode.`
          : `Several TikTok accounts are connected to ads account ${link.advertiserId} and none matches this profile's TikTok account. Re-link the profile's TikTok account in Ayrshare.`,
      );
    }
    const resolved: ResolvedIdentity = {
      identityType: identity.identityType,
      identityId: identity.identityId,
      authorizedBcId: identity.authorizedBcId,
    };

    await this.step('video', () => tiktok.getIdentityVideo(ctx, resolved, itemId));
    return { identity: resolved, tiktokItemId: itemId, ayrsharePostId, sparkAuthEndTime: null };
  }

  /** Runs a TikTok read and translates failures for this step. */
  private async step<T>(step: TikTokStep, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw err instanceof TikTokError ? translateTikTokError(err, step) : err;
    }
  }

  // ---- creation helpers ---------------------------------------------------------

  /**
   * Creates an object. If the create failed ambiguously (TikTok may have processed it), looks it
   * up by its unique name instead of retrying: found → use it; absent → the create really failed.
   */
  private async createOrReconcile(
    ctx: TikTokCallContext,
    level: ObjectLevel,
    name: string,
    parentId: string | undefined,
    create: () => Promise<string>,
  ): Promise<string> {
    try {
      return await create();
    } catch (err) {
      if (!(err instanceof TikTokError) || !err.ambiguous) throw err;

      let existingId: string | null;
      try {
        existingId = await this.deps.tiktok.findIdByName(ctx, level, name, parentId);
      } catch {
        throw new UncertainCreateError(level, name, err);
      }
      if (existingId === null) throw err;
      this.deps.logger.info({ level, id: existingId }, 'recovered object after ambiguous create');
      return existingId;
    }
  }

  /**
   * Deletes created objects children-first. If a delete fails, falls back to disabling so the
   * object cannot spend; anything not deleted is returned as an orphan.
   */
  private async rollback(
    ctx: TikTokCallContext,
    created: CreatedObjects,
    name: string,
    log: Logger,
  ): Promise<OrphanedObject[]> {
    const orphans: OrphanedObject[] = [];

    for (const level of ROLLBACK_ORDER) {
      const id = created[level];
      if (id === null) continue;
      try {
        await this.deps.tiktok.updateStatus(ctx, level, [id], 'DELETE');
        continue;
      } catch (err) {
        log.error({ err, level, id }, 'rollback delete failed; trying to disable');
      }
      try {
        await this.deps.tiktok.updateStatus(ctx, level, [id], 'DISABLE');
        orphans.push({ level, id, name, state: 'disabled' });
      } catch (err) {
        log.error({ err, level, id }, 'rollback disable failed');
        orphans.push({
          level,
          id,
          name,
          state: created.enabled.has(level) ? 'enabled' : 'disabled',
        });
      }
    }

    if (created.uncertain) {
      // Everything is created DISABLED, so even if it exists it cannot spend.
      orphans.push({ level: created.uncertain.level, id: null, name, state: 'disabled' });
    }
    return orphans;
  }

  private toAppError(err: unknown, step: TikTokStep): AppError | null {
    if (err instanceof AppError) return err;
    if (err instanceof UncertainCreateError) return translateTikTokError(err.cause, step);
    if (err instanceof TikTokError) return translateTikTokError(err, step);
    return null;
  }

  private cleanedUp(failure: AppError | null, created: CreatedObjects): AppError | null {
    if (!failure) return null;
    const anything = created.campaign !== null;
    const note = anything
      ? ' Everything created for this boost was deleted from your TikTok ad account; no money was spent.'
      : ' Nothing was created in your TikTok ad account; no money was spent.';
    return new AppError(failure.key, `${failure.details}${note}`, {
      cause: failure.cause ?? failure,
    });
  }

  private cleanupIncomplete(
    failure: AppError | null,
    orphans: readonly OrphanedObject[],
    boostId: string,
  ): AppError {
    const list = orphans
      .map((o) =>
        o.id === null
          ? `${o.level} "${o.name}" may exist (created disabled)`
          : `${o.level} ${o.id} (${o.state})`,
      )
      .join(', ');
    const original = failure
      ? `Boost failed (code ${failure.definition.code}): ${failure.details}`
      : 'Boost failed because of an internal error.';
    const canSpend = orphans.some((o) => o.state === 'enabled');
    return new AppError(
      'BOOST_CLEANUP_INCOMPLETE',
      `${original} Cleanup could not remove: ${list}. ${
        canSpend
          ? 'At least one object may still be enabled — pause it in TikTok Ads Manager now.'
          : 'They are disabled, so they cannot spend.'
      } Delete them in TikTok Ads Manager (search for "${boostId}"), or contact support with boost ID ${boostId}.`,
      { cause: failure ?? undefined },
    );
  }

  private persist(id: string, patch: Parameters<BoostRepository['update']>[1]): BoostRecord {
    return this.deps.boosts.update(id, patch, this.deps.now());
  }

  private callContext(
    link: TikTokAdsLink,
    onCall?: (record: TikTokCallRecord) => void,
  ): TikTokCallContext {
    return {
      advertiserId: link.advertiserId,
      accessToken: link.accessToken,
      ...(onCall && { onCall }),
    };
  }
}
