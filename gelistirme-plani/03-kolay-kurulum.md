# 03 — Zero-Config Cloud SaaS: Kayıt Ol ve Başla

> Eski vizyon: "Electron desktop app + one-click installer"
> Yeni vizyon: **"Kullanıcı kayıt olur, arka planda izole cloud ortam saniyeler içinde ayağa kalkar. VPS yok, Docker yok, API key yok."**

---

## Paradigma Değişimi

```
ESKİ MODEL (Self-Hosted):             YENİ MODEL (Zero-Config SaaS):
──────────────────────────             ────────────────────────────────
Node.js 24+ kur                       Kayıt ol
API key al, yapıştır                   Google/Apple ile giriş yap
Docker compose up                      Asistan hazır
.env dosyası düzenle                   .env dosyası diye bir şey yok
Gateway'i kendin çalıştır             Platform çalıştırır
Sunucun kapanırsa asistan ölür        7/24 canlı, hiç ölmez
Güncelleme: git pull + rebuild        Otomatik, sıfır downtime
Teknik bilgi ŞART                     Anneannem bile kullanabilir
```

---

## Kullanıcı Deneyimi (Hedef)

```
┌──────────────────────────────────────────────────────────┐
│                                                           │
│                    🦞 OpenClaw                            │
│                                                           │
│            Kişisel AI Asistanın.                          │
│            Seni tanır, seni anlar, senin için çalışır.   │
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
              arka planda ~5 saniye:
        ├── Kubernetes namespace oluştur
        ├── Container/MicroVM ayağa kaldır
        ├── Gateway başlat
        ├── Consciousness Loop başlat
        ├── Deep Memory DB oluştur
        └── Kanal bağlantısı hazırla

                    ↓ (hazır)

┌──────────────────────────────────────────────────────────┐
│                                                           │
│  🦞 Merhaba! Ben senin kişisel asistanın.                │
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

**Sıfır teknik adım.** API key yok, Docker yok, terminal yok.

---

## Arka Plan: Auto-Provisioning Mimarisi

### Kayıt Akışı (Kullanıcı Perspektifi: 5 saniye)

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
│  2. PROVISIONER SERVICE                                   │
│     ├── Kubernetes Namespace oluştur: ns-usr-abc123      │
│     ├── ResourceQuota uygula (CPU: 500m, RAM: 512Mi)     │
│     ├── NetworkPolicy uygula (izolasyon)                 │
│     ├── PersistentVolumeClaim oluştur (bellek depoları)  │
│     └── Secret oluştur (platform API key — kullanıcı     │
│         görmez, platform kendi key'ini tenant'a verir)   │
│       │                                                   │
│       ▼                                                   │
│  3. DEPLOY SERVICE                                        │
│     ├── OpenClaw Gateway Pod başlat                      │
│     ├── Consciousness Loop sidecar başlat                │
│     ├── Deep Memory DB (LanceDB) init                    │
│     ├── Readiness probe → hazır mı?                      │
│     └── ✅ Hazır! WebSocket bağlantısı aç               │
│       │                                                   │
│       ▼                                                   │
│  4. ONBOARDING                                            │
│     ├── Web chat arayüzüne yönlendir                     │
│     ├── İlk mesajı gönder                                │
│     └── Consciousness Loop: ilk tick                     │
│                                                           │
│  Toplam süre: ~3-8 saniye                                │
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

MALİYET MATEMATİĞİ (tahmini):
├── Aktif kullanıcı: ~$5-15/ay (CPU + RAM + storage + LLM)
├── Yarı-aktif kullanıcı: ~$1-3/ay (uyku + arada tick)
├── İnaktif kullanıcı: ~$0.10/ay (sadece disk)
├── LLM maliyeti: Platform toplu alım ile %40-60 indirim
└── Scale-to-zero ile 1000 kullanıcı = ~200 aktif container
```

---

## API Key Problemi: Platform-Managed LLM Access

```
ESKİ MODEL:
Kullanıcı → OpenAI'dan API key al → Yapıştır → Dua et çalışsın

YENİ MODEL:
Kullanıcı asla API key görmez.

┌──────────────────────────────────────────────────────────┐
│                    LLM PROXY LAYER                        │
│                                                           │
│  Kullanıcı mesaj yazar                                   │
│       │                                                   │
│       ▼                                                   │
│  Platform LLM Proxy                                      │
│  ├── Kullanıcının planına bak (Free/Pro/Team)            │
│  ├── Consciousness Loop tick mi, user message mi?        │
│  ├── Model seç:                                          │
│  │   ├── Free plan → Llama 3.1 (self-hosted) veya       │
│  │   │               Gemini Flash (ucuz)                 │
│  │   ├── Pro plan → Claude Sonnet / GPT-4o              │
│  │   └── Consciousness tick → Her zaman ucuz model      │
│  ├── Platform'un kendi API key'i ile çağrı yap          │
│  ├── Token kullanımını logla                             │
│  ├── Maliyeti kullanıcı hesabına yaz                     │
│  └── Yanıtı kullanıcıya döndür                          │
│                                                           │
│  Kullanıcı: API key? Ne API key'i?                       │
└──────────────────────────────────────────────────────────┘
```

### Fiyatlandırma Modeli

