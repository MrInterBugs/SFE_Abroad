# [Student Loan Repayment Calculator](https://sfe.aedanl.com)

A web app for UK student loan borrowers living abroad to estimate their monthly repayment based on their country of residence, salary, and repayment plan. Exchange rates and earnings thresholds are sourced directly from gov.uk and cached locally so the calculator continues to work even if older tax year pages are removed.

## Features

- **Plans 1, 2, 4 and 5** — covers all active overseas repayment plans, with an optional Postgraduate Loan add-on
- **Multi-year support** — switch between tax years (currently 2025-26 and 2026-27); defaults to the current UK tax year automatically
- **Offline cache** — thresholds are scraped from gov.uk and persisted to a local SQLite database; archived years are served entirely from the database once cached
- **Currency formatting** — salary is displayed with the correct local currency symbol
- **Remembers preferences** — selected plan, country, and year are stored in cookies and restored on next visit
- **Account recovery** — email confirmation and password reset links are sent through Resend
- **Form protection** — CSRF tokens on all submissions; rate limiting to prevent abuse.

## How it works

On startup the app fetches earnings threshold tables from gov.uk for all supported plans and tax years, parses them with Cheerio, and stores the results in a SQLite database. Subsequent requests are served from an in-memory cache (7-day TTL) with the database as a fallback. For archived tax years the database is used exclusively — gov.uk is never re-fetched.

Repayments are calculated as:

```
monthly repayment = ((annual salary in GBP − threshold) × rate%) ÷ 12
```

- Undergraduate plans (1, 2, 4, 5): **9%** above threshold
- Postgraduate Loan: **6%** above threshold

If the salary is below the threshold, no repayment is due. When both are selected, the result shows each repayment separately and as a combined total.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

No local Node.js installation is required — everything runs inside Docker.

## Running locally

```bash
git clone https://github.com/MrInterBugs/SFE_Abroad.git
cd SFE_Abroad
docker compose up --build
```

The app will be available at `http://localhost:3000`.

> **Note:** The first build compiles `better-sqlite3` from source and may take a couple of minutes.

### Email setup

Email confirmation and password reset use Resend. Set these variables before running the production compose stack:

```bash
RESEND_API_KEY=...
EMAIL_FROM="Student Finance Overseas <hello@your-domain.example>"
APP_BASE_URL=https://sfe.aedanl.com
```

`APP_BASE_URL` defaults to `https://sfe.aedanl.com` in `docker-compose.yml`. In local development, email sending is skipped unless `RESEND_API_KEY` is configured.

### Data persistence

Country data is stored in `./data/thresholds.db` on the host machine (mounted as a Docker volume). This means cached threshold data — including archived tax years — survives container restarts and rebuilds.

### Running tests

Tests run automatically as part of the Docker build. To run them manually inside a container:

```bash
docker run --rm sfe_abroad-student-loan-app npm test
```

## Usage

1. Select a **tax year** and **repayment plan**
2. Tick **I also have a Postgraduate Loan** if applicable
3. Type your **country of residence** — the field autocompletes from the gov.uk threshold table
4. Enter your **annual salary in local currency**
5. Click **Calculate**

The result shows your estimated monthly repayment in GBP, along with the exchange rate and earnings threshold used. If the Postgraduate Loan option is selected, undergraduate and PGL repayments are shown separately alongside a combined total.

## Data source

Threshold data is published by the UK government:

- [Plan 1](https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-1-student-loans)
- [Plan 2](https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-2-student-loans)
- [Plan 4](https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-4-student-loans)
- [Plan 5](https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-5-student-loans)
- [Postgraduate Loan](https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-postgraduate-student-loans)

> **Note:** The 2025-26 pages for Plans 1, 2, and 4 have a typo in their URL (the path reads `2024-25`). This is a gov.uk error — the data is correct. Plan 5 2026-27 uses a different URL format (`2026-to-2027`). Both quirks are handled in [config/constants.js](student-loan-repayment/config/constants.js).

## Tech stack

| | |
|---|---|
| Runtime | Node.js 25 (Alpine) |
| Framework | Express |
| Templating | EJS |
| Data fetching | Axios + Cheerio |
| Database | SQLite via better-sqlite3 |
| Security | Helmet (CSP), CSRF tokens, rate-limiter-flexible |
| Containerisation | Docker + Docker Compose |
| Reverse proxy (production) | Traefik |

## License

Licensed under the [Apache 2.0 License](LICENSE).
