import { Router } from 'express';

import { AppError, ValidationError } from '../../errors/app-error.js';
import { getAuth } from '../../middleware/authenticate.js';
import { idempotency } from '../../middleware/idempotency.js';
import type { AuditLog } from '../audit/audit-log.js';
import type { IdempotencyRepository } from '../idempotency/repository.js';

import { toBoostResponse, toDryRunResponse } from './presenter.js';
import type { BoostRepository } from './repository.js';
import { validateBoostRequest } from './schema.js';
import type { BoostService } from './service.js';

export interface TikTokBoostRouterDeps {
  readonly service: BoostService;
  readonly boosts: BoostRepository;
  readonly idempotencyRepo: IdempotencyRepository;
  readonly audit: AuditLog;
  readonly maxCampaignDays: number;
  readonly now: () => Date;
}

/**
 * Mounted at /api/ads/tiktok behind `authenticate`. Handlers only translate HTTP ↔ service;
 * all rules live in schema.ts and service.ts.
 */
export function tiktokBoostRouter(deps: TikTokBoostRouterDeps): Router {
  const router = Router();

  router.post(
    '/boost',
    idempotency({ repo: deps.idempotencyRepo, now: deps.now, audit: deps.audit }),
    async (req, res) => {
      const auth = getAuth(req);

      let request;
      try {
        request = validateBoostRequest(req.body, {
          now: deps.now(),
          maxCampaignDays: deps.maxCampaignDays,
        });
      } catch (err) {
        if (err instanceof ValidationError) {
          deps.audit.record({
            type: 'boost.rejected',
            requestId: req.id,
            accountId: auth.account.id,
            profileId: auth.profile.id,
            data: { code: err.definition.code, details: err.details },
          });
        }
        throw err;
      }

      if (request.dryRun) {
        const preview = await deps.service.preview(auth, request, { requestId: req.id });
        res.json(toDryRunResponse(request, preview));
        return;
      }

      const record = await deps.service.boost(auth, request, { requestId: req.id });
      res.json(toBoostResponse(record));
    },
  );

  router.get('/boost/:id', (req, res) => {
    const { profile } = getAuth(req);
    const record = deps.boosts.findById(req.params.id);
    // Same answer for "doesn't exist" and "belongs to another profile": no enumeration.
    if (record?.profileId !== profile.id) {
      throw new AppError(
        'BOOST_NOT_FOUND',
        `No TikTok boost with id "${req.params.id}" exists for this User Profile. Use the id returned by POST /api/ads/tiktok/boost, with the same Profile-Key.`,
      );
    }
    res.json(toBoostResponse(record));
  });

  return router;
}
