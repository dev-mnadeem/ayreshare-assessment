import type { Logger } from 'pino';

declare global {
  namespace Express {
    interface Request {
      /** Set by requestId middleware; echoed in the X-Request-Id response header. */
      id: string;
      /** Request-scoped child logger carrying `requestId`. */
      log: Logger;
    }
  }
}

export {};
