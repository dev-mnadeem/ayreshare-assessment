# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

`docs/task.md` is the assessment brief and the source of truth for scope. Everything below "Technical decisions" is agreed with the user. The toolchain is scaffolded (M1); the source layout under "Planned architecture" is built out milestone by milestone. Update this file when reality diverges.

**Progress tracking:** `.claude/milestones.md` holds the ordered milestones (M0–M10) and their checklists. Read it at the start of every session to find the current milestone, and update it (checkboxes, status column, notes) as work completes.

## The assignment (summary of `docs/task.md`)

Ayrshare is a single REST API that publishes to/reads from 13 social networks. It already ships `POST /api/ads/facebook/boost` (turn an organic Facebook post into a paid ad). We are building **`POST /api/ads/tiktok/boost`**: take an existing TikTok post and turn it into a running TikTok **Spark Ad**. It must **match Ayrshare's existing API style** and follow the TikTok Marketing API.

Required:

1. **Endpoint** `POST /api/ads/tiktok/boost`
   - Authenticated like every other Ayrshare endpoint (`Authorization: Bearer <API_KEY>`, optional `Profile-Key` header).
   - Accepts an existing TikTok post + budget, schedule, objective, targeting.
   - Returns enough to render "your ad is live" and to look it up later (IDs, status, resolved settings).
   - **Validates input before it costs the customer anything.**
   - Errors use Ayrshare's error envelope with a `details` field that tells a developer exactly how to fix the request.
2. **Safety** — boosting spends the customer's money and creates objects in their TikTok ad account. Design must include explicit safety features; be ready to explain them (see "Safety features").
3. **Documentation** — developer docs for the endpoint as a Markdown file (`docs/tiktok-boost.md`).

Out of scope: any UI; updating/pausing/deleting an ad after creation; any non-Spark ad types.

Platform access constraints:

- TikTok **Marketing API sandbox** (`https://sandbox-ads.tiktok.com/open_api`): one sandbox ad account; supports campaign, ad group, ad creation; **1 QPS** rate limit.
- **Spark authorization endpoints are NOT supported** in the Marketing API sandbox. The TikTok for Developers sandbox (Login Kit / Share Kit / Content Posting) is unrelated to the Marketing API.
- Developing against **mocked TikTok endpoints is explicitly fine.** Part of the job is stating what can and cannot be exercised for real — document that in the developer docs.

Stack constraint from the brief: Node.js with typed JavaScript; framework, validation, storage are our call; SQLite or in-memory is fine — spend time on code, not infrastructure.

## Reference: existing Ayrshare conventions to match

