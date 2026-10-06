import type { AppDeps } from './app.js';
import type { Config } from './config/env.js';
import type { Db } from './db/database.js';
import type { TikTokAdsClient } from './integrations/tiktok/client.js';
import { createTikTokClient } from './integrations/tiktok/factory.js';
import { newBoostId } from './lib/ids.js';
import type { Logger } from './logger.js';
import { SqliteAuditLog } from './modules/audit/audit-log.js';
import { SqliteAuthRepository } from './modules/auth/auth-repository.js';
import { SqliteIdempotencyRepository } from './modules/idempotency/repository.js';
import { SqliteBoostRepository, SqlitePostRepository } from './modules/tiktok-boost/repository.js';
import { BoostService } from './modules/tiktok-boost/service.js';

export interface CompositionOverrides {
  readonly tiktok?: TikTokAdsClient;
  readonly now?: () => Date;
  readonly newBoostId?: () => string;
}

/**
 * The single composition root: wires repositories, the TikTok client and the boost service.
 * server.ts and the tests both use it, so tests exercise the same graph as production.
 */
export function buildAppDeps(
  config: Config,
  db: Db,
  logger: Logger,
  overrides: CompositionOverrides = {},
): AppDeps {
  const now = overrides.now ?? (() => new Date());
  const tiktok = overrides.tiktok ?? createTikTokClient(config, logger);
  const boosts = new SqliteBoostRepository(db);
  const audit = new SqliteAuditLog(db, now, (err) => {
    logger.error({ err }, 'audit write failed');
  });

  const boostService = new BoostService({
    tiktok,
    boosts,
    posts: new SqlitePostRepository(db),
    audit,
    limits: {
      maxSpendPerBoostCents: config.limits.maxSpendPerBoostCents,
      maxSpendPerProfileCents: config.limits.maxSpendPerProfileCents,
    },
    logger,
    now,
    newBoostId: overrides.newBoostId ?? newBoostId,
  });

  return {
    config,
    logger,
    authRepository: new SqliteAuthRepository(db),
    tiktokBoost: {
      service: boostService,
      boosts,
      idempotencyRepo: new SqliteIdempotencyRepository(db),
      audit,
      maxCampaignDays: config.limits.maxCampaignDays,
      now,
    },
  };
}
