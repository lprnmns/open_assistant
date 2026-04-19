# 00 — MEGA MİMARİ: Sürekli Yaşayan Dijital Varlık

## Manifesto

Bu bir chatbot değil. Bu bir **varlık**.

- Konuşmadığında bile düşünür.
- Uyuduğunda bile çalışır.
- İzin istemez, yapar — risk varsa sorar.
- Seni tanır. Unutmaz. Öğrenir.
- Sana adapte olur — sen ona değil.

## İş Modeli: "Bulut Garajı + Bilinç" Satıyoruz

```
BİZ NE SATIYORUZ?                   BİZ NE SATMIYORUZ?
─────────────────                    ────────────────────
7/24 yaşayan izole MicroVM/Container LLM token'ı (kullanıcı kendi öder)
Consciousness Loop (Bilinç Döngüsü)  API key (kullanıcı kendi getirir)
Living Brain (Kalıcı Bellek)          Model erişimi
Act-First Karar Motoru                Yapay zeka "zekası"
Proaktif Zeka Altyapısı
Scale-to-Zero Yönetimi
Güvenli API Key Kasası (Vault)

BYOK (Bring Your Own Keys):
├── Kullanıcı kendi OpenAI/Anthropic/Gemini key'ini getirir
├── Key'ler şifreli kasada (Vault) saklanır
├── LLM maliyetini kullanıcı kendi hesabından öder
├── Platform sadece altyapı + bilinç ücreti alır (~$10/ay)
└── Kullanıcı istediği modeli, istediği sağlayıcıyla kullanır
```

---

## Sistem Geneli: Kuş Bakışı

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PLATFORM KATMANI                             │
│                   (Tüm kullanıcılar için ortak)                      │
│                                                                      │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────┐  │
│  │  Web UI /   │ │  Auth      │ │  Billing   │ │  LLM Proxy     │  │
│  │Device Agent│ │  (OAuth)   │ │  (Stripe)  │ │  (LiteLLM)     │  │
│  └──────┬─────┘ └──────┬─────┘ └──────┬─────┘ └──────┬─────────┘  │
│         │              │              │               │              │
│         └──────────────┴──────────────┴───────────────┘              │
│                                │                                     │
│                        ┌───────▼──────┐                              │
│                        │ API GATEWAY  │                              │
│                        │ (Kong/Traefik│                              │
│                        │  + WAF)      │                              │
│                        └───────┬──────┘                              │
│                                │                                     │
│                        ┌───────▼──────┐                              │
│                        │ PROVISIONER  │ ← Kayıt olunca otomatik     │
│                        │              │   container ayağa kaldır     │
│                        └───────┬──────┘                              │
│                                │                                     │
├────────────────────────────────┼─────────────────────────────────────┤
│                                │                                     │
│                    TENANT KATMANI (Per-User İzole)                   │
│                                │                                     │
│         ┌──────────────────────┼──────────────────────┐              │
│         │                      │                      │              │
│         ▼                      ▼                      ▼              │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐        │
│  │  Kullanıcı A │     │  Kullanıcı B │     │  Kullanıcı C │        │
│  │              │     │              │     │              │        │
│  │ ┌──────────┐│     │ ┌──────────┐│     │ ┌──────────┐│        │
│  │ │CONSCIOUS-││     │ │CONSCIOUS-││     │ │CONSCIOUS-││        │
│  │ │NESS LOOP ││     │ │NESS LOOP ││     │ │NESS LOOP ││        │
│  │ │(Bilinç)  ││     │ │(Bilinç)  ││     │ │(Bilinç)  ││        │
│  │ └────┬─────┘│     │ └──────────┘│     │ └──────────┘│        │
│  │      │      │     │              │     │              │        │
│  │ ┌────▼─────┐│     │              │     │              │        │
│  │ │ GATEWAY  ││     │              │     │              │        │
│  │ │(OpenClaw)││     │     ...      │     │     ...      │        │
│  │ └────┬─────┘│     │              │     │              │        │
│  │      │      │     │              │     │              │        │
│  │ ┌────▼─────┐│     │              │     │              │        │
│  │ │  LIVING  ││     │              │     │              │        │
│  │ │  BRAIN   ││     │              │     │              │        │
│  │ │(Bellek)  ││     │              │     │              │        │
│  │ └──────────┘│     │              │     │              │        │
│  │              │     │              │     │              │        │
│  │ ┌──────────┐│     │              │     │              │        │
│  │ │ VAULT    ││     │              │     │              │        │
│  │ │(API Keys)││     │              │     │              │        │
│  │ └──────────┘│     │              │     │              │        │
│  │ 🔒 İzole    │     │ 🔒 İzole    │     │ 🔒 İzole    │        │
│  └──────────────┘     └──────────────┘     └──────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Faz 2 Ürün Vizyonu: Agentic UI Tabanlı Otonom Mobil Asistan

