# Ayrshare TikTok Boost API

This is a reference implementation of `POST /api/ads/tiktok/boost`, an Ayrshare endpoint. It takes an existing TikTok post and turns it into a running TikTok **Spark Ad**. The paid ad uses the original post, so the engagement counts towards the organic post. It is the TikTok counterpart of Ayrshare's [Facebook boost](https://www.ayrshare.com/docs/apis/ads/facebook/boost-post) and keeps the same conventions: camelCase fields, a flat success body, and the `{ action, status, code, message, details }` error envelope.

Boosting spends the customer's money and creates objects in their TikTok ad account. Most of the code makes that safe:

- Every request is validated before TikTok is called.
- Spend caps are enforced on the worst case.
- A dry run checks a request without creating anything.
- Idempotency keys stop a retry from paying for a second ad.
- Campaign, ad group and ad are created switched off, and a failed boost is rolled back.
- Every TikTok call is written to an audit log.

| Document                                     | What it covers                                                      |
| -------------------------------------------- | ------------------------------------------------------------------- |
| [docs/tiktok-boost.md](docs/tiktok-boost.md) | Developer docs: request, responses, errors, retries, limits.        |
| [docs/safety.md](docs/safety.md)             | The risks considered, the mitigation for each, and what remains.    |
| [docs/api-session.md](docs/api-session.md)   | A full captured session of real requests and responses (mock mode). |

Stack: TypeScript (strict) on Node.js 22, Express 5, Zod 4, SQLite through better-sqlite3, pino and Vitest.

## Quick start

You need Node.js 22.12 or newer. `.nvmrc` pins 22. The default `TIKTOK_MODE=mock` simulates TikTok in-process, so nothing leaves your machine.

```bash
nvm use
npm ci
cp .env.example .env
npm run seed    # create ./data/ayrshare.db and load demo accounts, profiles and posts
npm run dev     # http://localhost:3000, reloads on change
```

`npm run build && npm start` runs the compiled server instead. If port 3000 is taken, set `PORT` in `.env`.

The seed prints the demo credentials. They are fixed placeholders from `src/demo/fixtures.ts` and only work against the mock:

| Value                                                | Use                                                     |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `Authorization: Bearer demo-api-key-active`          | The main demo account.                                  |
| `Profile-Key: demo-profile-key-creator`              | A second profile, with its own TikTok ads account.      |
| `Profile-Key: demo-profile-key-no-tiktok`            | A profile with no ads account linked (error 601).       |
| `Authorization: Bearer demo-api-key-suspended`       | A suspended account (error 614).                        |
| `tiktokPostId` `7300000000000000001` or `…02`        | Posts on the main profile's TikTok account.             |
| `postId` `demoPostPrimary1`                          | The same post, as published through Ayrshare.           |
| `authCode` `SPARK-DEMO-VALID-CODE` / `…EXPIRED-CODE` | A creator's Spark authorization code, valid or expired. |

## Usage

The responses below were captured from the running server. Some are shortened; [docs/api-session.md](docs/api-session.md) has them all in full.

**Dry run.** This runs every check a real boost would run, including the TikTok look-ups, but creates nothing:

```bash
curl -s localhost:3000/api/ads/tiktok/boost \
  -H "Authorization: Bearer demo-api-key-active" -H "Content-Type: application/json" \
  -d '{"tiktokPostId":"7300000000000000001","adName":"Launch","budget":25,
       "startDate":"2030-01-01T00:00:00Z","endDate":"2030-01-08T00:00:00Z","dryRun":true}'
```

```json
{
  "status": "success",
  "dryRun": true,
  "adName": "Launch",
  "advertiserId": "7100000000000000001",
  "adStatus": "active",
  "goal": { "type": "engagement", "title": "Get More Engagement", "description": "…" },
  "budget": 25,
  "budgetType": "daily",
  "maxSpend": 175,
  "startDate": "2030-01-01T00:00:00.000Z",
  "endDate": "2030-01-08T00:00:00.000Z",
  "tiktokPostId": "7300000000000000001",
  "authorizationType": "linked_account",
  "targetLocationIds": ["6252001"],
  "committedSpend": 0,
  "limits": { "maxSpendPerBoost": 5000, "maxSpendPerProfile": 20000 },
  "sparkAuthorizationEndsAt": null
}
```

`maxSpend` is the worst case: 25 USD a day for 7 days. The spend caps are checked against this figure.

**Boost.** Drop `dryRun` and send an `Idempotency-Key`:

```bash
curl -s localhost:3000/api/ads/tiktok/boost \
  -H "Authorization: Bearer demo-api-key-active" -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-1" \
  -d '{"tiktokPostId":"7300000000000000001","adName":"Launch","budget":25,
       "startDate":"2030-01-01T00:00:00Z","endDate":"2030-01-08T00:00:00Z"}'
```

