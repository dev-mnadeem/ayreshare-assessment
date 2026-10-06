# Boost a TikTok Post

`POST /api/ads/tiktok/boost` turns an existing TikTok post into a running TikTok **Spark Ad**: the ad uses the original post, so likes, comments, shares and follows count towards the organic post and its account. It is the TikTok counterpart of [`POST /api/ads/facebook/boost`](https://www.ayrshare.com/docs/apis/ads/facebook/boost-post) and follows the same conventions.

> **Boosting spends money.** Each call creates a campaign, an ad group and an ad in the TikTok ad account linked to the User Profile, and starts delivery once TikTok approves the ad. Use [`dryRun`](#dry-run) to check a request first, and send an [`Idempotency-Key`](#retries-and-idempotency) so retries can never create a second ad.

- [Before you start](#before-you-start)
- [Request](#request)
- [Examples](#examples)
- [Response](#response)
- [Dry run](#dry-run)
- [Look up a boost](#look-up-a-boost)
- [Retries and idempotency](#retries-and-idempotency)
- [Spend limits](#spend-limits)
- [Errors](#errors)
- [What happens during a boost](#what-happens-during-a-boost)
- [Environments and testing](#environments-and-testing)
- [Verification before launch](#verification-before-launch)

## Before you start

- **Linked TikTok ads account.** The User Profile must have a TikTok Ads Manager account (advertiser) linked in the Ayrshare dashboard, billed in **USD**, with a payment method set up in TikTok.
- **To boost your own post** (`postId` or `tiktokPostId`): the TikTok account that published the post must be connected to that ads account as an identity. The post must be public.
- **To boost a creator's post** (`authCode`): the creator generates a Spark authorization code in the TikTok app (post → **⋯** → **Ad settings** → turn on ad authorization → **Generate code**) and chooses how long it is valid (7, 30, 60 or 365 days). The ad must end before the authorization does.
- **TikTok reviews every ad** before delivery. A boost returns as soon as the ad exists; it starts spending once TikTok approves it.

## Request

```
POST https://api.ayrshare.com/api/ads/tiktok/boost
```

### Headers

| Header            | Required    | Description                                                                                                   |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `Authorization`   | Yes         | `Bearer API_KEY` — your Primary Profile API Key.                                                              |
| `Profile-Key`     | No          | Selects a User Profile. Omit to use the primary profile.                                                      |
| `Content-Type`    | Yes         | `application/json`                                                                                            |
| `Idempotency-Key` | Recommended | Any unique string up to 255 visible ASCII characters (a UUID works). See [Retries](#retries-and-idempotency). |

### Choosing the post

Send **exactly one** of these:

| Field          | Use it when                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `postId`       | The post was published through Ayrshare. Use the `id` returned by `POST /api/post`.                             |
| `tiktokPostId` | The post is on the profile's own TikTok account but wasn't published through Ayrshare. Send it as a **string**. |
| `authCode`     | You are boosting a creator's post with their Spark authorization code.                                          |

TikTok post IDs are 19 digits, larger than JSON numbers can carry exactly. Always send `tiktokPostId`, `locationIds` and `interests` values as strings.

### Body parameters

| Field                                  | Type     | Required | Default                | Description                                                                                                                                                                                                                   |
| -------------------------------------- | -------- | -------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adName`                               | string   | Yes      | —                      | 1–100 characters. TikTok objects are named `"{adName} - {id}"` so you can find them in TikTok Ads Manager.                                                                                                                    |
| `budget`                               | number   | Yes      | —                      | USD, at most 2 decimals. Daily: at least **20.00**. Total: at least **20.00 × days**.                                                                                                                                         |
| `budgetType`                           | string   | No       | `daily`                | `daily` or `total` (lifetime budget for the whole schedule).                                                                                                                                                                  |
| `endDate`                              | string   | **Yes**  | —                      | ISO 8601 with a timezone, e.g. `2026-11-01T09:00:00Z`. Required so the maximum spend is always known. At least 24 hours after the start, at most 90 days.                                                                     |
| `startDate`                            | string   | No       | now                    | ISO 8601 with a timezone. Not in the past (5 minutes of clock skew allowed).                                                                                                                                                  |
| `goal`                                 | string   | No       | `engagement`           | `engagement` (followers, likes, comments), `video_views` (6-second focused views), `reach` (as many people as possible), `traffic` (website visits; requires `callToAction`).                                                 |
| `status`                               | string   | No       | `active`               | `active` starts delivery after TikTok's review. `paused` creates everything switched off; enable it in TikTok Ads Manager.                                                                                                    |
| `bidAmount`                            | number   | No       | lowest cost            | USD, at most 2 decimals, lower than `budget`. Omit to let TikTok bid for the lowest cost.                                                                                                                                     |
| `minAge`                               | number   | No       | `18`                   | One of `18`, `25`, `35`, `45`, `55`. TikTok targets age ranges 18–24, 25–34, 35–44, 45–54 and 55+.                                                                                                                            |
| `maxAge`                               | number   | No       | `65`                   | One of `24`, `34`, `44`, `54`, `65` (`65` means 55+). Must be greater than `minAge`.                                                                                                                                          |
| `gender`                               | string   | No       | `all`                  | `all`, `male`, `female`.                                                                                                                                                                                                      |
| `locations`                            | object   | No       | `{"countries":["US"]}` | `countries`: ISO 3166-1 alpha-2 codes (e.g. `"US"`). `locationIds`: TikTok location IDs (as strings) for regions or cities. At least one entry overall; up to 100 each.                                                       |
| `interests`                            | string[] | No       | —                      | TikTok interest category IDs, up to 100.                                                                                                                                                                                      |
| `callToAction`                         | object   | traffic  | —                      | Required with `goal: "traffic"`, rejected otherwise. `type`: `LEARN_MORE`, `SHOP_NOW`, `SIGN_UP`, `CONTACT_US`, `DOWNLOAD`, `APPLY_NOW`, `BOOK_NOW`, `ORDER_NOW`, `SUBSCRIBE`, `WATCH_NOW`. `link`: the http(s) landing page. |
| `dryRun`                               | boolean  | No       | `false`                | Validate and check everything, create nothing. See [Dry run](#dry-run).                                                                                                                                                       |
| `postId` / `tiktokPostId` / `authCode` | string   | One of   | —                      | See [Choosing the post](#choosing-the-post).                                                                                                                                                                                  |

Option values are not case-sensitive. Unknown fields are rejected, so a typo such as `budgt` is reported instead of silently ignored.

## Examples

### Boost your own post

```bash
curl -X POST https://api.ayrshare.com/api/ads/tiktok/boost \
  -H "Authorization: Bearer API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 0b8f3c1e-7f0a-4c55-9d1b-2f6e8a4b9c10" \
  -d '{
    "tiktokPostId": "7300000000000000001",
    "adName": "Fall launch",
    "goal": "video_views",
    "budget": 25,
    "startDate": "2026-10-07T09:00:00Z",
    "endDate": "2026-10-14T09:00:00Z",
    "minAge": 25,
    "maxAge": 44,
    "locations": { "countries": ["US", "CA"] }
  }'
```

### Boost a post published through Ayrshare, for a User Profile

```bash
curl -X POST https://api.ayrshare.com/api/ads/tiktok/boost \
  -H "Authorization: Bearer API_KEY" \
  -H "Profile-Key: PROFILE_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "postId": "RxN3pW8kLq2", "adName": "Spring promo", "budget": 30, "endDate": "2026-11-01T00:00:00Z" }'
```

### Boost a creator's post with a Spark code, sending traffic to a website

```bash
curl -X POST https://api.ayrshare.com/api/ads/tiktok/boost \
  -H "Authorization: Bearer API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "authCode": "#ExampleSparkCode",
    "adName": "Creator collab",
    "goal": "traffic",
    "callToAction": { "type": "SHOP_NOW", "link": "https://shop.example.com/fall" },
    "budgetType": "total",
    "budget": 300,
    "endDate": "2026-10-20T00:00:00Z"
  }'
```

## Response

**HTTP 200** — the campaign, ad group and ad exist and, for `status: "active"`, are switched on.

```json
{
  "status": "success",
  "id": "bst_9f86d081884c7d659a2f",
  "boostStatus": "live",
  "adId": "1830000000000000003",
  "adGroupId": "1820000000000000002",
  "campaignId": "1810000000000000001",
  "adName": "Fall launch - bst_9f86d081884c7d659a2f",
  "advertiserId": "7100000000000000001",
  "adStatus": "active",
  "goal": {
    "type": "video_views",
    "title": "Get More Video Views",
    "description": "Show the post to people likely to watch it for at least 6 seconds."
  },
  "budget": 25,
  "budgetType": "daily",
  "bidAmount": null,
  "maxSpend": 175,
  "startDate": "2026-10-07T09:00:00.000Z",
  "endDate": "2026-10-14T09:00:00.000Z",
  "minAge": 25,
  "maxAge": 44,
  "gender": "all",
  "locations": { "countries": ["US", "CA"], "locationIds": [] },
  "interests": [],
  "callToAction": null,
  "postId": null,
  "tiktokPostId": "7300000000000000001",
  "authorizationType": "linked_account",
  "createdAt": "2026-10-06T12:00:00.000Z"
}
```

| Field                             | Description                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `id`                              | Ayrshare boost ID. Use it with [`GET /api/ads/tiktok/boost/{id}`](#look-up-a-boost) and when contacting support. |
| `boostStatus`                     | `live`, `paused`, or — when looked up later — `failed` / `cleanup_failed`.                                       |
| `adId`, `adGroupId`, `campaignId` | TikTok IDs of the created objects.                                                                               |
| `adName`                          | The name of all three objects in TikTok Ads Manager.                                                             |
| `adStatus`                        | `active` or `paused` as requested; `null` for failed boosts.                                                     |
| `maxSpend`                        | Most the boost can spend in USD: daily budget × days (partial days count as whole days), or the total budget.    |
| `authorizationType`               | `linked_account` (your own post) or `spark_code` (creator's post). Spark codes are never returned.               |
| Other fields                      | The settings the boost was created with, after defaults were applied.                                            |

## Dry run

Add `"dryRun": true` to run every check a real boost would — validation, [spend limits](#spend-limits), the linked ads account, ownership of the post (or the Spark code), and location lookup — without creating anything in TikTok. Spark codes are inspected but not authorized. The response shows exactly what would be created:

```json
{
  "status": "success",
  "dryRun": true,
  "adName": "Fall launch",
  "advertiserId": "7100000000000000001",
  "adStatus": "active",
  "goal": {
    "type": "video_views",
    "title": "Get More Video Views",
    "description": "Show the post to people likely to watch it for at least 6 seconds."
  },
  "budget": 25,
  "budgetType": "daily",
  "bidAmount": null,
  "maxSpend": 175,
  "startDate": "2026-10-07T09:00:00.000Z",
  "endDate": "2026-10-14T09:00:00.000Z",
  "minAge": 25,
  "maxAge": 44,
  "gender": "all",
  "locations": {
    "countries": ["US", "CA"],
    "locationIds": []
  },
  "interests": [],
  "callToAction": null,
  "postId": null,
  "tiktokPostId": "7300000000000000001",
  "authorizationType": "linked_account",
  "targetLocationIds": ["6252001", "6251999"],
  "committedSpend": 0,
  "limits": {
    "maxSpendPerBoost": 5000,
    "maxSpendPerProfile": 20000
  },
  "sparkAuthorizationEndsAt": null
}
```

`committedSpend` is the combined `maxSpend` of the profile's boosts that are still running; `limits` are the caps the request was checked against.

## Look up a boost

```bash
curl https://api.ayrshare.com/api/ads/tiktok/boost/bst_9f86d081884c7d659a2f \
  -H "Authorization: Bearer API_KEY"
```

Returns the same shape as the boost response. Send the same `Profile-Key` that created the boost; boosts of other profiles return **615**. A failed boost also includes `error` (`code`, `details`) and, if cleanup left anything behind, `orphans` (each with `level`, TikTok `id`, `name` and `state`).

## Retries and idempotency

Network failures happen. If a request times out you can't tell whether the boost was created, and retrying without protection could pay for two ads. Send an `Idempotency-Key` header with every boost and reuse it when you retry the **same** request:

| Situation                                                     | Result                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Same key, same request, first one finished                    | The original response is returned again, with header `Idempotent-Replayed: true`. Nothing new is created. |
| Same key, same request, first one still running               | **409 / 609.** Wait a few seconds and retry with the same key.                                            |
| Same key, different profile or body                           | **409 / 608.** Use a new key for a new boost.                                                             |
| First attempt failed with 429 (606), 503 (607) or another 5xx | Not stored: retrying with the same key runs the boost again.                                              |

Keys are scoped to your account and remembered for 24 hours. Validation errors (400) are remembered too — fix the request and use a new key.

## Spend limits

Every boost has a known maximum spend (`maxSpend`), because `endDate` is required. Two server-side limits apply to it:

| Limit       | Default    | Rule                                                                                                              |
| ----------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Per boost   | 5,000 USD  | `maxSpend` of one boost.                                                                                          |
| Per profile | 20,000 USD | Combined `maxSpend` of the profile's running boosts (live, paused or in progress, not yet ended) plus this boost. |

Requests over a limit fail with **604** before anything is sent to TikTok. TikTok's own minimums also apply: 20.00 USD per day.

## Errors

Errors use Ayrshare's standard envelope. `details` says what was wrong and how to fix it.

```json
{
  "action": "request",
  "status": "error",
  "code": 101,
  "message": "Missing or incorrect parameters. Please verify with the docs. https://www.ayrshare.com/docs/apis",
  "details": "Missing required fields: postId, tiktokPostId or authCode. Invalid fields: goal must be one of: engagement, video_views, reach, traffic; endDate must be an ISO 8601 date-time with a timezone, e.g. \"2026-11-01T09:00:00Z\"."
}
```

Field-level problems are all reported together. Rules that compare fields (dates, budget minimums, age range, call to action) are checked once every field is valid on its own.

| Code | HTTP | `action`     | Meaning                                                                | What to do                                                                                                     |
| ---- | ---- | ------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 101  | 400  | `request`    | Missing or invalid parameters (including budget minimums and dates).   | Fix the fields listed in `details`.                                                                            |
| 102  | 401  | `request`    | API Key missing, malformed or unknown.                                 | Send `Authorization: Bearer API_KEY`.                                                                          |
| 601  | 400  | `boost post` | No usable TikTok ads account: not linked, not USD, or access revoked.  | Link or re-link a USD TikTok Ads Manager account for the profile.                                              |
| 602  | 400  | `boost post` | Spark `authCode` invalid, expired, used, or expiring before `endDate`. | Ask the creator for a new code with a longer authorization, or end the ad earlier.                             |
| 603  | 400  | `boost post` | Post not found, not this profile's TikTok post, or not eligible.       | Check the post is public, belongs to the linked TikTok account, and use the right identifier.                  |
| 604  | 400  | `boost post` | `maxSpend` over the per-boost or per-profile limit.                    | Lower the budget, shorten the schedule, or wait for running boosts to end.                                     |
| 605  | 400  | `boost post` | TikTok rejected the request. `details` includes TikTok's message.      | Fix what TikTok reports. Anything already created was deleted; no money was spent.                             |
| 606  | 429  | `boost post` | TikTok rate limit.                                                     | Retry after a few seconds with the same `Idempotency-Key`.                                                     |
| 607  | 503  | `boost post` | TikTok unavailable or timed out.                                       | Retry later with the same `Idempotency-Key`.                                                                   |
| 608  | 409  | `request`    | `Idempotency-Key` reused for a different request.                      | Use a new key for a new boost.                                                                                 |
| 609  | 409  | `request`    | The request with this `Idempotency-Key` is still running.              | Wait, then retry with the same key to get its result.                                                          |
| 610  | 500  | `boost post` | The boost failed **and** some TikTok objects couldn't be removed.      | `details` lists them and whether they could still spend. Delete them in TikTok Ads Manager or contact support. |
| 611  | 404  | `request`    | Unknown endpoint.                                                      | Check the URL.                                                                                                 |
| 612  | 500  | `request`    | Unexpected error.                                                      | Retry; contact support with the request ID from `details` if it persists.                                      |
| 613  | 403  | `request`    | `Profile-Key` doesn't belong to this API Key.                          | Check the Profile-Key, or omit it to use the primary profile.                                                  |
| 614  | 403  | `request`    | Account or User Profile suspended.                                     | Contact support.                                                                                               |
| 615  | 404  | `request`    | Boost ID not found for this profile (lookup only).                     | Use the `id` from the boost response with the same `Profile-Key`.                                              |

Example of a TikTok rejection after creation had started (**605**):

```json
{
  "action": "boost post",
  "status": "error",
  "code": 605,
  "message": "Unable to boost post. TikTok rejected the request.",
  "details": "TikTok rejected the request while creating the ad group: The bid price is too low. (TikTok code 40002, request_id 202610061200001234). Everything created for this boost was deleted from your TikTok ad account; no money was spent."
}
```

Every response carries an `X-Request-Id` header. Include it, and the boost `id` if you have one, when contacting support.

## What happens during a boost

1. **Checks — nothing is created yet.** The request is validated and checked against the spend limits. Then TikTok is asked, read-only, about the ads account, the post (or Spark code) and the target locations.
2. **Create, switched off.** Campaign, ad group and ad are created in that order, all **disabled**, so nothing can spend while the boost is half-built.
3. **Switch on** — only with `status: "active"`: ad, then ad group, then the campaign last.
4. **If anything fails after creation started,** everything already created is deleted (newest first). If TikTok won't delete an object, it is switched off instead. Anything left over is reported with **610**, including whether it could still spend.
5. **If TikTok doesn't answer a create request,** the API checks whether the object was created rather than sending the request again, so a slow response can never produce a duplicate campaign.

Every attempt is recorded with each TikTok call and its TikTok `request_id`, so support can trace exactly what happened in your TikTok ad account.

## Environments and testing

This reference implementation runs in one of three modes (`TIKTOK_MODE`):

| Mode      | TikTok endpoint                                 | Use                                                                                                |
| --------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `mock`    | In-process simulation (default)                 | Local development, tests and demos. Seeded demo keys and posts; failures can be injected in tests. |
| `sandbox` | `https://sandbox-ads.tiktok.com/open_api/v1.3`  | TikTok Marketing API sandbox: one sandbox ad account, 1 request per second.                        |
| `live`    | `https://business-api.tiktok.com/open_api/v1.3` | Production.                                                                                        |

What each environment can exercise:

| Capability                                                        | Marketing API sandbox                                                | Mock |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | ---- |
| Ads account lookup, campaign / ad group creation                  | Yes                                                                  | Yes  |
| Ad creation with a Spark post                                     | Ad creation yes; a real TikTok post in a sandbox account is unlikely | Yes  |
| Spark authorization codes (`tt_video/authorize`, `tt_video/info`) | **No** — not in the sandbox's supported list                         | Yes  |
| Real delivery, review and spend                                   | No                                                                   | No   |

The TikTok for Developers sandbox (Login Kit, Share Kit, Content Posting API) is a different product and isn't used.

**Demo credentials (mock mode only)** after `npm run seed`: `Authorization: Bearer demo-api-key-active`; `Profile-Key: demo-profile-key-creator` (second profile) or `demo-profile-key-no-tiktok` (no ads account); own posts `tiktokPostId` `7300000000000000001` / `7300000000000000002` or `postId` `demoPostPrimary1`; Spark codes `SPARK-DEMO-VALID-CODE` and `SPARK-DEMO-EXPIRED-CODE`.

## Verification before launch

This implementation was built against TikTok's official SDK models and help-center rules, but **has not been run against the TikTok sandbox or production API**. TikTok's API reference pages couldn't be read during development, so these values come from prior knowledge. Each is isolated in `src/integrations/tiktok/constants.ts` (tagged `UNVERIFIED (M0)`) or in the HTTP client's response schemas, and must be confirmed before launch:

- [ ] `goal` → `optimization_goal` / `billing_event` pairs (`FOLLOWERS`/`OCPM`, `ENGAGED_VIEW`/`CPV`, `REACH`/`CPM`, `CLICK`/`CPC`) and `bid_type` values.
- [ ] Campaign `budget_mode: BUDGET_MODE_INFINITE` with the budget on the ad group.
- [ ] Schedule time format `YYYY-MM-DD HH:MM:SS` and that it is UTC.
- [ ] Enum values: `GENDER_MALE` / `GENDER_FEMALE`, `AGE_35_44` / `AGE_45_54` / `AGE_55_100`, `PLACEMENT_TIKTOK`, `SINGLE_VIDEO`, `SCHEDULE_START_END`, `PACING_MODE_SMOOTH`, and the call-to-action list.
- [ ] `operation_status: DELETE` for rollback, and that disabled objects really cannot spend.
- [ ] TikTok error codes (40001, 40002, 40100, 40102, 40104, 40105, 50000, 50002) and their meanings.
- [ ] Response shapes of `identity/video/info`, `tt_video/info` (including the authorization end time and its timezone), `tool/region` and the `*/get` lookups.
- [ ] Whether `request_id` on create calls de-duplicates, and its required format.
- [ ] Whether `tt_video/info` works before `tt_video/authorize` (dry runs rely on it).
- [ ] Whether a daily budget of exactly 20.00 USD is accepted (help center: "must exceed $20").