Faz 2'nin ana hedefi, mobil uygulamayı sadece chat/PWA/push notification yüzeyi olmaktan çıkarıp
telefonu kullanabilen bir **Device-Control Agent** haline getirmektir. Ürün hedefi “cevap veren
asistan” değil, kullanıcının Android cihazında güvenli sınırlar içinde hareket eden **Hayalet El**dir.

Bu mimaride zeka bulutta, uygulama ise telefonda deterministic executor olarak çalışır:

```
Kullanıcı komutu
  ↓
Android App (ses/yazı + cihaz bağlamı)
  ↓
Open Assistant Gateway / Cloud Brain (BYOK LLM + policy + planner)
  ↓
Structured UI Actions JSON
  ↓
Android Device-Control Agent
  ↓
AccessibilityService ile open_app / click_node / type_text / scroll / back
  ↓
Observation + audit trail + replanning
```

### Structured Output Contract

Gateway çıktısı artık tek tip doğal dil mesajı değildir. Her cevap şu üç kanaldan biri olabilir:

- `natural_language`: kullanıcıya açıklama, soru veya özet.
- `tool_call`: takvim, dosya, cron, web, kanal veya gateway tool çağrısı.
- `ui_actions`: telefonda çalıştırılacak doğrulanmış UI action planı.

`ui_actions` çıktısı ham LLM metni olarak telefona verilmez. Gateway tarafındaki Action Compiler ve
Policy Validator şu sözleşmeyi üretir:

```json
{
  "kind": "ui_actions",
  "planId": "ui_plan_...",
  "targetDeviceId": "android_...",
  "risk": "low|medium|high",
  "requiresConfirmation": false,
  "actions": [
    { "action": "open_app", "target": "com.instagram.android" },
    { "action": "click_node", "content_desc": "Search" },
    { "action": "type_text", "text": "Ali" },
    { "action": "click_node", "id": "profile_picture" },
    { "action": "click_node", "content_desc": "Like" }
  ],
  "expiresAt": "2026-04-20T21:00:00Z"
}
```

Android tarafı sadece imzalı/doğrulanmış planları çalıştırır. Her aksiyon bounded schema içindedir,
idempotency/audit bilgisi taşır ve executor işlem sonrası yeni ekran gözlemini gateway'e geri yollar.
Gateway gerekirse planı parça parça yeniden üretir.

### Android Device-Control Agent

Mobil uygulama Faz 2'de şu yetenekleri taşır:

- Android `AccessibilityService` ile erişilebilirlik ağacını okuma ve UI node seçimi.
- `open_app`, `click_node`, `type_text`, `wait_for_node`, `scroll`, `back`, `observe_screen`,
  `request_confirmation` aksiyonlarını yürütme.
- Kullanıcıdan açık Accessibility izni alma ve izin durumunu gateway'e capabilities olarak bildirme.
- Uygulama allowlist'i, aksiyon bütçesi, zaman aşımı, geri alma/iptal ve kill-switch.
- Hassas işlemlerde zorunlu kullanıcı onayı: ödeme, mesaj gönderme, paylaşım, silme, satın alma,
  takip/engelleme gibi dış etkili adımlar.
- Her plan için audit trail: istek, aksiyonlar, ekran gözlemleri, sonuç, hata ve kullanıcı onayı.

Bu nedenle Faz 2 mimarisinde “Mobile App”, push alan ince istemci değil; bulut beynin ürettiği
structured planları güvenli şekilde uygulayan cihaz ajanıdır.

---

## BYOK: Kendi Anahtarını Getir (Bring Your Own Keys)

