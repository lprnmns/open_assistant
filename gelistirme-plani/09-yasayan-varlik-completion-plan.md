# 09 — Yaşayan Varlık Tamamlama Planı (Completion WBS)

## 1. Executive Summary

### Bugünkü durum

M1 çekirdeği güçlü. Consciousness loop, scheduler, event buffer, brain (cortex + hippocampus), sleep/consolidation pipeline, tool policy pipeline, `requiresHuman` fail-closed enforcement — bunların hepsi yazılmış, test edilmiş, çalışıyor.

Ama **hiçbiri production'da aktif değil.**

`startConsciousnessLoop()` tanımlı ama hiçbir app bootstrap noktasında çağrılmıyor. `buildSnapshot()` gerçek veriyle beslenmiyor. `reversibilityScore` pipeline'da taşınıyor ama hiçbir karar vermiyor. Recall pipeline semantik benzerlik yapıyor ama "geçen hafta" diyince zaman filtresi uygulamıyor. Sistem kullanıcının "acil" yazdığını algılayıp cevap modunu değiştirmiyor.

### "Working system" ile "living entity behavior" arasındaki fark

| Katman | Working System (bugün) | Living Entity (hedef) |
|--------|----------------------|----------------------|
| Consciousness | Test'te tick atıyor | Production'da 7/24 yaşıyor |
| Memory | Vektör benzerliği ile recall | Zaman + semantik birlikte çalışıyor |
| Karar | `requiresHuman` gate'liyor | `reversibilityScore` auto-execute vs approval kararı veriyor |
| Ton | Model iyi davranırsa tesadüf | Deterministik cognitive load → mode transition |

### Neden M1 çekirdeği yeterli değil

Çünkü **motor var ama direksiyona bağlı değil.** Kullanıcı 3 gün sessiz kaldığında sistem uyanıp "yaklaşan teslim var" demiyor — çünkü scheduler production'da başlamıyor. Kullanıcı "takvime ekle" dediğinde robot gibi "yapayım mı?" diye soruyor — çünkü reversibilityScore karar vermiyor. Kullanıcı "geçen Salı ne konuştuk?" dediğinde alakasız bir notla dönüyor — çünkü temporal filter yok.

Bu eksikler artık "nice to have" değil; ürünün ruhunu oluşturan tamamlama kalemleridir.

---

## 2. Gap Matrix

| # | Feature | Today's State | Missing Piece | Why Current Code Is Insufficient | Risk If Left As-Is |
|---|---------|--------------|---------------|----------------------------------|-------------------|
| G1 | Production Consciousness Wiring | `startConsciousnessLoop()` tanımlı, test'te çalışıyor | App bootstrap'ta çağrılmıyor; `buildSnapshot()` stub | Scheduler hiç başlamıyor → proaktif davranış sıfır | Ürün sadece reaktif chatbot kalır |
| G2 | External World Snapshot Ingestion | `WorldSnapshot` tipi var, tüm alanlar caller-supplied | Redis/DB'den gerçek veri çeken `buildSnapshot()` implementasyonu yok | `lastUserInteractionAt`, `firedTriggerIds`, `activeChannelId` hep hardcoded | Watchdog yanlış kararlar verir (sahte veriyle) |
| G3 | Proactive Channel Dispatch Safety | `sendToChannel()` sadece `activeChannelId`'ye gider, fallback silent drop | Gerçek transport (gateway/webhook) bağlantısı yok | `SEND_MESSAGE` kararı verilse bile hiçbir yere gitmez | Consciousness loop kararları havada kalır |
| G4 | Temporal Resolver | `MemoryNote.createdAt` var, ISO string olarak prompt'a giriyor | Doğal dil zaman ifadesi → zaman aralığı çözümleme yok | "Geçen hafta" deyince tüm notlar arasından vektör benzerliği arar; zaman filtresi uygulamaz | Kullanıcı zaman referanslı sorularda yanlış/alakasız cevap alır |
| G5 | Temporal Memory Filter | `Hippocampus.recall()` signature: `(vector, k, opts?)` — opts sadece `sessionKey` | `startTime` / `endTime` metadata filtresi yok | Recall pipeline zaman aralığına göre daraltamaz; sadece benzerlik sıralar | 6 aylık not havuzunda "geçen hafta" ile "6 ay önce" ayrımı yapılamaz |
| G6 | Automatic Memory Extraction | Brain ingestion pipeline mevcut, consciousness loop prompt'ta çıktı üretir | tick() çıktısından otomatik not çıkarma + ingestion tetikleme yok | Sistem kendi ürettiği insight'ları kalıcı belleğe almıyor | Living brain "öğrenmiyor", sadece tüketiyor |
| G7 | Act-First Decision Layer | `reversibilityScore` pipeline metadata olarak taşınıyor | Score → execution kararı mapping yok; decision tree yok | Score orada duruyor ama auto-execute / mandatory-approval kararını etkilemiyor | Her action için "yapayım mı?" soruluyor; robot hissi |
| G8 | Cognitive Load Detection | `PromptMode` (full/minimal/none) konfigürasyon bazlı | Mesaj analizi yok: uzunluk, aciliyet, typo, compression ratio | Kullanıcı "acil bak loglara" yazınca sistem uzun, sıcak, açıklayıcı cevap üretebilir | Ton uyumsuzluğu; kullanıcı güveni azalır |
| G9 | Mode-Aware Reply Shaping | System prompt statik olarak inşa ediliyor | Runtime'da cognitive load → prompt modifier injection yok | Mod algılansa bile cevap üretimine yansıtılamaz | Algılama yapılsa bile davranışa dönüşmez |
| G10 | Observability / Audit for Proactive Actions | Cost tracking "consciousness" source'u tanıyor | Proaktif aksiyonların structured log/audit trail'i yok | Consciousness kararları ve dispatch sonuçları izlenemiyor | Debug/güven sorunları; "sistem ne yaptı?" sorusuna cevap yok |

---

## 3. Production Wiring Plan

