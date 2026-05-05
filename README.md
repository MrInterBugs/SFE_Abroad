# Student Finance Overseas Repayment Calculator

[sfe.aedanl.com](https://sfe.aedanl.com)

A small Express app for UK graduates living abroad who want to estimate their monthly Student Loans Company repayment. It uses the official gov.uk overseas earnings threshold tables, converts a local annual salary into GBP using the published exchange rate, and applies the relevant undergraduate or postgraduate repayment rate.

This project is built to be useful as a live calculator, but also resilient as the gov.uk pages move around over time: threshold data is parsed, cached in memory, and persisted to SQLite.

## Features

- Repayment plans 1, 2, 4, and 5
- Optional Postgraduate Loan calculation
- Tax-year switching for the configured supported years
- Country autocomplete built from gov.uk threshold data
- Local-currency display using country currency metadata
- Saved preferences when the user has preference-cookie consent
- Optional user accounts with email confirmation and password reset
- Profile defaults for country, plan, salary, graduation date, and loan balances
- Repayment projection chart powered by Chart.js
- SEO pages and generated sitemap
- SQLite persistence for cached thresholds, sessions, users, profiles, tokens, and calculation metadata
- CSRF protection, rate limiting, CSP headers, secure sessions, and argon2id password hashing

## How The Calculation Works

For undergraduate loans:

```text
monthly repayment = max(0, annual salary in GBP - overseas threshold) * 9% / 12
```

For Postgraduate Loans:

```text
monthly repayment = max(0, annual salary in GBP - overseas PGL threshold) * 6% / 12
```

The salary-to-GBP conversion uses the exchange rate published in the gov.uk overseas threshold table for the selected plan and tax year. This calculator is an estimate, not an official SLC statement.

## Project Layout

```text
.
|-- Dockerfile
|-- docker-compose.yml
|-- docker-entrypoint.sh
|-- landing/
|   |-- ads.txt
|   `-- nginx.conf
`-- student-loan-repayment/
    |-- app.js
    |-- config/
    |   |-- constants.js
    |   `-- seoPages.js
    |-- public/
    |   |-- main.js
    |   |-- styles.css
    |   `-- sitemap.xml
    |-- routes/
    |   |-- auth.js
    |   |-- index.js
    |   `-- profile.js
    |-- scripts/
    |   `-- generateSitemap.js
    |-- tests/
    |-- utils/
    `-- views/
```

## Tech Stack

| Area | Tooling |
|---|---|
| Runtime | Node.js 24 Alpine in Docker |
| Server | Express |
| Views | EJS |
| Frontend | Vanilla JS, CSS, Chart.js |
| Data fetching | Axios |
| HTML parsing | Cheerio |
| Database | SQLite via better-sqlite3 |
| Sessions | express-session with a custom SQLite store |
| Auth | argon2id password hashes, hashed auth tokens |
| Email | Resend API |
| Tests | Jest, Supertest |
| Production routing | Traefik labels in docker-compose.yml |

## Data Sources

Threshold data is published by the UK government:

- [Plan 1](https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-1-student-loans)
- [Plan 2](https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-2-student-loans)
- [Plan 4](https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-4-student-loans)
- [Plan 5](https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-5-student-loans)
- [Postgraduate Loan](https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-postgraduate-student-loans)

The configured source URLs live in [`student-loan-repayment/config/constants.js`](student-loan-repayment/config/constants.js). Some gov.uk paths have year-format quirks, and those are intentionally captured there.

## Data And Caching

On startup, the app prefetches every configured plan and tax-year combination from gov.uk.

The lookup order is:

1. Fresh in-memory cache
2. SQLite cache for archived or unavailable data
3. gov.uk fetch

Current-year data is refreshed from gov.uk after the in-memory cache expires. Non-current configured years prefer SQLite first because gov.uk can remove or rename archived pages.

The SQLite database is created at:

```text
student-loan-repayment/data/thresholds.db
```

In Docker, this path is mounted from the repository-level `./data` directory:

```text
./data:/usr/src/app/data
```

## Environment Variables

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `SESSION_SECRET` | Yes | None | Secret used to sign session cookies |
| `NODE_ENV` | Recommended | Development outside Docker, `production` in Docker | Controls secure-cookie behavior and test setup |
| `RESEND_API_KEY` | No | None | Enables email delivery through Resend |
| `EMAIL_FROM` | No | `Student Finance Overseas Calculator <onboarding@resend.dev>` | Sender address for confirmation and reset emails |
| `APP_BASE_URL` | No | `http://localhost:3000` in app code, `https://sfe.aedanl.com` in compose | Base URL used in email links |

When `RESEND_API_KEY` is missing, email sends are skipped and logged. That is convenient locally, but accounts that require email confirmation will not receive a real confirmation link.

## Running Locally With Node

Use this path if you want quick feedback without Docker.

```bash
cd student-loan-repayment
npm ci
SESSION_SECRET=dev-session-secret npm start
```

The app listens on:

```text
http://localhost:3000
```

The first request or startup prefetch may call gov.uk and populate SQLite.

## Running With Docker

Build and run the app container directly:

```bash
docker build -t sfe-abroad .
docker run --rm \
  -p 3000:3000 \
  -e SESSION_SECRET=dev-session-secret \
  -e APP_BASE_URL=http://localhost:3000 \
  -v "$PWD/data:/usr/src/app/data" \
  sfe-abroad
```

Then open:

```text
http://localhost:3000
```

The checked-in `docker-compose.yml` is production-oriented. It expects an external Docker network named `traefik_default` and includes Traefik labels for `sfe.aedanl.com`, plus a small nginx landing service for `aedanl.com` and `www.aedanl.com`.

## Production Compose

Create an `.env` file or export these variables before using the production compose file:

```bash
SESSION_SECRET=replace-with-a-long-random-secret
RESEND_API_KEY=optional-resend-key
EMAIL_FROM="Student Finance Overseas <hello@example.com>"
APP_BASE_URL=https://sfe.aedanl.com
```

Then run:

```bash
docker compose up --build -d
```

Because the compose file joins `traefik_default`, make sure that network already exists:

```bash
docker network ls
```

## Testing

Run the full Jest suite:

```bash
cd student-loan-repayment
npm test
```

The project currently enforces 100% global coverage for branches, functions, lines, and statements. Tests set `SESSION_SECRET` automatically through `tests/setup.js`.

Run a production dependency audit:

```bash
cd student-loan-repayment
npm audit --omit=dev
```

## Useful Scripts

From `student-loan-repayment/`:

```bash
npm start
npm test
npm run generate:sitemap
```

`npm run generate:sitemap` writes `student-loan-repayment/public/sitemap.xml` from the SEO page configuration.

## Authentication And Privacy Notes

User accounts support:

- Registration
- Email confirmation
- Login and logout
- Password reset
- Profile export
- Account deletion

Security and privacy choices worth keeping:

- Passwords are hashed with argon2id.
- Email confirmation and reset tokens are stored as SHA-256 hashes.
- Password reset revokes existing user sessions.
- CSRF tokens are required for mutating form submissions.
- Auth routes have a stricter rate limiter than general dynamic requests.
- Anonymous calculations are stored as aggregate daily stats.
- Signed-in calculation history stores metadata such as country, plan, year, and PGL inclusion. It does not store salary amounts.
- Preference cookies are only written when preference-cookie consent is present.

## Maintenance Checklist

At least once per UK tax-year rollover:

1. Add the new tax year and source URLs in `student-loan-repayment/config/constants.js`.
2. Run the test suite.
3. Start the app and confirm prefetch logs for every plan and year.
4. Regenerate the sitemap if SEO pages changed.
5. Check a few high-traffic countries manually against gov.uk.

When gov.uk changes page structure:

1. Update `parseTableData` in `student-loan-repayment/utils/fetchCountryData.js`.
2. Add or update parser fixtures in the tests.
3. Verify cached data can still be loaded from SQLite as a fallback.

## Known Operational Caveats

- Supported tax years are explicit. If a new tax year starts before `constants.js` is updated, the app falls back to the latest configured year.
- The home-page country autocomplete is currently based on current-year Plan 1 data. Calculation still validates against the selected plan and year on the server.
- The production compose file is not a generic local-development compose file because it depends on the external Traefik network.

## License

Licensed under the [Apache License 2.0](LICENSE).
