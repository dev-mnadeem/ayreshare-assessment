import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

import type { Logger } from '../logger.js';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// Inbound IDs end up in logs and response headers, so only accept a conservative charset.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Assigns a request ID (honouring a well-formed inbound X-Request-Id), attaches a child
 * logger, and logs one line per completed request.
 */
export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const inbound = req.get(REQUEST_ID_HEADER);
    req.id = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
    req.log = logger.child({ requestId: req.id });
    res.setHeader(REQUEST_ID_HEADER, req.id);

    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      req.log.info(
        {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Math.round(durationMs),
        },
        'request completed',
      );
    });

    next();
  };
}