### 3.1 Scheduler → App Lifecycle

**Mevcut durum:** `startConsciousnessLoop()` (`src/consciousness/boot.ts:99-128`) bir factory fonksiyon. Çağrılmıyor.

**Plan:**

`src/consciousness/boot.ts`'deki `startConsciousnessLoop()` zaten doğru abstraction. Eksik olan onu çağıran noktadır.

1. Ana app bootstrap dosyasında (CLI entry veya server start) `startConsciousnessLoop()` çağrısı ekle
2. Lifecycle sırası: DB bağlantısı → brain init (cortex + hippocampus + embedder) → `startConsciousnessLoop({ buildSnapshot, dispatch, brain })`
3. Graceful shutdown: `scheduler.stop()` process signal handler'da (SIGTERM/SIGINT) çağrılmalı
4. Feature flag: `CONSCIOUSNESS_ENABLED=1` env var ile koşullu başlatma (ilk rollout için)

**Dokunulacak dosyalar:**
- `src/consciousness/boot.ts` — mevcut, minimal değişiklik
- App bootstrap dosyası (tanımlanacak) — `startConsciousnessLoop()` çağrısı
- `src/consciousness/shutdown.ts` (yeni, opsiyonel) — graceful stop helper

### 3.2 buildSnapshot() → Gerçek Veri

**Mevcut durum:** Test'lerde `makeSnap()` helper'ı ile hardcoded. Boot.ts'de `buildWorldSnapshotFromRedis()` referansı var ama implementasyon yok.

**Plan:**

`buildRealWorldSnapshot()` fonksiyonu şu kaynaklardan veri çekecek:

| WorldSnapshot alanı | Veri kaynağı | Çözüm |
|---------------------|-------------|--------|
| `capturedAt` | `Date.now()` | Zaten doğru |
| `lastUserInteractionAt` | Son inbound mesaj timestamp'i (DB/Redis) | Kanal adaptörü son mesaj zamanını cache'ler |
| `pendingNoteCount` | Cortex.recentCount() | Yeni getter, mevcut `recent()` üstüne |
| `firedTriggerIds` | Trigger registry (yeni modül) | External trigger'lar → ID listesi |
| `dueCronExpressions` | Cron registry (mevcut cron altyapısı varsa) | Şu an kullanılmıyor; boş array ile başla |
| `externalWorldEvents` | Webhook / event ingest endpoint | Gelen event'ler buffer'a, snapshot sırasında oku |
| `activeChannelId` | Son aktif oturum kanalı (Redis/session store) | Kanal adaptörü günceller |
| `lastTickAt` | Scheduler internal state | Zaten scheduler tarafından yönetiliyor |
| `effectiveSilenceThresholdMs` | Loop internal state | Zaten loop tarafından yönetiliyor |

**Dokunulacak dosyalar:**
- `src/consciousness/snapshot.ts` (yeni) — `buildRealWorldSnapshot()` implementasyonu
- `src/consciousness/brain/cortex.ts` — `recentCount()` getter
- Kanal adaptör katmanı — `lastUserInteractionAt` + `activeChannelId` cache

### 3.3 activeChannelId Çözümleme

**Mevcut durum:** Caller'dan gelir; hiçbir resolver yok.

**Plan:**

activeChannelId kanal adaptörünün sorumluluğundadır. En son kullanıcı mesajının geldiği kanalın ID'si tutulur. Çözümleme stratejisi:

1. Her inbound mesajda kanal adaptörü `lastActiveChannel = { id, updatedAt }` günceller
2. `buildRealWorldSnapshot()` bu değeri okur
3. `undefined` ise consciousness loop proaktif mesaj göndermez (mevcut silent drop korunur)
4. Multi-channel durumunda en son aktif kanal kazanır (basit heuristic, ilk versiyon)

### 3.4 SEND_MESSAGE → Gerçek Kanala Dispatch

**Mevcut durum:** `dispatch.sendToChannel` caller-supplied callback; test'te mock.

**Plan:**

`startConsciousnessLoop()` çağırılırken dispatch callback'leri gerçek transport'a bağlanır:

```
dispatch: {
  sendToChannel: (channelId, content) => gateway.sendMessage(channelId, content),
  appendNote: (content) => brain.ingestion.ingest(makeMemoryNote({ content, sessionKey })),
}
```

