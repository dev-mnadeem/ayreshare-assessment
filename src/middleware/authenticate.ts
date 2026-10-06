import type { Request, RequestHandler } from 'express';

import { AppError, AuthenticationError } from '../errors/app-error.js';
import type { AuthRepository } from '../modules/auth/auth-repository.js';
import type { AuthContext, Profile } from '../modules/auth/types.js';

export const PROFILE_KEY_HEADER = 'Profile-Key';

const BEARER = /^Bearer\s+(\S+)\s*$/i;

function extractApiKey(req: Request): string {
  const header = req.get('Authorization');
  if (!header) {
    throw new AuthenticationError(
      'Missing Authorization header. Send "Authorization: Bearer <API_KEY>" using the API Key from the Ayrshare dashboard.',
    );
  }
  const match = BEARER.exec(header);
  if (!match?.[1]) {
    throw new AuthenticationError(
      'Malformed Authorization header. Use the Bearer scheme: "Authorization: Bearer <API_KEY>".',
    );
  }
  return match[1];
}

/**
 * Ayrshare authentication: the account's API Key in `Authorization: Bearer`, plus an optional
 * `Profile-Key` selecting one of that account's User Profiles (the primary profile otherwise).
 */
export function authenticate(repo: AuthRepository): RequestHandler {
  return (req, _res, next) => {
    const account = repo.findAccountByApiKey(extractApiKey(req));
    if (!account) {
      throw new AuthenticationError(
        'API Key not found. Check that you copied the full key from the Ayrshare dashboard.',
      );
    }
    if (account.status === 'suspended') {
      throw new AppError('ACCESS_SUSPENDED', 'This Ayrshare account is suspended.');
    }

    const profileKey = req.get(PROFILE_KEY_HEADER)?.trim();
    let profile: Profile | undefined;
    if (profileKey) {
      profile = repo.findProfileByKey(account.id, profileKey);
      if (!profile) {
        // Same answer whether the key is unknown or belongs to another account: no enumeration.
        throw new AppError(
          'PROFILE_KEY_INVALID',
          'No User Profile with this Profile-Key exists under your API Key. Omit the Profile-Key header to use your primary profile.',
        );
      }
    } else {
      profile = repo.findPrimaryProfile(account.id);
      if (!profile) {
        throw new Error(`Account ${account.id} has no primary profile`);
      }
    }
    if (profile.status === 'suspended') {
      throw new AppError('ACCESS_SUSPENDED', `User Profile "${profile.title}" is suspended.`);
    }

    req.auth = { account, profile } satisfies AuthContext;
    next();
  };
}

/** For handlers mounted behind `authenticate`; fails loudly if that wiring is missing. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) {
    throw new Error('getAuth() called on a route without the authenticate middleware');
  }
  return req.auth;
}