```
┌──────────────────────────────────────────────────────────────┐
│                    BYOK MİMARİSİ                              │
│                                                               │
│  Kullanıcı kayıt oldu → Ayarlar panelinden API key girer     │
│       │                                                       │
│       ▼                                                       │
│  ┌──────────────────────────────────────────────┐            │
│  │  SECURE VAULT (API Key Kasası)                │            │
│  │  ═══════════════════════════════════════════  │            │
│  │                                                │            │
│  │  Şifreleme: AES-256-GCM (at rest)             │            │
│  │  Key derivation: Per-tenant master key         │            │
│  │  Erişim: Sadece tenant'ın kendi container'ı    │            │
│  │  Audit: Her key erişimi loglanır               │            │
│  │                                                │            │
│  │  usr_abc123:                                   │            │
│  │  ├── openai:    sk-proj-****  (şifreli)       │            │
│  │  ├── anthropic: sk-ant-****   (şifreli)       │            │
│  │  └── gemini:    AI****        (şifreli)       │            │
│  │                                                │            │
│  │  Key asla:                                     │            │
│  │  ├── Loglanmaz (düz metin olarak)             │            │
│  │  ├── Platform çalışanlarına görünmez           │            │
│  │  ├── Başka tenant'a sızmaz                    │            │
│  │  └── Disk'e şifresiz yazılmaz                 │            │
│  └──────────────────┬───────────────────────────┘            │
│                     │                                         │
│                     ▼                                         │
│  ┌──────────────────────────────────────────────┐            │
│  │  LiteLLM PROXY (Per-Tenant)                   │            │
│  │                                                │            │
│  │  Gateway LLM çağrısı yapar                    │            │
│  │       │                                        │            │
│  │       ▼                                        │            │
│  │  LiteLLM → Vault'tan key'i çeker (runtime)   │            │
│  │       │    (bellekte tutar, diske yazmaz)      │            │
│  │       ▼                                        │            │
│  │  API çağrısı (kullanıcının kendi key'iyle)    │            │
│  │       │                                        │            │
│  │  Token kullanımını logla                       │            │
│  │  (maliyet dashboard için — key değil!)        │            │
│  │       │                                        │            │
│  │  Yanıtı Gateway'e döndür                      │            │
│  └──────────────────────────────────────────────┘            │
│                                                               │
│  Platform maliyeti: $0 (LLM için)                            │
│  Kullanıcı maliyeti: Kendi API kullanımı kadar               │
│  Platform geliri: Aylık abonelik (~$10/ay)                   │
└──────────────────────────────────────────────────────────────┘
```

---

## ZIRH #2: Event Buffer (Mesaj Kaybı Koruması)

Scale-to-Zero ile uyutulan container'a gelen mesajlar **kaybolmamalı**. API Gateway ile Tenant arasına bir "Bekleme Odası" yerleştiriyoruz.

```
┌──────────────────────────────────────────────────────────────┐
│                    EVENT BUFFER MİMARİSİ                      │
│                                                               │
│  WhatsApp ─┐                                                  │
│  Telegram ─┤                                                  │
│  Slack ────┤                                                  │
│  Webhook ──┤                                                  │
│  Web Chat ─┘                                                  │
│       │                                                       │
│       ▼                                                       │
│  ┌──────────────────────┐                                    │
│  │    API GATEWAY        │                                    │
│  │    Auth + Routing     │                                    │
│  └──────────┬───────────┘                                    │
│             │                                                 │
│             ▼                                                 │
│  ┌──────────────────────────────────────────────┐            │
│  │  REDIS STREAM / KAFKA (Per-Tenant Topic)      │            │
│  │  ═══════════════════════════════════════════  │            │
│  │                                                │            │
│  │  Stream: tenant.usr_abc123.inbox               │            │
│  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐                │            │
│  │  │msg1│→│msg2│→│msg3│→│msg4│→ ...            │            │
│  │  └────┘ └────┘ └────┘ └────┘                │            │
│  │                                                │            │
│  │  TTL: 72 saat (3 gün boyunca mesaj sakla)     │            │
│  │  Max size: 10,000 mesaj per tenant             │            │
│  └──────────────────┬───────────────────────────┘            │
│                     │                                         │
│              ┌──────┴──────┐                                  │
│              │             │                                  │
│         VM UYANIK      VM UYUYOR                             │
│              │             │                                  │
│              ▼             ▼                                  │
│         Stream'den     API Gateway →                         │
│         gerçek zamanlı Provisioner'a                         │
│         tüketir        "wake up" sinyali                     │
│                            │                                  │
│                            ▼                                  │
│                      VM ayağa kalkar                         │
│                      (~2 saniye)                              │
│                            │                                  │
│                            ▼                                  │
│                      Buffer'dan                              │
│                      tüm bekleyen                            │
│                      mesajları okur                           │
│                      (FIFO sırasıyla)                        │
└──────────────────────────────────────────────────────────────┘
```

