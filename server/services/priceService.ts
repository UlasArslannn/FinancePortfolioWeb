import { storage } from "../storage";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname2 = dirname(fileURLToPath(import.meta.url));
const FUNDS_JSON_PATH = join(__dirname2, "..", "bes_funds.json");
const BIST_STOCKS_PATH = join(__dirname2, "..", "bist_stocks.json");

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface BinancePriceResponse { symbol: string; price: string; }

interface YahooChartResponse {
  chart: {
    result: Array<{ meta: { regularMarketPrice: number; previousClose: number; shortName?: string; longName?: string; }; }>;
    error: null | { code: string; description: string };
  };
}

export interface PriceUpdateResult {
  assetId: string; symbol: string; oldPrice: number;
  newPrice: number | null; success: boolean; error?: string;
}

interface BesFund { symbol: string; name: string; price: number; }

export interface StockSearchResult { symbol: string; name: string; exchange: string; }

// ═══════════════════════════════════════════════════════════════════════════════
// YAHOO FINANCE — Cookie/Crumb Session
// ═══════════════════════════════════════════════════════════════════════════════

let yahooSession: { cookie: string; crumb: string; timestamp: number; } | null = null;
const YAHOO_SESSION_TTL_MS = 30 * 60 * 1000;

async function getYahooSession(): Promise<{ cookie: string; crumb: string } | null> {
  if (yahooSession && Date.now() - yahooSession.timestamp < YAHOO_SESSION_TTL_MS) {
    return yahooSession;
  }
  try {
    const cookieResponse = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": BROWSER_UA }, redirect: "manual",
    });
    const setCookieHeaders = cookieResponse.headers.getSetCookie?.()
      ?? [cookieResponse.headers.get("set-cookie") || ""];
    const cookies = setCookieHeaders
      .flatMap((h: string) => h.split(","))
      .map((c: string) => c.split(";")[0].trim())
      .filter(Boolean).join("; ");
    if (!cookies) { console.log("[Yahoo] No cookies from fc.yahoo.com"); return null; }

    const crumbResponse = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": BROWSER_UA, Cookie: cookies },
    });
    if (!crumbResponse.ok) { console.log(`[Yahoo] Crumb failed: ${crumbResponse.status}`); return null; }
    const crumb = await crumbResponse.text();
    if (!crumb || crumb.includes("Too Many") || crumb.includes("<!")) {
      console.log(`[Yahoo] Bad crumb: ${crumb.substring(0, 50)}`); return null;
    }
    yahooSession = { cookie: cookies, crumb, timestamp: Date.now() };
    console.log(`[Yahoo] Session ready`);
    return yahooSession;
  } catch (error) {
    console.error("[Yahoo] Session init failed:", error); return null;
  }
}

function invalidateYahooSession() { yahooSession = null; }