**Güvenlik sınırları:**
- Mesaj gönderme rate limit: max 1 proaktif mesaj / 5 dakika (consciousness config'e eklenir)
- Sadece `activeChannelId`'ye gönderim (mevcut integration.ts enforces)
- Content length cap: 500 karakter (consciousness yanıtı için yeterli, spam önler)
- Audit log: her dispatch `{ timestamp, channelId, content, decision }` olarak loglanır

**Dokunulacak dosyalar:**
- `src/consciousness/integration.ts` — rate limit + content cap eklenir
- `src/consciousness/types.ts` — config'e `maxProactiveMessageRateMs`, `maxProactiveContentLength` eklenir
- App bootstrap — gerçek gateway callback wiring

### 3.5 startConsciousnessLoop() — Test'ten Ürüne Taşıma

**Mevcut durum:** `boot.ts` factory fonksiyonu production-ready; sadece çağrılması lazım.

**Taşıma adımları:**
1. Feature flag guard: `if (!process.env.CONSCIOUSNESS_ENABLED) return`
2. Brain init: `createDefaultBrain({ dbPath, embedder })` (mevcut factory'ler)
3. Snapshot builder: `buildRealWorldSnapshot` (yeni, §3.2)
4. Dispatch wiring: gerçek gateway callback (§3.4)
5. Consolidation wiring: mevcut pipeline + session key
6. `scheduler.start()` — setTimeout chain başlar
7. Process exit handler: `scheduler.stop()` + brain cleanup

---

## 4. Temporal Intelligence Plan

### 4.1 Doğal Dil Zaman Çözümleme Katmanı

**Amaç:** "Geçen hafta", "geçen Salı", "bu sabah", "3 gün önce" gibi ifadeleri normalize edilmiş UTC zaman aralığına çevirmek.

**Tasarım:**

```
TemporalResolver.resolve(text: string, referenceTime: number): TemporalRange | null

type TemporalRange = {
  start: number;  // Unix ms, inclusive
  end: number;    // Unix ms, exclusive
  confidence: "exact" | "approximate" | "ambiguous";
  rawExpression: string;
};
```

**İşlenecek ifade kategorileri:**

| Kategori | Örnekler | Çözümleme |
|----------|---------|------------|
| Göreceli gün | "dün", "bugün", "3 gün önce" | referenceTime ± gün |
| Göreceli hafta | "geçen hafta", "bu hafta" | Pazartesi-Pazar aralığı |
| Gün adı | "geçen Salı", "Cuma günü" | En yakın geçmiş günü bul |
| Saat dilimi | "bu sabah", "dün akşam" | 06:00-12:00, 18:00-23:59 |
| Bağlamsal | "spor salonunda", "toplantıda" | → null (çözümlenemez, sadece semantik) |
| Mutlak tarih | "15 Mart", "2026-03-15" | Doğrudan parse |

**İmplementasyon yaklaşımı:**

Regex + kural tabanlı parser (LLM bağımlılığı yok, deterministic):

1. Türkçe + İngilizce zaman ifadesi regex pattern seti
2. `referenceTime` parametresi ile göreceli hesaplama
3. Belirsiz ifadeler için `confidence: "ambiguous"` döndür, geniş aralık kullan
4. Tanınamayan ifadeler → `null` (recall pure semantic'e düşer)

**Dokunulacak dosyalar:**
- `src/consciousness/brain/temporal-resolver.ts` (yeni) — parser modülü
- `src/consciousness/brain/temporal-resolver.test.ts` (yeni) — kapsamlı test suite

### 4.2 MemoryNote Metadata Genişletme

**Mevcut durum:** `MemoryNote` sadece `createdAt: number` taşıyor. Yeterli — zaman filtresi `createdAt` üstünden yapılabilir.

**Ek metadata (opsiyonel, ikinci iterasyon):**
- `context?: string` — "toplantı", "spor", "iş" gibi bağlam etiketi
- `extractedEntities?: string[]` — tarih, kişi adları, yer adları

**Birinci iterasyonda `createdAt` yeterli.** Temporal filter sadece `createdAt >= start && createdAt < end` koşulu uygular.

### 4.3 Temporal Filter → Recall Pipeline Entegrasyonu

**Mevcut recall akışı:**
```
query.text → embed → hippocampus.recall(vector, k) → dedupe with cortex.recent()
```

**Hedef recall akışı:**
```
query.text → temporalResolver.resolve(text) → embed
  → hippocampus.recall(vector, k, { startTime?, endTime? }) → dedupe
  → cortex.recent(recentN, { startTime?, endTime? }) → merge
```

**Değişiklikler:**

1. **`Hippocampus.recall()` signature genişletme:**
   ```
   recall(queryVector, k, opts?: { sessionKey?, startTime?, endTime? })
   ```
   SQLite sorgusu: `WHERE createdAt >= ? AND createdAt < ?` eklenir (mevcut vector search'e AND)

2. **`Cortex.recent()` signature genişletme:**
   ```
   recent(n, opts?: { startTime?, endTime? })
   ```
   RAM buffer filter: `notes.filter(n => n.createdAt >= start && n.createdAt < end)`

3. **`MemoryRecallQuery` genişletme:**
   ```
   type MemoryRecallQuery = {
     text: string;
     k?: number;
     recentN?: number;
     sessionKey?: string;
     temporalRange?: TemporalRange;  // ← yeni
   };
   ```

4. **Recall pipeline orchestration (recall.ts):**
   - `query.text`'ten `TemporalResolver.resolve()` çağrılır
   - Sonuç varsa `hippocampus.recall()` ve `cortex.recent()`'e zaman filtresi geçirilir
   - Sonuç yoksa mevcut davranış korunur (pure semantic)

**Semantic similarity ile temporal narrowing nasıl birlikte çalışacak:**
- Temporal filter bir **pre-filter**'dır: önce zaman aralığına göre aday seti daraltılır
- Daraltılmış set üzerinde vector similarity sıralaması yapılır
- Temporal filter boş sonuç dönerse (o aralıkta not yok) fallback: full semantic search + uyarı

**Dokunulacak dosyalar:**
- `src/consciousness/brain/temporal-resolver.ts` (yeni)
- `src/consciousness/brain/recall.ts` — query → resolve → filter entegrasyonu
- `src/consciousness/brain/hippocampus.ts` — SQL WHERE eklentisi
- `src/consciousness/brain/cortex.ts` — filter overload
- `src/consciousness/brain/types.ts` — `MemoryRecallQuery` genişletme

### 4.4 Örnekler

**"Geçen hafta ne konuştuk?"**
1. TemporalResolver → `{ start: 2026-03-23T00:00Z, end: 2026-03-30T00:00Z, confidence: "exact" }`
2. Hippocampus: `WHERE createdAt >= 1742688000000 AND createdAt < 1743292800000`
3. Vector search bu daraltılmış set üzerinde çalışır
4. Sonuç: sadece geçen haftanın notları, benzerlik sıralı

**"Geçen Salı spor podcasti"**
1. TemporalResolver → `{ start: 2026-03-24T00:00Z, end: 2026-03-25T00:00Z, confidence: "exact" }` (geçen Salı)
2. "Spor podcasti" semantic query olarak embed edilir
3. Hippocampus: Salı aralığındaki notlar + "spor podcasti" vector similarity
4. Sonuç: o güne ait en alakalı not

**"6 ay önce değil geçen hafta"**
1. TemporalResolver → "geçen hafta" çözümlenir; "6 ay önce değil" ifadesi negatif context
2. Temporal filter geçen haftayı kapsar
3. Vector search zaten "6 ay önce" notlarını zaman filtresiyle dışlamış olur

---

## 5. Act-First / Reversibility Plan

### 5.1 Karar Ağacı

**Mevcut durum:** `reversibilityScore` `ToolPolicyMeta` içinde `Record<string, number>` olarak taşınıyor (`tool-policy-pipeline.ts:33-37`). Hiçbir karar noktasında kullanılmıyor.

**Hedef karar ağacı:**

```
reversibilityScore >= 0.7  → AUTO_EXECUTE
  → Aksiyonu sormadan uygula
  → Kullanıcıya sonradan bildirim ("Takvime ekledim: ...")
  → Geri alma yolu sun (undo link/buton)

0.3 <= reversibilityScore < 0.7  → CONFIRM_BRIEF
  → Tek satır onay iste ("Takvime ekleyeyim mi? [Evet/Hayır]")
  → Timeout 60s → varsayılan BLOCK

reversibilityScore < 0.3  → MANDATORY_APPROVAL
  → Detaylı açıklama + açık onay zorunlu
  → requiresHuman semantiği korunur
  → Timeout → BLOCK, retry yok

reversibilityScore tanımsız  → MANDATORY_APPROVAL
  → Fail-closed: bilinmeyen tool → insan onayı zorunlu
```

### 5.2 Tool Metadata

**Mevcut konum:** `tool-policy-pipeline.ts` — `reversibilityScores` merge'lenmiş metadata.

**Plan:** Her tool policy step'i tool'a score atar. Varsayılan scorlar:

| Action Tipi | Örnek Toollar | Score | Karar |
|-------------|--------------|-------|-------|
| Read-only query | search, list, check | 1.0 | AUTO |
| Reversible state update | calendar add, note create, bookmark | 0.8 | AUTO |
| Soft external action | notification, reminder set | 0.5 | CONFIRM |
| Hard external action | email send, message to third party | 0.2 | MANDATORY |
| Destructive action | delete, revoke, cancel | 0.1 | MANDATORY |
| Unknown | yeni/tanımsız tool | undefined | MANDATORY |

**Score'lar policy step'lerinde tanımlanır** (mevcut pipeline altyapısı bunu zaten destekliyor). Tool geliştiricisi kendi score'unu beyan eder; global policy override edebilir.

### 5.3 Enforcement Entegrasyonu

**Dokunulacak dosya:** `src/agents/tool-policy-enforce.ts`

**Mevcut enforcement sırası:** `requiresHuman` → rate-limit → allow

**Yeni enforcement sırası:**
1. `requiresHuman` set'inde mi? → Evet → `MANDATORY_APPROVAL` (mevcut davranış korunur)
2. `reversibilityScore` var mı?
   - `>= 0.7` → `AUTO_EXECUTE` (skip human prompt)
   - `>= 0.3` → `CONFIRM_BRIEF` (kısa onay UI)
   - `< 0.3` → `MANDATORY_APPROVAL`
   - `undefined` → `MANDATORY_APPROVAL`
3. Rate limit check (mevcut)

**`requiresHuman` override:** `requiresHuman` listesindeki tool'lar `reversibilityScore`'dan bağımsız olarak her zaman `MANDATORY_APPROVAL`. Bu, fail-closed semantiği korur.

### 5.4 Third-Party Communication Koruması

**Değişmeyen kural:** Third-party contact / external send / delete path'leri her zaman `requiresHuman` listesinde kalır. `reversibilityScore` bunları bypass edemez.

**Mevcut enforcement (`tool-policy-enforce.ts:82-89`)** bunu zaten sağlıyor: `requiresHuman` check `reversibilityScore`'dan ÖNCE çalışır.

### 5.5 Auto-Execute Sonrası Bildirim

**Yeni gereksinim:** `AUTO_EXECUTE` path'inde kullanıcıya ne yapıldığı bildirilmeli.

```
type ExecutionResult = {
  action: string;
  reversibilityScore: number;
  executionMode: "auto" | "confirmed" | "approved";
  undoAvailable: boolean;
  summary: string;  // "Takvime eklendi: Toplantı, Çar 14:00"
};
```

Bu sonuç UI/channel adaptörüne iletilir; adaptör uygun formatta kullanıcıya gösterir.

**Dokunulacak dosyalar:**
- `src/agents/tool-policy-enforce.ts` — score → karar mapping, `ExecutionMode` tipi
- `src/agents/tool-policy-pipeline.ts` — minimal (mevcut altyapı yeterli)
- UI/kanal adaptörü — bildirim rendering

---

## 6. Cognitive Load Plan

### 6.1 Ölçülecek Sinyaller

| Sinyal | Nasıl Ölçülür | Ağırlık |
|--------|--------------|---------|
| Mesaj uzunluğu | `message.length` (karakter) | Kısa (<30 char) → yüksek yoğunluk sinyali |
| Punctuation density | `punctuation_count / word_count` | Düşük → kısa/acil; yüksek → düşünülmüş |
| Urgency keywords | Regex: `acil\|urgent\|hemen\|asap\|şimdi\|bozuldu\|patladı\|crash` | Boolean flag |
| Typo/compression ratio | Küçük harf oranı, eksik Türkçe karakter, kısaltma kullanımı | Yüksek compression → acil mod |
| ALL CAPS ratio | `uppercase_chars / total_chars` | > 0.5 → şiddetli aciliyet |
| Soru sayısı | `?` count | Çoklu soru → detaylı cevap beklentisi |
| Komut yapısı | İmperatif fiil ile başlıyor mu? ("bak", "yap", "çalıştır") | Boolean flag |

### 6.2 Modlar

**Executive Mode:**
- Tetikleyici: kısa mesaj + aciliyet keyword + düşük punctuation + imperatif yapı
- Davranış: kısa, doğrudan, düşük sosyal yağ, tek cümle cevap tercihi
- Prompt modifier: `"User is in a hurry. Be extremely concise. Lead with the answer. No preamble."`

**Companion Mode:**
- Tetikleyici: uzun mesaj + soru işaretleri + düşünülmüş yapı + sohbet tonu
- Davranış: daha doğal, daha sıcak, açıklayıcı, context sağlayıcı
- Prompt modifier: `"User is in reflective mode. Explain reasoning. Be warm but not verbose."`

**Standard Mode (varsayılan):**
- Tetikleyici: hiçbir uç sinyal yok
- Davranış: normal cevap tonu
- Prompt modifier: yok (mevcut system prompt)

### 6.3 Scoring Fonksiyonu

```
type CognitiveLoadSignal = {
  messageLength: number;
  punctuationDensity: number;
  hasUrgencyKeyword: boolean;
  typoCompressionRatio: number;
  allCapsRatio: number;
  questionCount: number;
  isImperative: boolean;
};

type CognitiveMode = "executive" | "companion" | "standard";

function detectCognitiveMode(signal: CognitiveLoadSignal): CognitiveMode;
```

**Heuristic (LLM bağımlılığı yok, deterministic):**

```
Executive skoru = w1 * (length < 30) + w2 * hasUrgency + w3 * (compressionRatio > 0.4) + w4 * isImperative + w5 * (capsRatio > 0.3)

Companion skoru = w6 * (length > 200) + w7 * (questionCount >= 2) + w8 * (punctuationDensity > 0.3)

En yüksek skor → mod
Eşitse → standard
```

Ağırlıklar başlangıçta sabit; A/B test ile ayarlanabilir.

### 6.4 Prompt'a Taşıma

**Mevcut system prompt inşası:** `src/agents/system-prompt.ts` → `buildAgentSystemPrompt()`

**Değişiklik:**

1. `detectCognitiveMode(lastUserMessage)` inbound reply path'te çağrılır
2. Sonuç `CognitiveMode` olarak system prompt builder'a geçirilir
3. Builder, mode'a göre ek prompt section ekler veya mevcut section'ları kısaltır

```
// system-prompt.ts (yeni parametre)
buildAgentSystemPrompt({
  ...mevcutParametreler,
  cognitiveMode?: CognitiveMode,  // ← yeni
})
```

**Executive Mode'da prompt değişikliği:**
- Mevcut verbose sections (skills, detailed instructions) kısaltılır
- Brevity directive eklenir
- Tone modifier injection

**Companion Mode'da prompt değişikliği:**
- Açıklama ve context teşviki eklenir
- Warmth modifier injection

### 6.5 Entegrasyon Noktası

**İnbound reply path:** Kullanıcı mesajı geldiğinde, cevap üretilmeden ÖNCE:

```
userMessage → detectCognitiveMode() → cognitiveMode
cognitiveMode → buildAgentSystemPrompt({ cognitiveMode }) → system prompt
system prompt + userMessage → LLM → response
```

### 6.6 Örnek: "kod patladı loglara bak acil"

1. `messageLength`: 31 → kısa
2. `hasUrgencyKeyword`: true ("acil")
3. `isImperative`: true ("bak")
4. `typoCompressionRatio`: 0.6 (küçük harf, Türkçe karakter eksik, kısaltılmış)
5. `allCapsRatio`: 0.0

Executive skoru: yüksek → **Executive Mode**

Beklenen cevap:
```
Loglar kontrol edildi. NullPointerException src/main.ts:142. Son deploy 14:32'de.
```

(Uzun açıklama yok, giriş cümlesi yok, doğrudan bulgu.)

**Dokunulacak dosyalar:**
- `src/consciousness/cognitive-load.ts` (yeni) — sinyal çıkarma + mod algılama
- `src/consciousness/cognitive-load.test.ts` (yeni) — heuristic test suite
- `src/agents/system-prompt.ts` — `cognitiveMode` parametresi + prompt modifier injection
- İnbound reply handler (tanımlanacak) — `detectCognitiveMode()` çağrısı

---

## 7. Test Strategy

### 7.1 Test Katmanları (Feature Bazında)

| Feature | Unit | Integration | Smoke | Live/Manual |
|---------|------|-------------|-------|-------------|
| Production Wiring | boot.ts mock dispatch | scheduler + real brain + mock gateway | Feature-flag on/off boot | Gerçek gateway ile proaktif mesaj |
| Temporal Resolver | parse("geçen hafta") → range | resolver + hippocampus time filter | recall("geçen Salı spor") → temporal hit | Gerçek not havuzuyla zaman sorguları |
| Act-First Engine | score → decision mapping | enforcement + policy pipeline + score | Auto-execute + notification | Gerçek tool execution |
| Cognitive Load | signal extraction + mode scoring | mode → prompt modifier → LLM call | Kısa acil mesaj → kısa cevap | Kullanıcı UX testi |

### 7.2 Acceptance Test Senaryoları

**AT-1: "3 gün sessizlik + yaklaşan teslim"**
- Setup: `lastUserInteractionAt` = now - 3 gün, `dueCronExpressions` veya `firedTriggerIds` = deadline trigger
- Beklenen: Watchdog uyanır, tick çalışır, `SEND_MESSAGE` kararı verilir, dispatch'e mesaj gider
- Doğrulama: dispatch callback çağrıldı, mesaj içeriği deadline referansı taşıyor
- Katman: integration test (scheduler + mock dispatch)

**AT-2: "Takvime ekle + dış mail onay iste"**
- Setup: Kullanıcı "toplantıyı takvime ekle" diyor → tool `calendar.add` (score 0.8)
- Beklenen: Auto-execute, kullanıcıya "Takvime eklendi" bildirimi
- Setup 2: Kullanıcı "müşteriye mail at" → tool `email.send` (score 0.2, requiresHuman)
- Beklenen: `MANDATORY_APPROVAL`, açık onay beklenir
- Katman: integration test (enforcement pipeline + mock tools)

**AT-3: "Geçen Salı spor podcasti"**
- Setup: Not havuzunda farklı günlere ait 20+ not, Salı günü "spor podcasti hakkında konuştuk" notu var
- Kullanıcı: "Geçen Salı spor podcasti hakkında ne konuşmuştuk?"
- Beklenen: TemporalResolver → Salı aralığı; recall bu aralıkta "spor podcasti" notunu döner; 6 ay önceki alakasız not dönmez
- Katman: integration test (resolver + hippocampus + recall pipeline)

**AT-4: "Acil kısa mesaj → executive mode"**
- Setup: Kullanıcı "loglara bak acil hata var" yazıyor
- Beklenen: `detectCognitiveMode()` → "executive"; cevap 1-2 cümle, doğrudan, açıklama yok
- Setup 2: Aynı kullanıcı "bu hata hakkında biraz düşünelim, neden oluyor olabilir sence?" yazıyor
- Beklenen: `detectCognitiveMode()` → "companion"; cevap açıklayıcı, bağlam sağlayıcı
- Katman: unit test (signal extraction) + integration test (prompt modifier → LLM response style)

---

## 8. Patch Breakdown / WBS

### Sub-Task 9.1 — Production Wiring: buildSnapshot + Boot

**Amaç:** `startConsciousnessLoop()` gerçek veriyle production'da başlatılabilir hale gelsin.

**Dokunulacak dosyalar:**
- `src/consciousness/snapshot.ts` (yeni) — `buildRealWorldSnapshot()`
- `src/consciousness/brain/cortex.ts` — `recentCount()` getter
- App bootstrap dosyası — `startConsciousnessLoop()` çağrısı + feature flag
- `src/consciousness/snapshot.test.ts` (yeni)

**Kabul kriterleri:**
- [ ] `buildRealWorldSnapshot()` en az `capturedAt`, `lastUserInteractionAt`, `pendingNoteCount`, `activeChannelId` gerçek kaynaktan doldurur
- [ ] Feature flag `CONSCIOUSNESS_ENABLED=1` ile koşullu boot
- [ ] Graceful shutdown: SIGTERM → `scheduler.stop()`
- [ ] Unit test: snapshot builder gerçek veri döner
- [ ] Mevcut testler kırılmaz

**Blocker/risk:** App bootstrap noktasının belirlenmesi gerekiyor (CLI vs server vs her ikisi)

### Sub-Task 9.2 — Production Wiring: Dispatch + Safety

**Amaç:** Consciousness kararları gerçek kanala güvenli şekilde iletilsin.

**Dokunulacak dosyalar:**
- `src/consciousness/integration.ts` — rate limit + content cap
- `src/consciousness/types.ts` — config genişletme
- `src/consciousness/audit.ts` (yeni) — dispatch audit log
- `src/consciousness/integration.test.ts` — yeni test'ler

**Kabul kriterleri:**
- [ ] Proaktif mesaj rate limit: max 1 / configurable interval
- [ ] Content length cap: configurable max
- [ ] Dispatch audit log: her gönderim `{ timestamp, channelId, contentPreview, decision }` olarak kaydedilir
- [ ] Silent drop `activeChannelId=undefined` durumunda korunur
- [ ] Integration test: rate limit enforced, audit written

**Blocker/risk:** Gateway adaptör API'sinin net olması gerekiyor

### Sub-Task 9.3 — Temporal Resolver

**Amaç:** Doğal dil zaman ifadeleri → UTC zaman aralığı çözümlemesi.

**Dokunulacak dosyalar:**
- `src/consciousness/brain/temporal-resolver.ts` (yeni)
- `src/consciousness/brain/temporal-resolver.test.ts` (yeni)

**Kabul kriterleri:**
- [ ] Türkçe + İngilizce zaman ifadeleri parse edilir: "geçen hafta", "dün", "last Tuesday", "3 gün önce"
- [ ] `TemporalRange { start, end, confidence, rawExpression }` döner
- [ ] Tanınamayan ifadeler → `null` (graceful fallback)
- [ ] 30+ test case: göreceli gün, hafta, gün adı, saat dilimi, mutlak tarih, tanınamayan
- [ ] LLM bağımlılığı yok (pure regex + rule-based)

**Blocker/risk:** Türkçe zaman ifadelerinin çeşitliliği; edge case kapsamı ilk iterasyonda %80 hedef

### Sub-Task 9.4 — Temporal Memory Filter

**Amaç:** Recall pipeline zaman aralığına göre daraltma yapabilsin.

**Dokunulacak dosyalar:**
- `src/consciousness/brain/hippocampus.ts` — SQL WHERE eklentisi
- `src/consciousness/brain/cortex.ts` — filter overload
- `src/consciousness/brain/recall.ts` — temporal integration
- `src/consciousness/brain/types.ts` — `MemoryRecallQuery` genişletme
- Mevcut recall test dosyaları — yeni temporal test case'ler

**Kabul kriterleri:**
- [ ] `Hippocampus.recall()` `startTime` / `endTime` parametresi kabul eder
- [ ] `Cortex.recent()` opsiyonel zaman filtresi uygular
- [ ] `MemoryRecallQuery.temporalRange` alanı eklenir
- [ ] Recall pipeline: query.text → resolver → filter → search
- [ ] Temporal filter boş sonuç → fallback pure semantic + log
- [ ] AT-3 senaryosu geçer: "geçen Salı spor podcasti" doğru notu döner

**Blocker/risk:** Sub-Task 9.3'e bağımlı (temporal resolver hazır olmalı)

### Sub-Task 9.5 — Act-First Decision Layer

**Amaç:** `reversibilityScore` → execution mode karar ağacı aktif olsun.

**Dokunulacak dosyalar:**
- `src/agents/tool-policy-enforce.ts` — score → decision mapping
- `src/agents/tool-policy-pipeline.ts` — varsayılan score tanımları (minimal)
- `src/agents/tool-policy-enforce.test.ts` — yeni decision test'ler

**Kabul kriterleri:**
- [ ] `reversibilityScore >= 0.7` → `AUTO_EXECUTE`
- [ ] `0.3 <= score < 0.7` → `CONFIRM_BRIEF`
- [ ] `score < 0.3` → `MANDATORY_APPROVAL`
- [ ] `undefined` → `MANDATORY_APPROVAL` (fail-closed)
- [ ] `requiresHuman` override: listede olan tool score'dan bağımsız `MANDATORY_APPROVAL`
- [ ] AT-2 senaryosu geçer: takvim auto, mail approval
- [ ] Mevcut `requiresHuman` enforcement kırılmaz

**Blocker/risk:** Mevcut tool ekosisteminde kaç tool'a score atanması gerektiği; ilk iterasyonda sadece bilinen tool'lara default score

### Sub-Task 9.6 — Act-First Notification + Undo

**Amaç:** Auto-execute sonrası kullanıcıya bildirim ve geri alma yolu.

**Dokunulacak dosyalar:**
- `src/agents/tool-policy-enforce.ts` — `ExecutionResult` tipi
- UI/kanal adaptörü — bildirim rendering
- Undo handler (yeni, basit)

**Kabul kriterleri:**
- [ ] Auto-execute sonrası `ExecutionResult { summary, undoAvailable }` döner
- [ ] Kullanıcıya bildirim: "Takvime eklendi: [detay]"
- [ ] Undo mekanizması en az "son auto-execute'u geri al" seviyesinde
- [ ] Bildirim kanalı `activeChannelId` üzerinden

**Blocker/risk:** Sub-Task 9.5'e bağımlı; undo mekanizmasının kapsamı sınırlı tutulmalı (ilk iterasyonda sadece son action)

### Sub-Task 9.7 — Cognitive Load Detection

**Amaç:** Kullanıcı mesajından cognitive mode algıla.

**Dokunulacak dosyalar:**
- `src/consciousness/cognitive-load.ts` (yeni)
- `src/consciousness/cognitive-load.test.ts` (yeni)

**Kabul kriterleri:**
- [ ] 7 sinyal çıkarılır (uzunluk, punctuation, urgency, typo, caps, soru, imperatif)
- [ ] 3 mod: executive / companion / standard
- [ ] Heuristic scoring: LLM bağımlılığı yok
- [ ] AT-4 senaryosu geçer: "acil hata" → executive, "düşünelim" → companion
- [ ] 20+ unit test: çeşitli mesaj tipleri

**Blocker/risk:** Heuristic ağırlıkları ilk tahminde; kullanıcı feedback'iyle iterasyon gerekecek

### Sub-Task 9.8 — Mode-Aware Reply Shaping

**Amaç:** Algılanan mod → system prompt değişikliği → cevap tonu adaptasyonu.

**Dokunulacak dosyalar:**
- `src/agents/system-prompt.ts` — `cognitiveMode` parametresi + modifier injection
- İnbound reply handler — `detectCognitiveMode()` entegrasyonu

**Kabul kriterleri:**
- [ ] `buildAgentSystemPrompt({ cognitiveMode })` kabul eder
- [ ] Executive mode: brevity directive, verbose section kısaltması
- [ ] Companion mode: warmth + explanation teşviki
- [ ] Standard mode: mevcut davranış korunur (no modifier)
- [ ] Integration test: executive prompt daha kısa, companion prompt daha açıklayıcı

**Blocker/risk:** Sub-Task 9.7'ye bağımlı; prompt modifier'ların LLM davranışını ne kadar etkileyeceği deneysel

### Sub-Task 9.9 — Observability / Audit Trail

**Amaç:** Proaktif aksiyonlar, dispatch'ler ve mod geçişleri izlenebilir olsun.

**Dokunulacak dosyalar:**
- `src/consciousness/audit.ts` (yeni) — structured audit log
- `src/consciousness/scheduler.ts` — tick sonuçlarını audit'e yaz
- `src/consciousness/integration.ts` — dispatch sonuçlarını audit'e yaz

**Kabul kriterleri:**
- [ ] Her consciousness tick → audit entry: `{ timestamp, wake, decision, phase, llmCallCount }`
- [ ] Her dispatch → audit entry: `{ timestamp, channelId, contentLength, success }`
- [ ] Her cognitive mode geçişi → audit entry: `{ timestamp, mode, signals }`
- [ ] Audit log'lar dosya veya DB'ye yazılır (konfigüre edilebilir)
- [ ] "Sistem ne yaptı?" sorusuna cevap verebilecek yapı

**Blocker/risk:** Log volume; retention policy tanımlanmalı

---

## 9. Safe Rollout Plan

### Merge Sırası

```
9.1 Production Wiring: Snapshot + Boot
  ↓
9.2 Production Wiring: Dispatch + Safety    (9.1'e bağlı)
  ↓
9.3 Temporal Resolver                        (bağımsız, paralel olabilir)
  ↓
9.4 Temporal Memory Filter                   (9.3'e bağlı)
  ↓
9.5 Act-First Decision Layer                 (bağımsız, paralel olabilir)
  ↓
9.6 Act-First Notification + Undo           (9.5'e bağlı)
  ↓
9.7 Cognitive Load Detection                 (bağımsız, paralel olabilir)
  ↓
9.8 Mode-Aware Reply Shaping                (9.7'ye bağlı)
  ↓
9.9 Observability / Audit Trail             (tüm feature'larla birlikte veya sonra)
```

### Feature Flag Gereksinimleri

| Sub-Task | Feature Flag Gerekli Mi? | Neden |
|----------|-------------------------|-------|
| 9.1-9.2 | **EVET** — `CONSCIOUSNESS_ENABLED` | Production'da consciousness loop'u koşullu başlatma; yanlış davranış riski yüksek |
| 9.3-9.4 | Hayır | Recall pipeline backward-compatible; temporal filter opsiyonel parametre |
| 9.5-9.6 | **EVET** — `ACT_FIRST_ENABLED` | Auto-execute davranışı mevcut UX'i değiştirir; gradual rollout şart |
| 9.7-9.8 | **EVET** — `COGNITIVE_MODE_ENABLED` | Prompt değişikliği tüm cevapları etkiler; A/B test gerekebilir |
| 9.9 | Hayır | Audit trail pasif gözlem; davranış değiştirmez |

### Mevcut Davranışı Bozma Riski

| Sub-Task | Risk Seviyesi | Etki | Koruma |
|----------|--------------|------|--------|
| 9.1-9.2 | **Yüksek** | Sistem proaktif mesaj göndermeye başlar | Feature flag + rate limit + content cap |
| 9.3-9.4 | **Düşük** | Recall sonuçları değişir (daha alakalı olmalı) | Temporal filter opsiyonel; null → mevcut davranış |
| 9.5 | **Orta** | Bazı tool'lar onaysız çalışır | `requiresHuman` override korunur; fail-closed default |
| 9.6 | **Düşük** | Yeni bildirim kanalı | Mevcut akışa ek, değiştirme yok |
| 9.7-9.8 | **Orta** | Cevap tonu değişir | Feature flag; standard mode = mevcut davranış |
| 9.9 | **Yok** | Sadece log ekler | Pasif gözlem |

### Önerilen Test-First Sıralama

1. **Önce test-only:** 9.3 (temporal resolver) + 9.7 (cognitive load) — bağımsız modüller, mevcut sisteme dokunmaz
2. **Sonra entegrasyon:** 9.4 (memory filter) + 9.8 (reply shaping) — mevcut pipeline'a ekleme
3. **Sonra production wiring:** 9.1 + 9.2 — en riskli, en son merge (feature flag ile)
4. **Sonra act-first:** 9.5 + 9.6 — UX değişikliği, kullanıcı feedback'i şart
5. **Her zaman:** 9.9 — audit trail her aşamada eklenebilir

---

## 10. Brutal Truth Section

### Bugün Aslında Hiç Olmayan Şeyler

| Eksik | Durum | Somut Gerçek |
|-------|-------|-------------|
| Production consciousness boot | **Sıfır** | `startConsciousnessLoop()` hiçbir yerde çağrılmıyor. Consciousness loop test dosyalarında yaşıyor. |
| Real-world snapshot builder | **Sıfır** | `buildWorldSnapshotFromRedis()` sadece bir JSDoc yorumunda geçiyor; implementasyon yok. |
| Temporal time-range query | **Sıfır** | Hippocampus SQL'inde `createdAt` WHERE koşulu yok. Recall API'sinde `startTime`/`endTime` parametresi yok. |
| Doğal dil zaman parser | **Sıfır** | "Geçen hafta" yazdığında sistem bunu string olarak embed ediyor; zaman aralığı çıkarmıyor. |
| reversibilityScore → karar | **Sıfır** | Score taşınıyor ama `evaluateToolEnforcement()` fonksiyonunda hiç okunmuyor. Dead metadata. |
| Cognitive load algılama | **Sıfır** | Mesaj uzunluğu, aciliyet, typo oranı gibi sinyaller hiçbir yerde ölçülmüyor. |
| Mode-aware prompt shaping | **Sıfır** | System prompt statik; runtime'da kullanıcı mesajına göre değişmiyor. |
| Proaktif dispatch audit | **Sıfır** | Consciousness kararları loglanmıyor; "sistem ne yaptı?" sorusuna cevap verilemez. |

### Landing Copy'de Overclaim Riski Taşıyan Alanlar

| Landing Copy | Risk | Gerçek |
|-------------|------|--------|
| "a continuous runtime that remembers, waits, wakes, and acts with guardrails" | **Orta** | Tüm bu davranışlar test'te doğrulanmış ama production'da aktif değil. Runtime gerçekten "continuous" çalışmıyor. |
| "Consciousness Loop — Continuous tick-based thinking" | **Düşük-Orta** | Mimari doğru, test'te çalışıyor, ama "continuous" kelimesi production'da 7/24 çalıştığını ima ediyor |
| "Living Brain — Continuous memory and note-taking across sessions" | **Düşük** | Brain gerçekten var ve çalışıyor; ama "across sessions" production wiring olmadan gerçekleşmiyor |
| Section 4 guardrail proof badge'leri | **Düşük** | Test dosyalarında doğrulanmış — test reference'ları doğru. Ama production'da henüz aktif olmadığı belirtilmiyor. |

### Tamamlama Bitmeden Yapılmaması Gereken Claim'ler

1. **"Open Assistant proaktif olarak sizi uyarır"** — 9.1 + 9.2 tamamlanmadan bu claim yapılamaz
2. **"Zaman anlayışı olan bellek"** — 9.3 + 9.4 tamamlanmadan bu claim yapılamaz
3. **"Düşük riskli işleri otomatik yapar"** — 9.5 tamamlanmadan bu claim yapılamaz
4. **"Sizin hızınıza adapte olur"** — 9.7 + 9.8 tamamlanmadan bu claim yapılamaz
5. **"Production-ready continuous runtime"** — 9.1 + 9.2 + 9.9 tamamlanmadan bu claim yapılamaz

---

## Bağımlılık Grafiği (Özet)

```
[9.3 Temporal Resolver] ──→ [9.4 Temporal Memory Filter]
           (bağımsız)

[9.1 Snapshot+Boot] ──→ [9.2 Dispatch+Safety] ──→ [production consciousness aktif]
           (en riskli)

[9.5 Act-First] ──→ [9.6 Notification+Undo]
    (bağımsız)

[9.7 Cognitive Load] ──→ [9.8 Reply Shaping]
      (bağımsız)

[9.9 Observability] ←── tüm feature'larla paralel veya sonra
```

**Paralel yapılabilecek gruplar:**
- Grup A: 9.3 + 9.4 (temporal intelligence)
- Grup B: 9.5 + 9.6 (act-first)
- Grup C: 9.7 + 9.8 (cognitive load)
- Grup D: 9.1 + 9.2 (production wiring)
- Grup E: 9.9 (observability)

Grup A, B, C birbirinden bağımsız. Grup D en riskli, en son merge. Grup E her zaman eklenebilir.