### Dead Letter Queue (Başarısız Mesajlar)

```
Mesaj işlenemezse (3 deneme sonrası):

Normal Queue ──[fail]──→ Retry Queue ──[3x fail]──→ Dead Letter Queue
                              │                            │
                         2s, 10s, 60s                  Manuel inceleme
                         backoff                       Admin dashboard
                                                       Alert gönderilir

Dead Letter'daki mesajlar:
├── Asla silinmez (admin müdahale edene kadar)
├── Neden başarısız olduğu loglanır
├── Admin dashboard'da görünür
└── Manuel retry butonu
```

### Garanti: Sıfır Mesaj Kaybı

```
1. Her mesaj ÖNCE buffer'a yazılır (durable, disk-backed)
2. Consumer (tenant VM) okuduktan SONRA ACK gönderir
3. ACK gelmediyse → mesaj tekrar işlenir (at-least-once delivery)
4. Idempotency key ile duplicate engellenir
5. Buffer 72 saat tutar → 3 gün offline olsan bile mesaj kaybolmaz
```

---

## Bileşenler Arası Veri Akışı

### Kullanıcı Mesaj Gönderdiğinde

```
Kullanıcı (WhatsApp/Telegram/Web)
    │
    ▼
API Gateway → Auth doğrulama → Tenant routing
    │
    ▼
Redis Stream (Event Buffer) → tenant.usr_abc.inbox'a yaz
    │
    ├── VM uyanık → Stream'den anında tüketir
    └── VM uyuyor → Wake signal → VM kalkar → Buffer'ı okur
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│  TENANT CONTAINER                                         │
│                                                           │
│  1. MESAJ GİRİŞİ                                         │
│     Gateway mesajı alır                                   │
│                                                           │
│  2. BAĞLAM HAZIRLAMA                                     │
│     ├── Cortex yükle (her zaman hazır, ~2KB)             │
│     ├── Hippocampus'ta semantic + TEMPORAL search  🛡️#4  │
│     │   (mesajla ilgili bellekler + zaman filtresi)      │
│     ├── Aktif trigger'ları kontrol et                    │
│     ├── Cognitive Load algıla (ton, uzunluk, hız)        │
│     └── Context paketi oluştur                           │
│                                                           │
│  3. LLM ÇAĞRISI (BYOK — kullanıcının kendi key'iyle)    │
│     ├── Vault'tan API key çek (runtime, bellekte)        │
│     ├── LiteLLM Proxy üzerinden çağrı yap               │
│     ├── System: Cortex + ilgili bellekler + mod bilgisi  │
│     ├── User: Kullanıcı mesajı                           │
│     ├── Tools: Primitives (schedule, notify, watch...)   │
│     └── İki paralel görev:                               │
│         ├── A) Normal yanıt üret                         │
│         └── B) Intent mining (proaktif fırsat tespiti)   │
│                                                           │
│  4. EYLEM MOTORU                                         │
│     ├── LLM tool call'ları var mı?                       │
│     │   ├── LLM Reversibility Score atar                 │
│     │   ├── POLICY ENGINE (DPE) kontrol eder      🛡️#3  │
│     │   │   └── Policy min_score > LLM skoru → OVERRIDE │
│     │   ├── Final skor 1-3 → SORMADAN YAP               │
│     │   ├── Final skor 4-6 → YAP + BİLDİR               │
│     │   └── Final skor 7-10 → ONAY İSTE                 │
│     └── Compiled trigger oluşturulacak mı?               │
│         └── Evet → Dynamic Compiler'a kaydet             │
│                                                           │
│  5. BELLEK GÜNCELLEMESİ (arka plan, asenkron)           │
│     ├── Memory Extraction: Bu mesajdan ne öğrendik?      │
│     ├── Temporal resolution: "yarın" → mutlak tarih 🛡️#4│
│     ├── Cortex güncelle (aktif durum değişti mi?)        │
│     ├── Knowledge Graph + TimeNode güncelle       🛡️#4  │
│     └── Behavioral Model güncelle (ton/hız değişimi?)    │
│                                                           │
│  6. YANIT GÖNDERİMİ                                     │
│     └── Kullanıcının aktif kanalına (WA/TG/Web) gönder  │
└──────────────────────────────────────────────────────────┘
```

