import { ERROR_CODES, type ErrorDefinition, type ErrorKey } from './codes.js';

/** Ayrshare's error response body. */
export interface ErrorEnvelope {
  action: ErrorDefinition['action'];
  status: 'error';
  code: number;
  message: string;
  details: string;
}

/**
 * Base for every error we intentionally return to the caller. `details` is the
 * developer-facing explanation of what to change; it must be safe to show (no secrets).
 */
export class AppError extends Error {
  readonly definition: ErrorDefinition;

  constructor(
    readonly key: ErrorKey,
    readonly details: string,
    options?: { cause?: unknown },
  ) {
    super(`${key}: ${details}`, options);
    this.name = new.target.name;
    this.definition = ERROR_CODES[key];
  }

  get httpStatus(): number {
    return this.definition.httpStatus;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      action: this.definition.action,
      status: 'error',
      code: this.definition.code,
      message: this.definition.message,
      details: this.details,
    };
  }
}

/** Code 101 — anything wrong with the request that we detect before calling TikTok. */
export class ValidationError extends AppError {
  constructor(details: string) {
    super('INVALID_PARAMETERS', details);
  }
}

/** Code 102 — missing or unknown API key. */
export class AuthenticationError extends AppError {
  constructor(details: string) {
    super('INVALID_API_KEY', details);
  }
}

export class NotFoundError extends AppError {
  constructor(details: string) {
    super('ENDPOINT_NOT_FOUND', details);
  }
}
