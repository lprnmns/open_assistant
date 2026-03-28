# Milestone 1: Single-Tenant MVP — İş Kırılım Yapısı (WBS)

> **Hedef:** Open Assistant'ı sadece Kurucu (Manas) için, Hetzner VPS üzerinde, kendi Pro API key'leriyle 7/24 kusursuz çalışan bir "Yaşayan Varlık" haline getirmek.
>
> **Çıktı:** Uyuyan, uyanan, proaktif mesajlar atan, bellekli, act-first karar veren tek kişilik Yaşayan Varlık.
>
> **Altyapı:** Hetzner CX31 (2 vCPU, 8GB RAM), Docker Compose, Redis, LanceDB, LiteLLM, Node.js/TypeScript.

---

## Genel İlkeler

- Mevcut OpenClaw kod tabanı (Gateway, channels, agents) üzerine inşa edilecek — sıfırdan yazılmayacak.
- Her alt görev kendi branch commit'iyle pushlanır, denetçi onayı beklenir.
- Testler her alt görevle birlikte yazılır (test olmadan commit yok).
- M1'de Kubernetes/MicroVM yok — Docker Compose yeterli.
- M1'de tek kullanıcı — multi-tenant izolasyonu M3'e bırakılır.
- BYOK key'ler M1'de basit encrypted `.env` ile yönetilir (Vault M3'te).

---

## ANA GÖREV 1: Proje Altyapısı ve BYOK Key Yönetimi

M1'in çalışması için gereken temel altyapı: LiteLLM entegrasyonu, API key yönetimi, Redis kurulumu.

### 1.1 — Docker Compose Güncellemesi
- **Açıklama:** Mevcut `docker-compose.yml`'a `redis` ve `litellm-proxy` servislerini ekle. Healthcheck'leri yapılandır.
- **Girdi:** Mevcut `docker-compose.yml` (2 servis: gateway + cli)
- **Çıktı:** Güncellenmiş `docker-compose.yml` (4 servis: gateway + cli + redis + litellm)
- **Kabul Kriteri:** `docker compose up` ile 4 servis birlikte ayağa kalkar, healthcheck'ler geçer.

### 1.2 — BYOK Key Yapılandırması (Encrypted .env)
- **Açıklama:** `.env.example`'a LLM provider key alanları ekle (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`). LiteLLM'in bu key'leri okumasını sağla. Key'lerin loglara sızmaması için güvenlik önlemi koy.
- **Girdi:** Mevcut `.env.example`
- **Çıktı:** BYOK-ready `.env.example` + LiteLLM config (`litellm_config.yaml`)
- **Kabul Kriteri:** LiteLLM proxy başlar, `.env`'deki key ile test API çağrısı başarılı olur. Key düz metin olarak hiçbir logda görünmez.

### 1.3 — LLM Proxy Entegrasyon Katmanı
- **Açıklama:** Gateway'in LLM çağrılarını doğrudan provider API yerine LiteLLM proxy üzerinden yapmasını sağlayacak bir abstraction layer yaz. `src/llm/proxy-client.ts` — LiteLLM'e HTTP çağrısı yapan basit, tip-güvenli bir istemci.
- **Girdi:** Mevcut agent model-selection yapısı (`src/agents/model-selection.ts`)
- **Çıktı:** `src/llm/proxy-client.ts`, `src/llm/types.ts`
- **Kabul Kriteri:** Gateway, LiteLLM proxy üzerinden Claude/GPT çağrısı yapabilir. Unit test'ler geçer. Mevcut gateway fonksiyonalitesi bozulmaz.

### 1.4 — Maliyet Loglama (Temel)
- **Açıklama:** Her LLM çağrısının token sayısı, modeli, maliyeti ve kaynağını (chat/consciousness/sleep/extraction) SQLite'a kaydeden basit bir logger. `src/llm/cost-logger.ts`.
- **Girdi:** LiteLLM proxy yanıtındaki usage metadata
- **Çıktı:** `src/llm/cost-logger.ts`, SQLite şeması, `openclaw cost` CLI komutu
- **Kabul Kriteri:** `openclaw cost today` komutu bugünkü harcamayı gösterir. Kaynak bazlı (chat vs consciousness) ayrım çalışır.

---

## ANA GÖREV 2: Consciousness Loop (Bilinç Döngüsü)

Sistemin kalp atışı. Kullanıcı mesaj atmasa bile düşünebilen döngü.

### 2.1 — Temel Tip Tanımları
- **Açıklama:** Tüm Consciousness sisteminin paylaşacağı TypeScript interface'lerini tanımla. `src/consciousness/types.ts`.
- **Çıktı:** `WorldSnapshot`, `TickDecision`, `WakeReason`, `TickAction`, `ConsciousnessConfig`, `ConsciousnessState` interface'leri.
- **Kabul Kriteri:** Tipler derlenir, diğer modüller import edebilir.

### 2.2 — Heuristic Watchdog
- **Açıklama:** LLM'den önce çalışan, sıfır maliyetli delta-check motoru. `src/consciousness/watchdog.ts`. Başlangıçta 4 delta kontrolü: (1) yeni mesaj geldi mi, (2) aktif trigger tetiklendi mi, (3) sessizlik eşiği aşıldı mı, (4) compiled cron tetiklendi mi. M1'de mail/takvim entegrasyonu yok — bu kontroller stub olarak kalır.
- **Girdi:** `WorldSnapshot` (Redis'ten okunan durum)
- **Çıktı:** `src/consciousness/watchdog.ts` + `watchdog.test.ts`
- **Kabul Kriteri:** Mock veriyle: "hiçbir şey değişmedi" → `wake: false`, "yeni mesaj var" → `wake: true, reason: 'new_message'`. Sessizlik eşiği aşıldığında %50 artış (re-trigger engeli). %100 test coverage.

### 2.3 — Consciousness Loop Engine
- **Açıklama:** Watchdog'u çağıran, gerektiğinde LLM'i uyandıran, karar alan ana döngü. `src/consciousness/loop.ts`. `tick()` metodu: Watchdog → context hazırla → LLM çağrısı (LiteLLM proxy üzerinden) → karar uygula. Adaptive interval: acil → 30sn, sakin → 5dk.
- **Girdi:** Watchdog sonucu, Cortex (bellek), kullanıcı profili
- **Çıktı:** `src/consciousness/loop.ts` + `loop.test.ts`
- **Kabul Kriteri:** Watchdog `wake: false` → LLM çağrılmaz ($0). Watchdog `wake: true` → LLM çağrılır, `TickAction` döner (MESAJ_AT / NOT_AL / SESSİZ_KAL / UYKU). Tick interval adaptive olarak ayarlanır.

### 2.4 — Consciousness Loop ↔ Gateway Entegrasyonu
- **Açıklama:** Loop'u mevcut Gateway boot sürecine (`src/gateway/boot.ts`) entegre et. Gateway ayağa kalktığında Loop başlar, kapandığında durur. Loop'un "MESAJ_AT" kararını kullanıcının aktif kanalına (başlangıçta Web Chat) göndermesini sağla.
- **Girdi:** Mevcut gateway boot akışı
- **Çıktı:** Güncellenmiş `boot.ts`, `src/consciousness/integration.ts`
- **Kabul Kriteri:** `docker compose up` → Gateway başlar → Loop otomatik başlar → tick'ler loglanır. Proaktif mesaj Web Chat'e ulaşır.

---

## ANA GÖREV 3: Deterministic Policy Engine (DPE)

LLM halüsinasyonlarını engelleyen, kod bazlı güvenlik katmanı.

### 3.1 — Policy Engine Core
- **Açıklama:** Hardcoded policy tablosu + `enforce()` fonksiyonu. `src/policy/engine.ts`, `src/policy/policies.ts`. LLM bir eyleme skor atadığında, DPE bu skoru policy tablosuna karşı kontrol eder ve gerekirse override eder.
- **Çıktı:** `PolicyEngine` sınıfı, `HARDCODED_POLICIES` tablosu, `PolicyDecision` tipi
- **Kabul Kriteri:** `email.send` + LLM skor 2 → DPE override → skor 8 + `requires_human: true`. `reminder.create` + LLM skor 1 → DPE geçir → skor 1, otomatik çalışır. Rate limiting çalışır (saatlik/günlük limitler).

### 3.2 — DPE ↔ Gateway Tool Execution Entegrasyonu
- **Açıklama:** Gateway'in tool execution pipeline'ına DPE kontrolünü enjekte et. LLM bir tool call döndüğünde, execution'dan önce `PolicyEngine.enforce()` çalışır. Override loglama (audit trail) ekle.
- **Girdi:** Mevcut tool execution akışı (`src/agents/`)
- **Çıktı:** Tool execution'da DPE checkpoint, `src/policy/audit.ts` (basit SQLite log)
- **Kabul Kriteri:** Tool call → DPE kontrol → override ise log + kullanıcıya onay iste. Audit logda: action, llm_score, policy_min, override flag, timestamp.

---

## ANA GÖREV 4: Living Brain (Kalıcı Bellek)

4 katmanlı bellek sisteminin M1 için gereken ilk 2 katmanı: Cortex + Hippocampus.

### 4.1 — Cortex (Anlık Profil)
- **Açıklama:** Her LLM çağrısına enjekte edilen ~2KB kullanıcı profili. `src/memory/cortex.ts`. JSON/YAML dosyası olarak disk'te saklanır. Gateway her LLM çağrısında Cortex'i system prompt'a ekler.
- **Çıktı:** `CortexManager` sınıfı — `load()`, `update()`, `toSystemPrompt()` metodları
- **Kabul Kriteri:** Cortex dosyadan yüklenir, system prompt'a enjekte edilir. `update()` ile alan güncellenebilir. Dosya bozulursa default profil yüklenir.

### 4.2 — Hippocampus: LanceDB Vektör Bellek
- **Açıklama:** Son 30 günün etkileşimlerini saklayan vektör veritabanı. `src/memory/hippocampus.ts`. LanceDB (embedded, dosya tabanlı) kullan. Semantic search + temporal filter.
- **Girdi:** Mesaj/olay metni + embedding
- **Çıktı:** `Hippocampus` sınıfı — `store()`, `search()`, `searchWithTimeRange()` metodları
- **Kabul Kriteri:** Metin saklanır, semantic search çalışır. "Geçen hafta ne konuştuk?" → temporal filter ile sadece o haftanın sonuçları döner. LanceDB dosya tabanlı, Docker volume'da kalıcı.

### 4.3 — Temporal Resolver (Zaman Çözücü)
- **Açıklama:** "yarın", "geçen hafta", "salı günü" gibi doğal dil zaman ifadelerini mutlak tarih aralıklarına çeviren modül. `src/memory/temporal-resolver.ts`.
- **Çıktı:** `TemporalResolver` sınıfı — `resolve(query: string, referenceDate: Date): TimeRange | null`
- **Kabul Kriteri:** "yarın" → yarının tarihi, "geçen hafta" → 7 gün öncesi aralığı, "15 Mart" → mutlak tarih. Türkçe ifadeler desteklenir. Unit test'lerle tüm pattern'lar test edilir.

### 4.4 — Memory Extraction Pipeline
- **Açıklama:** Her konuşma turundan otomatik bilgi çıkaran pipeline. `src/memory/extraction.ts`. LLM'e (ucuz model — Haiku/Flash) "bu mesajdan ne öğrendik?" sorar, çıkarılan bilgiyi Hippocampus'a ve Cortex'e yazar. Zaman ifadelerini `TemporalResolver` ile mutlak tarihe çevirir.
- **Girdi:** Kullanıcı mesajı + AI yanıtı
- **Çıktı:** `MemoryExtractor` sınıfı — `extract(conversation: Message[]): ExtractedMemory[]`
- **Kabul Kriteri:** "Ali'yle yarın 3'te buluşacağız" → EVENT çıkarılır, `refers_to_date` mutlak tarih olarak kaydedilir. Selamlaşma/onay gibi önemsiz mesajlardan çıkarım yapılmaz. Extraction asenkron çalışır (yanıt gecikmesi yaratmaz).

### 4.5 — Bellek ↔ Gateway Entegrasyonu
- **Açıklama:** Gateway'in her LLM çağrısından önce Cortex + Hippocampus arama yapmasını, her yanıttan sonra Memory Extraction çalıştırmasını sağla.
- **Girdi:** Mevcut gateway mesaj akışı
- **Çıktı:** Gateway'de bellek middleware'i
- **Kabul Kriteri:** Kullanıcı mesaj gönderdiğinde: (1) Cortex yüklenir, (2) Hippocampus'ta arama yapılır, (3) context LLM'e verilir, (4) yanıt sonrası extraction çalışır. Bellek Docker volume'da kalıcı — restart'ta kaybolmaz.

---

## ANA GÖREV 5: Sleep Phase (Uyku Fazı)

Gece çalışan konsolidasyon ve bakım rutinleri.

### 5.1 — Sleep Phase Scheduler
- **Açıklama:** Consciousness Loop'un kullanıcı inaktif olduğunda (gece saatleri veya 4+ saat sessizlik) Sleep Phase'i tetiklemesini sağla. `src/consciousness/sleep.ts`.
- **Çıktı:** `SleepPhase` sınıfı — `shouldStartSleep()`, `run()` metodları
- **Kabul Kriteri:** Gece 23:30 + kullanıcı 1 saat inaktif → sleep tetiklenir. Sleep sırasında normal tick'ler durur, Watchdog devam eder.

### 5.2 — Çöp Toplama (Garbage Collection)
- **Açıklama:** Günün konuşmalarından önemsiz mesajları temizleyen, token tasarrufu sağlayan faz. `src/consciousness/sleep-gc.ts`.
- **Çıktı:** `GarbageCollector` sınıfı — `collectGarbage(todaysMessages): CleanedResult`
- **Kabul Kriteri:** Selamlaşma, onay, geçici debug mesajları silinir. Önemli bilgiler Hippocampus'a taşınır. Token tasarrufu loglanır.

### 5.3 — Konsolidasyon (Memory Consolidation)
- **Açıklama:** Hippocampus'taki benzer bellekleri birleştiren, eski bellekleri arşivleyen faz. `src/consciousness/sleep-consolidation.ts`.
- **Çıktı:** `MemoryConsolidator` sınıfı — `consolidate(): ConsolidationReport`
- **Kabul Kriteri:** Benzer bellekler (cosine similarity > 0.9) birleştirilir. 30 gündür erişilmeyen bellekler arşivlenir (silinmez). Rapor loglanır.

### 5.4 — Cortex Güncelleme (Sabah Hazırlığı)
- **Açıklama:** Sleep sonunda Cortex'i güncelleyen, sabah ilk tick için hazırlayan faz.
- **Çıktı:** `CortexUpdater` — Sleep fazlarının sonuçlarını Cortex'e yazar
- **Kabul Kriteri:** Sleep tamamlandığında Cortex güncel. Sabah ilk tick'te güncel profil hazır.

---

## ANA GÖREV 6: Proaktif Mesajlaşma ve Kanal Entegrasyonu

Consciousness Loop'un kararlarını kullanıcıya iletme altyapısı.

### 6.1 — Proaktif Mesaj Gönderme Mekanizması
- **Açıklama:** Consciousness Loop "MESAJ_AT" kararı verdiğinde, mesajı kullanıcının aktif kanalına gönderen mekanizma. `src/consciousness/proactive-messenger.ts`. M1'de sadece Web Chat (WebSocket) desteklenecek.
- **Girdi:** `TickDecision` (action: MESAJ_AT, message: string, urgency: number)
- **Çıktı:** `ProactiveMessenger` sınıfı — `send(decision: TickDecision)`
- **Kabul Kriteri:** Loop "MESAJ_AT" → WebSocket üzerinden kullanıcıya mesaj ulaşır. Saat 00:00-07:00 arası acil olmayan mesajlar ertelenir (sabah gönderilir).

### 6.2 — Event Buffer (Redis Streams)
- **Açıklama:** Container uyurken/yeniden başlarken mesaj kaybını engelleyen Redis Stream buffer. `src/buffer/event-buffer.ts`. M1'de Scale-to-Zero yok ama restart durumunda mesaj kaybı olmamalı.
- **Çıktı:** `EventBuffer` sınıfı — `push()`, `consume()`, `ack()` metodları
- **Kabul Kriteri:** Mesaj Redis Stream'e yazılır. Gateway restart → buffer'daki mesajlar FIFO okunur. ACK mekanizması çalışır.

### 6.3 — WhatsApp veya Telegram Kanal Entegrasyonu
- **Açıklama:** Mevcut `extensions/` altındaki WhatsApp veya Telegram entegrasyonunu Consciousness Loop ile entegre et. Proaktif mesajların sadece Web Chat değil, seçilen kanala da gitmesini sağla.
- **Girdi:** Mevcut `extensions/whatsapp/` veya `extensions/telegram/`
- **Çıktı:** Kanal adaptörü güncelleme + proactive messenger kanal desteği
- **Kabul Kriteri:** Consciousness Loop proaktif mesajı WhatsApp/Telegram'a gönderebilir. Kullanıcı WhatsApp'tan yazdığında Gateway cevap verebilir.

---

## ANA GÖREV 7: Deploy ve Operasyonel Hazırlık

Hetzner'de 7/24 çalışan sistem.

### 7.1 — Hetzner Docker Compose Deploy Konfigürasyonu
- **Açıklama:** Production-ready Docker Compose: restart policies, volume mounts (bellek kalıcılığı), healthcheck'ler, log rotation, resource limits.
- **Çıktı:** `docker-compose.prod.yml`, deploy dökümantasyonu
- **Kabul Kriteri:** `docker compose -f docker-compose.prod.yml up -d` → 4 servis ayağa kalkar. Container crash → otomatik restart. Bellek volume'lar kalıcı.

### 7.2 — Monitoring ve Alerting (Basit)
- **Açıklama:** Basit healthcheck endpoint + log tabanlı monitoring. Container'lar çökerse Telegram/e-posta ile alert.
- **Çıktı:** `/healthz` endpoint güncellemesi, basit alert script'i
- **Kabul Kriteri:** Gateway, Redis, LiteLLM healthcheck'leri çalışır. Container down → alert gönderilir.

### 7.3 — Backup ve Recovery
- **Açıklama:** Bellek veritabanlarının (LanceDB dosyaları, Cortex, SQLite) günlük yedeklenmesi. Basit cron job ile yerel veya S3'e backup.
- **Çıktı:** Backup script, recovery prosedürü dökümantasyonu
- **Kabul Kriteri:** Günlük otomatik backup çalışır. Backup'tan recovery test edilir — bellek kaybı sıfır.

---

## Bağımlılık Grafiği (Sıralama)

```
ANA GÖREV 1 (Altyapı + BYOK)
├── 1.1 Docker Compose ──────────────────────────┐
├── 1.2 BYOK Key Config ─────┐                   │
├── 1.3 LLM Proxy Layer ─────┤                   │
└── 1.4 Maliyet Loglama ─────┘                   │
         │                                        │
         ▼                                        │
ANA GÖREV 2 (Consciousness)                      │
├── 2.1 Tip Tanımları ────────┐                   │
├── 2.2 Watchdog ─────────────┤                   │
├── 2.3 Loop Engine ──────────┤ (1.3'e bağımlı)  │
└── 2.4 Gateway Entegrasyon ──┘                   │
         │                                        │
         ▼                                        │
ANA GÖREV 3 (DPE)            ANA GÖREV 4 (Bellek)│
├── 3.1 Policy Core           ├── 4.1 Cortex     │
└── 3.2 Gateway Entegrasyon   ├── 4.2 Hippocampus│
         │                    ├── 4.3 Temporal Res│
         │                    ├── 4.4 Extraction  │
         │                    └── 4.5 Gw Entegras.│
         │                             │          │
         └──────────┬──────────────────┘          │
                    ▼                              │
         ANA GÖREV 5 (Sleep)                      │
         ├── 5.1 Scheduler ────(2.3'e bağımlı)   │
         ├── 5.2 GC ──────────(4.2'ye bağımlı)   │
         ├── 5.3 Konsolidasyon (4.2'ye bağımlı)   │
         └── 5.4 Cortex Update (4.1'e bağımlı)   │
                    │                              │
                    ▼                              │
         ANA GÖREV 6 (Proaktif)                   │
         ├── 6.1 Messenger ───(2.3'e bağımlı)    │
         ├── 6.2 Event Buffer ────────────────────┘
         └── 6.3 Kanal Entegr.
                    │
                    ▼
         ANA GÖREV 7 (Deploy)
         ├── 7.1 Prod Docker Compose
         ├── 7.2 Monitoring
         └── 7.3 Backup
```

## Önerilen Geliştirme Sırası

```
HAFTA 1-2:  Görev 1 (Altyapı) + Görev 2.1-2.2 (Tipler + Watchdog)
HAFTA 3-4:  Görev 2.3-2.4 (Loop + Gateway entegrasyon) + Görev 3 (DPE)
HAFTA 5-6:  Görev 4 (Bellek — Cortex, Hippocampus, Extraction)
HAFTA 7-8:  Görev 5 (Sleep Phase) + Görev 6 (Proaktif + Event Buffer)
HAFTA 9-10: Görev 7 (Deploy) + Entegrasyon testleri + Hetzner deploy
```

---

## Başarı Kriterleri (Milestone 1 Tamamlanma Koşulları)

- [ ] Sistem Docker Compose ile Hetzner'de 7/24 çalışır
- [ ] Consciousness Loop her dakika tick atar, Watchdog gereksiz tick'leri filtreler
- [ ] BYOK key ile LLM çağrıları başarılı (LiteLLM proxy üzerinden)
- [ ] Maliyet logları tutulur, `openclaw cost` çalışır
- [ ] Cortex her mesajda yüklenir, profil LLM'e enjekte edilir
- [ ] Hippocampus'ta bellekler saklanır, semantic+temporal arama çalışır
- [ ] Memory Extraction otomatik çalışır ("yarın" → mutlak tarih)
- [ ] DPE, LLM halüsinasyonlarını override eder (email.send skor 2 → skor 8)
- [ ] Sleep Phase gece tetiklenir: çöp toplama + konsolidasyon çalışır
- [ ] Proaktif mesajlar Web Chat'e ulaşır
- [ ] Event Buffer restart'larda mesaj kaybını önler
- [ ] En az 1 harici kanal (WhatsApp veya Telegram) çalışır
- [ ] Container crash → otomatik restart + alert
- [ ] Günlük backup çalışır, recovery test edilmiştir
