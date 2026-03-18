# FinancePortfolioWeb

A Turkish investment portfolio tracker — manage BIST stocks, US equities, ETFs, crypto, BES pension funds, and real estate in one place with real-time prices, budget tracking, and performance analytics.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite 5, Tailwind CSS 3 |
| UI Components | shadcn/ui (Radix UI) |
| Routing | Wouter |
| Server State | TanStack React Query v5 |
| Charts | Recharts |
| Backend | Express.js 4, TypeScript |
| ORM | Drizzle ORM |
| Database | PostgreSQL (Neon serverless) |
| Validation | Zod (shared client + server schemas) |

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.9+ (for BES scraper only)
- A [Neon](https://neon.tech) PostgreSQL database

### Setup

```bash
# Install dependencies
npm install
pip install -r requirements.txt

# Configure database
# Create a .env file with your Neon connection string:
echo "DATABASE_URL=postgresql://user:pass@host/db?sslmode=require" > .env

# Push schema to database
npm run db:push

# Start development server
npm run dev
```

The app runs at `http://localhost:5000`.

### Commands

| Command | Description |
|---|---|
| `npm run dev` | Start dev server (port 5000) |
| `npm run build` | Production build |
| `npm test` | Run 21 unit tests |
| `npm run db:push` | Apply schema changes to database |
| `npm run db:studio` | Open Drizzle Studio (DB GUI) |
| `npm run scrape:tefas` | Refresh BES fund cache |

## Price Data Sources

| Asset Type | Search | Prices | Notes |
|---|---|---|---|
| BIST Stocks | Local JSON list (275 stocks) | Yahoo Finance chart API (`.IS` suffix) | Yahoo search doesn't return Turkish stocks, so search is local |
| US Stocks/ETFs | Yahoo Finance search API | Yahoo Finance chart API | Cookie/crumb authentication |
| Crypto | CoinGecko search | Binance API (USDT pairs) | Falls back to CoinGecko |
| BES Funds | Local cache + TEFAS live | TEFAS API | Python scraper builds local cache |
| Real Estate | Manual entry | Manual | Not auto-updated |
| Exchange Rates | — | Yahoo Finance | USD, EUR, BTC, ETH, XAU → TRY |

---

## Improvements Over Original Codebase

This branch (`improvements/refactor-v1`) addresses 12 issues found during a code audit of the original project. Below is what was found, why it mattered, and what was done.

### 1. BIST Stocks Not Loading (Critical)

**Problem:** Yahoo Finance's search and chart APIs started requiring cookie/crumb authentication. The original code sent bare HTTP requests with only a User-Agent header, so all Turkish stocks (THYAO, GARAN, EREGL, etc.) returned empty results. US stocks also broke for the same reason.

**Why it matters:** The core feature of the app — adding and tracking Turkish stocks — was completely non-functional.

**Fix:** Three-part solution:
- **BIST search** now uses a local JSON file (`server/bist_stocks.json`) with 275 BIST stocks. Search is instant, no API needed. Yahoo's search endpoint simply doesn't return Istanbul-exchange stocks regardless of authentication.
- **BIST prices** come from Yahoo's chart API with `.IS` suffix (e.g., `THYAO.IS`), which works fine with authentication.
- **US/international** stocks use Yahoo's search and chart APIs with proper cookie/crumb session management — fetches cookie from `fc.yahoo.com`, extracts crumb from `/v1/test/getcrumb`, auto-retries on 401/403.

### 2. No Foreign Key Constraints

**Problem:** `transactions.assetId` was a plain `varchar` with no FK reference to `assets.id`. Deleting an asset left orphaned transaction rows in the database.

**Why it matters:** Data integrity — orphaned records accumulate over time and can cause calculation errors in portfolio summaries.

**Fix:** Added `.references(() => assets.id, { onDelete: "cascade" })` on `transactions.assetId` and the new `price_history.assetId`. Added Drizzle `relations()` definitions and database indexes on frequently queried columns.

### 3. Sequential Price Fetching

**Problem:** `updateAllAssetPrices()` fetched each asset's price one-by-one in a `for` loop. With 20+ assets, this could take 30+ seconds.

**Why it matters:** The "Update Prices" button felt unresponsive and could time out.

**Fix:** Built a `withConcurrencyLimit()` worker-pool utility. Prices now fetch 5 in parallel, configurable via `MAX_CONCURRENCY`.

### 4. No React Error Boundaries

**Problem:** Any failed API query or component crash would white-screen the entire app.

**Why it matters:** A single network error could make the whole app unusable.

**Fix:** Added an `ErrorBoundary` component with Turkish UI ("Bir Hata Oluştu"). Top-level boundary wraps the entire app, and each route gets its own boundary so a crash on one page doesn't affect others. Includes collapsible error details and a retry button.

### 5. Fragile BES Scraper

**Problem:** The Selenium-based BES scraper had zero retry logic. One network hiccup and it would fail silently, potentially overwriting the cache with empty data.

**Why it matters:** The BES fund cache is the only way to search pension funds — a failed scrape means no BES search until someone manually re-runs it.

**Fix:** Added 3 retries with 5-second delays, extracted `scrape_attempt()` for clean separation, preserves existing cache file on total failure, graceful fallback if `webdriver-manager` isn't installed.

### 6. No API Rate Limiting

**Problem:** No protection against request spam. Anyone could hammer `POST /api/prices/update` and get the server's IP banned by Yahoo/Binance.

**Why it matters:** External API bans would break prices for all users.

**Fix:** Added an in-memory `RateLimiter` class. General API: 60 requests/minute per IP. Price update endpoint: 3 requests/minute. Returns HTTP 429 with a Turkish error message.

### 7. Hardcoded Price Source Logic

**Problem:** Asset type → data source mapping was buried in `if/else` chains inside `priceService.ts`.

**Why it matters:** Adding a new asset type (e.g., commodities) required editing multiple functions.

**Fix:** Replaced with a `priceFetcherMap: Record<string, PriceFetcher>` strategy pattern. Adding a new asset type is one line.

### 8. No Exchange Rate Caching

**Problem:** Every call to `/api/exchange-rates` or `getPortfolioSummary()` hit Yahoo Finance fresh, even if called seconds apart.

**Why it matters:** Unnecessary API calls slow down page loads and risk rate limiting.

**Fix:** 5-minute in-memory TTL cache on `fetchExchangeRates()`.

### 9. No Historical Price Data

**Problem:** No `price_history` table. The monthly performance chart calculated values from transactions against current prices only — no actual historical snapshots.

**Why it matters:** Performance charts were misleading without real historical data points.

**Fix:** New `price_history` table with daily upsert logic. Snapshots are recorded automatically during price updates. New API endpoint: `GET /api/assets/:assetId/price-history`.

### 10. 27 Unused UI Components + 23 npm Dependencies

**Problem:** The full shadcn/ui library was installed but only ~20 components were actually imported.

**Why it matters:** Codebase noise — 27 files and 23 packages that served no purpose.

**Fix:** Removed all unused component files and their corresponding npm dependencies. Kept `separator`, `sheet`, `skeleton` (used by sidebar).

### 11. Zero Tests

**Problem:** No test files anywhere. Financial calculations (average price, profit/loss) had no safety net.

**Why it matters:** Regressions in money calculations have real consequences.

**Fix:** 21 unit tests covering: weighted average price, profit/loss, portfolio allocation, rate limiter, concurrency limiter, strategy pattern, and currency conversion. Uses Node's built-in `assert` — no test framework dependency. Run with `npm test`.

### 12. `exec()` for Python Scraper

**Problem:** The BES rescrape endpoint used `exec()` with string interpolation to spawn the Python process.

**Why it matters:** Potential shell injection if any user input ever leaked into the command.

**Fix:** Replaced `exec()` with `execFile("python", [scraperPath])`. Arguments are passed as an array, never touching a shell.

## Project Structure

```
FinancePortfolioWeb/
├── client/src/              # React frontend
│   ├── pages/               # Route pages (dashboard, transactions, budget, reports, settings)
│   ├── components/          # UI components + error boundary
│   ├── lib/                 # Query client, currency context
│   └── hooks/               # Custom React hooks
├── server/                  # Express backend
│   ├── index.ts             # App bootstrap
│   ├── routes.ts            # API route definitions
│   ├── storage.ts           # Database access layer (IStorage interface)
│   ├── db.ts                # Neon connection + Drizzle instance
│   ├── services/
│   │   └── priceService.ts  # Price fetching, search, exchange rates
│   ├── bist_stocks.json     # Local BIST stock list (275 stocks)
│   ├── bes_funds.json       # BES fund cache (built by scraper)
│   └── bes_scraper.py       # TEFAS BES fund scraper (Selenium)
├── shared/
│   └── schema.ts            # Drizzle ORM schema + Zod validation
├── tests/
│   └── unit.test.ts         # 21 unit tests
└── requirements.txt         # Python dependencies
```

## License

MIT
