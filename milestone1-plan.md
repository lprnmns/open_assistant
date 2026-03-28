# Milestone 1: Single-Tenant MVP — İş Kırılım Yapısı (WBS)

> **Revizyon:** v2 — QA Architect incelemesi (`code-reviews/milestone1-plan_review.md`) sonrası 4 bloklayıcı bulgu giderildi.

> **Hedef:** Open Assistant'ı sadece Kurucu (Manas) için, Hetzner VPS üzerinde, kendi Pro API key'leriyle 7/24 kusursuz çalışan bir "Yaşayan Varlık" haline getirmek.
>
> **Çıktı:** Uyuyan, uyanan, proaktif mesajlar atan, bellekli, act-first karar veren tek kişilik Yaşayan Varlık.
>
> **Altyapı:** Hetzner CX31 (2 vCPU, 8GB RAM), Docker Compose, Redis, LanceDB, LiteLLM, Node.js/TypeScript.

---

## Genel İlkeler

- Mevcut OpenClaw kod tabanı (Gateway, channels, agents, policy pipeline) üzerine inşa edilecek — sıfırdan yazılmayacak.
- Her alt görev kendi branch commit'iyle pushlanır, denetçi onayı beklenir.
- Testler her alt görevle birlikte yazılır (test olmadan commit yok).
- M1'de Kubernetes/MicroVM yok — Docker Compose yeterli.
- M1'de tek kullanıcı — multi-tenant izolasyonu M3'e bırakılır.
- BYOK key'ler M1'de boot-time decrypt edilen encrypted config ile yönetilir (plaintext disk'e yazılmaz).

---

## Revizyon Notları (v1 → v2)

Aşağıdaki 4 bloklayıcı bulgu QA incelemesine göre giderilmiştir:

| # | Bulgu | Yapılan Düzeltme |
|---|-------|-----------------|
| B1 | `new_message` Watchdog wake reason olarak double LLM çağrısı | Kaldırıldı; intent mining normal reply path içinde yürür |
| B2 | Yeni `src/policy/*` omurgası mevcut policy pipeline'ı çatallıyor | Mevcut `tool-policy-pipeline.ts` + `node-command-policy.ts` genişletilecek |
| B3 | Proaktif owner mesajı ile 3. kişi mesajı aynı action sınıfında | `message.send.owner_active_channel` / `message.send.third_party_contact` ayrımı eklendi |
| B4 | "Encrypted .env" gerçek at-rest encryption teslim etmiyor | Encrypted secrets file + boot-time decrypt + log redaction test zorunluluğu eklendi |

Ek düzeltmeler:
- Maliyet loglama mevcut `src/agents/usage.ts` + `src/gateway/model-pricing-cache.ts` üzerine inşa edilecek
- LLM Proxy entegrasyonu auth profile + pricing yüzeylerini de kapsar
- Self-host URL kesinleşene kadar plandan çıkarıldı

---

## ANA GÖREV 1: Proje Altyapısı ve BYOK Key Yönetimi

M1'in çalışması için gereken temel altyapı: LiteLLM entegrasyonu, güvenli API key yönetimi, Redis kurulumu.

### 1.1 — Docker Compose Güncellemesi
- **Açıklama:** Mevcut `docker-compose.yml`'a `redis` ve `litellm-proxy` servislerini ekle. Healthcheck'leri yapılandır. Production restart policy ekle.
- **Girdi:** Mevcut `docker-compose.yml` (2 servis: gateway + cli)
- **Çıktı:** Güncellenmiş `docker-compose.yml` (4 servis: gateway + cli + redis + litellm)
- **Kabul Kriteri:** `docker compose up` ile 4 servis birlikte ayağa kalkar, healthcheck'ler geçer. `restart: unless-stopped` her serviste aktif.

### 1.2 — BYOK Key Yapılandırması (Encrypted Secrets)

> **[B4 revizyonu]** Plain `.env` yerine at-rest encrypted secrets file kullanılır.

- **Açıklama:** API key'ler diskte şifresiz **saklanmaz**. Boot sırasında şifreli dosya çözülür, key'ler sadece runtime belleğinde tutulur ve LiteLLM'e process env üzerinden iletilir. `src/config/secrets.ts` modülü bu decrypt/inject döngüsünü yönetir.
- **Girdi:** `.env.example` (mevcut)
- **Çıktı:**
  - `src/config/secrets.ts` — encrypt/decrypt/load API'si
  - `scripts/init-secrets.ts` — kurulum sırasında bir kez çalıştırılan key şifreleme aracı
  - `config/secrets.enc` — şifreli key dosyası (`.gitignore`'a eklenir)
  - `litellm_config.yaml` — LiteLLM proxy yapılandırması
- **Kabul Kriteri:**
  - API key diskte şifresiz bulunmaz (`strings config/secrets.enc | grep sk-` boş döner)
  - Process env'ye key sadece runtime'da enjekte edilir
  - Log redaction testleri: key içeren bir string loglandığında `[REDACTED]` görünür
  - Container restart sonrası key tekrar güvenle yüklenir
  - `scripts/init-secrets.ts` ile key şifrelenir, `src/config/secrets.ts` ile açılır

### 1.3 — LLM Proxy Entegrasyon Katmanı
- **Açıklama:** Gateway'in LLM çağrılarını doğrudan provider API yerine LiteLLM proxy üzerinden yapmasını sağlayacak abstraction layer. Mevcut `src/agents/model-selection.ts` ve auth profile yüzeyiyle entegre olacak. `src/llm/proxy-client.ts`.
- **Girdi:** Mevcut `src/agents/model-selection.ts`, auth profile yapısı
- **Çıktı:** `src/llm/proxy-client.ts`, `src/llm/types.ts`
- **Kabul Kriteri:** Gateway, LiteLLM proxy üzerinden Claude/GPT çağrısı yapabilir. Auth profile ve model routing mevcut yüzeyle çakışmaz. Unit test'ler geçer. Mevcut gateway fonksiyonalitesi bozulmaz.

### 1.4 — Maliyet Loglama (Temel)

> **[Ek revizyon]** Mevcut `src/agents/usage.ts` ve `src/gateway/model-pricing-cache.ts` üzerine inşa edilir; ikinci bir cost normalizasyon hattı açılmaz.

- **Açıklama:** Her LLM çağrısının token sayısı, maliyeti ve kaynağını (chat/consciousness/sleep/extraction) loglayan katman. Mevcut `usage.ts` normalize edilip kaynak etiketi (`source`) ve SQLite persist katmanı eklenir.
- **Girdi:** `src/agents/usage.ts`, `src/gateway/model-pricing-cache.ts`
- **Çıktı:** Genişletilmiş `usage.ts` (source tag), `src/llm/cost-store.ts` (SQLite persist), `openclaw cost` CLI komutu
- **Kabul Kriteri:** `openclaw cost today` bugünkü harcamayı kaynak bazlı (chat/consciousness/sleep/extraction) gösterir. Mevcut usage yüzeyi bozulmaz.

---

## ANA GÖREV 2: Consciousness Loop (Bilinç Döngüsü)

Sistemin kalp atışı. Kullanıcı mesaj atmasa bile düşünebilen **background** döngü.

### 2.1 — Temel Tip Tanımları
- **Açıklama:** Tüm Consciousness sisteminin paylaşacağı TypeScript interface'leri. `src/consciousness/types.ts`.
- **Çıktı:** `WorldSnapshot`, `TickDecision`, `WakeReason`, `TickAction`, `ConsciousnessConfig`, `ConsciousnessState` interface'leri.
- **Kabul Kriteri:** Tipler derlenir. `TickAction` değerleri: `SEND_MESSAGE | TAKE_NOTE | STAY_SILENT | ENTER_SLEEP`. `WakeReason` değerleri: `TRIGGER_FIRED | SILENCE_THRESHOLD | PENDING_NOTE | CRON_DUE | EXTERNAL_WORLD_DELTA` — **`new_message` dahil değil**.

### 2.2 — Heuristic Watchdog

> **[B1 revizyonu]** `new_message` wake reason listesinden çıkarıldı. Kullanıcı mesajı geldiğinde normal gateway yanıt hattı çalışır; Consciousness Loop ikinci bir LLM çağrısı açmaz.

- **Açıklama:** LLM'den önce çalışan, sıfır maliyetli delta-check motoru. `src/consciousness/watchdog.ts`. Sadece **background** olayları takip eder: (1) aktif trigger tetiklendi mi, (2) sessizlik eşiği aşıldı mı, (3) bekleyen not var mı, (4) compiled cron tetiklendi mi.
- **Girdi:** `WorldSnapshot` (Redis'ten okunan background durum)
- **Çıktı:** `src/consciousness/watchdog.ts` + `watchdog.test.ts`
- **Kabul Kriteri:**
  - Mock veriyle: "hiçbir background delta yok" → `wake: false` (LLM çağrılmaz, $0)
  - "Aktif trigger tetiklendi" → `wake: true, reason: 'TRIGGER_FIRED'`
  - Sessizlik eşiği aşıldığında eşik %50 artırılır (aynı sebepten re-trigger engeli)
  - Kullanıcı yeni mesaj göndermiş olsa bile bu Watchdog'u tetiklemez
  - %100 unit test coverage

### 2.3 — Consciousness Loop Engine
- **Açıklama:** Watchdog'u çağıran, gerektiğinde LLM'i uyandıran, karar alan ana **background** döngü. `src/consciousness/loop.ts`. `tick()` metodu: Watchdog → context hazırla → LLM çağrısı (LiteLLM proxy üzerinden) → karar uygula. Adaptive interval: acil → 30sn, sakin → 5dk. Kullanıcı mesajı geldiğinde bu döngü devreye girmez; normal yanıt hattı çalışır.
- **Girdi:** Watchdog sonucu, Cortex (bellek), kullanıcı background durumu
- **Çıktı:** `src/consciousness/loop.ts` + `loop.test.ts`
- **Kabul Kriteri:**
  - Watchdog `wake: false` → LLM çağrılmaz ($0)
  - Watchdog `wake: true` → LLM çağrılır, `TickAction` döner
  - Inbound kullanıcı mesajı → loop bu mesaj için ikinci LLM çağrısı açmaz
  - Tick interval adaptive olarak ayarlanır

### 2.4 — Consciousness Loop ↔ Gateway Entegrasyonu
- **Açıklama:** Loop'u mevcut Gateway boot sürecine (`src/gateway/boot.ts`) entegre et. Gateway ayağa kalktığında Loop background process olarak başlar. Loop'un `SEND_MESSAGE` kararını kullanıcının aktif kanalına (başlangıçta Web Chat) göndermesini sağla. Normal inbound mesaj akışı bağımsız kalır.
- **Girdi:** Mevcut gateway boot akışı
- **Çıktı:** Güncellenmiş `boot.ts`, `src/consciousness/integration.ts`
- **Kabul Kriteri:** `docker compose up` → Gateway → Loop background başlar → tick'ler loglanır. Proaktif mesaj Web Chat'e ulaşır. Normal kullanıcı mesajı geldiğinde Loop ayrı bir düşünce hattı açmaz.

---

## ANA GÖREV 3: Deterministic Policy Engine (DPE)

LLM halüsinasyonlarını engelleyen güvenlik katmanı — **mevcut policy pipeline genişletilerek** eklenir.

### 3.1 — Mevcut Policy Pipeline'a Risk Metadata Eklenmesi

> **[B2 revizyonu]** Yeni `src/policy/*` kökü açılmaz. Mevcut `src/agents/tool-policy-pipeline.ts` ve `src/agents/tool-policy.ts` genişletilir.

> **[B3 revizyonu]** Mesaj gönderme aksiyonları recipient tipine göre ayrılır.

- **Açıklama:** `tool-policy-pipeline.ts` içindeki her tool definition'a risk metadata alanları eklenir: `reversibilityMinScore`, `requiresHuman`, `maxPerHour`, `maxPerDay`. Tool execution pipeline'ına "risk enforcement" adımı eklenir. Node komutları için son karar mevcut `src/gateway/node-command-policy.ts` ile birlikte verilir.
- **Girdi:** `src/agents/tool-policy-pipeline.ts`, `src/agents/tool-policy.ts`, `src/gateway/node-command-policy.ts`
- **Çıktı:** Genişletilmiş tool policy metadata + `src/agents/tool-policy-pipeline.ts`'e risk enforcement adımı
- **Risk sınıfları (kritik ayrım):**
  ```typescript
  // Proaktif owner mesajı — sormadan gönderilir
  "message.send.owner_active_channel": { reversibilityMinScore: 1, requiresHuman: false }

  // Üçüncü kişiye mesaj — her zaman onay gerekir
  "message.send.third_party_contact": { reversibilityMinScore: 8, requiresHuman: true }

  // Diğer yüksek risk aksiyonlar
  "email.send":    { reversibilityMinScore: 8, requiresHuman: true, maxPerHour: 10 }
  "finance.*":     { reversibilityMinScore: 10, requiresHuman: true, maxPerDay: 5 }
  "file.delete":   { reversibilityMinScore: 7, requiresHuman: true }

  // Düşük risk — Act-First
  "reminder.create": { reversibilityMinScore: 1, requiresHuman: false }
  "calendar.write":  { reversibilityMinScore: 2, requiresHuman: false }
  "memory.save":     { reversibilityMinScore: 1, requiresHuman: false }
  ```
- **Kabul Kriteri:**
  - LLM `email.send` için skor 2 verirse → pipeline min_score 8'e yükseltir → human onay istenir
  - LLM `message.send.owner_active_channel` için skor 1 verirse → Act-First, sormadan gönderir
  - LLM `message.send.third_party_contact` için skor 1 verirse → 8'e yükseltilir → onay istenir
  - Rate limiting çalışır
  - `tool-policy-pipeline.test.ts` güncellenip tüm yeni senaryolar test edilir

### 3.2 — Audit Trail
- **Açıklama:** Policy kararlarının (özellikle override'ların) loglanması. Mevcut gateway/tool execution akışına bağlı, ayrı bir log yüzeyi açılmaz.
- **Çıktı:** `src/agents/tool-policy-audit.ts` — SQLite'a append-only audit log. Her override kaydı: action, llm_score, policy_min, override:bool, timestamp.
- **Kabul Kriteri:** Override gerçekleştiğinde SQLite'a kayıt düşer. Mevcut tool-policy test suite bozulmaz.

---

## ANA GÖREV 4: Living Brain (Kalıcı Bellek)

4 katmanlı bellek sisteminin M1 için gereken ilk 2 katmanı: Cortex + Hippocampus.

### 4.1 — Cortex (Anlık Profil)
- **Açıklama:** Her LLM çağrısına enjekte edilen ~2KB kullanıcı profili. `src/memory/cortex.ts`. JSON dosyası olarak disk'te saklanır. Gateway her LLM çağrısında Cortex'i system prompt'a ekler.
- **Çıktı:** `CortexManager` sınıfı — `load()`, `update()`, `toSystemPrompt()` metodları
- **Kabul Kriteri:** Cortex dosyadan yüklenir, system prompt'a enjekte edilir. `update()` ile alan güncellenebilir. Dosya bozulursa default profil yüklenir.

### 4.2 — Hippocampus: LanceDB Vektör Bellek
- **Açıklama:** Son 30 günün etkileşimlerini saklayan vektör veritabanı. `src/memory/hippocampus.ts`. LanceDB (embedded, dosya tabanlı) kullan. Semantic search + temporal filter birlikte çalışır.
- **Çıktı:** `Hippocampus` sınıfı — `store()`, `search()`, `searchWithTimeRange()` metodları
- **Kabul Kriteri:** Metin saklanır, semantic search çalışır. "Geçen hafta ne konuştuk?" → temporal filter ile sadece o haftanın sonuçları döner. LanceDB Docker volume'da kalıcı — restart'ta kaybolmaz.

### 4.3 — Temporal Resolver (Zaman Çözücü)
- **Açıklama:** "yarın", "geçen hafta", "salı günü" gibi doğal dil zaman ifadelerini mutlak tarih aralıklarına çeviren modül. `src/memory/temporal-resolver.ts`.
- **Çıktı:** `TemporalResolver` sınıfı — `resolve(query: string, referenceDate: Date): TimeRange | null`
- **Kabul Kriteri:** "yarın" → yarının tarihi, "geçen hafta" → 7 gün öncesi aralığı, "15 Mart" → mutlak tarih. Türkçe ifadeler desteklenir. Unit test'lerle tüm pattern'lar test edilir.

### 4.4 — Memory Extraction Pipeline
- **Açıklama:** Her konuşma turundan otomatik bilgi çıkaran pipeline. `src/memory/extraction.ts`. Ucuz model (Haiku/Flash) ile "bu mesajdan ne öğrendik?" Zaman ifadelerini `TemporalResolver` ile mutlak tarihe çevirir. Asenkron çalışır — yanıt gecikmesi yaratmaz.
- **Çıktı:** `MemoryExtractor` sınıfı — `extract(conversation: Message[]): Promise<ExtractedMemory[]>`
- **Kabul Kriteri:** "Ali'yle yarın 3'te buluşacağız" → EVENT çıkarılır, `refers_to_date` mutlak tarih. Selamlaşma/onaydan çıkarım yapılmaz. Extraction gateway yanıtını bloklamaz.

### 4.5 — Bellek ↔ Gateway Entegrasyonu
- **Açıklama:** Gateway'in her LLM çağrısından önce Cortex + Hippocampus araması, her yanıttan sonra Memory Extraction çalıştırması. Middleware olarak mevcut mesaj akışına eklenir.
- **Çıktı:** Gateway'de bellek middleware'i
- **Kabul Kriteri:** Kullanıcı mesajı geldiğinde: (1) Cortex yüklenir, (2) Hippocampus'ta arama yapılır, (3) context LLM'e verilir, (4) yanıt sonrası extraction asenkron çalışır. Bellek Docker volume'da kalıcı.

---

## ANA GÖREV 5: Sleep Phase (Uyku Fazı)

Gece çalışan konsolidasyon ve bakım rutinleri.

### 5.1 — Sleep Phase Scheduler
- **Açıklama:** Consciousness Loop'un kullanıcı inaktif olduğunda (gece saatleri veya 4+ saat sessizlik) Sleep Phase'i tetiklemesi. `src/consciousness/sleep.ts`.
- **Çıktı:** `SleepPhase` sınıfı — `shouldStartSleep()`, `run()` metodları
- **Kabul Kriteri:** Gece 23:30 + kullanıcı 1 saat inaktif → sleep tetiklenir. Sleep sırasında normal background tick'ler durur, Watchdog devam eder.

### 5.2 — Çöp Toplama (Garbage Collection)
- **Açıklama:** Günün konuşmalarından önemsiz mesajları temizleyen faz. `src/consciousness/sleep-gc.ts`.
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

> **[B3 revizyonu]** `message.send.owner_active_channel` olarak sınıflandırılır, onay gerektirmez.

- **Açıklama:** Consciousness Loop `SEND_MESSAGE` kararı verdiğinde mesajı kullanıcının aktif kanalına gönderen mekanizma. `src/consciousness/proactive-messenger.ts`. Bu mesajlar `message.send.owner_active_channel` olarak policy pipeline'dan geçer (skor 1, Act-First). M1'de sadece Web Chat (WebSocket) desteklenecek.
- **Girdi:** `TickDecision` (action: SEND_MESSAGE, message: string, urgency: number)
- **Çıktı:** `ProactiveMessenger` sınıfı — `send(decision: TickDecision)`
- **Kabul Kriteri:** Loop `SEND_MESSAGE` → WebSocket üzerinden kullanıcıya mesaj ulaşır. Saat 00:00-07:00 arası acil olmayan mesajlar ertelenir. Policy pipeline üzerinden geçirildiğinde `owner_active_channel` sınıfı otomatik onaylanır.

### 6.2 — Event Buffer (Redis Streams)
- **Açıklama:** Container restart durumunda mesaj kaybını engelleyen Redis Stream buffer. `src/buffer/event-buffer.ts`.
- **Çıktı:** `EventBuffer` sınıfı — `push()`, `consume()`, `ack()` metodları
- **Kabul Kriteri:** Mesaj Redis Stream'e yazılır. Gateway restart → buffer'daki mesajlar FIFO okunur. ACK mekanizması çalışır.

### 6.3 — WhatsApp veya Telegram Kanal Entegrasyonu
- **Açıklama:** Mevcut `extensions/` altındaki WhatsApp veya Telegram entegrasyonunu Consciousness Loop ile entegre et. Proaktif mesajların seçilen kanala da gitmesini sağla.
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
- **Açıklama:** Bellek veritabanlarının (LanceDB dosyaları, Cortex, SQLite) günlük yedeklenmesi.
- **Çıktı:** Backup script, recovery prosedürü dökümantasyonu
- **Kabul Kriteri:** Günlük otomatik backup çalışır. Backup'tan recovery test edilir — bellek kaybı sıfır.

---

## Bağımlılık Grafiği (Sıralama)

```
ANA GÖREV 1 (Altyapı + BYOK)
├── 1.1 Docker Compose
├── 1.2 Encrypted Secrets (at-rest)
├── 1.3 LLM Proxy Layer (mevcut model-selection üzerine)
└── 1.4 Maliyet Loglama (mevcut usage.ts üzerine)
         │
         ▼
ANA GÖREV 2 (Background Consciousness)
├── 2.1 Tip Tanımları (new_message WakeReason'da YOK)
├── 2.2 Watchdog (sadece background delta'lar)
├── 2.3 Loop Engine (normal mesaj hattına dokunmaz)
└── 2.4 Gateway Entegrasyon
         │
         ▼
ANA GÖREV 3 (DPE — mevcut pipeline genişletme)
├── 3.1 Risk Metadata + owner/3rd-party mesaj ayrımı
└── 3.2 Audit Trail
         │
         ▼
ANA GÖREV 4 (Bellek)
├── 4.1 Cortex
├── 4.2 Hippocampus (LanceDB)
├── 4.3 Temporal Resolver
├── 4.4 Extraction
└── 4.5 Gateway Entegrasyon
         │
         ▼
ANA GÖREV 5 (Sleep)
├── 5.1 Scheduler
├── 5.2 GC
├── 5.3 Konsolidasyon
└── 5.4 Cortex Güncelleme
         │
         ▼
ANA GÖREV 6 (Proaktif)
├── 6.1 Messenger (owner_active_channel policy)
├── 6.2 Event Buffer
└── 6.3 Kanal Entegrasyon
         │
         ▼
ANA GÖREV 7 (Deploy)
├── 7.1 Prod Docker Compose
├── 7.2 Monitoring
└── 7.3 Backup
```

## Önerilen Geliştirme Sırası

```
HAFTA 1-2:  Görev 1 (Altyapı + Encrypted BYOK) + Görev 2.1-2.2 (Tipler + Watchdog)
HAFTA 3-4:  Görev 2.3-2.4 (Loop + Gateway entegrasyon) + Görev 3 (DPE pipeline genişletme)
HAFTA 5-6:  Görev 4 (Bellek — Cortex, Hippocampus, Extraction)
HAFTA 7-8:  Görev 5 (Sleep Phase) + Görev 6 (Proaktif + Event Buffer)
HAFTA 9-10: Görev 7 (Deploy) + Entegrasyon testleri + Hetzner deploy
```

---

## Başarı Kriterleri (Milestone 1 Tamamlanma Koşulları)

- [ ] Sistem Docker Compose ile Hetzner'de 7/24 çalışır
- [ ] Consciousness Loop background tick atar, Watchdog gereksiz tick'leri filtreler
- [ ] Normal kullanıcı mesajı geldiğinde Loop ikinci LLM çağrısı açmaz
- [ ] BYOK key'ler diskte şifresiz saklanmaz (at-rest encryption)
- [ ] LLM çağrıları LiteLLM proxy üzerinden yapılır (mevcut model-selection entegre)
- [ ] Maliyet logları tutulur (`openclaw cost` çalışır, mevcut usage.ts üzerine)
- [ ] DPE mevcut tool-policy-pipeline'a entegre, ayrı omurga yok
- [ ] `message.send.owner_active_channel` Act-First, `message.send.third_party_contact` onay gerekli
- [ ] Cortex her mesajda yüklenir, profil LLM'e enjekte edilir
- [ ] Hippocampus semantic + temporal arama çalışır
- [ ] Memory Extraction otomatik çalışır ("yarın" → mutlak tarih)
- [ ] Sleep Phase gece tetiklenir: çöp toplama + konsolidasyon çalışır
- [ ] Proaktif mesajlar Web Chat'e ulaşır
- [ ] Event Buffer restart'larda mesaj kaybını önler
- [ ] En az 1 harici kanal (WhatsApp veya Telegram) çalışır
- [ ] Container crash → otomatik restart + alert
- [ ] Günlük backup çalışır, recovery test edilmiştir