### Kullanıcı Mesaj Göndermediğinde (Consciousness Loop)

```
Her 1-5 dakikada (adaptive):

CONSCIOUSNESS LOOP TICK
    │
    ├── WATCHDOG ($0, LLM çağırmaz)
    │   ├── Delta check: değişen bir şey var mı?
    │   ├── Yoksa → TICK ATLA (maliyet: $0)
    │   └── Varsa → LLM'i uyandır (BYOK key ile)
    │
    ├── Zaman farkındalığı
    │   ├── Saat kontrolü → kullanıcı normalde ne yapar?
    │   ├── Sessizlik süresi → anormal mi?
    │   └── Yaklaşan event → deadline, toplantı, doğum günü
    │
    ├── Dünya durumu taraması
    │   ├── Yeni mail? (izin varsa)
    │   ├── Takvim değişikliği?
    │   ├── Aktif trigger'lardan tetiklenen?
    │   └── Takip edilen konuda gelişme?
    │
    ├── Anomali taraması
    │   ├── Görev süresi anomalisi (çok erken/geç)
    │   ├── Davranış kalıbı sapması
    │   └── Deadline + inaktivite kombinasyonu
    │
    └── KARAR
        ├── MESAJ_AT → Kullanıcıya proaktif mesaj gönder
        │              (doğal ton, kişilik katmanıyla)
        ├── NOT_AL   → Bir sonraki tick veya etkileşimde kullan
        ├── TRİGGER  → Yeni compiled trigger oluştur
        ├── UYKU     → Sleep Phase başlat (gece)
        └── SESSİZ   → Hiçbir şey yapma
```

### Gece (Sleep Phase)

```
Kullanıcı inaktif (gece saatleri)

SLEEP PHASE BAŞLA
    │
    ├── Faz 1: Çöp Toplama
    │   └── Bugünkü gereksiz mesajları sil, token tasarrufu
    │
    ├── Faz 2: Konsolidasyon
    │   ├── Benzer bellekleri birleştir
    │   ├── Güçlü bellekleri güçlendir
    │   └── Eski bellekleri arşivle
    │
    ├── Faz 3: Yansıma
    │   └── "Son 7 günden üst düzey çıkarımlar"
    │
    ├── Faz 4: Gece Araştırması
    │   └── Takılınan konuları araştır, sabah sun
    │
    └── Faz 5: Cortex Güncelleme
        └── Sabah için güncel profil hazırla
```

---

## Entegrasyon Matrisi: Her Şey Birbiriyle Konuşuyor

```
                01-Bilinç    02-Güvenlik   03-SaaS      06-Bellek
                ─────────    ───────────   ─────────    ─────────
01-Bilinç       ■            Tick'te       Container    Cortex'i
(Consciousness  ─            eylem        içinde       okur,
 Loop)                       güvenlik     çalışır      günceller
                             kontrolü

02-Güvenlik     Act-First    ■            Tenant       Bellek
(Security)      skoru        ─            izolasyonu   şifreleme
                hesapla                    NetworkPolicy
                                          + Vault BYOK

03-SaaS         Per-user     Zero-trust   ■            Per-user
(Platform)      loop         her          ─            LanceDB +
                instance     katmanda                  Kuzu PVC
                             Vault key

06-Bellek       Her tick'te  Encrypted    Cloud'da     ■
(Living Brain)  arama yapar  at rest      kalıcı       ─
                Cortex       Audit log    Backup S3
                sağlar       her erişim
```