```json
{
  "status": "success",
  "id": "bst_5cf2ff364e4a60b3fd9f",
  "boostStatus": "live",
  "adId": "1830000000000000003",
  "adGroupId": "1820000000000000002",
  "campaignId": "1810000000000000001",
  "adName": "Launch - bst_5cf2ff364e4a60b3fd9f",
  "adStatus": "active",
  "maxSpend": 175,
  "createdAt": "2026-11-07T20:45:21.644Z"
}
```

If you send the same request again with the same key, you get the same body back with `Idempotent-Replayed: true`, and no second ad is created. If you reuse the key with a different body, you get a `409`:

```json
{
  "action": "request",
  "status": "error",
  "code": 608,
  "message": "This Idempotency-Key was already used with a different request body.",
  "details": "Idempotency-Key \"demo-1\" was first used at 2026-11-07T20:45:21.643Z for a different request (different profile, endpoint or body). Use a new key for a new boost; reuse a key only to retry the exact same request."
}
```

**Look a boost up later.** `GET /api/ads/tiktok/boost/<id>` takes the same API key and Profile-Key, and returns the same shape as the boost response.

**Errors say how to fix the request.** A validation failure lists every problem in one `details` string:

```json
{
  "action": "request",
  "status": "error",
  "code": 101,
  "message": "Missing or incorrect parameters. Please verify with the docs. https://www.ayrshare.com/docs/apis",
  "details": "Invalid fields: tiktokPostId must be sent as a string: this number is too large to be represented exactly, so its digits were already changed in transit. Quote the ID, e.g. \"7301234567890123456\"; goal must be one of: engagement, video_views, reach, traffic; budget must have at most 2 decimal places (USD); endDate must be an ISO 8601 date-time with a timezone, e.g. \"2026-11-01T09:00:00Z\"."
}
```

A request over a spend cap fails before TikTok is called:

```json
{
  "action": "boost post",
  "status": "error",
  "code": 604,
  "message": "The requested budget exceeds the spend limit for this account.",
  "details": "This boost could spend up to 5600.00 USD (800.00 USD/day × 7 days), above the per-boost limit of 5000.00 USD. Lower the budget or shorten the schedule."
}
```

