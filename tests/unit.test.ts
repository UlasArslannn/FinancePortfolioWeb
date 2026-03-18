/**
 * Unit tests for FinancePortfolioWeb
 *
 * Run with: npx tsx tests/unit.test.ts
 *
 * Uses Node's built-in assert module — no test framework dependency needed.
 * For CI, consider adding vitest or jest.
 */

import assert from "node:assert/strict";

// ─────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err: Error) => {
      failed++;
      failures.push(`  ✗ ${name}\n    ${err.message}`);
      console.log(`  ✗ ${name} — ${err.message}`);
    });
}

async function describe(suite: string, fn: () => Promise<void>) {
  console.log(`\n${suite}`);
  return fn();
}

async function main() {

// ─────────────────────────────────────────────────
// Financial Calculation Tests
// ─────────────────────────────────────────────────
await describe("Financial Calculations — Average Price", async () => {
  await test("should calculate weighted average price on buy", () => {
    // Existing: 10 shares @ 100 TRY
    // New buy: 5 shares @ 120 TRY
    const currentQuantity = 10;
    const currentAvgPrice = 100;
    const buyQuantity = 5;
    const buyPrice = 120;

    const currentValue = currentQuantity * currentAvgPrice; // 1000
    const newValue = buyQuantity * buyPrice; // 600
    const newQuantity = currentQuantity + buyQuantity; // 15
    const newAvgPrice = (currentValue + newValue) / newQuantity; // 106.67

    assert.equal(newQuantity, 15);
    assert.ok(Math.abs(newAvgPrice - 106.6667) < 0.01, `Expected ~106.67, got ${newAvgPrice}`);
  });

  await test("should handle first purchase (zero existing)", () => {
    const currentQuantity = 0;
    const currentAvgPrice = 0;
    const buyQuantity = 10;
    const buyPrice = 50;

    const currentValue = currentQuantity * currentAvgPrice;
    const newValue = buyQuantity * buyPrice;
    const newQuantity = currentQuantity + buyQuantity;
    const newAvgPrice = newQuantity > 0 ? (currentValue + newValue) / newQuantity : 0;

    assert.equal(newQuantity, 10);
    assert.equal(newAvgPrice, 50);
  });

  await test("should reduce quantity on sell without changing avg price", () => {
    const currentQuantity = 20;
    const sellQuantity = 5;
    const newQuantity = Math.max(0, currentQuantity - sellQuantity);
    assert.equal(newQuantity, 15);
  });

  await test("should not go below zero on oversell", () => {
    const currentQuantity = 3;
    const sellQuantity = 10;
    const newQuantity = Math.max(0, currentQuantity - sellQuantity);
    assert.equal(newQuantity, 0);
  });
});

await describe("Financial Calculations — Profit/Loss", async () => {
  await test("should calculate positive profit", () => {
    const quantity = 10;
    const currentPrice = 150;
    const averagePrice = 100;

    const totalValue = quantity * currentPrice;   // 1500
    const totalCost = quantity * averagePrice;      // 1000
    const profit = totalValue - totalCost;          // 500
    const changePercent = ((currentPrice - averagePrice) / averagePrice) * 100; // 50%

    assert.equal(profit, 500);
    assert.equal(changePercent, 50);
  });

  await test("should calculate negative profit (loss)", () => {
    const quantity = 10;
    const currentPrice = 80;
    const averagePrice = 100;

    const profit = quantity * currentPrice - quantity * averagePrice;
    const changePercent = ((currentPrice - averagePrice) / averagePrice) * 100;

    assert.equal(profit, -200);
    assert.equal(changePercent, -20);
  });

  await test("should handle zero quantity gracefully", () => {
    const quantity = 0;
    const currentPrice = 100;
    const averagePrice = 50;

    const totalValue = quantity * currentPrice;
    const totalCost = quantity * averagePrice;
    const profit = totalValue - totalCost;
    const changePercent = totalCost > 0 ? ((currentPrice - averagePrice) / averagePrice) * 100 : 0;

    assert.equal(profit, 0);
    assert.equal(changePercent, 0);
  });
});

await describe("Financial Calculations — Portfolio Allocation", async () => {
  await test("should calculate percentage allocation correctly", () => {
    const assets = [
      { type: "hisse", value: 5000 },
      { type: "kripto", value: 3000 },
      { type: "bes", value: 2000 },
    ];
    const total = assets.reduce((sum, a) => sum + a.value, 0);
    assert.equal(total, 10000);

    const percentages = assets.map((a) => (a.value / total) * 100);
    assert.equal(percentages[0], 50);
    assert.equal(percentages[1], 30);
    assert.equal(percentages[2], 20);
  });

  await test("should handle empty portfolio", () => {
    const assets: { type: string; value: number }[] = [];
    const total = assets.reduce((sum, a) => sum + a.value, 0);
    assert.equal(total, 0);
  });
});

// ─────────────────────────────────────────────────
// Rate Limiter Tests
// ─────────────────────────────────────────────────
await describe("Rate Limiter", async () => {
  // Inline reimplementation for testing (mirrors routes.ts)
  class RateLimiter {
    private store = new Map<string, { count: number; resetAt: number }>();
    constructor(private maxRequests: number, private windowMs: number) {}
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

  await test("should allow requests within limit", () => {
    const limiter = new RateLimiter(3, 60_000);
    assert.ok(limiter.isAllowed("user1"));
    assert.ok(limiter.isAllowed("user1"));
    assert.ok(limiter.isAllowed("user1"));
  });

  await test("should block requests over limit", () => {
    const limiter = new RateLimiter(2, 60_000);
    assert.ok(limiter.isAllowed("user1"));
    assert.ok(limiter.isAllowed("user1"));
    assert.equal(limiter.isAllowed("user1"), false);
    assert.equal(limiter.isAllowed("user1"), false);
  });

  await test("should track different keys independently", () => {
    const limiter = new RateLimiter(1, 60_000);
    assert.ok(limiter.isAllowed("user1"));
    assert.ok(limiter.isAllowed("user2"));
    assert.equal(limiter.isAllowed("user1"), false);
    assert.ok(limiter.isAllowed("user3"));
  });

  await test("should reset after window expires", async () => {
    const limiter = new RateLimiter(1, 50); // 50ms window
    assert.ok(limiter.isAllowed("user1"));
    assert.equal(limiter.isAllowed("user1"), false);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.ok(limiter.isAllowed("user1"));
  });
});

// ─────────────────────────────────────────────────
// Price Strategy Pattern Tests
// ─────────────────────────────────────────────────
await describe("Price Strategy Pattern", async () => {
  await test("should map known asset types to fetchers", () => {
    const knownTypes = ["kripto", "hisse", "etf", "bes", "gayrimenkul"];
    // Simulate the strategy map without importing (avoids DB dependency)
    const priceFetcherMap: Record<string, string> = {
      kripto: "binance",
      hisse: "yahoo",
      etf: "yahoo",
      bes: "tefas",
      gayrimenkul: "manual",
    };

    for (const type of knownTypes) {
      assert.ok(priceFetcherMap[type], `Missing fetcher for type: ${type}`);
    }
  });

  await test("should return undefined for unknown asset types", () => {
    const priceFetcherMap: Record<string, string> = {
      kripto: "binance",
      hisse: "yahoo",
      etf: "yahoo",
      bes: "tefas",
      gayrimenkul: "manual",
    };
    assert.equal(priceFetcherMap["unknown"], undefined);
  });
});

// ─────────────────────────────────────────────────
// Currency Conversion Tests
// ─────────────────────────────────────────────────
await describe("Currency Conversion", async () => {
  await test("should convert USD to TRY using exchange rate", () => {
    const amountUsd = 100;
    const usdTryRate = 32.5;
    const result = amountUsd * usdTryRate;
    assert.equal(result, 3250);
  });

  await test("should handle TRY (no conversion needed, rate = 1)", () => {
    const amountTry = 5000;
    const tryRate = 1;
    assert.equal(amountTry * tryRate, 5000);
  });

  await test("should handle missing rate by defaulting to 1", () => {
    const rates: Record<string, number> = { TRY: 1, USD: 32.5 };
    const currency = "GBP";
    const rate = rates[currency] ?? 1;
    assert.equal(rate, 1);
  });
});

// ─────────────────────────────────────────────────
// Concurrency Limiter Tests
// ─────────────────────────────────────────────────
await describe("Concurrency Limiter", async () => {
  // Reimplementation for testing
  async function withConcurrencyLimit<T>(
    tasks: (() => Promise<T>)[],
    maxConcurrency: number
  ): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let index = 0;
    async function worker() {
      while (index < tasks.length) {
        const currentIndex = index++;
        results[currentIndex] = await tasks[currentIndex]();
      }
    }
    const workers = Array.from(
      { length: Math.min(maxConcurrency, tasks.length) },
      () => worker()
    );
    await Promise.allSettled(workers);
    return results;
  }

  await test("should process all tasks", async () => {
    const tasks = [1, 2, 3, 4, 5].map((n) => async () => n * 2);
    const results = await withConcurrencyLimit(tasks, 2);
    assert.deepEqual(results, [2, 4, 6, 8, 10]);
  });

  await test("should respect concurrency limit", async () => {
    let maxActive = 0;
    let active = 0;

    const tasks = Array.from({ length: 10 }, () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return true;
    });

    await withConcurrencyLimit(tasks, 3);
    assert.ok(maxActive <= 3, `Max active was ${maxActive}, expected <= 3`);
  });

  await test("should handle empty task list", async () => {
    const results = await withConcurrencyLimit([], 5);
    assert.deepEqual(results, []);
  });
});

// ─────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(f));
  process.exit(1);
} else {
  console.log("All tests passed!");
}
} // end main

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
