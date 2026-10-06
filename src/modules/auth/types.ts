export type EntityStatus = 'active' | 'suspended';

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly status: EntityStatus;
}

/** The TikTok ads account a profile has linked; required for any TikTok ads call. */
export interface TikTokAdsLink {
  readonly advertiserId: string;
  readonly accessToken: string;
  readonly username: string | null;
}

export interface Profile {
  readonly id: string;
  readonly accountId: string;
  readonly title: string;
  readonly isPrimary: boolean;
  readonly status: EntityStatus;
  readonly tiktokAds: TikTokAdsLink | null;
}

/** Who is making the request; attached to req.auth by the authenticate middleware. */
export interface AuthContext {
  readonly account: Account;
  readonly profile: Profile;
}
