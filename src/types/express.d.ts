import type { Logger } from 'pino';

import type { AuthContext } from '../modules/auth/types.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by requestId middleware; echoed in the X-Request-Id response header. */
      id: string;
      /** Request-scoped child logger carrying `requestId`. */
      log: Logger;
      /** Set by the authenticate middleware; read it with getAuth(req). */
      auth?: AuthContext;
    }
  }
}

export {};
