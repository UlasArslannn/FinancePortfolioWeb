import { storage } from "../storage";

interface BinancePriceResponse {
  symbol: string;
  price: string;
}

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: {
        regularMarketPrice: number;
        previousClose: number;
      };
    }>;
    error: null | { code: string; description: string };
  };
}

export async function fetchBinancePrice(symbol: string): Promise<number | null> {
  try {
    // Preserve alphanumeric characters for Binance symbols (e.g., 1INCH, SHIB1000)
    const binanceSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "") + "USDT";
    const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`);
    
    if (!response.ok) {
      console.log(`Binance API error for ${symbol}: ${response.status}`);
      return null;
    }
    
    const data: BinancePriceResponse = await response.json();
    return parseFloat(data.price);
  } catch (error) {
    console.error(`Failed to fetch Binance price for ${symbol}:`, error);
    return null;
  }
}

export async function fetchYahooPrice(symbol: string, market: string): Promise<number | null> {
  try {
    let yahooSymbol = symbol;
    
    if (market === "BIST") {
      yahooSymbol = symbol.toUpperCase() + ".IS";
    } else if (market === "US") {
      yahooSymbol = symbol.toUpperCase();
    }
    
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    );
    
    if (!response.ok) {
      console.log(`Yahoo Finance API error for ${symbol}: ${response.status}`);
      return null;
    }
    
    const data: YahooChartResponse = await response.json();
    
    if (data.chart.error) {
      console.log(`Yahoo Finance error for ${symbol}:`, data.chart.error.description);
      return null;
    }
    
    const result = data.chart.result?.[0];
    if (!result?.meta?.regularMarketPrice) {
      console.log(`No price data for ${symbol}`);
      return null;
    }
    
    return result.meta.regularMarketPrice;
  } catch (error) {
    console.error(`Failed to fetch Yahoo price for ${symbol}:`, error);
    return null;
  }
}

export interface PriceUpdateResult {
  assetId: string;
  symbol: string;
  oldPrice: number;
  newPrice: number | null;
  success: boolean;
  error?: string;
}

export async function updateAllAssetPrices(): Promise<PriceUpdateResult[]> {
  const assets = await storage.getAssets();
  const results: PriceUpdateResult[] = [];
  
  for (const asset of assets) {
    const oldPrice = Number(asset.currentPrice) || 0;
    let newPrice: number | null = null;
    let error: string | undefined;
    
    try {
      if (asset.type === "kripto") {
        newPrice = await fetchBinancePrice(asset.symbol);
      } else if (asset.type === "hisse" || asset.type === "etf") {
        newPrice = await fetchYahooPrice(asset.symbol, asset.market);
      } else if (asset.type === "bes") {
        const cached = besFundLocalCache.find(
          (f) => f.symbol.toUpperCase() === asset.symbol.toUpperCase()
        );
        newPrice = (cached && cached.price > 0) ? cached.price : await fetchTEFASPrice(asset.symbol);
      } else if (asset.type === "gayrimenkul") {
        newPrice = oldPrice;
      }
      
      if (newPrice !== null && newPrice > 0) {
        await storage.updateAsset(asset.id, {
          currentPrice: newPrice.toFixed(2),
        });
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Unknown error";
      console.error(`Error updating price for ${asset.symbol}:`, error);
    }
    
    results.push({
      assetId: asset.id,
      symbol: asset.symbol,
      oldPrice,
      newPrice,
      success: newPrice !== null && newPrice > 0,
      error,
    });
  }
  
  return results;
}

const TEFAS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// Cache session state (cookie + ASP.NET ViewState) so we only fetch the page once per hour
let tefasSession: { cookie: string; viewState: string; eventValidation: string; time: number } | null = null;

async function getTefasSession() {
  if (tefasSession && Date.now() - tefasSession.time < 60 * 60 * 1000) return tefasSession;
  try {
    const r = await fetch("https://www.tefas.gov.tr/TarihselVeriler.aspx", {
      headers: {
        "User-Agent": TEFAS_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9",
      },
    });
    const html = await r.text();
    const setCookie = r.headers.get("set-cookie") || "";
    const cookie = setCookie.split(",").map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
    const viewStateMatch = html.match(/id="__VIEWSTATE"\s+value="([^"]+)"/);
    const eventValMatch  = html.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/);
    tefasSession = {
      cookie,
      viewState:       viewStateMatch?.[1] ?? "",
      eventValidation: eventValMatch?.[1]  ?? "",
      time: Date.now(),
    };
    console.log(`[TEFAS] Session ready. ViewState: ${tefasSession.viewState ? "found" : "missing"} | Cookie: ${cookie.substring(0, 50)}`);
  } catch (e) {
    console.error("[TEFAS] Failed to get session:", e);
    tefasSession = { cookie: "", viewState: "", eventValidation: "", time: Date.now() };
  }
  return tefasSession!;
}

async function tefasPost(endpoint: string, params: Record<string, string>): Promise<any> {
  const session = await getTefasSession();
  const body = new URLSearchParams({
    ...params,
    ...(session.viewState       ? { __VIEWSTATE:       session.viewState }       : {}),
    ...(session.eventValidation ? { __EVENTVALIDATION: session.eventValidation } : {}),
  });
  const response = await fetch(`https://www.tefas.gov.tr/api/DB/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Origin": "https://www.tefas.gov.tr",
      "Referer": "https://www.tefas.gov.tr/TarihselVeriler.aspx",
      "User-Agent": TEFAS_UA,
      "Accept-Language": "tr-TR,tr;q=0.9",
      ...(session.cookie ? { "Cookie": session.cookie } : {}),
    },
    body: body.toString(),
  });
  if (!response.ok) throw new Error(`TEFAS HTTP ${response.status}`);
  const text = await response.text();
  if (!text || text.trim() === "") throw new Error("TEFAS returned empty body");
  return JSON.parse(text);
}

