# 04 — BYOK Maliyet İzleme ve Dashboard

## Vizyon

> Eski vizyon: "Platform token'larının maliyetini izle, bütçe koy"
> Yeni vizyon: **"Kullanıcının kendi BYOK API key harcamasını şeffaf şekilde izle, bütçe koy, uyar. Platform LLM maliyeti taşımaz — kullanıcı kendi harcamasını kontrol eder."**

Biz kullanıcıya token satmıyoruz. Ama kullanıcının kendi key'iyle yaptığı harcamayı **şeffaf, gerçek zamanlı ve akıllıca** gösteriyoruz. Bu, kullanıcının güvenini kazanır ve Consciousness Loop'un token tüketimini anlamasını sağlar.

---

## BYOK Maliyet Modeli

```
ESKİ MODEL (Platform-Managed):          YENİ MODEL (BYOK):
──────────────────────────────           ─────────────────────
Platform LLM maliyetini taşır           Kullanıcı kendi key'iyle öder
Platform'un kâr marjı dar               Platform sadece altyapı alır
Kullanıcı harcamayı görmez              Kullanıcı HER şeyi görür
Platform bütçe yönetir                   Kullanıcı KENDİ bütçesini koyar
Model seçimi platform'a ait             Model seçimi kullanıcıya ait

Platform geliri:
├── Abonelik: ~$10/ay (sabit, öngörülebilir)
├── LLM maliyeti: $0 (kullanıcı ödüyor)
└── Kâr marjı: ~%80

Kullanıcı maliyeti:
├── Platform aboneliği: ~$10/ay
├── LLM (kendi API key): ~$3-10/ay (Watchdog sayesinde düşük)
└── Toplam: ~$13-20/ay (rakiplere göre çok ucuz)
```

---

## Neden Maliyet Dashboard Hâlâ Kritik?

BYOK modelinde dashboard **daha da önemli** çünkü:

```
1. GÜVEN: Kullanıcı "AI'm benim key'imi harcıyor, ne kadar?"
   diye soracak. Şeffaf göstermezsek güven kaybederiz.

2. CONSCIOUSNESS LOOP MALİYETİ: Watchdog %90 tick'i filtreler
   ama kalan %10 LLM çağrısı hâlâ kullanıcının parasını harcar.
   Kullanıcı bunu görmeli ve kontrol edebilmeli.

3. MODEL SEÇİMİ: Kullanıcı Claude Opus ile Haiku arasındaki
   farkı görebilmeli. Dashboard model bazlı breakdown verir.

4. BÜTÇE KORUMASI: "Bu ay $20'dan fazla harcama" diyebilmeli.
   Limit aşılınca Consciousness Loop ucuz modele düşer veya durur.

5. SLEEP PHASE MALİYETİ: Gece araştırması kaç token harcadı?
   Kullanıcı "gece araştırmasını kapat" diyebilmeli.
```

---

## Dashboard Tasarımı (BYOK Versiyonu)