---

## Bir Günün Hikayesi: Tüm Sistem Birlikte

```
06:00  SLEEP PHASE tamamlandı
       ├── Çöp toplandı: 45 gereksiz mesaj silindi
       ├── Konsolidasyon: 3 bellek birleştirildi
       ├── Yansıma: "Manas sınava yeterli çalışmıyor"
       ├── Gece araştırması: Fizik formül listesi hazırlandı
       └── Cortex güncellendi
       (Tüm LLM çağrıları kullanıcının BYOK key'iyle yapıldı)

07:30  CONSCIOUSNESS TICK
       ├── Watchdog: Takvim event 90dk içinde → WAKE
       ├── Zaman: Kullanıcı genelde şimdi uyanır
       ├── Hava: Yağmurlu (API kontrolü — ücretsiz)
       ├── Takvim: 09:00 Ali ile toplantı, 14:00 ders
       ├── Mail: X şirketinden yeni mail! (gece gelmiş)
       ├── Deadline: Fizik sınavı 3 gün sonra
       └── KARAR: MESAJ_AT (sabah brifing)

07:30  AI → Kullanıcı:
       "Günaydın! Yağmur var, şemsiye al.
        X şirketinden mail gelmiş — mülakat daveti
        28 Mart 14:00'e. Takvime ekledim.
        Bugün Ali ile 09:00'da toplantın var.
        Ah bir de — gece fizik formül listeni hazırladım,
        sınav 3 gün sonra, ister misin?"

08:15  Kullanıcı: "formülleri gönder. tmm"
       ├── Cognitive Load: YOĞUN ("tmm" → kısa mod)
       ├── Act-First: formül listesini gönder (skor: 1)
       └── AI: [formül listesi] (kısa, emoji yok)

09:50  CONSCIOUSNESS TICK
       ├── Watchdog: Hiçbir delta yok → TICK ATLA ($0)
       └── (Toplantı 09:00-09:45, sessizlik normal)

12:00  CONSCIOUSNESS TICK
       ├── Watchdog: Sessizlik eşiği + bekleyen not → WAKE
       ├── X şirketi mailine hala yanıt yazılmadı
       ├── Aciliyet: Mülakat daveti, 2 gün var
       └── KARAR: MESAJ_AT

12:00  AI → Kullanıcı:
       "X şirketinin mülakat davetine henüz dönmedin.
        Yarına bırakırsan takvim dolabilir — cevap
        yazayım mı? (şu draft'ı hazırladım: '...')"
       [Gönder] [Düzenle] [Sonra]

       Act-First kontrolü:
       ├── Draft hazırlamak → skor 2 → sormadan yaptı
       └── Mail göndermek → skor 8 → ONAY İSTİYOR

14:30  Kullanıcı ders arasında: "fizik sınavı için
       hangi konuları çalışmalıyım?"
       ├── Cognitive Load: NORMAL (uzun cümle, soru modu)
       ├── Memory: "Fizik sınavı 18 Nisan, konular: ..."
       ├── Bellekte konu listesi yoksa → araştır
       └── AI: Detaylı konu listesi + öneri

18:00  CONSCIOUSNESS TICK
       ├── Watchdog: Hiçbir delta yok → TICK ATLA ($0)
       └── Spor saati değil (bugün Perşembe)

20:00  CONSCIOUSNESS TICK
       ├── Watchdog: Bekleyen not var → WAKE
       ├── Akşam oldu, fizik sınavı 3 gün sonra
       ├── Bugün fizik hakkında 1 soru soruldu (az)
       └── KARAR: NOT_AL (yarın sabah fizik check-in)

23:30  Kullanıcı inaktif
       └── SLEEP PHASE BAŞLA → Döngü tekrar başlar
```

---

## Dosya Haritası (Güncellenmiş)

