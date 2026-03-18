#!/usr/bin/env python3
"""
besfongetirileri.com/FonBulma scraper — Selenium tabanlı.

Tüm BES fonlarının kodlarını, adlarını, fiyatlarını ve getirilerini çeker.
"Karşılaştır" butonuna tıklayıp DataTables JS API ile tüm veriyi tek seferde alır.

Fix #5: Added retry logic, better error handling, graceful fallbacks.

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
import traceback
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUTPUT = os.path.join(SCRIPT_DIR, "bes_funds.json")
FUND_LIST_URL = "https://www.besfongetirileri.com/FonBulma"

MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 5


def get_driver(headless=True):
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service

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

    # Try webdriver-manager first, fall back to system chromedriver
    try:
        from webdriver_manager.chrome import ChromeDriverManager
        service = Service(ChromeDriverManager().install())
    except ImportError:
        print("[scraper] webdriver-manager not installed, trying system chromedriver...")
        service = Service("chromedriver")

    return webdriver.Chrome(service=service, options=options)


def select_all_options(driver, select_id):
    """Bir multi-select elementinin tüm seçeneklerini seç."""
    driver.execute_script(f"""
        var sel = document.getElementById('{select_id}');
        if (sel) {{
            for (var i = 0; i < sel.options.length; i++) {{
                sel.options[i].selected = true;
            }}
            try {{ $('#{select_id}').multipleSelect('checkAll'); }} catch(e) {{}}
        }}
    """)


def scrape_attempt(headless=True):
    """Single scrape attempt. Returns list of fund dicts or raises on failure."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    print("Chrome başlatılıyor...")
    driver = get_driver(headless=headless)
    wait = WebDriverWait(driver, 30)

    try:
        print(f"Sayfa yükleniyor: {FUND_LIST_URL}")
        driver.get(FUND_LIST_URL)

        wait.until(EC.presence_of_element_located((By.ID, "btn_Karsilastir")))
        time.sleep(1.5)

        print("Filtreler ayarlanıyor (tüm fon türleri, riskler, dönemler)...")
        select_all_options(driver, "drpFundType")
        select_all_options(driver, "drpRisk")
        select_all_options(driver, "drpPeriod")

        driver.execute_script("""
            var sel = document.getElementById('drpEvalutionType');
            if (sel) sel.value = 'D';
        """)

        print("'Karşılaştır' butonuna tıklanıyor...")
        btn = driver.find_element(By.ID, "btn_Karsilastir")
        driver.execute_script("arguments[0].click();", btn)

        print("Tablo yüklenmesi bekleniyor...")
        wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "#table1 tbody tr td")
        ))
        time.sleep(2)

        print("Tüm veri DataTables API'si ile alınıyor...")
        rows = driver.execute_script(
            "return $('#table1').DataTable().data().toArray();"
        )

        print(f"Toplam {len(rows)} satır alındı.")
        return rows

    finally:
        driver.quit()


def parse_rows(rows):
    """Parse raw DataTables rows into clean fund dicts."""
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
    return funds


def scrape_all(output_file=DEFAULT_OUTPUT, headless=True):
    """Scrape with retry logic (Fix #5)."""
    last_error = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"\n--- Deneme {attempt}/{MAX_RETRIES} ---")
            rows = scrape_attempt(headless=headless)

            if not rows:
                print(f"Deneme {attempt}: Hiç veri alınamadı, tekrar deneniyor...")
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY_SECONDS)
                continue

            funds = parse_rows(rows)

            if not funds:
                print(f"Deneme {attempt}: Parse edilen fon yok, tekrar deneniyor...")
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY_SECONDS)
                continue

            # Success — write output
            output = {
                "lastUpdated": datetime.now().isoformat(),
                "source": "besfongetirileri.com",
                "count": len(funds),
                "funds": funds,
            }

            with open(output_file, "w", encoding="utf-8") as fp:
                json.dump(output, fp, ensure_ascii=False, indent=2)

            print(f"\nToplam {len(funds)} fon kaydedildi -> {output_file}")
            print("\nÖrnek fonlar:")
            for f in funds[:5]:
                print(f"  {f['symbol']:6s}  {f['price']:.6f}  {f['name'][:60]}")

            return funds

        except ImportError as e:
            print(f"\nGerekli paket eksik: {e}")
            print("Lütfen 'pip install selenium webdriver-manager' çalıştırın.")
            sys.exit(1)

        except Exception as e:
            last_error = e
            print(f"Deneme {attempt} başarısız: {e}")
            traceback.print_exc()
            if attempt < MAX_RETRIES:
                print(f"{RETRY_DELAY_SECONDS} saniye bekleniyor...")
                time.sleep(RETRY_DELAY_SECONDS)

    print(f"\n{MAX_RETRIES} deneme sonrası başarısız olundu.")
    if last_error:
        print(f"Son hata: {last_error}")

    # If existing cache file exists, don't overwrite it on failure
    if os.path.exists(output_file):
        print(f"Mevcut önbellek dosyası korunuyor: {output_file}")
    
    return []


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="besfongetirileri.com BES fon scraper")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Çıktı JSON dosyası")
    parser.add_argument("--visible", action="store_true", help="Tarayıcıyı görünür modda çalıştır")
    args = parser.parse_args()

    scrape_all(output_file=args.output, headless=not args.visible)