### Ana Ekran
```
┌─────────────────────────────────────────────────────┐
│  API Harcama Dashboard                    Mart 2026  │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │ Bugün    │ │ Bu Hafta │ │ Bu Ay    │ │ Bütçe  │ │
│  │ $0.47   │ │ $3.21   │ │ $12.85  │ │ $20.00 │ │
│  │ 12k tkn │ │ 84k tkn │ │ 340k tkn│ │ ██████░│ │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘ │
│                                                      │
│  Kaynak Bazlı Maliyet (Bu Ay):                      │
│  ┌────────────────────────────────────────────┐     │
│  │ Konuşmalar      ████████████  $7.20  (%56)│     │
│  │ Consciousness   ████          $2.80  (%22)│     │
│  │ Sleep Phase     ███            $1.85  (%14)│     │
│  │ Memory Extract  █              $1.00  (%8) │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  Model Bazlı Maliyet (Bu Ay):                      │
│  ┌────────────────────────────────────────────┐     │
│  │ Claude Sonnet  ████████████████  $8.20     │     │
│  │ GPT-4o-mini    ████               $2.15     │     │
│  │ Claude Haiku   ██                  $1.50     │     │
│  │ Gemini Flash   █                   $1.00     │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  Sağlayıcı Bazlı:                                  │
│  ┌────────────────────────────────────────────┐     │
│  │ Anthropic  ████████████████████  $9.70     │     │
│  │ OpenAI     ████                   $2.15     │     │
│  │ Google     █                       $1.00     │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  Günlük Trend (Son 30 Gün):                        │
│  $2 ┤                                               │
│     │     ╭─╮                    ╭─╮                │
│  $1 ┤ ╭─╮│ │╭──╮   ╭──╮   ╭──╮│ │                │
│     │╭╯ ╰╯ ╰╯  ╰───╯  ╰───╯  ╰╯ ╰──             │
│  $0 ┤                                               │
│     └──────────────────────────────────→            │
│                                                      │
│  API Key Durumu:                                    │
│  ├── OpenAI:    Aktif, bakiye yeterli               │
│  ├── Anthropic: Aktif, bakiye yeterli               │
│  └── Gemini:    Bağlı değil [Bağla]                │
└─────────────────────────────────────────────────────┘
```

### Bütçe & Uyarı Ayarları
```
┌─────────────────────────────────────────┐
│  Bütçe Ayarları                         │
│                                          │
│  Aylık API Harcama Limiti: [$20.00  ]   │
│                                          │
│  Uyarılar:                              │
│  ☑ %50'de bildirim gönder              │
│  ☑ %75'te uyarı gönder                 │
│  ☑ %90'da acil bildirim                │
│  ☑ %100'de Consciousness Loop'u durdur │
│                                          │
│  Bütçe Aşılınca:                        │
│  ○ Tamamen durdur (LLM çağrısı yapma)   │
│  ● Ucuz modele düş (Haiku/Flash)        │
│  ○ Sadece kullanıcı mesajlarına cevap ver│
│    (Consciousness Loop durur)            │
│                                          │
│  Model Limitleri (günlük):              │
│  Claude Opus:     max [$2.00/gün]       │
│  GPT-4o:          max [$3.00/gün]       │
│  Claude Haiku:    sınırsız              │
│  Gemini Flash:    sınırsız              │
│                                          │
│  [Kaydet]                               │
└─────────────────────────────────────────┘
```

### Consciousness Loop Maliyet Kontrolü
```
┌─────────────────────────────────────────┐
│  Bilinç Döngüsü Maliyet Ayarları       │
│                                          │
│  Tick modeli seçimi:                    │
│  ├── Konuşma modeli: [Claude Sonnet ▼] │
│  ├── Consciousness tick: [Haiku     ▼] │
│  ├── Memory extraction: [Haiku      ▼] │
│  └── Sleep Phase: [Haiku            ▼] │
│                                          │
│  Consciousness Loop:                    │
│  ☑ Aktif (dakikada 1 tick)             │
│  ☐ Sadece iş saatlerinde (08-22)       │
│  ☐ Devre dışı (sadece mesajlara cevap) │
│                                          │
│  Sleep Phase:                           │
│  ☑ Çöp toplama + Konsolidasyon          │
│  ☑ Yansıma (reflection)                │
│  ☐ Gece araştırması (ek maliyet)       │
│                                          │
│  Tahmini aylık Consciousness maliyeti:  │
│  ~$2.80 (Haiku ile, Watchdog aktif)     │
│                                          │
│  [Kaydet]                               │
└─────────────────────────────────────────┘
```

---

## Akıllı Maliyet Düşürme Teknikleri

### 1. Model Cascading (Kullanıcı Kontrolünde)

