# 4. Maliyet İzleme ve Dashboard

## Vizyon
Kullanıcılar "burns through tokens fast" diye şikayet ediyor. Üçüncü parti "ClawWatcher" aracı sırf bu ihtiyaç için yazılmış. OpenClaw'un **built-in maliyet kontrol sistemi** olmalı.

---

## Mevcut Durum
- `skills/model-usage/` — Basit model kullanım skill'i
- Token/maliyet takibi yok
- Bütçe limiti yok
- Harcama uyarısı yok
- Model bazlı maliyet karşılaştırması yok

---

## Açık Kaynak Maliyet İzleme Çözümleri

### Tier 1: Entegre Edilebilir Platformlar

| Platform | Stars | Yaklaşım | Avantaj |
|----------|-------|----------|---------|
| **Langfuse** | 6k+ | Self-host, trace bazlı maliyet | En iyi açık kaynak seçenek |
| **LiteLLM** | 14k+ | API proxy, anahtar bazlı bütçe | Bütçe limitleri built-in |
| **OpenLIT** | 2k+ | OpenTelemetry-native | Grafana entegrasyonu |
| **Lunary** | 1k+ | LLM observability + maliyet | Basit dashboard |
| **Helicone** | 5k+ | Proxy tabanlı, gerçek zamanlı | En kolay entegrasyon |

### Tier 2: Proxy/Gateway Çözümleri

**LiteLLM** — En güçlü seçenek:
```
App → LiteLLM Proxy → OpenAI/Anthropic/Google
          │
          ├── Per-key bütçe limitleri
          ├── Otomatik istek reddi (bütçe aşılınca)
          ├── Admin dashboard (maliyet by model/key/team)
          └── 100+ provider desteği
```

---

## Önerilen Dashboard Tasarımı

### Ana Ekran
```
┌─────────────────────────────────────────────────────┐
│  💰 Maliyet Dashboard                    Mart 2026  │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │ Bugün    │ │ Bu Hafta │ │ Bu Ay    │ │ Bütçe  │ │
│  │ $0.47   │ │ $3.21   │ │ $12.85  │ │ $20.00 │ │
│  │ ↑12%    │ │ ↓5%     │ │ 64%     │ │ ██████░│ │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘ │
│                                                      │
│  📊 Model Bazlı Maliyet (Bu Ay)                    │
│  ┌────────────────────────────────────────────┐     │
│  │ Claude Sonnet  ████████████████  $8.20     │     │
│  │ GPT-4o-mini    ████               $2.15     │     │
│  │ Whisper        ██                  $1.50     │     │
│  │ DALL-E 3       █                   $1.00     │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  🔧 Skill Bazlı Maliyet                            │
│  ┌────────────────────────────────────────────┐     │
│  │ coding-agent   ████████████████  $6.00     │     │
│  │ email-summary  ████               $2.50     │     │
│  │ web-search     ███                 $2.00     │     │
│  │ voice-chat     ██                  $1.35     │     │
│  │ diğer          █                   $1.00     │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  📈 Günlük Trend (Son 30 Gün)                      │
│  $2 ┤                                               │
│     │     ╭─╮                    ╭─╮                │
│  $1 ┤ ╭─╮│ │╭──╮   ╭──╮   ╭──╮│ │                │
│     │╭╯ ╰╯ ╰╯  ╰───╯  ╰───╯  ╰╯ ╰──             │
│  $0 ┤                                               │
│     └──────────────────────────────────→            │
└─────────────────────────────────────────────────────┘
```

### Bütçe & Uyarı Ayarları
```
┌─────────────────────────────────────────┐
│  ⚙️ Bütçe Ayarları                     │
│                                          │
│  Aylık Bütçe Limiti:  [$20.00    ]     │
│                                          │
│  Uyarılar:                              │
│  ☑ %50'de WhatsApp bildirimi            │
│  ☑ %75'te e-posta uyarısı              │
│  ☑ %90'da acil bildirim                │
│  ☑ %100'de istekleri durdur            │
│                                          │
│  Model Limitleri:                       │
│  Claude Opus:   Günlük max [$2.00]     │
│  DALL-E 3:      Günlük max [$1.00]     │
│                                          │
│  [Kaydet]                               │
└─────────────────────────────────────────┘
```

---

## Akıllı Maliyet Düşürme Teknikleri

### 1. Model Cascading (Kademeli Yönlendirme)

```
Kullanıcı Sorgusu
       │
       ▼
┌──────────────────┐
│ Karmaşıklık      │
│ Değerlendirme    │
│ (küçük model)    │
└───────┬──────────┘
        │
   ┌────┴────┐
   │         │
Basit     Karmaşık
   │         │
   ▼         ▼
GPT-4o-mini  Claude Opus
~$0.001      ~$0.05
```

**Tipik tasarruf:** %40-70 maliyet düşüşü, <%5 kalite kaybı

