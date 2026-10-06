import { createHash } from 'node:crypto';

import type { RequestHandler, Response } from 'express';

import { AppError, ValidationError } from '../errors/app-error.js';
import type { AuditLog } from '../modules/audit/audit-log.js';
import type { IdempotencyRepository } from '../modules/idempotency/repository.js';

import { getAuth } from './authenticate.js';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const REPLAYED_HEADER = 'Idempotent-Replayed';

const VALID_KEY = /^[\x21-\x7E]{1,255}$/;
const MINUTE_MS = 60 * 1000;

export interface IdempotencyOptions {
  readonly repo: IdempotencyRepository;
  readonly now: () => Date;
  readonly audit?: AuditLog;
  /** How long an in-progress claim blocks retries before it's presumed dead (process crash). */
  readonly lockTtlMs?: number;
  /** How long a completed response is replayed. */
  readonly retentionMs?: number;
}

/** Stable JSON: object keys sorted recursively, so key order doesn't change the fingerprint. */
function canonicalJson(value: unknown): string {
  // JSON.stringify(undefined) returns undefined at runtime (e.g. a request with no body).
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Outcomes the client is told to retry with the same key (rate limits, TikTok unavailable,
 * in-progress conflicts, server errors) are not stored, so the retry actually re-executes.
 * Everything else — success and permanent 4xx — is replayed verbatim.
 */
function isReplayable(status: number): boolean {
  return status < 500 && status !== 409 && status !== 429;
}

/**
 * Stripe-style idempotency for unsafe requests. Mount after `authenticate`. Keys are scoped to
 * the account; the fingerprint covers profile, method, path and body, so a key can't be reused
 * for a different request.
 */
export function idempotency(options: IdempotencyOptions): RequestHandler {
  const lockTtlMs = options.lockTtlMs ?? 10 * MINUTE_MS;
  const retentionMs = options.retentionMs ?? 24 * 60 * MINUTE_MS;
  const { repo, now } = options;

  return (req, res, next) => {
    const key = req.get(IDEMPOTENCY_KEY_HEADER);
    if (key === undefined) {
      next();
      return;
    }
    if (!VALID_KEY.test(key)) {
      throw new ValidationError(
        `Invalid fields: ${IDEMPOTENCY_KEY_HEADER} header must be 1-255 visible ASCII characters without spaces (a UUID is recommended).`,
      );
    }

    const { account, profile } = getAuth(req);
    const fingerprint = createHash('sha256')
      .update(canonicalJson([profile.id, req.method, `${req.baseUrl}${req.path}`, req.body]))
      .digest('hex');

    const existing = repo.find(account.id, key);
    if (existing) {
      const age = now().getTime() - existing.createdAt.getTime();
      const expired = existing.status === 'completed' ? age > retentionMs : age > lockTtlMs;

      if (expired) {
        repo.release(account.id, key);
      } else if (existing.fingerprint !== fingerprint) {
        throw new AppError(
          'IDEMPOTENCY_KEY_REUSED',
          `${IDEMPOTENCY_KEY_HEADER} "${key}" was first used at ${existing.createdAt.toISOString()} for a different request (different profile, endpoint or body). Use a new key for a new boost; reuse a key only to retry the exact same request.`,
        );
      } else if (existing.status === 'in_progress') {
        throw new AppError(
          'IDEMPOTENCY_IN_PROGRESS',
          `The request with ${IDEMPOTENCY_KEY_HEADER} "${key}" (started ${existing.createdAt.toISOString()}) is still being processed. Wait a few seconds, then retry with the same key to get its result.`,
        );
      } else {
        options.audit?.record({
          type: 'idempotency.replayed',
          requestId: req.id,
          accountId: account.id,
          profileId: profile.id,
          data: { key, originalStatus: existing.responseStatus },
        });
        res.setHeader(REPLAYED_HEADER, 'true');
        res.status(existing.responseStatus ?? 200).json(existing.responseBody);
        return;
      }
    }

    if (!repo.tryBegin(account.id, key, fingerprint, now())) {
      throw new AppError(
        'IDEMPOTENCY_IN_PROGRESS',
        `A request with ${IDEMPOTENCY_KEY_HEADER} "${key}" is already being processed. Retry shortly with the same key.`,
      );
    }

    let settled = false;
    const settle = (status: number, body: unknown): void => {
      if (settled) return;
      settled = true;
      if (isReplayable(status)) repo.complete(account.id, key, status, body, now());
      else repo.release(account.id, key);
    };

    // Store the response before it is sent, so a crash after sending can't lose it.
    // Deliberately no release on 'close': a client that disconnects (e.g. its own timeout) while
    // the boost is still running must not free the key, or its retry would start a second boost.
    // The handler still calls res.json afterwards, which stores the result; a process crash
    // leaves the claim to expire after lockTtlMs.
    const originalJson = res.json.bind(res) as (body: unknown) => Response;
    res.json = ((body: unknown) => {
      settle(res.statusCode, body);
      return originalJson(body);
    }) as typeof res.json;

    next();
  };
}
