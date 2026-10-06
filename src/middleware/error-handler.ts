import type { ErrorRequestHandler, RequestHandler } from 'express';

import { AppError, NotFoundError, ValidationError } from '../errors/app-error.js';
import { ERROR_CODES } from '../errors/codes.js';

/** Shape of the errors thrown by express.json() (body-parser). */
interface BodyParserError {
  type: string;
  message: string;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    typeof err.type === 'string' &&
    'message' in err
  );
}

/** Body-parser failures happen before any handler runs; translate them into code 101. */
function fromBodyParser(err: BodyParserError): AppError | undefined {
  switch (err.type) {
    case 'entity.parse.failed':
      return new ValidationError(
        `Request body is not valid JSON (${err.message}). Send a JSON object with Content-Type: application/json.`,
      );
    case 'entity.too.large':
      return new ValidationError('Request body is too large. The limit is 100kb.');
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new ValidationError('Unsupported request body encoding. Send UTF-8 encoded JSON.');
    default:
      return undefined;
  }
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`No endpoint matches ${req.method} ${req.path}.`));
};

/**
 * Formats every error as Ayrshare's envelope. Known AppErrors pass through; anything else is
 * logged with its stack and returned as a generic 500 that leaks nothing internal.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const appError =
    err instanceof AppError ? err : isBodyParserError(err) ? fromBodyParser(err) : undefined;

  if (appError) {
    req.log.warn(
      { code: appError.definition.code, details: appError.details, cause: appError.cause },
      'request failed',
    );
    res.status(appError.httpStatus).json(appError.toEnvelope());
    return;
  }

  req.log.error({ err }, 'unhandled error');
  const internal = ERROR_CODES.INTERNAL_ERROR;
  res.status(internal.httpStatus).json({
    action: internal.action,
    status: 'error',
    code: internal.code,
    message: internal.message,
    details: `Internal error. If it persists, contact support with request ID ${req.id}.`,
  });
};
