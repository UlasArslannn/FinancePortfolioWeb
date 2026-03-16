# process.md — Feature Fikirleri & Yol Haritası

Bu dosya projeye eklenebilecek özellikleri ve geliştirme fikirlerini içerir.

---

## Yüksek Öncelikli

### 1. Kimlik Doğrulama & Çok Kullanıcı Desteği
Şu an uygulama tek kullanıcılı. Birden fazla kullanıcı için:
- **Neon Auth** veya **Better Auth** entegrasyonu
- `userId` alanı tüm tablolara (assets, incomes, expenses) eklenmeli
- Row-level güvenlik politikaları Neon'da aktif edilebilir
- Google/GitHub OAuth veya email+password login

### 2. Portföy Hedefleri (Goal Tracking)
- "2025 sonuna kadar 500.000 TL portföy" gibi hedef tanımlama
- Dashboard'da hedef ilerleme çubuğu
- Aylık tasarruf hedefi takibi (bütçe sayfasıyla entegrasyon)
- Varlık sınıfı hedef dağılımı (örn. %60 hisse, %20 kripto, %20 nakit)

### 3. Temettü Takibi
- Varlıklara temettü geçmişi ekleme (tarih + tutar)
- Yıllık temettü geliri özeti
- Temettü verimini otomatik hesaplama (temettü / mevcut fiyat)
- Bütçe sayfasında `temettü` kategorisiyle otomatik ilişkilendirme

### 4. Borsa Uyarıları / Fiyat Alarmları
- Kullanıcının belirlediği fiyat seviyelerinde bildirim
- "THYAO 150 TL'ye düşerse uyar" gibi alarm tanımlama
- Browser push notification veya email
- Stop-loss / take-profit seviyeleri

---

## Orta Öncelikli

### 5. Veri Dışa Aktarma
- Portföy ve işlem geçmişini **Excel (XLSX)** veya **CSV** olarak indirme
- Vergi raporu çıktısı (yıllık kâr/zarar özeti)
- PDF portföy raporu (Recharts grafiklerini dahil ederek)
- `xlsx` veya `exceljs` kütüphanesi kullanılabilir

### 6. Brokerage CSV İçe Aktarma
- Türk aracı kurumlarından (İş Yatırım, Garanti BBVA, Midas, Robinhood) CSV içe aktarma
- İşlem geçmişini otomatik parse etme
- Çakışma tespiti (duplicate işlem önleme)
- Farklı CSV formatları için parser konfigürasyonu

### 7. Kıyaslama (Benchmarking)
- Portföy performansını endekslerle karşılaştır: BIST100, S&P500, Altın
- "Geçen yıl tüm paranı BIST100'e koysaydın ne olurdu?" analizi
- Çizgi grafiğine endeks çakıştırma

### 8. İzleme Listesi (Watchlist)
- Portföyde olmayan ama takip edilen semboller
- Fiyat, günlük değişim, 52 haftalık high/low
- Watchlist'ten portföye hızlı ekleme
- Not ekleme (neden izlediğini hatırlatıcı)

### 9. Yapay Zeka Destekli Portföy Analizi (Claude API)
- `@anthropic-ai/sdk` entegrasyonu
- "Portföyümü analiz et" → Claude, varlık dağılımı ve performansı yorumlar
- Bütçe harcama alışkanlıklarını analiz etme
- Sohbet tabanlı portföy asistanı (sidebar chatbot)
- Risk profili belirleme ve önerilerde bulunma

---

## Düşük Öncelikli / Gelecek

### 10. Mobil Uygulama (React Native / Expo)
- Mevcut API'yi yeniden kullanarak React Native ile mobil uygulama
- Biometrik kimlik doğrulama (Face ID, parmak izi)
- Widget (portföy değeri ana ekranda)
- Push bildirimler

### 11. Risk Analizi
- Portföy volatilite hesabı (günlük kapanış verisi gerektirir)
- Beta katsayısı (BIST100 veya S&P500'e göre)
- Sharpe oranı
- Max drawdown analizi
- "Portföyünüzün risk seviyesi: Orta-Yüksek" gibi özet

### 12. Portföy Dengeleme Önerileri (Rebalancing)
- Mevcut dağılımı hedef dağılımla karşılaştır
- "THYAO fazla, XU100 ETF al" gibi somut öneri
- Tek tıkla dengeleme alım listesi çıkarma

### 13. Çoklu Portföy Desteği
- "Ana Portföy", "Emeklilik Portföyü", "Spekülatif" gibi ayrı portföyler
- Portföy bazında ve konsolide görünüm
- Portföyler arası transfer işlemi

### 14. Haber & Duyuru Entegrasyonu
- Portföydeki varlıklarla ilgili haberler (RSS veya Investing.com API)
- KAP (Kamuyu Aydınlatma Platformu) duyuruları — özellikle BIST hisseleri için
- Dashboard'da mini haber akışı

### 15. Finansal Takvim
- Temettü ödeme tarihleri
- Şirket bilanço açıklama tarihleri
- TCMB para politikası toplantı tarihleri
- Kullanıcının yatırım hatırlatıcıları (örn. aylık DCA alımı)

### 16. Nakit Pozisyon Takibi
- Portföydeki nakit/vadesiz mevduat tutarı
- Vadeli mevduat (faiz oranı, vade tarihi)
- Hesaplar arası para transferi takibi
- Toplam net değere nakit dahil edilmesi

### 17. Sosyal / Paylaşım
- Anonim portföy paylaşımı (tutarlar gizlenmiş)
- "Bu ay %12 kazandım" paylaşım kartı oluşturma
- Arkadaşlarla portföy karşılaştırması (anonim)

---

## Teknik Borçlar & İyileştirmeler

- **`budget.tsx` bölünmeli** — 1063 satır, Income ve Expense olmak üzere iki component'e ayrılabilir
- **`add-asset-dialog.tsx` bölünmeli** — 767 satır, adım adım wizard'a dönüştürülebilir
- **Test coverage** — Vitest ile unit testler, özellikle `storage.ts` ve `priceService.ts` için
- **Error boundary** — React ErrorBoundary eklenmeli
- **Rate limiting** — `/api/prices/update` endpoint'ine rate limit eklenmeli
- **Caching** — Fiyat güncellemeleri için Redis veya in-memory cache (çok sık API çağrısı engeli)
- **WebSocket** — Gerçek zamanlı fiyat güncellemesi (polling yerine)
- **i18n** — Uygulama şu an tamamen Türkçe hardcoded; İngilizce için i18n altyapısı
- **E2E testler** — Playwright ile kritik kullanıcı akışları test edilmeli