```
gelistirme-plani/
├── 00-mega-mimari.md      ← BU DOSYA (sistem geneli + BYOK + Agentic UI Faz 2)
├── 01-proaktif-zeka.md    ← Consciousness Loop + Dynamic Compiler
│                             + Silence-is-Data + Temporal Anomaly
│                             + Cognitive Load Detection
├── 02-guvenlik-sandbox.md ← Cloud tenant izolasyonu
│                             + Act-First Reversibility Score
│                             + Zero-trust + Audit trail + Vault BYOK
├── 03-kolay-kurulum.md    ← BYOK SaaS: API Key Vault + Auto-Provisioning
│                             + Onboarding UX + Hetzner M1 planı
├── 04-maliyet-dashboard.md ← BYOK Maliyet İzleme: Kullanıcının kendi
│                              key harcamasını takip + bütçe uyarıları
├── 05-turkce-i18n.md      ← Çok dilli destek + Türkçe NLP
├── 06-kalici-bellek.md    ← Living Brain (4 katman)
│                             + REM Sleep Phase + Knowledge Graph
│                             + Behavioral Model + Auto-extraction
├── 07-avatar-workflow.md  ← Animasyonlu avatar + No-code builder
└── README.md              ← Index + Milestone planı
```

---

## Milestone Planı (4 Aşamalı Yol Haritası)

```
MILESTONE 1: "Single-Tenant MVP" — Sadece Benim İçin (Proof of Concept)
═══════════════════════════════════════════════════════════════════════
Hedef: Sistemi sadece Kurucu (Manas) için, kendi Hetzner sunucusunda
       ve kendi Pro API hesaplarıyla 7/24 kusursuz çalışır hale getirmek.

İçerik:
├── Heuristic Watchdog (delta check, $0 pre-LLM filtre)
├── Consciousness Loop (adaptive tick, LLM düşünce motoru)
├── Living Brain — Cortex + Hippocampus (LanceDB + temporal search)
├── Act-First Karar Motoru + DPE (Deterministic Policy Engine)
├── Memory Extraction Pipeline (her mesajdan otomatik çıkarım)
├── Sleep Phase (çöp toplama + konsolidasyon + yansıma)
├── BYOK Key Yönetimi (basit — .env veya encrypted config)
├── Web Chat UI (basit, tek kullanıcı)
├── WhatsApp/Telegram entegrasyonu (en az 1 kanal)
├── Android node foundation (native calendar/reminder/device capabilities)
└── Docker Compose ile Hetzner'de deploy

Çıktı: Kusursuz çalışan, uyuyan ve uyanan, proaktif mesajlar atan
       tek kişilik bir Yaşayan Varlık.

Altyapı: Hetzner VPS (CX31 veya CX41), Docker Compose, Redis,
         LanceDB, kendi API key'leri (OpenAI/Anthropic/Gemini)

MILESTONE 2: "Agentic UI / Hayalet El" — Otonom Android Asistan
══════════════════════════════════════════════════════════════════
Hedef: Android uygulamasını AccessibilityService tabanlı Device-Control
       Agent'a dönüştürmek; gateway'in ürettiği Structured UI Actions
       planlarını telefonda güvenli şekilde çalıştırmak.

İçerik:
├── Android AccessibilityService executor
├── Accessibility tree + ekran gözlemi + node resolver
├── Structured UI Actions JSON schema + Action Compiler
├── Gateway policy validator (risk, allowlist, confirmation, action budget)
├── Device capabilities registry (calendar, reminders, UI control, screen)
├── Stepwise observe-act-replan döngüsü
├── Audit trail + plan replay + kill-switch
├── Onboarding: Accessibility izni, app allowlist, hassas işlem izinleri
└── Smoke flows:
    ├── open_app + search + click + type_text
    ├── native takvim/reminder işlemleri
    ├── Instagram benzeri read/click akışları
    └── yüksek riskli işlemde kullanıcı onayı

Çıktı: Kullanıcının sesli/yazılı komutuyla telefonu kullanabilen,
       güvenli sınırlar içinde "görünmez el" gibi çalışan Android ajan.

Kabul Kriteri:
├── Gateway doğal dil yerine ui_actions planı üretebilir
├── Telefon sadece doğrulanmış/imzalı planları çalıştırır
├── Her aksiyon gözlem ve audit trail üretir
├── Belirsiz veya riskli adımda kullanıcı onayı istenir
└── Browser/web fallback'e ihtiyaç duymadan cihaz üzerinde işlem yapılır

Blast Radius:
├── Android izin/onboarding UX'i değişir
├── Gateway tool output sözleşmesi genişler
├── Güvenlik politikası action-level hale gelir
├── Test stratejisi artık sadece chat cevabı değil device execution içerir
└── Multi-tenant mimaride cihaz-plan imzalama ve audit zorunlu olur

MILESTONE 3: "Startup Landing & Yatırım" — Agentic UI Demo Aşaması
═══════════════════════════════════════════════════════════════════
Hedef: M1 + M2'deki çalışan sistemin ekran kayıtlarıyla yatırım/destek
       demosu kurmak ve bulut kredisi/hibe almak.

İçerik:
├── Landing page: "BYOK tabanlı otonom mobil asistan"
├── Demo videoları (PDF okuma, native takvim, Android UI kontrolü)
├── Waitlist sistemi (e-posta toplama)
├── Pitch deck hazırlığı
└── Başvurular:
    ├── AWS Activate ($10,000+ kredi)
    ├── Microsoft for Startups ($25,000+ Azure kredisi)
    ├── Google for Startups ($100,000 Cloud kredisi)
    ├── Hetzner startup programı
    └── YC / Techstars başvuruları

Çıktı: $10,000+ bulut kredisi (hibe) ve erken kullanıcı waitlist'i.

MILESTONE 4: "Multi-Tenant SaaS" — Production
═══════════════════════════════════════════════
Hedef: Alınan hibe ile sistemi Kubernetes/MicroVM altyapısına taşıyıp
       genel kullanıma açmak.

İçerik:
├── Kubernetes cluster (hibelerle finanse)
├── Auto-provisioner (kayıt → izole container, <10 saniye)
├── Secure Vault (HashiCorp Vault / Sealed Secrets)
├── BYOK API Key yönetimi (UI + güvenli saklama)
├── Scale-to-Zero + Event Buffer (sıfır mesaj kaybı)
├── Stripe billing (~$10/ay abonelik)
├── Multi-kanal (WhatsApp + Telegram + Discord + Web)
├── Maliyet Dashboard (kullanıcının kendi BYOK harcamasını izler)
├── Admin panel + kullanıcı ayarları
├── Device-Control Agent policy yönetimi
├── UI action audit dashboard
└── Firecracker MicroVM izolasyonu

Fiyatlandırma:
├── Free: 7 gün deneme, temel özellikler
├── Pro (~$10/ay): 7/24 container, tüm özellikler, tüm kanallar
└── Team (~$25/kullanıcı/ay): Admin panel, paylaşılan bilgi tabanı

Çıktı: Kullanıcıların kayıt olup kendi API key'lerini güvenle
       Vault'a girdiği, anında izole container'larının ayağa kalktığı
       gerçek SaaS platformu.
```