The [developer docs](docs/tiktok-boost.md#errors) list every error code (101, 102 and 601–615).

## How a boost runs

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API (Express)
    participant S as BoostService
    participant DB as SQLite
    participant T as TikTok Marketing API

    C->>A: POST /api/ads/tiktok/boost (+ Idempotency-Key)
    A->>DB: authenticate API key / Profile-Key, claim idempotency key
    A->>A: validate body (Zod + cross-field rules) → 101
    A->>S: boost(request)
    S->>DB: committed spend for profile → 604 if over a cap
    S->>T: read-only pre-flight: advertiser (USD?), identity + video or Spark code, regions
    S->>DB: insert boost row, re-checking the profile cap in one IMMEDIATE transaction
    S->>T: create campaign, ad group, ad (all DISABLED)
    S->>T: enable ad → ad group → campaign (status "active" only)
    alt any step fails after the first create
        S->>T: delete children-first, falling back to disable
        S->>DB: status failed / cleanup_failed (+ orphans) → 610 if anything is left
    end
    S->>DB: status live / paused, audit events for every TikTok call
    A->>DB: store response for idempotent replay
    A-->>C: 200 { status: "success", id, adId, … }
```

## Design choices

- **Worst-case spend is always known.** `endDate` is required, so every boost has a `maxSpend` (a daily budget times the days, or the total budget). Both caps compare against it. `MAX_SPEND_PER_BOOST` limits one boost. `MAX_SPEND_PER_PROFILE` limits the sum over a profile's running boosts. The profile cap is checked again inside the same SQLite transaction that inserts the boost, so two concurrent boosts cannot both slip under it.
- **Money is integer cents.** USD amounts arrive as JSON numbers. They are checked for at most two decimals, with a float tolerance, and converted to cents once at the edge (`src/lib/money.ts`).
- **Writes to TikTok are never blindly retried.** The HTTP client retries reads, and rate-limit rejections that TikTok did not process. Writes can fail ambiguously (a timeout, a 5xx or an unreadable 200). When that happens, the service looks the object up by its unique name, `{adName} - {boostId}`, instead of creating it again.
- **Errors are built for the developer reading them.** One registry, `src/errors/codes.ts`, maps each error to its Ayrshare code, HTTP status and action. `details` names every field problem at once, including 19-digit TikTok IDs that were sent unquoted and silently rounded by JSON.
- **Idempotency is modelled on Stripe's.** Keys are scoped to the account. The fingerprint covers profile, method, path and canonical body. Retryable outcomes (409, 429, 5xx) are not stored, so the retry actually runs. A client that disconnects mid-boost keeps its claim, so the retry cannot start a second boost.
- **Credentials stay out of storage and logs.** API keys and Profile-Keys are stored only as SHA-256 digests. pino redacts tokens and Spark codes. Audit data goes through `redactSecrets`, and Spark codes are masked on the boost row.
- **One composition root.** `src/composition.ts` wires repositories, the TikTok client and the service. The server and the tests both build the same graph, and the TikTok client (`mock` or HTTP) is chosen from config.
- **The mode must match the host.** Config validation refuses to start if `TIKTOK_MODE=sandbox` or `live` does not match the host in `TIKTOK_BASE_URL`, which guards against real spend by accident.

## Configuration

Every variable is validated at startup. If any is invalid, the server refuses to start and lists every problem. See `.env.example`.

| Variable                | Default                                        | Notes                                                                   |
| ----------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| `PORT`                  | `3000`                                         |                                                                         |
| `LOG_LEVEL`             | `info`                                         | pino levels. Credentials are always redacted.                           |
| `DATABASE_PATH`         | `./data/ayrshare.db`                           | `:memory:` gives an ephemeral database.                                 |
| `TIKTOK_MODE`           | `mock`                                         | `mock`, `sandbox` or `live`. Must match the host in `TIKTOK_BASE_URL`.  |
| `TIKTOK_BASE_URL`       | `https://sandbox-ads.tiktok.com/open_api/v1.3` | For live: `https://business-api.tiktok.com/open_api/v1.3`.              |
| `TIKTOK_MAX_QPS`        | `1`                                            | Outbound TikTok request rate. The sandbox allows 1 per second.          |
| `TIKTOK_TIMEOUT_MS`     | `15000`                                        | Per TikTok request.                                                     |
| `MAX_SPEND_PER_BOOST`   | `5000`                                         | USD cap on one boost's worst-case spend.                                |
| `MAX_SPEND_PER_PROFILE` | `20000`                                        | USD cap on the combined worst-case spend of a profile's running boosts. |
| `MAX_CAMPAIGN_DAYS`     | `90`                                           | Longest allowed schedule.                                               |

In `sandbox` and `live` mode, the TikTok advertiser ID and access token come from the profile's row in the database. The seed only writes mock values. To use a real sandbox advertiser, update the `profiles` row.

## Scripts

| Command                   | What it does                                                       |
| ------------------------- | ------------------------------------------------------------------ |
| `npm run dev`             | Start with reload (`tsx watch`).                                   |
| `npm run build` / `start` | Compile to `dist/` / run the compiled server.                      |
| `npm run seed`            | Apply migrations and upsert demo data. Safe to repeat.             |
| `npm test`                | Run all tests (Vitest). `npx vitest run --coverage` adds coverage. |
| `npm run check`           | Type check, lint, format check and tests in one go.                |
| `npm run lint` / `format` | ESLint (type-aware, strict) / Prettier.                            |

The suite has 323 tests in 19 files. It needs no network: TikTok is the in-process mock, or `nock` for the HTTP client. Statement coverage is about 96%.

## Layout

```
src/
  app.ts, server.ts, composition.ts   Express app, entrypoint, dependency wiring
  config/ logger.ts errors/           validated env, redacting logger, error codes + envelope
  middleware/                         request ID, auth (API key + Profile-Key), idempotency, errors
  modules/tiktok-boost/               schema (validation), service (boost flow), routes, presenter, repositories
  modules/auth|audit|idempotency/     accounts and profiles, audit trail, idempotency keys
  integrations/tiktok/                client interface, HTTP client, mock, payload mapper, error translation
  db/                                 SQLite connection, migrations, seed
tests/unit, tests/integration         Vitest suites; helpers build the real composition root
```

## Status and limitations

- The service was built against a **mocked** TikTok Marketing API and has not been run against the TikTok sandbox or production. TikTok's sandbox does not support the Spark authorization endpoints. Every TikTok value that still needs confirming is listed under [Verification before launch](docs/tiktok-boost.md#verification-before-launch) and tagged `UNVERIFIED (M0)` in `src/integrations/tiktok/constants.ts`.
- Authentication is simulated with seeded accounts and profiles, but it follows Ayrshare's rules.
- The rate limiter and the idempotency store are single-process. A multi-instance deployment would need shared ones, such as Redis.
- Out of scope: any UI; updating, pausing or deleting an ad after it is created; and ad types other than Spark.

## License

[MIT](LICENSE)
