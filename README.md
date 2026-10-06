# Ayrshare TikTok Boost API

A reference implementation of `POST /api/ads/tiktok/boost`: an Ayrshare endpoint that turns an existing TikTok post into a running TikTok Spark Ad, alongside the existing [Facebook boost](https://www.ayrshare.com/docs/apis/ads/facebook/boost-post).

- **Developer docs:** [docs/tiktok-boost.md](docs/tiktok-boost.md) — request, responses, errors, retries, limits.
- **Safety design:** [docs/safety.md](docs/safety.md) — risks, mitigations and what's left.

TypeScript (strict) · Node.js ≥ 20.19 · Express 5 · Zod 4 · SQLite (better-sqlite3) · pino · Vitest.

## Quick start

```bash
nvm use                # Node 20.19+ (see .nvmrc)
npm ci
cp .env.example .env   # defaults: TIKTOK_MODE=mock, SQLite at ./data/ayrshare.db
npm run seed           # migrate and load demo accounts, profiles and posts
npm run dev            # http://localhost:3000
```

If port 3000 is taken (e.g. by Docker), set `PORT` in `.env` and use that port below.

Try it with the demo key (mock mode simulates TikTok in-process; nothing leaves your machine):

```bash
# Dry run: validate and plan, create nothing
curl -s localhost:3000/api/ads/tiktok/boost \
  -H "Authorization: Bearer demo-api-key-active" -H "Content-Type: application/json" \
  -d '{"tiktokPostId":"7300000000000000001","adName":"Launch","budget":25,"endDate":"2030-01-08T00:00:00Z","startDate":"2030-01-01T00:00:00Z","dryRun":true}'

# Boost it (safe to repeat: same Idempotency-Key = same boost)
curl -s localhost:3000/api/ads/tiktok/boost \
  -H "Authorization: Bearer demo-api-key-active" -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-1" \
  -d '{"tiktokPostId":"7300000000000000001","adName":"Launch","budget":25,"endDate":"2030-01-08T00:00:00Z","startDate":"2030-01-01T00:00:00Z"}'

# Look it up later
curl -s localhost:3000/api/ads/tiktok/boost/<id> -H "Authorization: Bearer demo-api-key-active"
```

Other demo values (from `src/demo/fixtures.ts`): `Profile-Key: demo-profile-key-creator`, `demo-profile-key-no-tiktok` (601 example), API key `demo-api-key-suspended` (614 example), `postId: demoPostPrimary1`, Spark codes `SPARK-DEMO-VALID-CODE` / `SPARK-DEMO-EXPIRED-CODE`.

## Scripts

| Command                   | What it does                                                   |
| ------------------------- | -------------------------------------------------------------- |
| `npm run dev`             | Start with reload (`tsx watch`).                               |
| `npm run build` / `start` | Compile to `dist/` / run the build.                            |
| `npm run seed`            | Apply migrations and upsert demo data (safe to repeat).        |
| `npm test`                | All tests (Vitest). `npx vitest run --coverage` for coverage.  |
| `npm run check`           | Type check + lint + format check + tests — what CI should run. |
| `npm run lint` / `format` | ESLint (type-aware, strict) / Prettier.                        |

## Configuration

All variables are validated at startup; the server refuses to start and lists every problem if any is invalid. See `.env.example`.

| Variable                | Default                                        | Notes                                                                   |
| ----------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| `PORT`                  | `3000`                                         |                                                                         |
| `LOG_LEVEL`             | `info`                                         | pino levels; credentials are always redacted.                           |
| `DATABASE_PATH`         | `./data/ayrshare.db`                           | `:memory:` for an ephemeral database.                                   |
| `TIKTOK_MODE`           | `mock`                                         | `mock`, `sandbox` or `live`. Must match the host in `TIKTOK_BASE_URL`.  |
| `TIKTOK_BASE_URL`       | `https://sandbox-ads.tiktok.com/open_api/v1.3` | Live: `https://business-api.tiktok.com/open_api/v1.3`.                  |
| `TIKTOK_MAX_QPS`        | `1`                                            | Outbound TikTok request rate (the sandbox allows 1/s).                  |
| `TIKTOK_TIMEOUT_MS`     | `15000`                                        | Per TikTok request.                                                     |
| `MAX_SPEND_PER_BOOST`   | `5000`                                         | USD cap on one boost's worst-case spend.                                |
| `MAX_SPEND_PER_PROFILE` | `20000`                                        | USD cap on the combined worst-case spend of a profile's running boosts. |
| `MAX_CAMPAIGN_DAYS`     | `90`                                           | Longest allowed schedule.                                               |

In `sandbox` / `live` mode the TikTok advertiser ID and access token come from the profile's linked account in the database. The seed only creates mock values; link a real sandbox advertiser by updating the `profiles` row.

## How it's organised

```
src/
  app.ts, server.ts, composition.ts   Express app, entrypoint, dependency wiring
  config/ logger.ts errors/           validated env, redacting logger, Ayrshare error codes + envelope
  middleware/                         request ID, auth (API key + Profile-Key), idempotency, errors
  modules/tiktok-boost/               schema (validation), service (boost flow), routes, presenter, repositories
  modules/auth|audit|idempotency/     accounts & profiles, audit trail, idempotency keys
  integrations/tiktok/                TikTok client interface, HTTP client, mock, mapper, error translation
  db/                                 SQLite connection, migrations, seed
tests/unit, tests/integration         310 tests
```

The boost flow (validate → spend caps → read-only checks → create disabled → enable → rollback on failure) is described in [docs/tiktok-boost.md](docs/tiktok-boost.md#what-happens-during-a-boost).

## Status and limitations

- Developed against a **mocked** TikTok Marketing API. The Spark authorization endpoints aren't available in TikTok's Marketing API sandbox, and the sandbox wasn't exercised for this submission. TikTok values not confirmed against the live API are listed under [Verification before launch](docs/tiktok-boost.md#verification-before-launch).
- Authentication is simulated (seeded accounts and profiles) but behaves like Ayrshare's.
- Out of scope: UI; updating, pausing or deleting ads after creation; non-Spark ads.