```
Kullanıcı ayarlarında model ataması:

┌──────────────────────────────────────────┐
│  Görev               │ Model            │
│  ────────────────────│─────────────────│
│  Kullanıcıyla sohbet │ Claude Sonnet    │
│  Consciousness tick  │ Claude Haiku     │
│  Memory extraction   │ Claude Haiku     │
│  Sleep Phase         │ Claude Haiku     │
│  Araştırma           │ GPT-4o-mini      │
└──────────────────────────────────────────┘

Tipik tasarruf: %50-70 (Consciousness + Sleep ucuz modelle)
```

### 2. Watchdog: En Büyük Tasarruf

```
Watchdog OLMADAN:
├── 1440 tick/gün × LLM çağrısı = ~$2-5/gün
└── Aylık: $60-150 (kullanıcının key'inden!)

Watchdog İLE:
├── 1440 tick/gün × Watchdog ($0) = $0
├── ~50-100 LLM çağrısı/gün (sadece gerektiğinde)
├── Consciousness: ~$0.05-0.10/gün (Haiku ile)
└── Aylık: $1.50-3.00 (%95+ tasarruf)

Bu tasarruf BYOK modelinde daha da kritik:
Kullanıcının parasını gereksiz harcamak = güven kaybı.
Watchdog = kullanıcının cüzdanının bekçisi.
```

### 3. Prompt Caching (Sağlayıcı Desteği)

| Sağlayıcı | Mekanizma | Tasarruf | Min Prefix |
|------------|-----------|----------|------------|
| Anthropic | `cache_control` breakpoint | %90 cached tokens | 1024 token |
| OpenAI | Otomatik (shared prefix) | %50 cached input | 1024 token |
| Google | Context Caching API | ~%75 cached tokens | 32768 token |

### 4. Semantic Cache (Anlam Tabanlı Önbellek)

```
Kullanıcı Sorgusu
       │
       ▼
[Embed] → [Vektör araması (cache)]
       │
  ┌────┴────┐
  │         │
Cache HIT  Cache MISS
(sim>0.95)    │
  │           ▼
  │      [LLM Çağrısı] (BYOK key ile)
  │           │
  ▼           ▼
Cached      Yeni yanıt → Cache'e kaydet
yanıt
(ÜCRETSİZ)
```

### 5. Token-Efficient Prompting

| Teknik | Tasarruf |
|--------|----------|
| JSON mode (yapısal çıktı) | %30-50 output token |
| `max_tokens` limiti | Kaçak generation engeli |
| Kullanılmayan tool tanımlarını çıkar | ~500 token/istek |
| Konuşma özetleme (her 10 turda) | ~2000 token/istek |
| "Kısa ol" system prompt | ~%40 output azalma |

---

## Teknik Mimari (BYOK)

```
┌───────────────────────────────────────────────┐
│              TENANT CONTAINER                  │
│                    │                           │
│                    ▼                           │
│  ┌─────────────────────────────────┐          │
│  │      LiteLLM Proxy (BYOK)      │          │
│  │  - Vault'tan key çeker          │          │
│  │  - Model routing (cascade)     │          │
│  │  - Caching (semantic)          │          │
│  │  - Rate limiting               │          │
│  │  - Budget caps (kullanıcı bütçesi)│       │
│  │  - Metrics emission             │          │
│  └──────────┬──────────────────────┘          │
│             │                                  │
│   ┌─────────┼─────────┐                       │
│   ▼         ▼         ▼                       │
│ Anthropic  OpenAI   Google                    │
│ (kullanıcı (kullanıcı (kullanıcı              │
│  key'i)     key'i)     key'i)                 │
│                                                │
│  ┌─────────────────────────────────┐          │
│  │     Metrics Store               │          │
│  │  (SQLite — per tenant)          │          │
│  │  - Per-request: model, tokens,  │          │
│  │    cost, source (chat/tick/sleep)│          │
│  │  - Daily/weekly/monthly totals  │          │
│  │  - Budget tracking              │          │
│  │  - Key health status            │          │
│  └──────────┬──────────────────────┘          │
│             │                                  │
│             ▼                                  │
│  ┌─────────────────────────────────┐          │
│  │     Dashboard + Alerts          │          │
│  │  - Web UI (ayarlar paneli)     │          │
│  │  - WhatsApp/Telegram alerts    │          │
│  │  - Budget limit enforcement    │          │
│  │  - Key health monitoring       │          │
│  └─────────────────────────────────┘          │
└───────────────────────────────────────────────┘
```

