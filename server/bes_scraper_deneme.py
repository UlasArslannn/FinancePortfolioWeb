#!/usr/bin/env python3
"""
besfongetirileri.com/FonBulma scraper — Selenium tabanlı.

Tüm BES fonlarının kodlarını, adlarını, fiyatlarını ve getirilerini çeker.
"Karşılaştır" butonuna tıklayıp DataTables JS API ile tüm veriyi tek seferde alır.

Kullanım:
  python server/bes_scraper.py
  python server/bes_scraper.py --output benim_dosyam.json
  python server/bes_scraper.py --visible   # Headless olmayan mod (debug için)
"""
import json
import sys
import os
import time
import argparse
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUTPUT = os.path.join(SCRIPT_DIR, "bes_funds.json")
FUND_LIST_URL = "https://www.besfongetirileri.com/FonBulma"


def get_driver(headless=True):
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    from webdriver_manager.chrome import ChromeDriverManager

    options = Options()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1920,1080")
    options.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    )

    service = Service(ChromeDriverManager().install())
    return webdriver.Chrome(service=service, options=options)


def select_all_options(driver, select_id):
    """Bir multi-select elementinin tüm seçeneklerini seç."""
    from selenium.webdriver.common.by import By

    driver.execute_script(f"""
        var sel = document.getElementById('{select_id}');
        if (sel) {{
            for (var i = 0; i < sel.options.length; i++) {{
                sel.options[i].selected = true;
            }}
            // multiple-select plugin varsa yenile
            try {{ $('#{select_id}').multipleSelect('checkAll'); }} catch(e) {{}}
        }}
    """)


def scrape_all(output_file=DEFAULT_OUTPUT, headless=True):
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    print("Chrome başlatılıyor...")
    driver = get_driver(headless=headless)
    wait = WebDriverWait(driver, 30)

    try:
        print(f"Sayfa yükleniyor: {FUND_LIST_URL}")
        driver.get(FUND_LIST_URL)

        # Sayfanın yüklenmesini bekle
        wait.until(EC.presence_of_element_located((By.ID, "btn_Karsilastir")))
        time.sleep(1.5)  # multiple-select plugin'inin initialize olması için

        print("Filtreler ayarlanıyor (tüm fon türleri, riskler, dönemler)...")

        # Tüm fon türlerini seç
        select_all_options(driver, "drpFundType")

        # Tüm risk seviyelerini seç
        select_all_options(driver, "drpRisk")

        # Tüm dönemleri seç
        select_all_options(driver, "drpPeriod")

        # Değerlendirme tipi: Dönemsel (D) — zaten default, ama garantiye alalım
        driver.execute_script("""
            var sel = document.getElementById('drpEvalutionType');
            if (sel) sel.value = 'D';
        """)

        print("'Karşılaştır' butonuna tıklanıyor...")
        btn = driver.find_element(By.ID, "btn_Karsilastir")
        driver.execute_script("arguments[0].click();", btn)

        # Tablonun yüklenmesini bekle (tbody'de en az 1 tr görünmeli)
        print("Tablo yüklenmesi bekleniyor...")
        wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "#table1 tbody tr td")
        ))
        # Yükleme animasyonu bitene kadar bekle
        time.sleep(2)

        # DataTables JS API ile TÜM satırları al (tüm sayfalar, pagination'a gerek yok)
        print("Tüm veri DataTables API'si ile alınıyor...")
        rows = driver.execute_script(
            "return $('#table1').DataTable().data().toArray();"
        )

        print(f"Toplam {len(rows)} satır alındı.")

    finally:
        driver.quit()

    if not rows:
        print("Hiç veri alınamadı!")
        return []

    funds = []
    for r in rows:
        if not isinstance(r, dict):
            continue

        code = str(r.get("fund_code") or "").strip()
        name = str(r.get("fund") or "").strip()
        founder = str(r.get("fund_founder_title") or "").strip()

        price_raw = r.get("fund_price")
        try:
            price = float(str(price_raw).replace(",", ".")) if price_raw is not None else 0.0
        except (ValueError, TypeError):
            price = 0.0

        risk = r.get("fund_risk")

        entry = {
            "symbol": code,
            "name": name,
            "founder": founder,
            "price": price,
            "risk": risk,
        }

        # Dönem getirileri
        for api_key, out_key in [
            ("fund_daily",      "daily"),
            ("fund_weekly",     "weekly"),
            ("fund_montly",     "monthly_1"),
            ("fund_2monthly",   "monthly_2"),
            ("fund_3monthly",   "monthly_3"),
            ("fund_6monthly",   "monthly_6"),
            ("fund_year_today", "ytd"),
            ("fund_yearly",     "yearly"),
        ]:
            val = r.get(api_key)
            if val is not None:
                try:
                    entry[out_key] = float(str(val).replace(",", "."))
                except (ValueError, TypeError):
                    entry[out_key] = None

        if code:
            funds.append(entry)

    funds.sort(key=lambda x: x["symbol"])

    output = {
        "lastUpdated": datetime.now().isoformat(),
        "source": "besfongetirileri.com",
        "count": len(funds),
        "funds": funds,
    }

    with open(output_file, "w", encoding="utf-8") as fp:
        json.dump(output, fp, ensure_ascii=False, indent=2)

    print(f"\nToplam {len(funds)} fon kaydedildi -> {output_file}")
    print("\nOrnek fonlar:")
    for f in funds[:5]:
        print(f"  {f['symbol']:6s}  {f['price']:.6f}  {f['name'][:60]}")

    return funds


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="besfongetirileri.com BES fon scraper")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Çıktı JSON dosyası")
    parser.add_argument("--visible", action="store_true", help="Tarayıcıyı görünür modda çalıştır")
    args = parser.parse_args()

    scrape_all(output_file=args.output, headless=not args.visible)