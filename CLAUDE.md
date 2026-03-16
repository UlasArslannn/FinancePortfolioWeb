# CLAUDE.md — FinancePortfolioWeb

Türk yatırım portföy takip uygulaması. Full-stack TypeScript, React + Express, Neon PostgreSQL.

---

## Temel Komutlar

```bash
npm run dev          # Geliştirme sunucusu (Vite + Express, port 5000)
npm run build        # Production build (Vite client + esbuild server)
npm run start        # Production sunucusu (dist/index.js)
npm run check        # TypeScript tip kontrolü
npm run db:push      # Drizzle schema'yı veritabanına uygula
npm run db:studio    # Drizzle Studio (DB görsel arayüz)
npm run scrape:tefas # BES fon listesini Python scraper ile güncelle
```

---

## Mimari

```
FinancePortfolioWeb/
├── client/src/          # React frontend (Vite SPA)
│   ├── pages/           # Wouter route sayfaları
│   ├── components/      # UI bileşenleri (iş mantığı + shadcn/ui)
│   │   └── ui/          # shadcn/ui bileşen kütüphanesi
│   ├── lib/             # Yardımcı modüller (queryClient, currency-context)
│   └── hooks/           # Custom React hookları
├── server/              # Express backend
│   ├── index.ts         # Express app bootstrap
│   ├── routes.ts        # Tüm API route tanımları
│   ├── storage.ts       # Veritabanı erişim katmanı (IStorage interface)
│   ├── db.ts            # Neon bağlantısı + Drizzle instance
│   └── services/
│       ├── priceService.ts     # Fiyat çekme servisleri
│       └── tefas_scraper.py   # TEFAS BES fon scraper (Python)
├── shared/
│   └── schema.ts        # Drizzle ORM şeması + Zod validation şemaları
└── migrations/          # Drizzle migration dosyaları
```

---

## Tech Stack

| Katman | Teknoloji |
|--------|-----------|
| Frontend framework | React 18 + TypeScript |
| Build tool | Vite 5 |
| Routing | Wouter 3 |
| Server state | TanStack React Query v5 |
| Form | react-hook-form + Zod |
| UI bileşenler | shadcn/ui (Radix UI tabanlı) |
| Grafikler | Recharts 2 |
| Stil | Tailwind CSS 3 (class-based dark mode) |
| Backend | Express.js 4 |
| ORM | Drizzle ORM 0.39 |
| Veritabanı | PostgreSQL (Neon serverless) |
| Validation | Zod 3 (client + server paylaşımlı) |
| Animasyon | framer-motion |

---

## Veritabanı Şeması

Tüm şema `shared/schema.ts` dosyasında tanımlı. Drizzle ORM kullanılıyor.

### Tablolar

**assets** — Portföydeki varlıklar
- `id` UUID PK
- `type`: `hisse | etf | kripto | gayrimenkul | bes`
- `name`, `symbol`, `market` (`BIST | US | Diğer`)
- `quantity` (decimal 18,8), `averagePrice` (decimal 18,2), `currentPrice` (decimal 18,2)
- `currency` (default `TRY`)

**transactions** — Alış/satış işlemleri
- `id` UUID PK, `assetId` FK → assets
- `type`: `alış | satış`
- `quantity`, `price`, `totalAmount`, `currency`, `date`, `notes`

**incomes** — Gelirler
- `category`: `maaş | kira | temettü | faiz | serbest | diğer`
- `amount`, `currency`, `date`, `isRecurring`

**expenses** — Giderler
- `category`: `market | faturalar | ulaşım | sağlık | eğlence | giyim | yemek | kira | kredi | sigorta | diğer`
- `amount`, `currency`, `date`, `isRecurring`

**recurring_incomes / recurring_expenses** — Tekrarlayan gelir/gider
- `frequency`: `haftalık | aylık | yıllık`
- `startDate`, `lastApplied`

> Tüm tutarlar veritabanında **TRY** olarak saklanır. Para birimi dönüşümü frontend'de `CurrencyContext` üzerinden yapılır.

---

## API Endpoints

### Varlıklar
```
GET    /api/assets                    Tüm varlıkları listele
GET    /api/assets/:id                Tek varlık
POST   /api/assets                    Yeni varlık ekle
PATCH  /api/assets/:id                Varlık güncelle
DELETE /api/assets/:id                Varlık sil
```

### İşlemler
```
GET    /api/transactions              Tüm işlemler
GET    /api/transactions/:id          Tek işlem
GET    /api/assets/:assetId/transactions  Varlığa ait işlemler
POST   /api/transactions              Yeni işlem ekle
DELETE /api/transactions/:id          İşlem sil
```

### Portföy Analitik
```
GET    /api/portfolio/summary         Toplam değer, net değer, aylık değişim
GET    /api/portfolio/allocation      Varlık sınıfına göre dağılım
GET    /api/portfolio/performance     Aylık performans (grafik verisi)
GET    /api/portfolio/details         Her varlık için kâr/zarar detayı
```

### Fiyat Servisleri
```
POST   /api/prices/update             Tüm varlık fiyatlarını güncelle
GET    /api/prices/:symbol            Tek sembol fiyatı (?type=&market=)
GET    /api/exchange-rates            Döviz kurları (USD, EUR, BTC, ETH, XAU)
GET    /api/stocks/search             Hisse/ETF/kripto arama
```

