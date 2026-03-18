# Changelog — improvements branch

## Fix #13: BIST Stocks Now Use İş Yatırım (Yahoo Finance was broken)
**Files:** `server/services/priceService.ts`, `server/routes.ts`
**Root cause:** Yahoo Finance's v8/chart and v1/search APIs now require cookie+crumb authentication. The code was sending bare requests with only a User-Agent header → 401/403 for all stocks.
**What changed:**
- **BIST stocks/ETFs**: Switched to İş Yatırım's public JSON API (`isyatirim.com.tr/...Data.aspx/HisseTekil`) — no API key needed, returns TRY prices directly, works for THYAO, GARAN, EREGL, etc.
- **BIST search**: New `searchBISTStocks()` using İş Yatırım's stock list with a 30-minute cache; falls back to a direct price probe for uncached tickers.
- **US/international stocks**: Yahoo Finance now uses proper cookie/crumb session management — fetches cookie from `fc.yahoo.com`, extracts crumb from `/v1/test/getcrumb`, includes both in all requests. Auto-retries with fresh session on 401/403.
- **Unified search**: New `searchStocks(query, market, type)` function dispatches to the right source (İş Yatırım for BIST, Yahoo with auth for US, CoinGecko for crypto). The routes.ts stock search endpoint now calls this single function.
- **Strategy pattern updated**: `hisse` and `etf` fetchers now branch on market — `BIST → fetchIsyatirimPrice()`, everything else → `fetchYahooPrice()` with auth.

> **No migration needed** — this is a pure logic change in the price service layer.

## Fix #2: Foreign Key Constraints + Cascade Deletes
**Files:** `shared/schema.ts`
- Added `.references(() => assets.id, { onDelete: "cascade" })` to `transactions.assetId`
- Added Drizzle `relations()` definitions for `assets ↔ transactions` and `assets ↔ priceHistory`
- Added DB indexes on `transactions.asset_id`, `transactions.date`, and `price_history(asset_id, snapshot_date)`
- Deleting an asset now automatically cascades to its transactions and price history

> **Migration required:** Run `npm run db:push` after deploying to apply the FK constraints and new table.

## Fix #3: Concurrent Price Fetching
**Files:** `server/services/priceService.ts`
- Replaced sequential `for` loop with a `withConcurrencyLimit()` utility
- Fetches up to 5 asset prices in parallel (configurable `MAX_CONCURRENCY`)
- Uses a worker-pool pattern so API rate limits are respected

## Fix #4: React Error Boundaries
**Files:** `client/src/components/error-boundary.tsx`, `client/src/App.tsx`
- Added `ErrorBoundary` class component with Turkish UI messaging
- Top-level boundary wraps the entire app (catches provider failures)
- Per-page boundaries wrap each route (isolates page-level crashes)
- Shows error details in a collapsible section + "Tekrar Dene" reset button

## Fix #5: BES Scraper Retry Logic
**Files:** `server/bes_scraper.py`
- Added `MAX_RETRIES = 3` with `RETRY_DELAY_SECONDS = 5` between attempts
- Extracted `scrape_attempt()` from main flow for clean retry logic
- On total failure, preserves existing cache file instead of overwriting
- Graceful fallback if `webdriver-manager` isn't installed (tries system chromedriver)
- Better error reporting with `traceback.print_exc()`

## Fix #6: API Rate Limiting
**Files:** `server/routes.ts`
- Added `RateLimiter` class (in-memory, per-IP, sliding window)
- General API: 60 requests/minute per IP on all `/api/*` routes
- Price update: 3 requests/minute on `POST /api/prices/update` (prevents upstream API bans)
- Returns HTTP 429 with Turkish error message when limit exceeded

## Fix #7: Strategy Pattern for Price Sources
**Files:** `server/services/priceService.ts`
- Replaced `if/else` chain with `priceFetcherMap: Record<string, PriceFetcher>`
- Each asset type maps to a typed function: `kripto→Binance`, `hisse/etf→Yahoo`, `bes→TEFAS`, `gayrimenkul→manual`
- `getPriceFetcher(type)` returns `undefined` for unknown types (safe)
- Easy to add new asset types: just add one line to the map

## Fix #8: Exchange Rate Caching
**Files:** `server/services/priceService.ts`
- Added 5-minute in-memory cache (`EXCHANGE_RATE_CACHE_TTL_MS`)
- `fetchExchangeRates()` returns cached rates if within TTL
- Prevents redundant external API calls when multiple components request rates

## Fix #9: Price History Table + API
**Files:** `shared/schema.ts`, `server/storage.ts`, `server/routes.ts`, `server/services/priceService.ts`
- New `price_history` table: `(id, asset_id FK, price, currency, snapshot_date)`
- `recordPriceSnapshot()` — upsert: one snapshot per asset per day
- `getPriceHistory(assetId, startDate?, endDate?)` — query historical data
- `GET /api/assets/:assetId/price-history?startDate=&endDate=` — new API endpoint
- Price snapshots recorded automatically during `updateAllAssetPrices()`

## Fix #10: Removed 27 Unused UI Components + 23 Dependencies
**Files:** `client/src/components/ui/*`, `package.json`
- Removed 27 unused shadcn/ui component files (accordion, alert, avatar, calendar, carousel, chart, etc.)
- Kept `separator.tsx`, `sheet.tsx`, `skeleton.tsx` (used by sidebar)
- Removed 23 corresponding npm dependencies (all `@radix-ui/*` for removed components, `cmdk`, `embla-carousel-react`, `input-otp`, `react-day-picker`, `react-resizable-panels`, `vaul`)

## Fix #11: Unit Test Suite
**Files:** `tests/unit.test.ts`, `package.json`
- 21 tests covering: average price calculations, profit/loss, portfolio allocation, rate limiter, price strategy pattern, currency conversion, concurrency limiter
- Uses Node's built-in `assert` module — zero test framework dependencies
- Run with `npm test` (added to package.json scripts)

## Fix #12: Secure Subprocess Execution
**Files:** `server/routes.ts`
- Replaced `exec()` with `execFile()` for the BES scraper endpoint
- `execFile("python", [scraperPath])` prevents shell injection attacks
- No user input can leak into a shell command
