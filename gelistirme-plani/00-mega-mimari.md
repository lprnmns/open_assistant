# 00 — MEGA MİMARİ: Sürekli Yaşayan Dijital Varlık

## Manifesto

Bu bir chatbot değil. Bu bir **varlık**.
- Konuşmadığında bile düşünür.
- Uyuduğunda bile çalışır.
- İzin istemez, yapar — risk varsa sorar.
- Seni tanır. Unutmaz. Öğrenir.
- Sana adapte olur — sen ona değil.

---

## Sistem Geneli: Kuş Bakışı

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PLATFORM KATMANI                             │
│                   (Tüm kullanıcılar için ortak)                      │
│                                                                      │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────┐  │
│  │  Web UI /   │ │  Auth      │ │  Billing   │ │  LLM Proxy     │  │
│  │  Mobile App │ │  (OAuth)   │ │  (Stripe)  │ │  (LiteLLM)     │  │
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
│  │ 🔒 İzole    │     │ 🔒 İzole    │     │ 🔒 İzole    │        │
│  └──────────────┘     └──────────────┘     └──────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
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
│  3. LLM ÇAĞRISI (Platform LLM Proxy üzerinden)          │
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
│     │   ├── ⚠️ POLICY ENGINE (DPE) kontrol eder  🛡️#3  │
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

03-SaaS         Per-user     Zero-trust   ■            Per-user
(Platform)      loop         her          ─            LanceDB +
                instance     katmanda                  Kuzu PVC

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

07:30  CONSCIOUSNESS TICK
       ├── Zaman: Kullanıcı genelde şimdi uyanır
       ├── Hava: Yağmurlu (API kontrolü)
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
       ├── Toplantı 09:00-09:45 (takvimden)
       ├── 50 dk sessizlik → normal (toplantıdaydı)
       └── KARAR: SESSİZ_KAL

12:00  CONSCIOUSNESS TICK
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
       ├── Spor saati (PzSaSa 18:00 rutini)
       ├── Bugün Perşembe → spor günü değil
       └── KARAR: SESSİZ_KAL

20:00  CONSCIOUSNESS TICK
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
├── 00-mega-mimari.md      ← BU DOSYA (sistem geneli)
├── 01-proaktif-zeka.md    ← Consciousness Loop + Dynamic Compiler
│                             + Silence-is-Data + Temporal Anomaly
│                             + Cognitive Load Detection
├── 02-guvenlik-sandbox.md ← Cloud tenant izolasyonu
│                             + Act-First Reversibility Score
│                             + Zero-trust + Audit trail
├── 03-kolay-kurulum.md    ← Zero-Config Cloud SaaS
│                             + Auto-provisioning + Platform LLM
│                             + Pricing + Onboarding UX
├── 04-maliyet-dashboard.md ← Token izleme + Model cascading
│                              (güncellenecek: SaaS billing entegrasyonu)
├── 05-turkce-i18n.md      ← Çok dilli destek + Türkçe NLP
│                             (güncellenecek: cloud TTS/STT)
├── 06-kalici-bellek.md    ← Living Brain (4 katman)
│                             + REM Sleep Phase + Knowledge Graph
│                             + Behavioral Model + Auto-extraction
├── 07-avatar-workflow.md  ← Animasyonlu avatar + No-code builder
│                             (güncellenecek: web-first avatar)
└── README.md              ← Index (güncellenecek)
```

---

## Faz Planı (Büyük Resim)

```
FAZ 1: MVP — "Konuşan Beyin" (0-3 ay)
├── Cloud SaaS altyapısı (K8s + provisioner)
├── Web chat UI + auth (Google/Apple)
├── Living Brain: Cortex + Hippocampus
├── Act-First karar motoru (temel)
├── Consciousness Loop (basit, 5dk tick)
├── Memory extraction (her mesajda)
├── Free plan (günde 50 mesaj, temel model)
└── Deliverable: Kayıt ol, konuş, seni tanımaya başlasın

FAZ 2: "Uyanık Varlık" (3-6 ay)
├── WhatsApp + Telegram entegrasyonu
├── Dynamic Trigger Compiler
├── Consciousness Loop: Tam özellikli (adaptive tick)
├── Silence-is-Data + Temporal Anomaly
├── Cognitive Load Detection
├── Sleep Phase (çöp toplama + konsolidasyon)
├── Pro plan + Stripe billing
├── Maliyet dashboard (temel)
└── Deliverable: Proaktif mesajlar, seni tanıyan asistan

FAZ 3: "Yaşayan Varlık" (6-12 ay)
├── Knowledge Graph (Kuzu)
├── Behavioral Model (rutin + anomali tespiti)
├── Sleep Phase: Gece araştırması
├── Yansıma (reflection) motoru
├── Animasyonlu avatar (web, basit 2D)
├── Sesli etkileşim (Whisper + TTS)
├── Türkçe + i18n (temel)
├── No-code workflow builder (temel)
├── Mobile app (PWA)
├── Firecracker izolasyonu
└── Deliverable: Gerçekten "yaşayan" hissettiren asistan

FAZ 4: "Ekosistem" (12+ ay)
├── Tam i18n (10+ dil)
├── Native mobile app (iOS/Android)
├── Team plan + admin panel
├── 3D avatar + lip-sync
├── Plugin/skill marketplace
├── Self-host deployment kit
├── Enterprise features (SSO, compliance)
└── Deliverable: Global platform
```

---

## Son Söz

Bu mimari tek bir ilkeye dayanır:

> **"Asistan, kullanıcının hayatına adapte olur — kullanıcı asistana değil."**

Kullanıcı kurulum yapmaz. API key yapıştırmaz. Trigger ayarlamaz.
Hatırlatma istemez. İzin vermek için beklenmez (risk yoksa).
Bellek yönetmez. Çöp toplamaz.

**Sadece konuşur. Gerisi olur.**
