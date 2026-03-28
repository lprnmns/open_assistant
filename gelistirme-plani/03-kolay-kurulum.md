# 03 — BYOK SaaS: Kendi Anahtarını Getir, Kayıt Ol ve Başla

> Eski vizyon: "Platform-Managed LLM — kullanıcı API key görmez"
> Yeni vizyon: **"BYOK (Bring Your Own Keys) — Kullanıcı kendi API key'ini güvenle Vault'a girer. Biz zeka satmıyoruz, zekanın 7/24 yaşayacağı evi satıyoruz."**

---

## Paradigma Değişimi

```
ESKİ MODEL (Platform-Managed LLM):      YENİ MODEL (BYOK SaaS):
──────────────────────────────────       ─────────────────────────────
Platform API key alır, yönetir           Kullanıcı kendi key'ini getirir
LLM maliyeti platform'a ait             LLM maliyeti kullanıcıya ait
Platform toplu alım indirimi            Kullanıcı kendi planını seçer
Karmaşık fiyatlandırma (token bazlı)    Basit: ~$10/ay altyapı ücreti
Platform kâr marjı: düşük (LLM pahalı) Platform kâr marjı: YÜKSEK
Vendor lock-in riski                     Kullanıcı istediği LLM'i kullanır
```

**Neden bu karar doğru:**
```
Platform-Managed modelde:
├── 1000 kullanıcı × $5/gün LLM = $150,000/ay MALİYET
├── Kâr marjı: %10-20 (çok riskli)
└── Bir LLM fiyat artışı = iflas riski

BYOK modelinde:
├── 1000 kullanıcı × $10/ay abonelik = $10,000/ay GELİR
├── LLM maliyeti: $0 (kullanıcı ödüyor)
├── Altyapı maliyeti: ~$2,000/ay (Kubernetes cluster)
├── Kâr marjı: %80 (sürdürülebilir)
└── LLM fiyatları bizi ETKİLEMEZ
```

---

## Kullanıcı Deneyimi (Hedef)

### Milestone 3 (Multi-Tenant SaaS) UX:

