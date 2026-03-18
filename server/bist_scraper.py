#!/usr/bin/env python3
"""
BIST Stocks + ETF Scraper
TradingView Screener kullanarak tüm BIST hisselerini ve ETF'lerini
isim + fiyat + type alanlarıyla bist_stocks.json'a kaydeder.
"""

import json
import os
import sys
from datetime import datetime

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "bist_stocks.json")


def scrape():
    try:
        from tradingview_screener import Query
    except ImportError:
        print("[BIST Scraper] tradingview-screener bulunamadı:", file=sys.stderr)
        print("  pip install borsapy", file=sys.stderr)
        sys.exit(1)

    print("[BIST Scraper] TradingView screener'dan veri çekiliyor...")

    try:
        _count, df = (
            Query()
            .set_markets("turkey")
            .select("name", "description", "close", "type")
            .limit(1500)
            .get_scanner_data()
        )
    except Exception as e:
        print(f"[BIST Scraper] Screener hatası: {e}", file=sys.stderr)
        sys.exit(1)

    stocks = []
    for _, row in df.iterrows():
        symbol = str(row.get("name", "")).replace("BIST:", "").strip()
        name = str(row.get("description", symbol)).strip()
        price = row.get("close", 0)
        tv_type = str(row.get("type", "stock")).strip()

        if not symbol:
            continue

        # TradingView "fund" → bizim "etf" (GYO + BYF)
        asset_type = "etf" if tv_type == "fund" else "stock"

        stocks.append({
            "symbol": symbol,
            "name": name,
            "price": round(float(price), 2) if price and str(price) != "nan" else 0,
            "type": asset_type,
        })

    stocks.sort(key=lambda x: x["symbol"])

    stock_count = sum(1 for s in stocks if s["type"] == "stock")
    etf_count = sum(1 for s in stocks if s["type"] == "etf")

    output = {
        "lastUpdated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "source": "TradingView Screener",
        "stocks": stocks,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"[BIST Scraper] {len(stocks)} kayit: {stock_count} hisse, {etf_count} ETF/GYO")


if __name__ == "__main__":
    scrape()