### BES Fonları
```
GET    /api/bes/search                BES fon arama (lokal önbellek + TEFAS)
GET    /api/bes/cache-status          Önbellek durumu
POST   /api/bes/rescrape              Python scraper'ı tetikle
```

### Bütçe
```
GET    /api/incomes                   Gelirler
POST   /api/incomes                   Gelir ekle
DELETE /api/incomes/:id               Gelir sil
GET    /api/expenses                  Giderler
POST   /api/expenses                  Gider ekle
DELETE /api/expenses/:id              Gider sil
GET    /api/budget/summary            Bütçe özeti (?startDate=&endDate=)
GET    /api/recurring-incomes         Tekrarlayan gelirler
POST   /api/recurring-incomes         Tekrarlayan gelir ekle
DELETE /api/recurring-incomes/:id     Tekrarlayan gelir sil
GET    /api/recurring-expenses        Tekrarlayan giderler
POST   /api/recurring-expenses        Tekrarlayan gider ekle
DELETE /api/recurring-expenses/:id    Tekrarlayan gider sil
```

---

## Fiyat Kaynakları

| Varlık Tipi | Kaynak | Not |
|-------------|--------|-----|
| Hisse (BIST) | Yahoo Finance | `.IS` suffix eklenir |
| Hisse (US) | Yahoo Finance | Direkt sembol |
| ETF | Yahoo Finance | |
| Kripto | Binance API | USDT paritesi → TRY dönüşüm |
| BES | TEFAS | Python scraper + lokal önbellek |
| Gayrimenkul | Manuel | Fiyat otomatik güncellenmiyor |

---

## Frontend Yapısı

### Sayfalar
| Sayfa | Dosya | Açıklama |
|-------|-------|---------|
| Dashboard | `pages/dashboard.tsx` | Portföy özeti, grafikler, varlık tablosu |
| Transactions | `pages/transactions.tsx` | İşlem geçmişi |
| Budget | `pages/budget.tsx` | Gelir/gider yönetimi, bütçe özeti |
| Reports | `pages/reports.tsx` | Performans raporları |
| Settings | `pages/settings.tsx` | Para birimi, tema, görünürlük ayarları |

### Önemli Bileşenler
| Bileşen | Satır | Görev |
|---------|-------|-------|
| `add-asset-dialog.tsx` | 767 | Varlık ekleme (sembol arama, tip seçimi) |
| `edit-asset-dialog.tsx` | 290 | Varlık düzenleme |
| `add-transaction-dialog.tsx` | 258 | Alış/satış işlem formu |
| `asset-table.tsx` | 290 | Portföy tablosu (sıralama, filtreleme) |
| `asset-allocation-chart.tsx` | 261 | Pasta grafik (varlık dağılımı) |
| `transaction-table.tsx` | 81 | İşlem geçmişi tablosu |
| `monthly-performance-chart.tsx` | 69 | Aylık performans çizgi grafiği |
| `app-sidebar.tsx` | 80 | Navigasyon kenar çubuğu |

### Lib / Context
- **`currency-context.tsx`** — Global para birimi durumu (TRY/USD/EUR/BTC/ETH/XAU). Tüm dönüşüm ve formatlama burada.
- **`queryClient.ts`** — TanStack Query yapılandırması, API helper fonksiyonu.

---

## Geliştirme Kuralları

### Veri Akışı
1. Sunucu → veritabanı → `storage.ts` → `routes.ts` → API
2. Client → TanStack Query → React bileşeni
3. Mutasyonlardan sonra ilgili query key'leri `invalidateQueries` ile geçersiz kılınır

### Query Key Konvansiyonu
```typescript
["/api/portfolio/summary"]   // Endpoint path'i query key olarak kullanılır
["/api/assets"]
["/api/budget/summary"]
```

### Para Birimi
- Veritabanında her şey **TRY** olarak saklanır
- `useDisplayCurrency()` hook'u ile `convertAmount(amountInTRY)` çağrılır
- Hiçbir zaman döviz dönüşümü server-side yapılmaz

### Form Validation
- Şemalar `shared/schema.ts`'de Zod ile tanımlanır
- Hem client hem server aynı şemayı kullanır
- Partial update için `.partial()` kullanılır

### Storage Katmanı
- Tüm DB işlemleri `server/storage.ts` → `DatabaseStorage` üzerinden
- `IStorage` interface'i abstraction sağlar
- Route'larda direkt Drizzle sorgusu yazılmaz

---

## Ortam Değişkenleri

```bash
DATABASE_URL=   # Neon PostgreSQL bağlantı string'i (pooled)
PORT=5000       # (opsiyonel) Sunucu portu
NODE_ENV=       # development | production
```

---

## Tasarım Sistemi

- Renk: CSS HSL değişkenleri (`--primary`, `--secondary`, `--success`, `--destructive`)
- Primary: `#1E3A8A` (koyu mavi)
- Success: `#10B981` (yeşil — kazanç)
- Destructive: `#EF4444` (kırmızı — kayıp)
- Dark mode: Tailwind `class` tabanlı, `localStorage`'da saklanır
- Tüm metin ve kategoriler Türkçe
- `design_guidelines.md` dosyasına bakılabilir