```
┌──────────────────────────────────────────────────────────┐
│                                                           │
│                    Open Assistant                         │
│                                                           │
│            7/24 yaşayan kişisel AI altyapın.             │
│            Kendi API key'ini getir, gerisini biz halledelim.│
│                                                           │
│            ┌──────────────────────────┐                   │
│            │  Google ile Kayıt Ol     │                   │
│            └──────────────────────────┘                   │
│            ┌──────────────────────────┐                   │
│            │  Apple ile Kayıt Ol      │                   │
│            └──────────────────────────┘                   │
│            ┌──────────────────────────┐                   │
│            │  E-posta ile Kayıt Ol    │                   │
│            └──────────────────────────┘                   │
│                                                           │
│            Zaten hesabın var mı? Giriş yap               │
│                                                           │
└──────────────────────────────────────────────────────────┘

                    ↓ (kayıt oldu)

┌──────────────────────────────────────────────────────────┐
│                                                           │
│  API Key'lerini Bağla                                    │
│                                                           │
│  Asistanın senin için düşünebilmesi için en az 1 API     │
│  key'e ihtiyacı var. Key'lerin şifreli kasada saklanır,  │
│  kimse göremez — sadece senin asistanın kullanır.        │
│                                                           │
│  ┌──────────────────────────────────────────────┐       │
│  │  OpenAI API Key                               │       │
│  │  [sk-proj-________________________________]   │       │
│  │  Nereden alırım? → platform.openai.com/api-keys│      │
│  └──────────────────────────────────────────────┘       │
│                                                           │
│  ┌──────────────────────────────────────────────┐       │
│  │  Anthropic API Key (opsiyonel)                │       │
│  │  [sk-ant-_________________________________]   │       │
│  │  Nereden alırım? → console.anthropic.com      │       │
│  └──────────────────────────────────────────────┘       │
│                                                           │
│  ┌──────────────────────────────────────────────┐       │
│  │  Google Gemini API Key (opsiyonel)            │       │
│  │  [AI___________________________________]      │       │
│  │  Nereden alırım? → aistudio.google.com        │       │
│  └──────────────────────────────────────────────┘       │
│                                                           │
│  🔒 Key'lerin AES-256 ile şifrelenir.                   │
│     Biz dahil kimse düz halini göremez.                  │
│                                                           │
│  [Devam Et →]                                            │
│                                                           │
└──────────────────────────────────────────────────────────┘

                    ↓ (key girdi, devam etti)
              arka planda ~5 saniye:
        ├── Kubernetes namespace oluştur
        ├── Container/MicroVM ayağa kaldır
        ├── Gateway başlat
        ├── API Key'i Vault'a şifrele ve kaydet
        ├── LiteLLM Proxy'yi key ile yapılandır
        ├── Consciousness Loop başlat
        ├── Deep Memory DB oluştur
        └── Kanal bağlantısı hazırla

                    ↓ (hazır)

┌──────────────────────────────────────────────────────────┐
│                                                           │
│  Merhaba! Ben senin kişisel asistanın.                   │
│                                                           │
│  Seni tanımak istiyorum. Birkaç şey sorayım mı,         │
│  yoksa direkt sohbete mi başlayalım? Konuştukça          │
│  zaten öğrenirim.                                         │
│                                                           │
│  ┌────────────────────┐  ┌─────────────────────┐        │
│  │  Birkaç şey sor    │  │  Direkt başlayalım  │        │
│  └────────────────────┘  └─────────────────────┘        │
│                                                           │
│  Beni şu kanallardan da kullanabilirsin:                 │
│  [WhatsApp] [Telegram] [Discord] [Slack]                 │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

**Sıfır teknik adım (LLM tarafında).** Docker yok, terminal yok, model seçimi yok.
Sadece key gir — gerisini platform halleder.

---

## Arka Plan: Auto-Provisioning Mimarisi

### Kayıt Akışı (Kullanıcı Perspektifi: 5-10 saniye)

```
┌──────────────────────────────────────────────────────────┐
│                    PROVISIONING PIPELINE                   │
│                                                           │
│  Kullanıcı "Kayıt Ol" tıkladı                           │
│       │                                                   │
│       ▼                                                   │
│  1. AUTH SERVICE                                          │
│     ├── OAuth callback (Google/Apple)                     │
│     ├── JWT token üret                                    │
│     ├── User record oluştur (PostgreSQL)                 │
│     └── Tenant ID ata: usr_abc123                        │
│       │                                                   │
│       ▼                                                   │
│  2. KEY VAULT SERVICE                                     │
│     ├── Kullanıcının API key'lerini al                   │
│     ├── AES-256-GCM ile şifrele                          │
│     ├── Per-tenant encryption key (master key'den derive)│
│     ├── Encrypted key'i Vault'a kaydet                   │
│     ├── Düz metin key'i bellekten sil                    │
│     └── Audit log: "key_stored" event                    │
│       │                                                   │
│       ▼                                                   │
│  3. PROVISIONER SERVICE                                   │
│     ├── Kubernetes Namespace oluştur: ns-usr-abc123      │
│     ├── ResourceQuota uygula (CPU: 500m, RAM: 512Mi)     │
│     ├── NetworkPolicy uygula (izolasyon)                 │
│     ├── PersistentVolumeClaim oluştur (bellek depoları)  │
│     └── Vault access policy ata (sadece kendi key'leri)  │
│       │                                                   │
│       ▼                                                   │
│  4. DEPLOY SERVICE                                        │
│     ├── OpenClaw Gateway Pod başlat                      │
│     ├── LiteLLM sidecar başlat (Vault'tan key çeker)    │
│     ├── Consciousness Loop sidecar başlat                │
│     ├── Deep Memory DB (LanceDB) init                    │
│     ├── Readiness probe → hazır mı?                      │
│     └── Hazır! WebSocket bağlantısı aç                   │
│       │                                                   │
│       ▼                                                   │
│  5. ONBOARDING                                            │
│     ├── Web chat arayüzüne yönlendir                     │
│     ├── İlk mesajı gönder (BYOK key ile LLM çağrısı)   │
│     └── Consciousness Loop: ilk tick                     │
│                                                           │
│  Toplam süre: ~5-10 saniye                               │
└──────────────────────────────────────────────────────────┘
```

### Ölçekleme ve Maliyet Kontrolü

```
SCALE-TO-ZERO + EVENT BUFFER (Sıfır Mesaj Kaybı):

├── Kullanıcı 30dk inaktif → Container uyku moduna (RAM: ~50MB)
├── Kullanıcı 24h inaktif → Container durdur (RAM: 0, disk kalır)
├── VM uyurken gelen mesajlar → Redis Stream buffer'da bekler (72 saat TTL)
├── Kullanıcı mesaj yazar → Wake signal → ~2 saniyede container ayağa kalkar
├── İlk iş: Buffer'daki bekleyen mesajları FIFO sırasıyla oku
├── Dead Letter Queue: 3 denemede işlenemeyen mesajlar → admin dashboard
├── Consciousness Loop Watchdog: VM uyurken bile minimal tick (sıfır LLM)
│   └── Watchdog, buffer'da mesaj birikiyor mu diye kontrol eder
└── Deep Memory: Disk'te kalıcı (PVC), container ölse bile kaybolmaz

PLATFORM MALİYET MATEMATİĞİ (tahmini):
├── Aktif kullanıcı container: ~$3-5/ay (CPU + RAM + storage)
├── Yarı-aktif kullanıcı: ~$1-2/ay (uyku + arada tick)
├── İnaktif kullanıcı: ~$0.10/ay (sadece disk)
├── LLM maliyeti: $0 (BYOK — kullanıcı kendi ödüyor)
├── Scale-to-zero ile 1000 kullanıcı = ~200 aktif container
├── Platform geliri: 1000 × $10/ay = $10,000/ay
└── Platform kâr marjı: ~%80
```

---

## BYOK: Secure API Key Vault Mimarisi

```
┌──────────────────────────────────────────────────────────┐
│                    BYOK KEY VAULT                          │
│                                                           │
│  Kullanıcı API key girer (Web UI / Ayarlar)              │
│       │                                                   │
│       ▼                                                   │
│  ┌──────────────────────────────────────────────┐       │
│  │  KEY ENCRYPTION PIPELINE                       │       │
│  │                                                │       │
│  │  1. Input validation                           │       │
│  │     ├── Format kontrolü (sk-proj-*, sk-ant-*)  │       │
│  │     ├── Provider tespiti (OpenAI/Anthropic/...) │      │
│  │     └── Test API call (key geçerli mi?)        │       │
│  │                                                │       │
│  │  2. Encryption                                 │       │
│  │     ├── Master key: platform-level (HSM/KMS)   │       │
│  │     ├── Tenant key: master'dan derive (HKDF)   │       │
│  │     ├── Encrypt: AES-256-GCM(tenant_key, api_key)│    │
│  │     └── Nonce: her encryption'da unique         │       │
│  │                                                │       │
│  │  3. Storage                                    │       │
│  │     ├── M1: Encrypted config file (basit)      │       │
│  │     ├── M3: HashiCorp Vault / Sealed Secrets   │       │
│  │     └── Key rotation: kullanıcı istediğinde    │       │
│  │                                                │       │
│  │  4. Runtime access                             │       │
│  │     ├── LiteLLM proxy başlarken Vault'tan çeker│       │
│  │     ├── Bellekte tutar (diske yazmaz)          │       │
│  │     ├── Container restart → tekrar çeker       │       │
│  │     └── Audit log: her erişim kaydedilir       │       │
│  └──────────────────────────────────────────────┘       │
│                                                           │
│  GÜVENLİK GARANTİLERİ:                                  │
│  ├── Key düz metin olarak asla loglanmaz                 │
│  ├── Key disk'e şifresiz yazılmaz                        │
│  ├── Platform çalışanları key'lere erişemez              │
│  ├── Tenant A, Tenant B'nin key'ini göremez              │
│  ├── Key sadece ilgili tenant container'ında decrypt olur│
│  └── Kullanıcı istediğinde key'i silebilir/değiştirebilir│
└──────────────────────────────────────────────────────────┘
```

### LiteLLM Proxy (BYOK Mode)

```
┌──────────────────────────────────────────────────────────┐
│                    LiteLLM PROXY (BYOK)                    │
│                                                           │
│  Gateway LLM çağrısı yapmak istiyor                      │
│       │                                                   │
│       ▼                                                   │
│  LiteLLM Proxy (per-tenant sidecar)                      │
│  ├── Vault'tan kullanıcının key'lerini çek               │
│  ├── Kullanıcının tercih ettiği model'i seç              │
│  │   ├── Kullanıcı tercih belirlemediyse → default model │
│  │   ├── Consciousness tick → ucuz model (varsa)         │
│  │   └── User message → güçlü model                      │
│  ├── API çağrısı yap (kullanıcının key'iyle)             │
│  ├── Token kullanımını logla (maliyet dashboard için)    │
│  ├── Key hatalıysa / geçersizse:                         │
│  │   ├── Kullanıcıya bildir: "API key'in geçersiz/       │
│  │   │   bakiyesi bitmiş. Kontrol eder misin?"           │
│  │   ├── Consciousness Loop duraklar (LLM çağrısı yok) │
│  │   └── Watchdog çalışmaya devam eder ($0)              │
│  └── Yanıtı Gateway'e döndür                             │
│                                                           │
│  Desteklenen sağlayıcılar:                               │
│  ├── OpenAI (GPT-4o, GPT-4o-mini, o1, ...)             │
│  ├── Anthropic (Claude Sonnet, Opus, Haiku)              │
│  ├── Google (Gemini Pro, Flash, Ultra)                    │
│  ├── Mistral, Groq, Together, vb.                        │
│  └── Self-hosted (Ollama, vLLM — ileri kullanıcılar)    │
└──────────────────────────────────────────────────────────┘
```

---

## Fiyatlandırma Modeli (Milestone 3)

```
┌──────────────────────────────────────────────────────────┐
│  FREE TRIAL (7 gün)                                      │
│  • 7 gün tam erişim (deneme)                             │
│  • Kendi API key'ini getir                               │
│  • Temel Consciousness Loop (15dk tick)                  │
│  • Web chat kanalı                                       │
│  • 100MB bellek depolama                                 │
│  • Deneme sonunda: Pro'ya geç veya veda                  │
├──────────────────────────────────────────────────────────┤
│  PRO PLAN — ~$10/ay                                      │
│  • 7/24 yaşayan container (Scale-to-Zero destekli)       │
│  • Kendi API key'lerini (BYOK) güvenli kasada sakla      │
│  • Consciousness Loop: 1dk tick (adaptive)               │
│  • Tüm kanallar (WhatsApp, Telegram, Discord, Web)      │
│  • 5GB bellek depolama (Living Brain)                    │
│  • Sleep Phase (gece konsolidasyon + araştırma)          │
│  • Maliyet Dashboard (kendi API harcamanı izle)          │
│  • Sınırsız trigger                                      │
│  • E-posta/takvim entegrasyonu                           │
├──────────────────────────────────────────────────────────┤
│  TEAM PLAN — ~$25/kullanıcı/ay                           │
│  • Pro'nun tüm özellikleri                               │
│  • Admin panel                                           │
│  • Paylaşılan bilgi tabanı                               │
│  • SSO / SAML                                            │
│  • SLA garantisi                                         │
│  • Öncelikli destek                                      │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  NOT: LLM maliyeti bu fiyatlara DAHİL DEĞİLDİR.         │
│  Kullanıcı kendi API hesabından öder.                    │
│  Ortalama kullanıcı LLM maliyeti: ~$3-10/ay             │
│  (Consciousness Loop Watchdog sayesinde düşük)           │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

---

## Onboarding: İlk 5 Dakika

Hardcoded soru listesi değil — **AI doğal sohbetle kullanıcıyı tanıyor.**

```
AI: "Merhaba! Ben senin kişisel asistanın.
     Seni tanımak istiyorum — birkaç şey sorayım mı,
     yoksa direkt konuşarak öğreneyim mi?"

Kullanıcı: "Sor"

AI: "Ne iş yapıyorsun? Öğrenci misin, çalışıyor musun?"

Kullanıcı: "Üniversite öğrencisiyim, bilgisayar mühendisliği"

AI: "Güzel! Sınavlar, ödevler, projeler derken yoğun bir
     tempo olmalı. Hangi kanaldan konuşmak istersin?
     WhatsApp'tan mı yazarsın yoksa buradan mı?"

[Sohbet doğal devam eder, AI arka planda profil oluşturur]
```

---

## Kanal Bağlama (OAuth Flow)

```
┌──────────────────────────────────────────────────────────┐
│  Kanallarını Bağla                                       │
│                                                           │
│  ┌──────────┐ Bağlandı                                   │
│  │ Web Chat │ (her zaman aktif)                          │
│  └──────────┘                                            │
│                                                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│  │WhatsApp  │ │Telegram  │ │Discord   │                │
│  │[Bağla]   │ │[Bağla]   │ │[Bağla]   │                │
│  └──────────┘ └──────────┘ └──────────┘                │
│                                                           │
│  Bağladıktan sonra istediğin kanaldan yaz,               │
│  ben hepsinden cevap veririm.                            │
│  Farketmez nereden yazarsan — seni tanırım.             │
└──────────────────────────────────────────────────────────┘
```

**Önemli:** Kanallar arasında tam bağlam sürekliliği. WhatsApp'tan başladığın sohbete Telegram'dan devam edebilirsin. AI ikisinin de sen olduğunu bilir.

---

## Milestone 1: Hetzner Single-Tenant Altyapısı

Milestone 1'de Kubernetes yok. Basit Docker Compose ile Hetzner VPS'te çalışır.

```
┌──────────────────────────────────────────────────────────┐
│  HETZNER VPS (CX31: 2 vCPU, 8GB RAM, 80GB SSD)          │
│  ~€8/ay (~$9/ay)                                         │
│                                                           │
│  Docker Compose:                                         │
│  ┌─────────────────────────────────────────────┐        │
│  │  openclaw-gateway     (Node.js)              │        │
│  │  ├── Consciousness Loop (built-in)           │        │
│  │  ├── Watchdog (built-in)                     │        │
│  │  ├── Act-First Engine (built-in)             │        │
│  │  └── Memory Manager (built-in)               │        │
│  ├─────────────────────────────────────────────┤        │
│  │  litellm-proxy        (Python sidecar)       │        │
│  │  └── .env'den API key'leri okur              │        │
│  ├─────────────────────────────────────────────┤        │
│  │  redis                (Event Buffer + Cache) │        │
│  ├─────────────────────────────────────────────┤        │
│  │  lancedb              (Vektör bellek — dosya)│        │
│  ├─────────────────────────────────────────────┤        │
│  │  webchat-ui           (React, basit)         │        │
│  └─────────────────────────────────────────────┘        │
│                                                           │
│  Maliyet:                                                │
│  ├── Hetzner VPS: ~$9/ay                                │
│  ├── Domain + SSL: ~$1/ay                               │
│  ├── LLM (BYOK): Kendi API hesabımdan                   │
│  └── Toplam: ~$10/ay                                    │
└──────────────────────────────────────────────────────────┘
```

---

## Teknik Altyapı Stack (Milestone'lara Göre)

### Milestone 1: Single-Tenant (Hetzner)
```
┌──────────────────────────────────────────────────────────┐
│  SINGLE-TENANT STACK                                      │
│                                                           │
│  Runtime:     Node.js + TypeScript                       │
│  LLM Proxy:   LiteLLM (Docker sidecar)                  │
│  Key Storage:  .env (encrypted) → basit ama yeterli     │
│  Buffer:      Redis Streams                               │
│  Vektör DB:   LanceDB (embedded, dosya tabanlı)          │
│  Graph DB:    Kuzu (embedded) — M1 sonuna doğru          │
│  Web UI:      React (basit chat arayüzü)                 │
│  Deploy:      Docker Compose on Hetzner VPS              │
│  Kanal:       Web + WhatsApp veya Telegram (1 kanal)     │
│  Monitoring:  Basit loglar + healthcheck                  │
└──────────────────────────────────────────────────────────┘
```

### Milestone 3: Multi-Tenant (Kubernetes)
```
┌──────────────────────────────────────────────────────────┐
│  MULTI-TENANT PLATFORM STACK                              │
│                                                           │
│  ┌─────────────────────────┐                             │
│  │      WEB FRONTEND       │  React / Next.js            │
│  │  • Chat UI              │  Vercel Edge'de host        │
│  │  • Dashboard            │                              │
│  │  • Ayarlar (BYOK keys)  │                              │
│  └───────────┬─────────────┘                             │
│              │ WebSocket + REST                           │
│  ┌───────────▼─────────────┐                             │
│  │      API GATEWAY        │  Kong / Traefik             │
│  │  • Auth (JWT)           │  Rate limiting              │
│  │  • Routing              │  SSL termination            │
│  │  • WebSocket proxy      │                              │
│  └───────────┬─────────────┘                             │
│              │                                            │
│  ┌───────────▼─────────────┐                             │
│  │   CONTROL PLANE         │                              │
│  │  • User Service         │  Node.js microservices      │
│  │  • Provisioner          │  Kubernetes operators       │
│  │  • Billing (Stripe)     │                              │
│  │  • Channel Broker       │  WhatsApp/TG/Slack bridges  │
│  │  • Key Vault Service    │  Encrypt/decrypt/rotate     │
│  └───────────┬─────────────┘                             │
│              │                                            │
│  ┌───────────▼─────────────────────────────────────┐     │
│  │            TENANT PLANE (per-user)               │     │
│  │  ┌─────────────┐ ┌─────────────┐ ┌──────────┐  │     │
│  │  │   Gateway    │ │Consciousness│ │  Memory  │  │     │
│  │  │   (OpenClaw) │ │   Loop      │ │  (Lance  │  │     │
│  │  │              │ │   Sidecar   │ │   DB +   │  │     │
│  │  │              │ │             │ │   Kuzu)  │  │     │
│  │  └──────────────┘ └─────────────┘ └──────────┘  │     │
│  │  ┌─────────────┐                                │     │
│  │  │  LiteLLM    │ ← Vault'tan BYOK key çeker    │     │
│  │  │  Proxy      │                                │     │
│  │  └─────────────┘                                │     │
│  └─────────────────────────────────────────────────┘     │
│              │                                            │
│  ┌───────────▼─────────────┐                             │
│  │    SHARED SERVICES       │                              │
│  │  • PostgreSQL            │  User data, billing        │
│  │  • Redis                 │  Cache, pub/sub, buffer    │
│  │  • S3/MinIO              │  Dosya depolama            │
│  │  • HashiCorp Vault       │  BYOK key yönetimi        │
│  │  • Prometheus + Grafana  │  Monitoring                │
│  └──────────────────────────┘                             │
└──────────────────────────────────────────────────────────┘
```

---

## Self-Hosted Seçenek (İleri Kullanıcılar İçin)

SaaS birincil ürün, ama açık kaynak olduğu için self-host seçeneği de kalır:

```
# İleri kullanıcılar için (opsiyonel, desteklenen ama önerilmeyen)
docker compose up -d
# .env'ye kendi API key'lerini yaz, çalıştır

# Veya tek satır:
curl -fsSL https://get.openassistant.ai | bash
```

Ama pazarlama mesajı: **"Kendi key'ini getir, biz 7/24 yaşat. Self-host istiyorsan kodlar açık."**

---

## Mobile App (Milestone 3 Sonrası)

```
Web-first başla, sonra native app:

İlk: PWA (Progressive Web App)
├── Mobil tarayıcıdan "Ana Ekrana Ekle"
├── Push notification desteği
├── Offline temel özellikler
└── Sıfır kurulum

Sonra: Native App (React Native / Flutter)
├── Sesli etkileşim (mikrofon erişimi)
├── Bildirimler (FCM/APNs)
├── Widget (Android/iOS)
└── Always-on companion
```

---

Bu dosya, dosya 02 (Cloud güvenlik + Vault), dosya 00 (Mega mimari + BYOK) ve dosya 04 (BYOK maliyet dashboard) ile entegre çalışır.