From `POST /api/ads/facebook/boost` (https://www.ayrshare.com/docs/apis/ads/facebook/boost-post):

- Headers: `Authorization: Bearer API_KEY` (required), `Profile-Key` (optional, selects a user profile), `Content-Type: application/json`.
- Request fields are **camelCase**: `postId` (Ayrshare post ID) **or** `fbPostId` (native ID) — exactly one; `accountId`, `adName`, `budget` (USD, ≥ 1.00, 2 decimals), `bidAmount`, `goal` (enum, lowercase snake_case values), `status` (`active` | `paused`, default `active`), `startDate`/`endDate` (ISO 8601), `minAge` (18), `maxAge` (65), `gender` (`all`|`male`|`female`), `locations` (`{ countries: ["US"], regions, cities }`), `interests`, `callToAction`.
- Success: HTTP 200 with a flat body starting `"status": "success"` plus `adId`, `adName`, `adStatus`, echoed/resolved settings, `goal` as `{ type, title, description }`, `postId`, dates.
- Error envelope (HTTP 4xx/5xx):
  ```json
  {
    "action": "request",
    "status": "error",
    "code": 101,
    "message": "Missing or incorrect parameters. Please verify with the docs. https://www.ayrshare.com/docs/apis",
    "details": "Missing required fields: budget"
  }
  ```
  - `code: 101` = missing/incorrect parameters (`action: "request"`). `code: 369` = Facebook boost failed (`action: "boost post"`).
  - HTTP statuses used: 400 bad request, 401 missing/invalid API key, 403 not allowed / profile suspended, 404 not found, 429 rate limited (headers `x-ratelimit-max`, `x-ratelimit-count`), 500 internal.
- Facebook boost behavior worth mirroring: partial-failure cleanup (Ayrshare deletes created campaign objects if a later step fails), case-insensitive enum input, enum errors list accepted values.
- New TikTok-specific error codes live in one registry (`src/errors/codes.ts`), are listed in the developer docs, and are defined in the TikTok reference section below.

## Reference: TikTok Marketing API (Spark Ads flow)

Researched in M0. **✅ = confirmed** from TikTok's official SDK (`github.com/tiktok/tiktok-business-api-sdk`, `js_sdk/docs/*`), TikTok's Postman collection, or the TikTok Ads help center. **⚠️ = unverified** (TikTok's API reference pages are JS-rendered and couldn't be read); these come from prior knowledge and get validated against the sandbox in M9. Keep every TikTok constant in `src/integrations/tiktok/constants.ts` so corrections are one-file changes, and tag unverified constants with `// UNVERIFIED (M0)`.

### Transport

- Base `https://business-api.tiktok.com/open_api/v1.3`; sandbox `https://sandbox-ads.tiktok.com/open_api/v1.3` ✅. Sandbox: one ad account, campaign/ad group/ad creation, **1 QPS** ✅ (task brief).
- Auth header `Access-Token: <advertiser access token>` ✅.
- Response envelope `{ code, message, request_id, data }`; **`code: 0` = success, HTTP 200 alone means nothing** ⚠️ (well known, but re-check in M9). Always log `request_id`.

### Endpoints we use ✅

| Purpose                      | Method + path                                                                    | Key fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Advertiser pre-flight        | `GET /advertiser/info/`                                                          | `advertiser_ids`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Linked TikTok identity       | `GET /identity/get/`                                                             | `advertiser_id`, `identity_type` (`TT_USER` / `BC_AUTH_TT`; latter also needs `identity_authorized_bc_id`)                                                                                                                                                                                                                                                                                                                                                                |
| Own-post check               | `GET /identity/video/info/`                                                      | `advertiser_id`, `identity_type` (`AUTH_CODE`\|`TT_USER`\|`BC_AUTH_TT`), `identity_id`, `item_id`                                                                                                                                                                                                                                                                                                                                                                         |
| Spark code authorize         | `POST /tt_video/authorize/`                                                      | `advertiser_id`, `auth_code` — **not in the sandbox → mock only**                                                                                                                                                                                                                                                                                                                                                                                                         |
| Spark code info              | `GET /tt_video/info/`                                                            | `advertiser_id`, `auth_code` → item + identity ⚠️ response shape (`item_info.item_id`, `user_info.identity_id`, `auth_info` expiry)                                                                                                                                                                                                                                                                                                                                       |
| Location lookup              | `GET /tool/region/`                                                              | maps to `location_ids`                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Interests                    | `GET /tool/interest_category/`                                                   | `interest_category_ids`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Campaign                     | `POST /campaign/create/`                                                         | required: `advertiser_id`, `campaign_name`, `objective_type`; optional `budget_mode`, `budget`, `operation_status` (**defaults `ENABLE`**), `request_id`                                                                                                                                                                                                                                                                                                                  |
| Ad group                     | `POST /adgroup/create/`                                                          | required: `advertiser_id`, `campaign_id`, `adgroup_name`, `billing_event`, `budget`, `budget_mode`, `optimization_goal`, `pacing`, `schedule_type`, `schedule_start_time`; optional `schedule_end_time`, `placement_type` (default `PLACEMENT_TYPE_NORMAL`), `placements`, `location_ids`, `age_groups`, `gender`, `languages`, `interest_category_ids`, `bid_type`, `bid_price`, `identity_type`/`identity_id`, `operation_status` (**defaults `ENABLE`**), `request_id` |
| Ad                           | `POST /ad/create/`                                                               | required: `advertiser_id`, `adgroup_id`, `creatives[]`; per creative: `ad_name`, `identity_type`, `identity_id`, `identity_authorized_bc_id`, `tiktok_item_id`, `ad_format`, `call_to_action`, `landing_page_url`, `operation_status` (**defaults `ENABLE`**)                                                                                                                                                                                                             |
| Status (activate / rollback) | `POST /campaign/status/update/`, `/adgroup/status/update/`, `/ad/status/update/` | `campaign_ids` / `adgroup_ids` / `ad_ids` + `operation_status` (`ENABLE`\|`DISABLE`\|`DELETE` ⚠️)                                                                                                                                                                                                                                                                                                                                                                         |
| Read-back (reconcile)        | `GET /campaign/get/`, `/adgroup/get/`, `/ad/get/`                                | used to reconcile after ambiguous failures                                                                                                                                                                                                                                                                                                                                                                                                                                |

Implications:

- Every object defaults to `ENABLE` → "create disabled" means **explicitly sending `operation_status: "DISABLE"`** on campaign, ad group and ad.
- Campaign and ad-group create accept `request_id` — likely TikTok's own dedupe key ⚠️. Send a deterministic one derived from our boost ID + step so a retried create can't duplicate.

### Spark identity ✅

- `identity_type` enum: `CUSTOMIZED_USER` (non-Spark, out of scope), `AUTH_CODE`, `TT_USER`, `BC_AUTH_TT`.
- `postId` / `tiktokPostId` → identity from `identity/get` (`TT_USER`, the profile's linked account); verify ownership/eligibility with `identity/video/info`; `tiktok_item_id` = TikTok video ID.
- `authCode` → `tt_video/authorize` then `tt_video/info` → `identity_id` + `tiktok_item_id`; `identity_type: AUTH_CODE`. Creators pick 7/30/60/365-day authorization; the ad end date should not exceed the authorization expiry ⚠️ (enforce if `tt_video/info` returns it).
- Help center limits ✅: video ≤ 10 minutes; banned posts rejected; ≤ 10,000 Spark Ads per ad account; video can't be deleted while authorized.

### Objectives and goal mapping

Spark-supported objectives (auction) ✅: Reach, Traffic, Video Views, Community interaction, App promotion, Conversions, Lead generation, Sales. We expose only the four that need no pixel/app/catalog:

| Ayrshare `goal`                              | `objective_type` | `optimization_goal`                  | `billing_event` | Notes                                       |
| -------------------------------------------- | ---------------- | ------------------------------------ | --------------- | ------------------------------------------- |
| `engagement` (**default**, matches Facebook) | `ENGAGEMENT`     | `FOLLOWERS` ⚠️                       | `OCPM` ⚠️       | "Community interaction" in Ads Manager      |
| `video_views`                                | `VIDEO_VIEWS`    | `ENGAGED_VIEW` (6-s focused view) ⚠️ | `CPV` ⚠️        |                                             |
| `reach`                                      | `REACH`          | `REACH` ⚠️                           | `CPM` ⚠️        |                                             |
| `traffic`                                    | `TRAFFIC`        | `CLICK` ⚠️                           | `CPC` ⚠️        | requires `callToAction.link` (landing page) |

`bid_type: BID_TYPE_NO_BID` (lowest cost) by default ⚠️; `bidAmount` → `BID_TYPE_CUSTOM` + `bid_price` ⚠️. `pacing: PACING_MODE_SMOOTH` ⚠️. `placement_type: PLACEMENT_TYPE_NORMAL` ✅ + `placements: ["PLACEMENT_TIKTOK"]` ⚠️. `ad_format: SINGLE_VIDEO` ⚠️.

### Budget and schedule

- Minimums (USD, help center) ✅: campaign daily or lifetime > $50; **ad group daily > $20**; ad group lifetime ≥ $20 × total days. Budget type can't change once live ✅.
- **Decision:** campaign `budget_mode: BUDGET_MODE_INFINITE` ⚠️ (no campaign cap); the spend limit lives on the single ad group. This avoids the $50 campaign minimum blocking a $20/day boost, and the campaign is dedicated to this boost.
- `budget_mode`: `BUDGET_MODE_DAY` ↔ `budgetType: "daily"`, `BUDGET_MODE_TOTAL` ↔ `"total"` ✅ (names) — `TOTAL` requires `SCHEDULE_START_END` ⚠️.
- `schedule_type`: `SCHEDULE_START_END` (we always send an end date) ⚠️. Times are `YYYY-MM-DD HH:MM:SS` ⚠️, **UTC in v1.3** ⚠️ — confirm in M9; convert only in the mapper.

### Targeting

- `gender`: `GENDER_UNLIMITED` ✅ (seen in docs), `GENDER_MALE`, `GENDER_FEMALE` ⚠️.
- `age_groups` buckets: `AGE_18_24`, `AGE_25_34` ✅, `AGE_35_44`, `AGE_45_54`, `AGE_55_100` ⚠️ (13–17 exists but is excluded). TikTok targets **buckets**, not arbitrary ages → `minAge` must be one of 18/25/35/45/55 and `maxAge` one of 24/34/44/54/65 (65 = "55+"); `details` lists the valid values. Defaults 18–65 (all adult buckets), matching Facebook's defaults.
- Locations: TikTok uses numeric `location_ids`, not ISO codes. API accepts `locations.countries` (ISO 3166-1 alpha-2, default `["US"]`, like Facebook) resolved via `tool/region` in pre-flight, plus `locations.locationIds` for regions/cities.
- Interests: `interests` = TikTok `interest_category_ids` (from `tool/interest_category`).

### TikTok error codes to translate ⚠️ (all unverified — confirm in M9, keep in one map)

`40001` param error · `40002` invalid field value · `40100` rate limit (QPS) · `40104`/`40105` access token invalid/expired · `40102` no permission on advertiser · `50000`/`50002` TikTok internal (transient). Anything unknown → generic "TikTok rejected the boost" with TikTok's `message` + `request_id` in `details`.

### Sandbox: what we can and can't exercise

| Step                                                        | Marketing API sandbox                                                           | Our approach            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------- |
| advertiser/info, campaign / ad group create, status update  | ✅ supported                                                                    | live-test in M9 (1 QPS) |
| ad/create with Spark identity                               | ⚠️ ad creation supported, but no real TikTok post/identity in a sandbox account | try in M9; else mock    |
| identity/get, identity/video/info                           | ⚠️ unknown                                                                      | try in M9; else mock    |
| tt_video/authorize, tt_video/info (Spark codes)             | ❌ not supported (task brief)                                                   | mock only               |
| Real delivery / spend / review                              | ❌                                                                              | out of scope            |
| TikTok for Developers sandbox (Login/Share/Content Posting) | not the Marketing API                                                           | not used                |

### Ayrshare error codes for this endpoint

Codes from the published Ayrshare list go up to 519 (plus 369 for Facebook boost). New codes use a **6xx block** so they can't collide; in a real codebase they'd be assigned from Ayrshare's internal registry. Source of truth: `src/errors/codes.ts` (the `message` strings, including 102's, are our wording — Ayrshare's exact texts aren't published).

| Code | HTTP | `action`     | When                                                                                                   |
| ---- | ---- | ------------ | ------------------------------------------------------------------------------------------------------ |
| 101  | 400  | `request`    | Any validation failure we detect ourselves (incl. budget minimums, age buckets, dates) — existing code |
| 102  | 401  | `request`    | Missing/invalid API key — existing Ayrshare code                                                       |
| 601  | 400  | `boost post` | Profile has no linked TikTok ads account / advertiser not accessible                                   |
| 602  | 400  | `boost post` | Spark `authCode` invalid, expired, or already used                                                     |
| 603  | 400  | `boost post` | Post not found, not owned by the linked account, or not eligible for Spark                             |
| 604  | 400  | `boost post` | Spend cap exceeded (per request or per profile)                                                        |
| 605  | 400  | `boost post` | TikTok rejected the boost (TikTok `message` + `request_id` in `details`) — TikTok analogue of 369      |
| 606  | 429  | `boost post` | TikTok rate limit                                                                                      |
| 607  | 503  | `boost post` | TikTok unavailable / timed out                                                                         |
| 608  | 409  | `request`    | `Idempotency-Key` reused with a different body                                                         |
| 609  | 409  | `request`    | Request with the same `Idempotency-Key` still in progress                                              |
| 610  | 500  | `boost post` | Boost failed and cleanup was incomplete — orphaned TikTok object IDs listed in `details`               |
| 611  | 404  | `request`    | Unknown route                                                                                          |
| 612  | 500  | `request`    | Unexpected internal error — generic message, `details` carries the request ID, nothing internal leaks  |
| 613  | 403  | `request`    | `Profile-Key` unknown or belongs to another account (same answer for both — no enumeration)            |
| 614  | 403  | `request`    | Account or User Profile suspended                                                                      |

## Technical decisions

| Area             | Decision                                                                                                                                                                                                                               | Why                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Language         | TypeScript, `strict: true` (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)                                                                                                                                                | Required by user; type safety end to end.                                                                                            |
| Runtime          | Node.js LTS (≥ 20), ESM                                                                                                                                                                                                                | Matches Ayrshare's stack.                                                                                                            |
| HTTP framework   | Express                                                                                                                                                                                                                                | User's choice; small and well known.                                                                                                 |
| Validation       | **Zod**                                                                                                                                                                                                                                | Schemas are the single source of truth; request types are `z.infer`'d, never hand-written. Zod issue paths feed the `details` field. |
| Storage          | **SQLite via `better-sqlite3`** behind repository interfaces                                                                                                                                                                           | Persists boost records, idempotency keys, and audit log across restarts. Tests use `:memory:`.                                       |
| Post input       | Accept **either** `postId` (Ayrshare post ID) / `tiktokPostId` (native video ID) for the profile's linked TikTok account (`TT_USER` identity), **or** `authCode` (creator Spark code, `AUTH_CODE` identity). Exactly one of the three. | Covers own-content boosts (mirrors Facebook) and creator Spark codes.                                                                |
| Default `status` | `active`, matching Facebook boost                                                                                                                                                                                                      | Consistency with existing API; safety comes from the mechanisms below.                                                               |
| TikTok access    | `TikTokAdsClient` interface with an HTTP implementation and a mock implementation, selected by config (`TIKTOK_MODE=mock\|sandbox\|live`)                                                                                              | Spark auth endpoints aren't in the sandbox; mock must be first-class and scriptable for failure tests.                               |
| Testing          | Vitest + Supertest; `nock` (or the mock client) for TikTok                                                                                                                                                                             | Fast, native TS/ESM.                                                                                                                 |
| Lint/format      | ESLint (typescript-eslint, type-aware) + Prettier                                                                                                                                                                                      | Industry standard.                                                                                                                   |
| Logging          | pino, JSON, request-scoped child logger with request ID                                                                                                                                                                                | Structured logs; redaction support.                                                                                                  |
| Config           | Env vars parsed and validated with Zod at startup (`src/config`); fail fast on invalid config                                                                                                                                          | No `process.env` reads elsewhere.                                                                                                    |
| Money            | Accept USD decimals in the API; validate ≤ 2 decimals; handle internally as integer cents; convert only at the TikTok boundary                                                                                                         | Avoid floating-point money bugs.                                                                                                     |
| Time             | Accept ISO 8601 with offset; store UTC; convert to TikTok's format/timezone only in the mapper                                                                                                                                         |                                                                                                                                      |

## Request contract (M4)

`validateBoostRequest` is the single entry point; it throws `ValidationError` (101) and runs before anything that touches TikTok. Rules worth knowing before changing it:

- Field names follow Facebook boost: `adName`, `budget`, `goal` (default `engagement`), `status` (default `active`), `startDate` (default now), `endDate` (**required**), `minAge`/`maxAge` (18/65), `gender` (`all`), `locations` (`{ countries, locationIds }`, default `{ countries: ["US"] }`), `interests`, `callToAction` (traffic only, and required for traffic). Additions: `budgetType` (`daily` default | `total`), `bidAmount` (optional), `dryRun`, and exactly one of `postId` / `tiktokPostId` / `authCode`.
- **Strict:** unknown fields are rejected (catches typos like `budgt`). Enums are case-insensitive and trimmed; CTA types are uppercase (as on Facebook), other enums lowercase.
- **Two phases:** field-level Zod checks first, then cross-field rules (schedule, budget minimums, age order, CTA/goal) only when every field passed. The post-identifier check runs on the raw body so it's reported alongside field errors. All issues within a phase go into one `details` string.
- Dates must be ISO 8601 **with a timezone**; `startDate` may be ≤ 5 min in the past (clock skew); schedule ≥ 24 h (our rule, keeps day-based budget math meaningful) and ≤ `MAX_CAMPAIGN_DAYS`.
- Budget minimums: daily ≥ $20.00; total ≥ $20.00 × billing days (`ceil(duration / 24h)`). `maxSpendCents` = daily × days, or the total.
- Numeric IDs (`tiktokPostId`, `locationIds`, `interests`) are strings; safe integers are accepted and stringified, while numbers beyond `Number.MAX_SAFE_INTEGER` (e.g. an unquoted 19-digit TikTok ID, already rounded by JSON parsing) get a "send it as a string" error.
- Spend caps (604) are **not** schema rules — they're a safety check in M7.

## TikTok client contract (M5)

- **Never import TikTok wire names outside `integrations/tiktok/`.** The service talks to `TikTokAdsClient` with camelCase domain types; payloads come from `mapper.ts`.
- Every call takes a `TikTokCallContext { advertiserId, accessToken, onCall? }`; `onCall` receives one `TikTokCallRecord` per attempt (endpoint, TikTok `request_id`, code, outcome) — the audit trail hook for M7.
- Failures are always `TikTokError`. Use `translateTikTokError(err, step)` at the service boundary; the `step` decides the Ayrshare code for TikTok rejections (Spark steps → 602, identity/video → 603, advertiser → 601, creates → 605); rate limits → 606, server/timeout/network/malformed → 607, auth → 601.
- **Retry policy (HTTP client):** rate-limited calls retry for any method (TikTok rejected them before processing); other transient failures retry only for GETs; max 2 retries, backoff 1s/2s. Writes that fail with server/timeout/network/malformed are `ambiguous` and are **never** retried — the service must reconcile with `findIdByName` (object names embed the boost ID) and/or rely on the deterministic `request_id`.
- Mock (`TIKTOK_MODE=mock`, and all tests): validates tokens, post ownership, Spark codes (`DEMO.sparkCodes`), daily budget ≥ $20, parent ownership; `failNext(method, { kind: 'api' | 'rate_limit' | 'server' | 'timeout', afterSend? })` injects failures — `timeout` + `afterSend` performs the write and then fails (the ambiguous case).
- Response `data` schemas are lenient (unknown keys ignored) and mostly UNVERIFIED; a shape mismatch surfaces as `malformed_response` naming the missing path.

## Boost flow (M6) — `BoostService`

1. **`plan()` — read-only pre-flight, nothing is created:** linked ads account (601) → advertiser must be USD (601) → resolve the post: `postId` via `posts` table (603 if not this profile's TikTok post), `tiktokPostId` → `TT_USER` identity matched by the profile's TikTok username then `identity/video/info` ownership check (603); `authCode` → `tt_video/authorize` (skipped on dry run) + `tt_video/info`, and the creator's authorization must outlast `endDate` (602) → countries → TikTok location IDs (101 for codes TikTok can't target).
2. **Record:** a `boosts` row (`in_progress`) is written before the first create; TikTok IDs and `request_id`s are persisted after each step.
3. **Create, all DISABLED:** campaign → ad group → ad. Names are `"<adName> - <boostId>"` (searchable in Ads Manager); `request_id` = `<boostId>-campaign|adgroup`.
4. **Activate** only if `status: "active"`: ad → ad group → campaign (top-level switch last). `paused` leaves all three disabled → record `paused`.
5. **On any failure after step 2:** delete children-first (ad → ad group → campaign); if a delete fails, disable instead; anything left is an `OrphanedObject` (`state`: disabled / enabled / unknown-id). Clean rollback → original error + "no money was spent", record `failed`. Orphans → **610** listing IDs and states (with a "pause it now" warning if any could still be enabled), record `cleanup_failed`.
6. **Ambiguous create** (`TikTokError.ambiguous`): never retried — `findIdByName` decides: found → continue with it; absent → genuine failure; lookup fails → orphan with `id: null` ("may exist, created disabled").
7. Non-TikTok errors (bugs) still roll back, are recorded with code 612, and are rethrown unchanged.

`BoostService` takes `{ tiktok, boosts, posts, logger, now, newBoostId }` — inject a fixed clock and deterministic IDs in tests. `boost(auth, request, { onTikTokCall })` forwards every TikTok call record (M7 audit hook).

## Safety features (design requirements)

These are the answer to requirement 2 — implement and document all of them:

1. **Validate before spending.** Zod validation (types, enums, ranges, cross-field rules like `endDate > startDate`, `minAge ≤ maxAge`, exactly one post identifier), then **pre-flight checks** against TikTok (advertiser account accessible, post/auth code resolvable, objective supported for Spark) before any create call.
2. **Bounded spend.** Require `endDate` (with a max campaign length) or a total budget so the worst case is computable; return `maxSpend` in the response. Enforce server-side per-request and per-profile spend caps (config) and TikTok minimum budgets with explicit `details`.
3. **Idempotency.** Support an `Idempotency-Key` header: same key + same body replays the stored response; same key + different body → 409 with a clear `details`. Prevents double-charging on client retries.
4. **Create disabled, then enable.** Create campaign and ad group with `DISABLE` status, create the ad, and only flip to `ENABLE` once every object exists (and only if requested `status` is `active`). Nothing can spend in a half-built state.
5. **Compensating rollback.** If any step fails, delete/disable created objects in reverse order. Record any object that couldn't be cleaned up as `orphaned` in SQLite and surface it in the error `details` (Facebook boost does the same).
6. **`dryRun: true`.** Runs validation + pre-flight and returns the exact plan (resolved targeting, schedule, `maxSpend`) without creating anything.
7. **Safe retries.** Throttle outbound TikTok calls (sandbox 1 QPS). Retry only on transient/rate-limit responses for reads; never blindly retry a `create` call after an ambiguous failure (timeout after send) — reconcile instead (read back via `*/get/`). Send a deterministic TikTok `request_id` (boost ID + step) on campaign/ad-group create as a second dedupe layer.
8. **Audit and traceability.** Persist every boost attempt with the Ayrshare boost ID, profile, inputs, TikTok object IDs, and TikTok `request_id`s. Embed the boost ID in TikTok object names so they can be found in Ads Manager.
9. **Secret hygiene.** Never log access tokens, auth codes, or API keys (pino `redact`); mask them in stored audit rows.

## Architecture

Layered; dependencies point inward. Routes don't contain logic, services don't know about Express, only `integrations/tiktok` knows TikTok's wire format.

```
src/
  app.ts                  createApp(deps) + installCoreMiddleware / installErrorHandling — no listen()
  server.ts               loads .env, config, logger; listen(); graceful SIGTERM/SIGINT shutdown
  logger.ts               pino factory + REDACT_PATHS (secrets never logged)
  config/env.ts           Zod-validated env → typed Config (money limits in cents); fail fast
  lib/money.ts            USD ↔ integer cents, 2-decimal check (float-safe)
  lib/validation.ts       Zod issues → FieldIssue[] → one `details` string ("Missing required fields: …. Invalid fields: …")
  types/express.d.ts      Request augmentation: req.id, req.log
  middleware/
    request-context.ts    X-Request-Id (validated inbound or UUID), child logger, access log line
    error-handler.ts      404 + error → Ayrshare envelope; body-parser errors → 101
    authenticate.ts       Bearer API key → account; Profile-Key → profile (else primary); req.auth / getAuth(req)
    (M7: idempotency)
  errors/
    codes.ts              ERROR_CODES registry (code, httpStatus, action, message)
    app-error.ts          AppError (+ ValidationError, AuthenticationError, NotFoundError) → toEnvelope()
  modules/tiktok-boost/   (M4–M8)
    constants.ts          public API vocabulary (goals, enums, age edges, CTA types, minimums)
    schema.ts             validateBoostRequest(body, { now, maxCampaignDays }) → normalised BoostRequest (cents, Dates, PostReference, maxSpendCents)
    types.ts              BoostRecord, BoostStatus, OrphanedObject
    repository.ts         BoostRepository + PostRepository (Ayrshare post → TikTok video) on SQLite
    service.ts            BoostService.plan() (read-only pre-flight) and .boost() (create → enable → persist; rollback)
    controller.ts         (M8) HTTP ↔ service translation only
  integrations/tiktok/
    client.ts             TikTokAdsClient interface (pre-flight reads, Spark code, create, status, findIdByName)
    types.ts              TikTokCallContext (+ onCall trace hook), domain results, snake_case wire payloads
    constants.ts          every TikTok enum/limit/endpoint/response code (`UNVERIFIED (M0)` tags)
    mapper.ts             pure BoostRequest → campaign/ad group/ad payloads (all DISABLE), dates, ages, locations
    errors.ts             TikTokError { kind, code, requestId, transient, ambiguous } + kindForCode
    translate.ts          translateTikTokError(err, step) → AppError (601/602/603/605/606/607)
    rate-limiter.ts       RateLimiter: spaces call starts (TIKTOK_MAX_QPS)
    http-client.ts        fetch-based client: Access-Token, Zod-validated envelope/data, safe retries
    mock-client.ts        in-memory TikTok (DEMO fixtures), failNext() injection, request_id dedupe
    factory.ts            createTikTokClient(config, logger) by TIKTOK_MODE
  demo/fixtures.ts        DEMO keys, advertisers, tokens, video IDs, Spark codes — shared by seed + mock
  modules/auth/
    types.ts              Account, Profile, TikTokAdsLink, AuthContext
    auth-repository.ts    AuthRepository interface + SqliteAuthRepository (lookups by key hash)
    tiktok-ads-link.ts    requireTikTokAdsLink(profile) → 601 if no linked ads account
  db/
    database.ts           openDatabase(path) (WAL, foreign_keys, busy_timeout) + runMigrations
    migrations.ts         append-only MIGRATIONS list; each runs once in a transaction
    seed.ts               DEMO keys/IDs + idempotent seedDemoData(db)
  scripts/seed.ts         `npm run seed` CLI
  lib/secrets.ts          hashSecret (sha256) for API/profile keys
  lib/ids.ts              newBoostId() → "bst_<20 hex>"
tests/
  helpers/test-app.ts     testDeps() (silent logger, :memory:) and harnessApp() — real middleware + test-defined routes, so error paths are tested without test-only routes in src
  unit/                   pure modules: config, money, logger, schema, mapper, service (mock client)
  integration/            Supertest against createApp() / harnessApp()
docs/
  task.md                 assessment brief (git-ignored, local only)
  tiktok-boost.md         developer docs for the endpoint (deliverable)
```

Auth is simulated but behaves like Ayrshare's: accounts (primary API key) own User Profiles; `Authorization: Bearer <key>` resolves the account, optional `Profile-Key` selects a profile, otherwise the primary profile is used. All `/api` routes sit behind `authenticate`, so a request without a valid key gets 401 even for unknown routes; `/health` is public. API/profile keys are stored only as SHA-256 hashes. The linked TikTok ads account (advertiser ID + access token) lives on the profile; the 601 "not linked" check is per endpoint (`requireTikTokAdsLink`), not in the auth middleware. Demo keys are in `src/db/seed.ts` (`DEMO`), e.g. `Authorization: Bearer demo-api-key-active`, `Profile-Key: demo-profile-key-creator`.

Persistence conventions: repositories are **synchronous** (better-sqlite3 is synchronous; keeps transactions simple — a networked DB would make them async). Schema changes are new entries in `src/db/migrations.ts`, never edits to shipped ones; each milestone adds the tables it needs (boosts in M6, idempotency/audit in M7). Rows are snake_case and mapped to camelCase domain types inside the repository; timestamps are ISO-8601 UTC text.

## Commands

Requires Node ≥ 20.19 (`.nvmrc`; ESLint 10 and better-sqlite3's native build need it). Copy `.env.example` to `.env` for local runs.

```bash
npm run dev            # tsx watch src/server.ts
npm run seed           # migrate + upsert demo accounts/profiles into DATABASE_PATH (idempotent)
npm run build          # tsc -p tsconfig.build.json → dist/
npm start              # node dist/server.js
npm run typecheck      # tsc --noEmit (covers src, tests, config files)
npm run lint           # eslint . (type-aware strict rules)
npm run format         # prettier --write .   (format:check in CI)
npm test               # vitest run
npm run check          # typecheck + lint + format:check + test — must be green to finish a milestone
npx vitest run tests/unit/smoke.test.ts      # single file
npx vitest run -t "responds ok"              # single test by name
npx vitest run --coverage                    # coverage (v8)
```

Toolchain notes (versions resolved at scaffold time): Express 5 (async handler rejections reach the error middleware natively — no wrapper needed), Zod 4, TypeScript 6 (`types` must be listed explicitly; currently `["node"]`), ESLint 10 flat config with `typescript-eslint` `strictTypeChecked`, Vitest 4. ESM throughout: relative imports in TS use the `.js` extension (`import { createApp } from './app.js'`). Prettier also formats Markdown, including this file.

## Code quality standards

- **Types:** no `any` (use `unknown` + narrowing); no non-null `!` assertions; validate at every trust boundary (HTTP input, env, TikTok responses) with Zod, and trust types inside.
- **Errors:** throw typed `AppError` subclasses carrying HTTP status, Ayrshare `code`, `action`, `message`, `details`; a single error middleware formats the envelope. Never leak stack traces or TikTok raw errors unmapped — translate TikTok codes into actionable `details` (keep the TikTok `request_id`).
- **Dependency injection:** pass collaborators (client, repositories, clock, ID generator, config) into factories/constructors; no module-level singletons. This keeps the service testable with the mock client and a fake clock.
- **Pure core:** keep mapping and validation logic pure functions; side effects live in service/repository/client.
- **Small units:** one responsibility per module; functions do one thing; prefer early returns.
- **Naming:** API fields camelCase like Ayrshare; enum values lowercase snake_case in the public API, mapped to TikTok's UPPER_CASE in `mapper.ts` only.
- **Constants:** no magic numbers/strings — budgets minimums, caps, enum maps live in named constants.
- **Async:** always `await` or return promises; no floating promises (enforce with `@typescript-eslint/no-floating-promises`); Express 5 forwards rejected promises from handlers to the error middleware, so no async wrapper is needed.
- **Testing:** test behavior at the HTTP boundary (status, envelope, body) plus focused unit tests for mapper/validation. Every safety feature gets a test: idempotent replay, mismatched-body 409, rollback on each step failure, orphan recording, dry run creates nothing, caps enforced, activation only after full creation.
- **Comments:** explain _why_ (TikTok quirks, safety rationale), not _what_.
- **Commits:** small, focused, conventional-commit style messages.