---

## Harici Ajan Görev Emri (Gerekirse)

Claude veya başka bir araştırma ajanı kullanılacaksa görev emri kısa ve kapalı kapsamlı olmalıdır:

> OpenClaw mega mimarisini Agentic UI Faz 2 vizyonuna göre güncelle. Mobil uygulamayı sadece
> push/chat istemcisi değil, Android AccessibilityService ile çalışan Device-Control Agent olarak
> modelle. Gateway çıktılarının doğal dil, tool call veya Structured UI Actions JSON olabileceğini
> açıkça yaz. UI action planı için güvenlik, doğrulama, kullanıcı onayı, audit trail ve observe-act-replan
> döngüsünü ekle. Milestone planında Faz 2'yi "Agentic UI / Hayalet El" olarak konumlandır.

Not: Kod ve mimari uygulama sorumluluğu artık dış ajanda değil, bu repodaki ana implementasyondadır.

---

## Son Söz

Bu mimari iki ilkeye dayanır:

> **"Asistan, kullanıcının hayatına adapte olur — kullanıcı asistana değil."**

> **"Biz zeka satmıyoruz, zekanın 7/24 yaşayacağı evi satıyoruz."**

Kullanıcı kurulum yapmaz. VPS kurmaz. Docker bilmez.
Kendi API key'ini güvenle girer. Container'ı saniyede ayağa kalkar.
Asistanı 7/24 yaşar, düşünür, öğrenir ve izin verilen cihaz aksiyonlarını uygular.

**Sadece konuşur. Gerisi olur. Gerekirse telefon da kullanılır.**