### 2. Prompt Caching (Sağlayıcı Desteği)

| Sağlayıcı | Mekanizma | Tasarruf | Min Prefix |
|------------|-----------|----------|------------|
| Anthropic | `cache_control` breakpoint | %90 cached tokens | 1024 token |
| OpenAI | Otomatik (shared prefix) | %50 cached input | 1024 token |
| Google | Context Caching API | ~%75 cached tokens | 32768 token |

### 3. Semantic Cache (Anlam Tabanlı Önbellek)

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
  │      [LLM Çağrısı]
  │           │
  ▼           ▼
Cached      Yeni yanıt → Cache'e kaydet
yanıt
```

**GPTCache** (`zillizcloud/gptcache`) — %30-70 maliyet düşüşü tekrarlı sorgularda

### 4. Token-Efficient Prompting

| Teknik | Tasarruf |
|--------|----------|
| JSON mode (yapısal çıktı) | %30-50 output token |
| `max_tokens` limiti | Kaçak generation engeli |
| Kullanılmayan tool tanımlarını çıkar | ~500 token/istek |
| Konuşma özetleme (her 10 turda) | ~2000 token/istek |
| "Kısa ol" system prompt | ~%40 output azalma |

### 5. Lokal Model Fallback

```
Basit sorgu → Ollama (Llama 3.1 8B) → ÜCRETSİZ
Karmaşık sorgu → Cloud API (Claude/GPT-4) → Ücretli

Maliyet karşılaştırma:
- Cloud API: $3.00/M input tokens (Claude Sonnet)
- Lokal Llama 8B: ~$0.03/M tokens (100x ucuz)
- Break-even: ~10k istek/gün
```

---

## Teknik Mimari

```
┌───────────────────────────────────────────────┐
│              OpenClaw Gateway                  │
│                    │                           │
│                    ▼                           │
│  ┌─────────────────────────────────┐          │
│  │      AI Gateway/Proxy Layer     │          │
│  │  (LiteLLM veya custom proxy)    │          │
│  │  - Routing (cascade)            │          │
│  │  - Caching (semantic)           │          │
│  │  - Rate limiting                │          │
│  │  - Budget caps                  │          │
│  │  - Metrics emission             │          │
│  └──────────┬──────────────────────┘          │
│             │                                  │
│   ┌─────────┼─────────┐                       │
│   ▼         ▼         ▼                       │
│ Cloud    Cloud    Lokal Model                 │
│ (OpenAI) (Anthropic) (Ollama)                 │
│                                                │
│  ┌─────────────────────────────────┐          │
│  │     Metrics Store               │          │
│  │  (SQLite / InfluxDB)            │          │
│  │  - Per-request cost             │          │
│  │  - Per-model aggregation        │          │
│  │  - Per-skill breakdown          │          │
│  │  - Daily/weekly/monthly totals  │          │
│  └──────────┬──────────────────────┘          │
│             │                                  │
│             ▼                                  │
│  ┌─────────────────────────────────┐          │
│  │     Dashboard + Alerts          │          │
│  │  - Web UI (Canvas/React)        │          │
│  │  - Slack/WhatsApp alerts        │          │
│  │  - CSV/JSON export              │          │
│  └─────────────────────────────────┘          │
└───────────────────────────────────────────────┘
```

---

## Takip Edilecek Metrikler

| Metrik | Neden Önemli |
|--------|-------------|
| İstek başına maliyet (P50, P95, P99) | Pahalı outlier tespiti |
| Kullanıcı/session başına maliyet | Birim ekonomisi |
| Skill başına maliyet | ROI analizi |
| Cache hit oranı | Cache etkinliği |
| Model dağılımı (% by model) | Routing doğrulaması |
| Token verimliliği (output/input) | Prompt optimizasyonu |
| Günlük/haftalık trend | Bütçe tahmini |

---

## Uygulama Yol Haritası

### Faz 1: Temel İzleme
- Her LLM çağrısında token sayısı + maliyet kaydı
- SQLite'da basit metrik saklama
- CLI: `openclaw cost today/week/month`
- Basit maliyet limiti (aşılınca durdur)

### Faz 2: Dashboard
- Web UI ile görsel maliyet dashboard
- Model ve skill bazlı breakdown
- Günlük trend grafiği
- Bütçe uyarıları (WhatsApp/Telegram/Slack)

### Faz 3: Akıllı Optimizasyon
- Model cascading (basit→ucuz, karmaşık→pahalı)
- Semantic cache (GPTCache entegrasyonu)
- Prompt caching (Anthropic/OpenAI native)
- Lokal model fallback (Ollama)

### Faz 4: İleri Analitik
- Maliyet tahminleme (trend analizi)
- Anomaly detection (anormal harcama uyarısı)
- Per-skill ROI analizi
- Otomatik model seçim optimizasyonu