// Helper: make an authenticated Yahoo request
async function yahooFetch(url: string): Promise<Response | null> {
  const session = await getYahooSession();
  const separator = url.includes("?") ? "&" : "?";
  const fullUrl = session ? `${url}${separator}crumb=${encodeURIComponent(session.crumb)}` : url;
  const headers: Record<string, string> = { "User-Agent": BROWSER_UA };
  if (session) headers["Cookie"] = session.cookie;

  let response = await fetch(fullUrl, { headers });

  // Retry on auth failure
  if (response.status === 401 || response.status === 403) {
    console.log(`[Yahoo] Auth failed (${response.status}), refreshing...`);
    invalidateYahooSession();
    const newSession = await getYahooSession();
    if (!newSession) return null;
    const retryUrl = session
      ? url.replace(new RegExp(`crumb=[^&]*`), "") + `${separator}crumb=${encodeURIComponent(newSession.crumb)}`
      : `${url}${separator}crumb=${encodeURIComponent(newSession.crumb)}`;
    response = await fetch(retryUrl, {
      headers: { "User-Agent": BROWSER_UA, Cookie: newSession.cookie },
    });
  }

  return response.ok ? response : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// YAHOO — Price Fetching
// ═══════════════════════════════════════════════════════════════════════════════

export async function fetchYahooPrice(symbol: string, market: string): Promise<number | null> {
  try {
    let yahooSymbol = symbol;
    if (market === "BIST") yahooSymbol = symbol.toUpperCase() + ".IS";
    else if (market === "US") yahooSymbol = symbol.toUpperCase();

    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`;
    console.log(`[Yahoo price] ${yahooSymbol}...`);
    const response = await yahooFetch(url);
    if (!response) { console.log(`[Yahoo price] No response for ${yahooSymbol}`); return null; }

    const data: YahooChartResponse = await response.json();
    if (data.chart.error) { console.log(`[Yahoo price] Error for ${yahooSymbol}: ${data.chart.error.description}`); return null; }
    const result = data.chart.result?.[0];
    if (!result?.meta?.regularMarketPrice) { console.log(`[Yahoo price] No data for ${yahooSymbol}`); return null; }
    console.log(`[Yahoo price] ${yahooSymbol} = ${result.meta.regularMarketPrice}`);
    return result.meta.regularMarketPrice;
  } catch (error) {
    console.error(`[Yahoo price] Failed for ${symbol}:`, error); return null;
  }
}

/**
 * Probe a Yahoo symbol via the chart endpoint. Returns name + price if valid.
 * Used as search fallback — if user types "THYAO" and search returns nothing,
 * we try the chart for THYAO.IS directly.
 */
async function probeYahooSymbol(yahooSymbol: string): Promise<{ name: string; price: number } | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`;
    const response = await yahooFetch(url);
    if (!response) return null;
    const data: YahooChartResponse = await response.json();
    const result = data.chart.result?.[0];
    if (!result?.meta?.regularMarketPrice) return null;
    return {
      name: result.meta.shortName || result.meta.longName || yahooSymbol,
      price: result.meta.regularMarketPrice,
    };
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BIST — Local Stock List Search (Yahoo search doesn't return Turkish stocks)
// Yahoo chart API works fine for prices via .IS suffix — only search is broken.
// ═══════════════════════════════════════════════════════════════════════════════

interface BistStock { symbol: string; name: string; price?: number; type?: "stock" | "etf"; }
let bistStockList: BistStock[] = [];

export function loadBistStocksFromFile(): number {
  try {
    const raw = readFileSync(BIST_STOCKS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.stocks)) {
      bistStockList = parsed.stocks;
      console.log(`[BIST] Loaded ${bistStockList.length} stocks from bist_stocks.json`);
      return bistStockList.length;
    }
  } catch {
    console.log("[BIST] bist_stocks.json not found");
  }
  return 0;
}

/** bist_stocks.json'da fiyat varsa döndürür (bist_scraper.py tarafından doldurulur) */
export function getBistCachedPrice(symbol: string): number | null {
  const s = bistStockList.find((x) => x.symbol.toUpperCase() === symbol.toUpperCase());
  return s?.price && s.price > 0 ? s.price : null;
}

export function searchBISTLocal(query: string, assetType?: string): StockSearchResult[] {
  const q = query.toUpperCase().trim();
  if (!q) return [];

  // "etf" tipinde arama → sadece ETF/GYO kayıtları
  // "hisse" tipinde arama → sadece stock kayıtları
  // type belirtilmemişse → hepsi
  const typeFilter =
    assetType === "etf" ? "etf" :
    assetType === "hisse" ? "stock" :
    undefined;

  return bistStockList
    .filter((s) => {
      if (typeFilter && s.type && s.type !== typeFilter) return false;
      const sym = s.symbol.toUpperCase();
      const name = s.name.toUpperCase();
      return sym.startsWith(q) || sym.includes(q) || name.includes(q);
    })
    .slice(0, 15)
    .map((s) => ({ symbol: s.symbol, name: s.name, exchange: "BIST" }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// YAHOO — Stock Search (for US/international only)
// ═══════════════════════════════════════════════════════════════════════════════

export async function searchYahooStocks(query: string, market: string): Promise<StockSearchResult[]> {
  try {
    const searchQuery = query.toUpperCase();
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(searchQuery)}&quotesCount=30&newsCount=0&listsCount=0`;

    console.log(`[Yahoo search] query="${searchQuery}" market=${market}`);
    const response = await yahooFetch(url);
    if (!response) return [];

    const data = await response.json();
    const quotes: any[] = data.quotes || [];
    const US_EXCHANGES = ["NYQ", "NMS", "NGM", "NCM", "ASE", "PCX", "BTS"];

    return quotes
      .filter((q: any) => {
        if (market === "US") return US_EXCHANGES.includes(q.exchange);
        return true;
      })
      .slice(0, 15)
      .map((q: any) => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        exchange: q.exchDisp || q.exchange || "",
      }));
  } catch (error) {
    console.error("[Yahoo search] Failed:", error); return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BINANCE — Crypto
// ═══════════════════════════════════════════════════════════════════════════════

export async function fetchBinancePrice(symbol: string): Promise<number | null> {
  try {
    const binanceSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "") + "USDT";
    const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`);
    if (!response.ok) { console.log(`[Binance] HTTP ${response.status} for ${symbol}`); return null; }
    const data: BinancePriceResponse = await response.json();
    return parseFloat(data.price);
  } catch (error) { console.error(`[Binance] Failed for ${symbol}:`, error); return null; }
}

async function fetchCoinGeckoPrice(coinId: string): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
      { headers: { Accept: "application/json" } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data[coinId]?.usd || null;
  } catch (error) { console.error(`[CoinGecko] Failed for ${coinId}:`, error); return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Strategy Pattern
// ═══════════════════════════════════════════════════════════════════════════════

type PriceFetcher = (symbol: string, market: string) => Promise<number | null>;

const priceFetcherMap: Record<string, PriceFetcher> = {
  kripto: async (symbol) => fetchBinancePrice(symbol),
  hisse: async (symbol, market) => {
    if (market === "BIST") {
      // TradingView cache'i önce dene (bist_scraper.py tarafından güncellenir)
      const cached = getBistCachedPrice(symbol);
      if (cached) return cached;
      return fetchYahooPrice(symbol, market);
    }
    return fetchYahooPrice(symbol, market);
  },
  etf: async (symbol, market) => fetchYahooPrice(symbol, market),
  bes: async (symbol) => fetchTEFASPrice(symbol),
  gayrimenkul: async () => null,
};

export function getPriceFetcher(assetType: string): PriceFetcher | undefined {
  return priceFetcherMap[assetType];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Unified Stock Search
// ═══════════════════════════════════════════════════════════════════════════════

export async function searchStocks(query: string, market: string, type: string): Promise<StockSearchResult[]> {
  if (type === "kripto") {
    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
        { headers: { "User-Agent": BROWSER_UA } }
      );
      if (response.ok) {
        const data = await response.json();
        return (data.coins || []).slice(0, 10).map((coin: any) => ({
          symbol: coin.symbol?.toUpperCase(), name: coin.name, exchange: "Crypto",
        }));
      }
    } catch (err) { console.error("[CoinGecko search] Failed:", err); }
    return [];
  }

  // BIST: local stock list (Yahoo search doesn't return Turkish stocks)
  if (market === "BIST") {
    const results = searchBISTLocal(query, type);
    console.log(`[BIST search] "${query}" type=${type} → ${results.length} results`);
    return results;
  }

  // US/international: Yahoo search with auth
  return await searchYahooStocks(query, market);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exchange Rates (5-min cache)
// ═══════════════════════════════════════════════════════════════════════════════

const EXCHANGE_RATE_CACHE_TTL_MS = 5 * 60 * 1000;
let exchangeRateCache: { rates: Record<string, number>; timestamp: number } | null = null;

export async function fetchExchangeRates(): Promise<Record<string, number>> {
  if (exchangeRateCache && Date.now() - exchangeRateCache.timestamp < EXCHANGE_RATE_CACHE_TTL_MS) {
    return exchangeRateCache.rates;
  }
  const rates: Record<string, number> = { TRY: 1 };
  const usdTry = await fetchYahooPrice("USDTRY=X", "Diğer");
  if (usdTry) rates.USD = usdTry;
  const eurTry = await fetchYahooPrice("EURTRY=X", "Diğer");
  if (eurTry) rates.EUR = eurTry;
  let btcUsd = await fetchBinancePrice("BTC");
  if (!btcUsd) btcUsd = await fetchCoinGeckoPrice("bitcoin");
  if (btcUsd && usdTry) rates.BTC = btcUsd * usdTry;
  let ethUsd = await fetchBinancePrice("ETH");
  if (!ethUsd) ethUsd = await fetchCoinGeckoPrice("ethereum");
  if (ethUsd && usdTry) rates.ETH = ethUsd * usdTry;
  const goldOzUsd = await fetchYahooPrice("GC=F", "Diğer");
  if (goldOzUsd && usdTry) rates.XAU = (goldOzUsd / 31.1035) * usdTry;
  exchangeRateCache = { rates, timestamp: Date.now() };
  return rates;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Concurrent Price Update
// ═══════════════════════════════════════════════════════════════════════════════

async function withConcurrencyLimit<T>(tasks: (() => Promise<T>)[], maxConcurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;
  async function worker() { while (index < tasks.length) { const i = index++; results[i] = await tasks[i](); } }
  await Promise.allSettled(Array.from({ length: Math.min(maxConcurrency, tasks.length) }, () => worker()));
  return results;
}

export async function updateAllAssetPrices(): Promise<PriceUpdateResult[]> {
  const assets = await storage.getAssets();

  const makeTask = (asset: (typeof assets)[0]) => async (): Promise<PriceUpdateResult> => {
    const oldPrice = Number(asset.currentPrice) || 0;
    let newPrice: number | null = null;
    let error: string | undefined;
    try {
      const fetcher = getPriceFetcher(asset.type);
      if (!fetcher || asset.type === "gayrimenkul") { newPrice = oldPrice; }
      else { newPrice = await fetcher(asset.symbol, asset.market); }
      if (newPrice !== null && newPrice > 0) {
        await storage.updateAsset(asset.id, { currentPrice: newPrice.toFixed(6) });
      }
    } catch (e) { error = e instanceof Error ? e.message : "Unknown error"; }
    return { assetId: asset.id, symbol: asset.symbol, oldPrice, newPrice, success: newPrice !== null && newPrice > 0, error };
  };

  const besAssets = assets.filter((a) => a.type === "bes");
  const otherAssets = assets.filter((a) => a.type !== "bes");

  // BES dışındakiler paralel (max 5)
  const otherResults = await withConcurrencyLimit(otherAssets.map(makeTask), 5);

  // BES: sıralı + 700ms ara (TEFAS rate limit koruması)
  // fetchTEFASPrice içinde JSON otomatik güncelleniyor
  const besResults: PriceUpdateResult[] = [];
  for (const asset of besAssets) {
    if (besResults.length > 0) await new Promise((r) => setTimeout(r, 700));
    besResults.push(await makeTask(asset)());
  }

  return [...otherResults, ...besResults];
}

export async function fetchSingleAssetPrice(symbol: string, type: string, market: string): Promise<number | null> {
  const fetcher = getPriceFetcher(type);
  return fetcher ? await fetcher(symbol, market) : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEFAS — BES
// ═══════════════════════════════════════════════════════════════════════════════

const TEFAS_UA = BROWSER_UA;
let tefasSession: { cookie: string; viewState: string; eventValidation: string; time: number; } | null = null;

async function getTefasSession() {
  if (tefasSession && Date.now() - tefasSession.time < 60 * 60 * 1000) return tefasSession;
  try {
    const r = await fetch("https://www.tefas.gov.tr/TarihselVeriler.aspx", {
      headers: { "User-Agent": TEFAS_UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "tr-TR,tr;q=0.9" },
    });
    const html = await r.text();
    const setCookie = r.headers.get("set-cookie") || "";
    const cookie = setCookie.split(",").map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
    tefasSession = {
      cookie,
      viewState: html.match(/id="__VIEWSTATE"\s+value="([^"]+)"/)?.[1] ?? "",
      eventValidation: html.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/)?.[1] ?? "",
      time: Date.now(),
    };
  } catch (e) {
    console.error("[TEFAS] Session failed:", e);
    tefasSession = { cookie: "", viewState: "", eventValidation: "", time: Date.now() };
  }
  return tefasSession!;
}

async function tefasPost(endpoint: string, params: Record<string, string>): Promise<any> {
  const session = await getTefasSession();
  const body = new URLSearchParams({
    ...params,
    ...(session.viewState ? { __VIEWSTATE: session.viewState } : {}),
    ...(session.eventValidation ? { __EVENTVALIDATION: session.eventValidation } : {}),
  });
  const response = await fetch(`https://www.tefas.gov.tr/api/DB/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Origin: "https://www.tefas.gov.tr",
      Referer: "https://www.tefas.gov.tr/TarihselVeriler.aspx",
      "User-Agent": TEFAS_UA, "Accept-Language": "tr-TR,tr;q=0.9",
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    },
    body: body.toString(),
  });
  if (!response.ok) throw new Error(`TEFAS HTTP ${response.status}`);
  const text = await response.text();
  if (!text || text.trim() === "") throw new Error("TEFAS empty body");
  return JSON.parse(text);
}

function tefasDateStr(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

export async function fetchTEFASPrice(fundCode: string): Promise<number | null> {
  try {
    const url = `https://www.tefas.gov.tr/FonAnaliz.aspx?FonKod=${encodeURIComponent(fundCode.toUpperCase())}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9",
      },
    });
    if (!response.ok) { console.error(`[TEFAS] HTTP ${response.status} for ${fundCode}`); return null; }
    const html = await response.text();
    // div.main-indicators > ul.top-list > li:first-child > span içindeki fiyat
    // Format: "0,140154" (Türkçe ondalık)
    const match = html.match(/class="top-list"[\s\S]*?<span[^>]*>(\d+,\d+)<\/span>/);
    if (match) {
      const price = parseFloat(match[1].replace(",", "."));
      if (price > 0) {
        console.log(`[TEFAS] ${fundCode} = ${price}`);
        // Memory cache ve JSON dosyasını güncelle
        const entry = besFundLocalCache.find((f) => f.symbol.toUpperCase() === fundCode.toUpperCase());
        if (entry) {
          entry.price = price;
          try {
            writeFileSync(FUNDS_JSON_PATH, JSON.stringify({ lastUpdated: new Date().toISOString(), funds: besFundLocalCache }, null, 2), "utf-8");
          } catch (e) { console.warn("[TEFAS] JSON kaydetme hatası:", e); }
        }
        return price;
      }
    }
    console.warn(`[TEFAS] Fiyat bulunamadı: ${fundCode}`);
    return null;
  } catch (error) { console.error(`[TEFAS] Failed for ${fundCode}:`, error); return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BES Fund Cache
// ═══════════════════════════════════════════════════════════════════════════════

let besFundLocalCache: BesFund[] = [];
let besCacheLastUpdated: string | null = null;

export function loadBesFundsFromFile(): { count: number; lastUpdated: string | null } {
  try {
    const raw = readFileSync(FUNDS_JSON_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.funds) && parsed.funds.length > 0) {
      besFundLocalCache = parsed.funds;
      besCacheLastUpdated = parsed.lastUpdated ?? null;
      console.log(`[BES cache] Loaded ${besFundLocalCache.length} funds`);
      return { count: besFundLocalCache.length, lastUpdated: besCacheLastUpdated };
    }
  } catch { console.log("[BES cache] bes_funds.json not found"); }
  return { count: 0, lastUpdated: null };
}

export function getBesCacheInfo() {
  return { count: besFundLocalCache.length, lastUpdated: besCacheLastUpdated };
}

export async function searchBESFunds(query: string): Promise<BesFund[]> {
  const q = query.toUpperCase().trim();
  if (!q) return [];
  if (besFundLocalCache.length > 0) {
    const hits = besFundLocalCache.filter((f) => f.symbol.toUpperCase().startsWith(q) || f.name.toUpperCase().includes(q));
    if (hits.length > 0) return hits.slice(0, 12);
  }
  const lastBizDay = new Date();
  const dow = lastBizDay.getDay();
  if (dow === 0) lastBizDay.setDate(lastBizDay.getDate() - 2);
  else if (dow === 6) lastBizDay.setDate(lastBizDay.getDate() - 1);
  try {
    const data = await tefasPost("BindFundInfo", { fontip: "EMK", fonkod: q, bastarih: tefasDateStr(lastBizDay), bittarih: tefasDateStr(lastBizDay), fonstatus: "ACTIVE" });
    if (data.data?.length) return data.data.slice(0, 12).map((f: any) => ({ symbol: f.FONKODU, name: f.FONUNVAN, price: Number(f.FIYAT) || 0 }));
  } catch (err) { console.error("[BES search] error:", err); }
  return [];
}

// ═══════════════════════════════════════════════════════════════════════════════
// BES Fund Cache Rebuild — TEFAS API üzerinden temiz UTF-8 isimlerle yeniden inşa
// ═══════════════════════════════════════════════════════════════════════════════

export async function rebuildBesFundCache(): Promise<number> {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  const seen = new Set<string>();
  const funds: BesFund[] = [];

  // Her harf için TEFAS'a sorgula — tüm aktif EMK fonlarını kapsar
  const letters = "ABCDEFGHIJKLMNOPRSTUVYZ";
  for (const letter of letters) {
    try {
      const data = await tefasPost("BindFundInfo", {
        fontip: "EMK", fonkod: letter,
        bastarih: tefasDateStr(weekAgo), bittarih: tefasDateStr(today), fonstatus: "ACTIVE",
      });
      if (data.data?.length) {
        for (const f of data.data) {
          if (f.FONKODU && !seen.has(f.FONKODU)) {
            seen.add(f.FONKODU);
            funds.push({ symbol: f.FONKODU, name: f.FONUNVAN ?? f.FONKODU, price: Number(f.FIYAT) || 0 });
          }
        }
      }
    } catch (err) {
      console.warn(`[BES rebuild] letter ${letter} failed:`, err);
    }
  }

  if (funds.length === 0) {
    console.warn("[BES rebuild] No funds fetched, keeping existing cache");
    return besFundLocalCache.length;
  }

  funds.sort((a, b) => a.symbol.localeCompare(b.symbol));
  const output = { lastUpdated: new Date().toISOString(), funds };
  writeFileSync(FUNDS_JSON_PATH, JSON.stringify(output, null, 2), "utf-8");
  besFundLocalCache = funds;
  besCacheLastUpdated = output.lastUpdated;
  console.log(`[BES rebuild] ${funds.length} fon kaydedildi`);
  return funds.length;
}
