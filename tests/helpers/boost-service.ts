import { DEMO } from '../../src/demo/fixtures.js';
import { AppError, type ErrorEnvelope } from '../../src/errors/app-error.js';
import { MockTikTokClient } from '../../src/integrations/tiktok/mock-client.js';
import { createLogger } from '../../src/logger.js';
import { SqliteAuditLog } from '../../src/modules/audit/audit-log.js';
import { SqliteAuthRepository } from '../../src/modules/auth/auth-repository.js';
import type { AuthContext } from '../../src/modules/auth/types.js';
import {
  SqliteBoostRepository,
  SqlitePostRepository,
} from '../../src/modules/tiktok-boost/repository.js';
import { BoostService } from '../../src/modules/tiktok-boost/service.js';

import { TEST_NOW } from './boost-request.js';
import { createTestDb } from './test-app.js';

export const GENEROUS_LIMITS = {
  maxSpendPerBoostCents: 1_000_000,
  maxSpendPerProfileCents: 5_000_000,
};

export function setupBoostService(limits = GENEROUS_LIMITS) {
  const db = createTestDb();
  const tiktok = new MockTikTokClient();
  const boosts = new SqliteBoostRepository(db);
  const authRepo = new SqliteAuthRepository(db);
  const audit = new SqliteAuditLog(db, () => TEST_NOW);
  let seq = 0;
  const service = new BoostService({
    tiktok,
    boosts,
    posts: new SqlitePostRepository(db),
    audit,
    limits,
    logger: createLogger({ logLevel: 'silent', env: 'test' }),
    now: () => TEST_NOW,
    newBoostId: () => `bst_test${String(++seq)}`,
  });

  const auth = (profileKey?: string): AuthContext => {
    const account = authRepo.findAccountByApiKey(DEMO.apiKey);
    const profile = profileKey
      ? authRepo.findProfileByKey('acc_demo', profileKey)
      : authRepo.findPrimaryProfile('acc_demo');
    if (!account || !profile) throw new Error('fixture missing');
    return { account, profile };
  };

  const statuses = () =>
    Object.fromEntries(tiktok.listObjects().map((o) => [o.level, o.status])) as Record<
      string,
      string
    >;

  return { service, tiktok, boosts, audit, db, auth, statuses };
}

/** Awaits a promise expected to reject with an AppError and returns its envelope. */
export async function appError(promise: Promise<unknown>): Promise<ErrorEnvelope> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err.toEnvelope();
    throw err;
  }
  throw new Error('expected an AppError');
}