const TEFAS_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  "Accept": "application/json, text/javascript, */*; q=0.01",
  "Origin": "https://www.tefas.gov.tr",
  "Referer": "https://www.tefas.gov.tr/TarihselVeriler.aspx",
  "User-Agent": TEFAS_UA,
};

function tefasDateStr(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

// Fetch current NAV for a specific BES fund via BindFundReturn
export async function fetchTEFASPrice(fundCode: string): Promise<number | null> {
  try {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 10);

    // Try BindFundReturn first
    try {
      const data = await tefasPost("BindFundReturn", {
        fontip: "EMK",
        sfonkod: fundCode.toUpperCase(),
        bastarih: tefasDateStr(weekAgo),
        bittarih: tefasDateStr(today),
        fonturkodu: "",
      });
      if (data.data?.length) {
        const sorted = [...data.data].sort((a: any, b: any) =>
          new Date(b.TARIH).getTime() - new Date(a.TARIH).getTime()
        );
        const price = Number(sorted[0].FIYAT);
        if (price > 0) return price;
      }
    } catch { /* fall through to next method */ }

    // Fallback: BindFundInfo with specific fund code
    const data2 = await tefasPost("BindFundInfo", {
      fontip: "EMK",
      fonkod: fundCode.toUpperCase(),
      bastarih: tefasDateStr(weekAgo),
      bittarih: tefasDateStr(today),
      fonstatus: "ACTIVE",
    });
    if (data2.data?.length) {
      return Number(data2.data[0].FIYAT) || null;
    }

    return null;
  } catch (error) {
    console.error(`Failed to fetch TEFAS price for ${fundCode}:`, error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// BES fund local cache (populated from tefas_funds.json scraped by Python)
// ---------------------------------------------------------------------------
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname2 = dirname(fileURLToPath(import.meta.url));
const FUNDS_JSON_PATH = join(__dirname2, "..", "bes_funds.json");

interface BesFund { symbol: string; name: string; price: number; }

let besFundLocalCache: BesFund[] = [];
let besCacheLastUpdated: string | null = null;

export function loadBesFundsFromFile(): { count: number; lastUpdated: string | null } {
  try {
    const raw = readFileSync(FUNDS_JSON_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.funds) && parsed.funds.length > 0) {
      besFundLocalCache = parsed.funds;
      besCacheLastUpdated = parsed.lastUpdated ?? null;
      console.log(`[BES cache] Loaded ${besFundLocalCache.length} funds from tefas_funds.json (updated: ${besCacheLastUpdated})`);
      return { count: besFundLocalCache.length, lastUpdated: besCacheLastUpdated };
    }
  } catch {
    console.log("[BES cache] tefas_funds.json not found or invalid — run 'npm run scrape:tefas' to build the cache");
  }
  return { count: 0, lastUpdated: null };
}

export function getBesCacheInfo(): { count: number; lastUpdated: string | null } {
  return { count: besFundLocalCache.length, lastUpdated: besCacheLastUpdated };
}

export async function searchBESFunds(query: string): Promise<BesFund[]> {
  const upperQuery = query.toUpperCase().trim();
  if (!upperQuery) return [];

  // If local cache is populated, search there first (fast, no network)
  if (besFundLocalCache.length > 0) {
    const hits = besFundLocalCache.filter(
      (f) =>
        f.symbol.toUpperCase().startsWith(upperQuery) ||
        f.name.toUpperCase().includes(upperQuery)
    );
    console.log(`[BES search] cache hit "${upperQuery}" → ${hits.length} results`);
    if (hits.length > 0) return hits.slice(0, 12);
  }

  // Fallback: live TEFAS query (used when cache is empty or no cache match)
  console.log(`[BES search] cache miss for "${upperQuery}", trying live TEFAS...`);
  const lastBizDay = new Date();
  const dow = lastBizDay.getDay();
  if (dow === 0) lastBizDay.setDate(lastBizDay.getDate() - 2);
  else if (dow === 6) lastBizDay.setDate(lastBizDay.getDate() - 1);
  const dateStr = tefasDateStr(lastBizDay);

  try {
    const data = await tefasPost("BindFundInfo", {
      fontip: "EMK",
      fonkod: upperQuery,
      bastarih: dateStr,
      bittarih: dateStr,
      fonstatus: "ACTIVE",
    });
    console.log(`[BES search] live "${upperQuery}" → ${data.data?.length ?? 0} results`);
    if (data.data?.length) {
      return data.data.slice(0, 12).map((f: any) => ({
        symbol: f.FONKODU,
        name: f.FONUNVAN,
        price: Number(f.FIYAT) || 0,
      }));
    }
  } catch (err) {
    console.error("[BES search] tefasPost error:", err);
  }

  return [];
}

export async function fetchSingleAssetPrice(
  symbol: string,
  type: string,
  market: string
): Promise<number | null> {
  if (type === "kripto") {
    return await fetchBinancePrice(symbol);
  } else if (type === "hisse" || type === "etf") {
    return await fetchYahooPrice(symbol, market);
  } else if (type === "bes") {
    const cached = besFundLocalCache.find(
      (f) => f.symbol.toUpperCase() === symbol.toUpperCase()
    );
    if (cached && cached.price > 0) return cached.price;
    return await fetchTEFASPrice(symbol);
  }
  return null;
}

async function fetchCoinGeckoPrice(coinId: string): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
      {
        headers: {
          "Accept": "application/json",
        },
      }
    );
    
    if (!response.ok) {
      console.log(`CoinGecko API error for ${coinId}: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    return data[coinId]?.usd || null;
  } catch (error) {
    console.error(`Failed to fetch CoinGecko price for ${coinId}:`, error);
    return null;
  }
}

export async function fetchExchangeRates(): Promise<Record<string, number>> {
  const rates: Record<string, number> = { TRY: 1 };
  
  // Fetch USD/TRY 
  const usdTry = await fetchYahooPrice("USDTRY=X", "Diğer");
  if (usdTry) rates.USD = usdTry;
  
  // Fetch EUR/TRY
  const eurTry = await fetchYahooPrice("EURTRY=X", "Diğer");
  if (eurTry) rates.EUR = eurTry;
  
  // Fetch BTC price in USD - try Binance first, fallback to CoinGecko
  let btcUsd = await fetchBinancePrice("BTC");
  if (!btcUsd) {
    btcUsd = await fetchCoinGeckoPrice("bitcoin");
  }
  if (btcUsd && usdTry) rates.BTC = btcUsd * usdTry;
  
  // Fetch ETH price in USD - try Binance first, fallback to CoinGecko
  let ethUsd = await fetchBinancePrice("ETH");
  if (!ethUsd) {
    ethUsd = await fetchCoinGeckoPrice("ethereum");
  }
  if (ethUsd && usdTry) rates.ETH = ethUsd * usdTry;
  
  // Gold price (XAU/USD then convert to TRY per gram)
  // 1 troy oz = 31.1035 grams
  const goldOzUsd = await fetchYahooPrice("GC=F", "Diğer");
  if (goldOzUsd && usdTry) rates.XAU = (goldOzUsd / 31.1035) * usdTry;
  
  return rates;
}
