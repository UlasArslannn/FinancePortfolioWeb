import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertAssetSchema, insertTransactionSchema, insertIncomeSchema, insertExpenseSchema, insertRecurringIncomeSchema, insertRecurringExpenseSchema } from "@shared/schema";
import { updateAllAssetPrices, fetchSingleAssetPrice, fetchExchangeRates, searchBESFunds, getBesCacheInfo, loadBesFundsFromFile, searchStocks } from "./services/priceService";
import { execFile } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __routesDirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Fix #6: Simple In-Memory Rate Limiter
// ---------------------------------------------------------------------------
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  constructor(
    private maxRequests: number,
    private windowMs: number
  ) {}

  isAllowed(key: string): boolean {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || now > entry.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count >= this.maxRequests) return false;
    entry.count++;
    return true;
  }
}

// Price update: max 3 requests per minute
const priceUpdateLimiter = new RateLimiter(3, 60 * 1000);
// General API: max 60 requests per minute per IP
const generalLimiter = new RateLimiter(60, 60 * 1000);

export async function registerRoutes(app: Express): Promise<Server> {
  // Apply general rate limiting to all API routes
  app.use("/api", (req, res, next) => {
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    if (!generalLimiter.isAllowed(clientIp)) {
      return res.status(429).json({ error: "Too many requests. Please try again later." });
    }
    next();
  });
  // Asset routes
  app.get("/api/assets", async (req, res) => {
    try {
      const assets = await storage.getAssets();
      res.json(assets);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch assets" });
    }
  });

  app.get("/api/assets/:id", async (req, res) => {
    try {
      const asset = await storage.getAsset(req.params.id);
      if (!asset) {
        return res.status(404).json({ error: "Asset not found" });
      }
      res.json(asset);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch asset" });
    }
  });

  app.post("/api/assets", async (req, res) => {
    try {
      const validated = insertAssetSchema.parse(req.body);
      const asset = await storage.createAsset(validated);
      res.status(201).json(asset);
    } catch (error) {
      res.status(400).json({ error: "Invalid asset data" });
    }
  });

  app.patch("/api/assets/:id", async (req, res) => {
    try {
      const validated = insertAssetSchema.partial().parse(req.body);
      const asset = await storage.updateAsset(req.params.id, validated);
      if (!asset) {
        return res.status(404).json({ error: "Asset not found" });
      }
      res.json(asset);
    } catch (error) {
      res.status(400).json({ error: "Invalid asset data" });
    }
  });

  app.delete("/api/assets/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteAsset(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Asset not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete asset" });
    }
  });

  // Transaction routes
  app.get("/api/transactions", async (req, res) => {
    try {
      const transactions = await storage.getTransactions();
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  app.get("/api/transactions/:id", async (req, res) => {
    try {
      const transaction = await storage.getTransaction(req.params.id);
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      res.json(transaction);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch transaction" });
    }
  });

  app.get("/api/assets/:assetId/transactions", async (req, res) => {
    try {
      const transactions = await storage.getTransactionsByAsset(req.params.assetId);
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  app.post("/api/transactions", async (req, res) => {
    try {
      const validated = insertTransactionSchema.parse(req.body);
      const transaction = await storage.createTransaction(validated);
      res.status(201).json(transaction);
    } catch (error) {
      res.status(400).json({ error: "Invalid transaction data" });
    }
  });

  app.delete("/api/transactions/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteTransaction(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete transaction" });
    }
  });

  // Portfolio analytics routes
  app.get("/api/portfolio/summary", async (req, res) => {
    try {
      const summary = await storage.getPortfolioSummary();
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch portfolio summary" });
    }
  });

  app.get("/api/portfolio/allocation", async (req, res) => {
    try {
      const allocation = await storage.getAssetAllocation();
      res.json(allocation);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch asset allocation" });
    }
  });

  app.get("/api/portfolio/performance", async (req, res) => {
    try {
      const performance = await storage.getMonthlyPerformance();
      res.json(performance);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch monthly performance" });
    }
  });

  app.get("/api/portfolio/details", async (req, res) => {
    try {
      const details = await storage.getAssetDetails();
      res.json(details);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch asset details" });
    }
  });

  // Price update routes (with rate limiting - Fix #6)
  app.post("/api/prices/update", async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    if (!priceUpdateLimiter.isAllowed(clientIp)) {
      return res.status(429).json({
        error: "Fiyat güncelleme çok sık yapılıyor. Lütfen 1 dakika bekleyin.",
      });
    }
    try {
      const results = await updateAllAssetPrices();
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      res.json({
        message: `Fiyatlar güncellendi: ${successful} başarılı, ${failed} başarısız`,
        results,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Price update error:", error);
      res.status(500).json({ error: "Fiyatlar güncellenirken hata oluştu" });
    }
  });

  app.get("/api/prices/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const { type, market } = req.query;
      
      if (!type || !market) {
        return res.status(400).json({ error: "type and market query params required" });
      }
      
      const price = await fetchSingleAssetPrice(
        symbol,
        type as string,
        market as string
      );
      
      if (price === null) {
        return res.status(404).json({ error: "Price not found" });
      }
      
      res.json({ symbol, price, fetchedAt: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch price" });
    }
  });

  // BES fund search endpoint (searches local cache, falls back to live TEFAS)
  app.get("/api/bes/search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || String(q).length < 2) return res.json([]);
      console.log(`[bes/search] query="${q}"`);
      const results = await searchBESFunds(String(q));
      console.log(`[bes/search] results count: ${results.length}`);
      res.json(results);
    } catch (error) {
      console.error("BES search error:", error);
      res.status(500).json({ error: "Failed to search BES funds" });
    }
  });

  // BES cache status
  app.get("/api/bes/cache-status", (_req, res) => {
    const info = getBesCacheInfo();
    res.json({
      loaded: info.count > 0,
      count: info.count,
      lastUpdated: info.lastUpdated,
    });
  });

  // Trigger Python scraper to rebuild the cache (Fix #12: execFile instead of exec)
  app.post("/api/bes/rescrape", (req, res) => {
    const scraperPath = join(__routesDirname, "tefas_scraper.py");
    execFile("python", [scraperPath], { timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) {
        console.error("[bes/rescrape] scraper error:", stderr);
        return;
      }
      console.log("[bes/rescrape] scraper done:", stdout.trim().split("\n").slice(-2).join(" | "));
      loadBesFundsFromFile();
    });
    res.json({ message: "Scraper started. Check /api/bes/cache-status for progress." });
  });

  // Stock/crypto search endpoint — Yahoo with auth for all markets
  app.get("/api/stocks/search", async (req, res) => {
    try {
      const { q, market, type } = req.query;
      if (!q || String(q).length < 1) return res.json([]);

      const results = await searchStocks(
        String(q),
        String(market || ""),
        String(type || "")
      );
      res.json(results);
    } catch (error) {
      console.error("Stock search error:", error);
      res.status(500).json({ error: "Failed to search stocks" });
    }
  });

  // Exchange rates endpoint
  app.get("/api/exchange-rates", async (req, res) => {
    try {
      const rates = await fetchExchangeRates();
      res.json({ rates, updatedAt: new Date().toISOString() });
    } catch (error) {
      console.error("Exchange rates error:", error);
      res.status(500).json({ error: "Failed to fetch exchange rates" });
    }
  });

  // Price history endpoint (Fix #9)
  app.get("/api/assets/:assetId/price-history", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const history = await storage.getPriceHistory(
        req.params.assetId,
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch price history" });
    }
  });

  // Income routes
  app.get("/api/incomes", async (req, res) => {
    try {
      const incomes = await storage.getIncomes();
      res.json(incomes);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch incomes" });
    }
  });

  app.post("/api/incomes", async (req, res) => {
    try {
      const validated = insertIncomeSchema.parse(req.body);
      const income = await storage.createIncome(validated);
      res.status(201).json(income);
    } catch (error) {
      res.status(400).json({ error: "Invalid income data" });
    }
  });

  app.delete("/api/incomes/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteIncome(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Income not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete income" });
    }
  });

  // Expense routes
  app.get("/api/expenses", async (req, res) => {
    try {
      const expenses = await storage.getExpenses();
      res.json(expenses);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch expenses" });
    }
  });

  app.post("/api/expenses", async (req, res) => {
    try {
      const validated = insertExpenseSchema.parse(req.body);
      const expense = await storage.createExpense(validated);
      res.status(201).json(expense);
    } catch (error) {
      res.status(400).json({ error: "Invalid expense data" });
    }
  });

  app.delete("/api/expenses/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteExpense(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Expense not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete expense" });
    }
  });

  // Recurring income routes
  app.get("/api/recurring-incomes", async (req, res) => {
    try {
      res.json(await storage.getRecurringIncomes());
    } catch {
      res.status(500).json({ error: "Failed to fetch recurring incomes" });
    }
  });

  app.post("/api/recurring-incomes", async (req, res) => {
    try {
      const validated = insertRecurringIncomeSchema.parse(req.body);
      res.status(201).json(await storage.createRecurringIncome(validated));
    } catch {
      res.status(400).json({ error: "Invalid recurring income data" });
    }
  });

  app.delete("/api/recurring-incomes/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteRecurringIncome(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Not found" });
      res.status(204).send();
    } catch {
      res.status(500).json({ error: "Failed to delete recurring income" });
    }
  });

  // Recurring expense routes
  app.get("/api/recurring-expenses", async (req, res) => {
    try {
      res.json(await storage.getRecurringExpenses());
    } catch {
      res.status(500).json({ error: "Failed to fetch recurring expenses" });
    }
  });

  app.post("/api/recurring-expenses", async (req, res) => {
    try {
      const validated = insertRecurringExpenseSchema.parse(req.body);
      res.status(201).json(await storage.createRecurringExpense(validated));
    } catch {
      res.status(400).json({ error: "Invalid recurring expense data" });
    }
  });

  app.delete("/api/recurring-expenses/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteRecurringExpense(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Not found" });
      res.status(204).send();
    } catch {
      res.status(500).json({ error: "Failed to delete recurring expense" });
    }
  });

  // Apply recurring: generate entries for all pending occurrences
  app.post("/api/budget/apply-recurring", async (req, res) => {
    try {
      const result = await storage.applyRecurring();
      res.json(result);
    } catch (error) {
      console.error("Apply recurring error:", error);
      res.status(500).json({ error: "Failed to apply recurring items" });
    }
  });

  // Budget summary route
  app.get("/api/budget/summary", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const summary = await storage.getBudgetSummary(
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch budget summary" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