---

## Takip Edilecek Metrikler

| Metrik | Neden Önemli (BYOK) |
|--------|---------------------|
| İstek başına maliyet (P50, P95, P99) | Pahalı outlier tespiti — kullanıcının parasını korur |
| Kaynak bazlı maliyet (chat/tick/sleep) | Consciousness Loop ne kadar harcıyor? |
| Model bazlı maliyet | Hangi model en çok token yiyor? |
| Sağlayıcı bazlı maliyet | OpenAI vs Anthropic karşılaştırma |
| Cache hit oranı | Cache ne kadar tasarruf sağlıyor? |
| Watchdog skip oranı | Watchdog gereksiz LLM çağrılarının kaçını engelledi? |
| Günlük/haftalık trend | Bütçe tahmini |
| Key health status | API key geçerli mi? Bakiye var mı? |

---

## API Key Health Monitoring

```
┌──────────────────────────────────────────────────────────┐
│  KEY HEALTH MONITOR (Her 1 saatte kontrol)                │
│                                                           │
│  Kontroller:                                             │
│  ├── API key geçerli mi? (test çağrısı — minimal token) │
│  ├── Rate limit'e yaklaştık mı?                          │
│  ├── Bakiye/kredi durumu (provider API varsa)            │
│  └── Key son ne zaman başarılı kullanıldı?               │
│                                                           │
│  Durumlar:                                               │
│  ├── HEALTHY:  Key çalışıyor, bakiye yeterli            │
│  ├── WARNING:  Bakiye azalıyor / rate limit yakın        │
│  ├── ERROR:    Key geçersiz / expire olmuş               │
│  └── MISSING:  Key girilmemiş                            │
│                                                           │
│  ERROR durumunda:                                        │
│  ├── Kullanıcıya bildir: "OpenAI key'in geçersiz olmuş. │
│  │   Kontrol eder misin? Ayarlar → API Key'ler"         │
│  ├── Consciousness Loop: Watchdog devam eder ($0)        │
│  │   ama LLM çağrısı durur                               │
│  ├── Gelen mesajlar: Buffer'da bekler                    │
│  └── Key düzeltilince: Buffer'dan mesajları işler        │
└──────────────────────────────────────────────────────────┘
```

---

## Uygulama Yol Haritası

### Milestone 1: Temel BYOK İzleme (Single-Tenant)
- Her LLM çağrısında token sayısı + maliyet kaydı (SQLite)
- Kaynak bazlı etiketleme (chat / consciousness / sleep / extraction)
- CLI: `openclaw cost today/week/month`
- Basit bütçe limiti (aşılınca Consciousness Loop durur)
- Key health check (basit — API call test)

### Milestone 3: Tam Dashboard (Multi-Tenant)
- Web UI ile görsel maliyet dashboard
- Model, sağlayıcı ve kaynak bazlı breakdown
- Günlük trend grafiği
- Bütçe uyarıları (WhatsApp/Telegram)
- Consciousness Loop maliyet kontrol paneli
- Key health monitoring + auto-alert
- Model cascading ayarları (kullanıcı kontrolünde)
- Semantic cache (GPTCache entegrasyonu)
- Prompt caching (Anthropic/OpenAI native)

Bu dosya, dosya 03 (BYOK SaaS + Vault) ve dosya 01 (Watchdog maliyet tasarrufu) ile entegre çalışır.