```
┌──────────────────────────────────────────────────────────┐
│  FREE PLAN (Herkes için)                                  │
│  • Günde 50 mesaj                                         │
│  • Temel model (Llama 3.1 / Gemini Flash)                │
│  • 5 aktif trigger                                       │
│  • 100MB bellek depolama                                 │
│  • Web chat + 1 kanal (WhatsApp veya Telegram)           │
│  • Consciousness Loop: 15dk'da 1 tick                    │
├──────────────────────────────────────────────────────────┤
│  PRO PLAN — $9.99/ay                                     │
│  • Sınırsız mesaj                                        │
│  • Güçlü modeller (Claude Sonnet, GPT-4o)                │
│  • Sınırsız trigger                                      │
│  • 5GB bellek depolama                                   │
│  • Tüm kanallar                                          │
│  • Consciousness Loop: 1dk'da 1 tick                     │
│  • Uyku Fazı (gece araştırma + konsolidasyon)           │
│  • E-posta/takvim entegrasyonu                           │
│  • Sesli etkileşim                                       │
├──────────────────────────────────────────────────────────┤
│  TEAM PLAN — $29.99/kullanıcı/ay                         │
│  • Pro'nun tüm özellikleri                               │
│  • Admin panel                                           │
│  • Paylaşılan bilgi tabanı                               │
│  • SSO / SAML                                            │
│  • API erişimi                                           │
│  • SLA garantisi                                         │
│  • Öncelikli destek                                      │
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

Arka planda oluşan profil:
{
  role: "üniversite öğrencisi",
  field: "bilgisayar mühendisliği",
  likely_needs: ["sınav hatırlatma", "proje takibi",
                 "staj arama", "teknik öğrenme"],
  preferred_channel: "whatsapp",  // sonra belirlenecek
  tone: "samimi",                 // Türkçe, informal
  schedule: "öğrenci rutini"      // sonra detaylanacak
}
```

---

## Kanal Bağlama (OAuth Flow)

```
┌──────────────────────────────────────────────────────────┐
│  Kanallarını Bağla                                       │
│                                                           │
│  ┌──────────┐ Bağlandı ✅                                │
│  │ Web Chat │ (her zaman aktif)                          │
│  └──────────┘                                            │
│                                                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│  │WhatsApp  │ │Telegram  │ │Discord   │                │
│  │[Bağla]   │ │[Bağla]   │ │[Bağla]   │                │
│  └──────────┘ └──────────┘ └──────────┘                │
│                                                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│  │Slack     │ │iMessage  │ │Signal    │                │
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

## Teknik Altyapı Stack

```
┌──────────────────────────────────────────────────────────┐
│  PLATFORM ARCHITECTURE                                    │
│                                                           │
│  ┌─────────────────────────┐                             │
│  │      WEB FRONTEND       │  React / Next.js            │
│  │  • Chat UI              │  Vercel Edge'de host        │
│  │  • Dashboard            │                              │
│  │  • Ayarlar              │                              │
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
│  │  • Billing              │  Stripe integration         │
│  │  • Channel Broker       │  WhatsApp/TG/Slack bridges  │
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
│  └─────────────────────────────────────────────────┘     │
│              │                                            │
│  ┌───────────▼─────────────┐                             │
│  │    SHARED SERVICES       │                              │
│  │  • LLM Proxy (LiteLLM)  │  Toplu API key yönetimi    │
│  │  • PostgreSQL            │  User data, billing        │
│  │  • Redis                 │  Cache, pub/sub            │
│  │  • S3/MinIO              │  Dosya depolama            │
│  │  • Vault                 │  Secret yönetimi           │
│  └──────────────────────────┘                             │
└──────────────────────────────────────────────────────────┘
```

---

## Self-Hosted Seçenek (İleri Kullanıcılar İçin)

SaaS birincil ürün, ama açık kaynak olduğu için self-host seçeneği de kalır:

```
# İleri kullanıcılar için (opsiyonel, desteklenen ama önerilmeyen)
docker compose up -d

# Veya tek satır:
curl -fsSL https://get.openclaw.ai | bash
```

Ama pazarlama mesajı: **"Kayıt ol, kullan. Self-host istiyorsan kodlar açık."**

---

## Mobile App (Faz 2)

```
Web-first başla, sonra native app:

Faz 1: PWA (Progressive Web App)
├── Mobil tarayıcıdan "Ana Ekrana Ekle"
├── Push notification desteği
├── Offline temel özellikler
└── Sıfır kurulum

Faz 2: Native App (React Native / Flutter)
├── Sesli etkileşim (mikrofon erişimi)
├── Bildirimler (FCM/APNs)
├── Sensör erişimi (GPS, adımölçer)
├── Widget (Android/iOS)
└── Always-on companion
```

---

## Uygulama Yol Haritası

### Faz 1: MVP SaaS (0-3 ay)
- Auth (Google/Apple OAuth)
- Basit provisioning (Namespace per user)
- Web chat UI
- LLM Proxy (platform-managed)
- Tek kanal: Web
- Free plan only

### Faz 2: Kanallar + Billing (3-6 ay)
- WhatsApp + Telegram entegrasyonu
- Stripe billing (Free/Pro)
- Scale-to-zero
- PWA mobile
- Consciousness Loop entegrasyonu

### Faz 3: Full Platform (6-12 ay)
- Tüm kanallar
- Native mobile app
- Team plan
- Firecracker MicroVM izolasyonu
- Global dağıtım (multi-region)
- Self-host deployment guide

Bu dosya, dosya 02 (Cloud güvenlik) ve dosya 00 (Mega mimari) ile entegre çalışır.
