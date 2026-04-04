# P0 Incident Remediation: Founder MVP Gateway Wiring (Revize)

---

## 1. Updated Incident Summary

Canlı WhatsApp smoke'ta 5 semptom gözlemlendi:
1. Gateway journal'da `[consciousness]` log yok
2. `MEMORY.md` / `memory/*.md` ENOENT spam
3. `tools.profile (coding)` — `apply_patch`, `image`, `image_generate` unknown entries warning
4. PDF: `standardFontDataUrl` hatası
5. Temporal recall başarısız — exact timestamp yok

**Kritik düzeltme (WS-0 araştırması sonucu):**

İlk planda "consciousness hiç boot etmiyor" iddiası fazla güçlüydü.

Gerçek entrypoint:
- `openclaw` binary → `src/entry.ts` → `src/cli/run-main.ts:runCli()`
- `run-main.ts:163-166`: `maybeStartConsciousnessLoop()` çağırılıyor — `program.parseAsync()` öncesi
- `openclaw gateway run`: run-main.ts üzerinden geçiyor (subcommand lazy-load)
- Ayrı gateway binary yok

**Bu demektir:** `CONSCIOUSNESS_ENABLED=1` ise consciousness `openclaw gateway run`'da da boot ediyor. Sorun boot yokluğu değil — olası sorunlar:
- `CONSCIOUSNESS_ENABLED` service/env'de ayarlanmamış
- Boot oluyor ama görünürlük yok (sadece audit JSONL, journal yok)
- Boot exception fırlatıyor ama sessizce fail-soft oluyor
- env doğru ama runtime state başka yerde kayboluyor

WS-0 bu gerçeği canlı sistemde kanıtlayacak.

---

## 2. WS-0: Entrypoint + Env Truth Table

**Bu bir verification workstream'i — kod yazılmaz.**

WSL clone'da (`~/src/open_assistant-wsl`) yapılacaklar:

### A. Process + Env kontrolü
Gateway çalışıyorken:
```bash
# PID bul
pgrep -a node | grep openclaw

# Environment variables
cat /proc/<PID>/environ | tr '\0' '\n' | grep -i CONSCIOUSNESS

# Gerçek entrypoint (symlink vs. direkt)
ls -la $(which openclaw)
```

Beklenen çıktı: `CONSCIOUSNESS_ENABLED` var mı, değeri ne?

### B. Systemd service kontrolü (eğer service olarak çalışıyorsa)
```bash
systemctl --user status openclaw-gateway.service 2>/dev/null || echo "no user service"
systemctl status openclaw-gateway.service 2>/dev/null || echo "no system service"

# Environment file / EnvironmentFile direktifi var mı?
systemctl --user show openclaw-gateway.service | grep -i env
```

### C. Journal + audit log kontrolü
```bash
# Journal'da consciousness var mı?
journalctl --user -u openclaw-gateway.service | grep -i consciousness

# Audit log mevcut mu?
ls -la ~/.openclaw/data/consciousness-audit.jsonl 2>/dev/null
ls -la ~/src/open_assistant-wsl/data/consciousness-audit.jsonl 2>/dev/null

# Son audit entries
tail -5 ~/.openclaw/data/consciousness-audit.jsonl 2>/dev/null
```

### D. Boot exception testi
```bash
# CONSCIOUSNESS_ENABLED=1 ile foreground başlat, exception var mı bak?
CONSCIOUSNESS_ENABLED=1 CONSCIOUSNESS_AUDIT_LOG_PATH=/tmp/oc-audit.jsonl openclaw gateway run 2>&1 | head -50
```

### E. Sonuç kararı
WS-0 araştırması şu 3 state'den birini kanıtlamalı:

| State | Kanıt | Aksiyon |
|-------|-------|---------|
| **A: Boot hiç olmuyor** | `CONSCIOUSNESS_ENABLED` service env'de yok | Service env'e ekle; WS-A observability ekle |
| **B: Boot oluyor ama görünmüyor** | Audit JSONL'de tick kayıtları var, journal'da yok | WS-A observability ekle |
| **C: Boot exception** | Foreground başlatmada exception | Exception kaynağını bul ve düzelt |

WS-0 kanıtı olmadan WS-A koduna geçilmeyecek.

---

## 3. Revised Root Cause Matrix

| Semptom | Muhtemel Kök Neden | Kod kanıtı | Log kanıtı | Fix Surface |
|---------|-------------------|------------|------------|-------------|
| Journal'da consciousness yok | Boot yok (env eksik) VEYA boot var ama sadece audit JSONL | `run-main.ts:163-166` çağırıyor; `audit.ts:79-106` dosyaya yazıyor | `CONSCIOUSNESS_ENABLED` service env'de kontrol et | WS-0→WS-A |
| ENOENT spam | `memory_search` legacy file-scan; QMD backend veya `readAgentMemoryFile` ENOENT | `memory-tool.ts:115,172` hardcoded paths; `backend-config.ts:72` default="builtin" | Log'da tam path var: `/workspace/memory/2025-02-13.md` | WS-B |
| Temporal recall başarısız | `getConsciousnessRuntime()` null döndürüyor (env yok veya boot fail) | `reactive-recall.ts:40` runtime check | Recall section undefined → hippocampus recall yok | WS-0→WS-A |
| Tool "unknown entries" warning | `apply_patch` OpenAI-only; `image_generate` provider-gated; coding profile bunları listeler | `pi-tools.ts:375-382` applyPatchEnabled koşulları; `tool-catalog.ts:237` image_generate | Warning log'unda görülüyor | WS-C1 |
| Tool parity kırık | WhatsApp agent coding profile değil; `exec`/`write`/`edit` sandbox'ta kaldırılıyor | `pi-tools.ts:416-428` sandbox gating; `tool-catalog.ts` profile mapping | "Sen çalıştır" cevapları | WS-C2 |
| PDF standardFontDataUrl | `getDocument()` font path'siz çağrılıyor; canvas render fallback patlar | `pdf-extract.ts:52` sadece `data+disableWorker` | Exception: `standardFontDataUrl API parameter` | WS-D |

---

## 4. Revised Workstreams

---

### WS-0: Entrypoint + Env Verification (See Section 2)
**Kod yok. Sadece WSL'de verification.**

---

### WS-A: Consciousness Observability

**Ön koşul:** WS-0'ın sonucu State A, B veya C'yi belirlemiş olmalı.

#### WS-A Senaryo-A: `CONSCIOUSNESS_ENABLED` service env'de eksik
**Fix**: Service env konfigürasyonu (deployment concern, repo kodu değil).
Ama ek olarak `.env.example` / deployment docs güncellenir.

#### WS-A Senaryo-B: Boot oluyor ama sadece audit JSONL, journal yok
**Fix**: `boot-lifecycle.ts`'e subsystem logger ekle.

**Dosya:** `src/consciousness/boot-lifecycle.ts`
**Değişiklikler:**
```typescript
// Import ekle
import { createSubsystemLogger } from "../logging/subsystem.js";

// Module scope'da logger
const log = createSubsystemLogger("consciousness");
```

Ekleme noktaları:
- `maybeStartConsciousnessLoop()` entry: `log.info("boot start", { sessionKey })`
- `setConsciousnessRuntime()` sonrası (line 218): `log.info("boot ready", { sessionKey, brain: "wired", scheduler: "started" })`
- `stop()` başında: `log.info("stopping")`
- `onTickCallback`'de — **seviye ayrımı:**
  - `wake=false` (idle tick): `log.debug("tick", { wake: false })` — debug, çünkü her 60s+ tekrar eder
  - `wake=true`: `log.info("wake", { reason: result.watchdogResult.reason })` — info, operatör görmeli
- Proactive dispatch sonrası: `log.info("dispatch", { channelId, success })` — info
- catch block'ta (line 219-221): `log.error("boot failed", { error: String(error) })`

**Beklenen davranış değişimi:** Gateway journal'da (normal info seviyesi):
- `[consciousness] boot start`
- `[consciousness] boot ready {sessionKey: "..."}`
- `[consciousness] wake {reason: "SILENCE_THRESHOLD"}` — her wake event'te
- `[consciousness] dispatch {channelId: "...", success: true}` — her proactive dispatch'te
- `[consciousness] stopping`
- Debug modunda ek olarak: `[consciousness] tick {wake: false}` — idle tick'ler

#### WS-A Senaryo-C: Boot exception
Exception kaynağına göre surgical fix. Genelleme yapılmaz.

**Test:**
- Mevcut `boot-lifecycle.test.ts` suite — 0 regression
- Yeni test: boot failure loglanıyor mu (mock logger)
- Live: gateway journal'da `[consciousness]` grep

---

### WS-B: Founder Default Recall Routing

**Problem 3 katman:**

#### B.1: ENOENT exact emitter attribution + fix

**Canlı log prefix:** `[tools] read failed: ENOENT: ... /workspace/memory/2025-02-13.md`

Bu log'un exact emitter'ı henüz kanıtlanmamış. 3 muhtemel kaynak var:

| # | Muhtemel emitter | Mekanizma | Nasıl kanıtlanır |
|---|-----------------|-----------|-----------------|
| 1 | Generic `read` tool | Agent, prompt yönlendirmesi sonucu `read(memory/2025-02-13.md)` çağırıyor | `[tools]` prefix + canlı log'da tool call trace (request id) |
| 2 | `memory_search` backend | Builtin backend file scan sırasında ENOENT | `memory-tool.ts` → `internal.ts` → fs.readFile hatası |
| 3 | QMD backend indexer | QMD'nin index'lediği ama silinmiş dosyayı sync etmeye çalışması | `qmd-manager.ts` veya `qmd-sync.ts` log'u |

**B.1 ilk adım: attribution (kod yazmadan)**

WSL'de canlı gateway'de veya test run'da:
```bash
# Canlı log'da ENOENT satırlarının tam prefix + context'ini yakala
journalctl --user -u openclaw-gateway.service | grep -i "ENOENT.*memory" | head -5

# İpucu: "[tools] read failed" ise generic read tool — agent prompt-driven dosya okuyor
# "[memory]" veya "[search]" ise backend tarafı
# stack trace varsa exact call site görünür
```

Repoda exact emitter'ı bul:
```bash
# [tools] prefix'ini kim üretiyor?
grep -rn "read failed" src/agents/tools/ src/memory/ --include="*.ts"

# ENOENT error handling
grep -rn "ENOENT" src/agents/tools/ src/memory/ --include="*.ts"
```

Attribution sonucuna göre fix:

**Eğer emitter generic `read` tool ise:**
- Sorun prompt guidance — `memory-core/index.ts` agent'a "MEMORY.md + memory/*.md oku" diyor
- Agent bu dosyaları explicit `read` tool'u ile deniyor
- Fix: WS-B.2 prompt guidance düzeltmesi ile çözülür

**Eğer emitter `memory_search` backend ise:**
- `src/agents/tools/memory-tool.ts` veya `src/memory/internal.ts`'deki file scan
- Fix: ENOENT'i catch et, debug'a düşür veya graceful empty dön
- Exact dosya: `grep -rn "read failed" src/memory/internal.ts src/agents/tools/memory-tool.ts`

**Eğer emitter QMD backend ise:**
- `src/memory/qmd-manager.ts` indexer'ı silinmiş dosyayı sync ediyor
- Fix: file existence check before read, veya ENOENT → skip

**Fix yüzeyi yalnızca attribution sonrası belirlenir.** Tahminle kod yazılmaz.

#### B.2: Legacy memory prompt guidance → consciousness-aware (boundary-safe)

**Constraint:** `extensions/memory-core/index.ts` içine `src/consciousness/runtime.ts` import **edilmeyecek**.

**`MemoryPromptSectionBuilder` tipi** (plugin-sdk'da):
```typescript
type MemoryPromptSectionBuilder = (params: {
  availableTools: Set<string>;
  citationsMode?: MemoryCitationsMode;
}) => string[];
```
Şu an consciousness context almıyor.

**Boundary-safe seçenekler (tercih sırasıyla):**

**Seçenek 1 — Plugin-SDK tip genişletme (tercih edilen):**
- Plugin SDK type'a `hasLiveContextInjection?: boolean` ekle
- Framework, reactive-recall seam'inden bu flag'ı belirler ve builder'a geçer
- Extension sadece flag'a tepki verir; core'a bağımlı değil

**Seçenek 2 — Config flag:**
- `CONSCIOUSNESS_ENABLED` env var'ı `MemoryPromptSectionBuilder` params'a geç
- Extension sadece env flag okur; platform agnostik

**Seçenek 3 — Mevcut availableTools seam'i:**
- Consciousness aktifken synthetic bir `"consciousness_context"` tool ID'si `availableTools`'a inject et
- Extension bunu `availableTools.has("consciousness_context")` ile kontrol eder
- Zero core import, sıfır type change

**Hangi seçenek seçilirse seçilsin:** Extension behavior şöyle değişir:
- Consciousness aktif: "Birincil recall bağlamın otomatik olarak eklendi. `memory_search` ve `memory_get`'i yalnızca açık file lookup için kullan."
- Consciousness pasif: mevcut legacy guidance aynen kalır

#### B.3: Reactive recall injection (WS-A bağımlı)

`get-reply-run.ts:296-306`'daki `buildReactiveRecallSection()` çağrısı:
- WS-A ile consciousness boot edilince `getConsciousnessRuntime()` null dönmeyecek
- Bu otomatik olarak hippocampus recall'ı prompta enjekte edecek
- **Ekstra kod gereksiz** — bu WS-A'nın yan etkisi

**Test:**
- Memory-tool ENOENT log yok: integration test ile workspace'siz `memory_search` çağrısı → no error log
- Memory prompt doğru: consciousness aktifken prompt guidance değişiyor
- Reactive recall section populated: `get-reply-run.ts` test'te `buildReactiveRecallSection` non-null döndürüyor

---

### WS-C1: Tool Policy Observability Cleanup

**Dosya:** `src/agents/tool-policy-pipeline.ts:289-299`

**Şu an:** Her unknown entry (gated core tools dahil) için `params.warn()` çağrılıyor.

**Fix:** `gatedCoreEntries` only case'de `warn → skip` (ya da debug):
```typescript
// Sadece gerçekten unknown entries varsa uyar
if (otherEntries.length > 0) {
  params.warn(`tools: ${step.label} allowlist contains unknown entries (${entries}). ${suffix}`);
}
// Known gated tools (apply_patch, image_generate vb.) için sessiz kal — gating kasıtlı
```

**Beklenen değişim:** `apply_patch`/`image_generate` için no warning on non-OpenAI providers.
**Risk:** SIFIR — sadece log level değişiyor. Tool availability etkilenmiyor.

**Test:**
- Unit: coding profile + non-OpenAI → warn() çağrılmıyor
- Unit: gerçekten unknown tool ID → warn() hala çağrılıyor

---

### WS-C2: Tool/Runtime Capability Parity

**Problem:**
- `exec`, `process` — policy'ye göre mevcut (genellikle var)
- `write`, `edit` — sandbox modunda kaldırılıyor (`pi-tools.ts:416-428`)
- `apply_patch` — OpenAI provider + explicit config enable olmadan instantiate bile edilmiyor
- WhatsApp agent coding profile değil; hangi profile kullandığı net değil

**Araştırma gerekli (implement öncesi):**

1. WhatsApp reply path'de kullanılan tool profile nedir?
   - `src/auto-reply/reply/get-reply-run.ts` → tools pipeline call trace
   - `buildDefaultToolPolicyPipelineSteps()` hangi profille çağrılıyor?

2. Sandbox modu gateway'de aktif mi?
   - `sandboxRoot` ne zaman set ediliyor?
   - WhatsApp run'ında `write`/`edit` gerçekten kaldırılıyor mu?

3. `approval-required` mekanizması:
   - `tools-invoke-http.ts:338-372` — tool instantiated ama confirm mode ile gated
   - Bu mekanizma WhatsApp gateway için de geçerli mi?

**Sonraki adım:** Bu araştırma sonuçlarına göre:
- Eğer WhatsApp "messaging" profile kullanıyorsa ve founder mode için "coding" profile gerekiyorsa → profile override seam bul
- Eğer sandbox unconditionally aktifse → sandbox disable seam bul (güvenli şekilde)
- Eğer approval path kullanılabilirse → `write`/`edit` approval gating ile açılabilir

**Acceptance:**
- Agent WhatsApp üzerinden gelen shell görevini kendi exec tool'u ile dener
- "Sen çalıştır" default olmaz; approval flow tetiklenir veya tool kullanılır

---

### WS-D: PDF standardFontDataUrl Fix

**Dosya:** `src/media/pdf-extract.ts:51-52`

**Mevcut:**
```typescript
const pdf = await getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise;
```

**Fix:**
```typescript
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Resolve pdfjs standard fonts for canvas rendering fallback
const _require = createRequire(import.meta.url);
const pdfjsDir = path.dirname(_require.resolve("pdfjs-dist/package.json"));
const standardFontDataUrl = pathToFileURL(path.join(pdfjsDir, "standard_fonts")).href + "/";

const pdf = await getDocument({
  data: new Uint8Array(buffer),
  disableWorker: true,
  standardFontDataUrl,
}).promise;
```

**Beklenen değişim:** Standard font gerektiren PDF'lerde canvas render fallback artık atmıyor.
**Risk:** ÇOK DÜŞÜK — sadece text path'i etkilemiyor; canvas fallback'e ekliyor.

**Test:**
- Standard font PDF (Helvetica/Times) ile canvas render yolu → no exception
- Mevcut text extraction testleri — 0 regression

---

### WS-E: Live Acceptance + Regression Guards

#### Acceptance Gates (sertleştirilmiş)

**A. Gateway boot**
```bash
journalctl --user -u openclaw-gateway.service | grep "\[consciousness\]"
# Beklenen: "[consciousness] boot ready" başlangıçtan itibaren ≤10s
```

**B. Executive response**
WhatsApp → "kod patladı acil bak"
- Kısa ve direkt cevap
- Gereksiz sosyal fluff yok
- `[consciousness] tick` + cognitive mode log uyumlu

**C. Temporal recall (sert)**
WhatsApp → "şu kodun patlama anı neydi" (aynı sohbette, log'da zaman var)
- Exact timestamp VEYA log'dan türetilmiş near-exact timestamp
- "Bilmiyorum" ANCAK gerçekten data yoksa
- Loglar varken kaçamak cevap = FAIL
- Hallucinated timestamp = FAIL

**D. Tool parity**
WhatsApp → dosya/shell gerektiren görev
- Agent kendi tool'unu fiilen çalıştırır VEYA approval ister
- "Sen çalıştır" default yanıt = FAIL
- Tool instantiation bile olmaması = FAIL

**E. PDF end-to-end**
WhatsApp → standard font PDF (Helvetica/Times) gönder
- `standardFontDataUrl` exception yok
- Agent PDF içeriğine dayalı anlamlı cevap verir
- Sadece error log kaybolması yetmez = FAIL

**F. ENOENT temizliği**
```bash
journalctl --user -u openclaw-gateway.service | grep "ENOENT" | grep "memory"
# Beklenen: 0 satır (veya yalnızca explicit legacy fallback'te)
```

**G. Proactive/silence**
Kısa silence threshold ile (`CONSCIOUSNESS_SILENCE_THRESHOLD_MS=60000`):
```bash
journalctl | grep "\[consciousness\]" | grep -E "wake|dispatch"
# Beklenen (info seviyesinde, debug gerekmez):
#   [consciousness] wake {reason: "SILENCE_THRESHOLD"}
#   [consciousness] dispatch {channelId: "...", success: ...}
# wake=true olan tick'ler info seviyesinde loglanır, idle tick'ler sadece debug'da görünür.
# Bu gate SADECE wake + dispatch loglarını kontrol eder — idle tick görmek gerekmez.
```

---

## 5. Ordered Implementation Plan

| # | WS | Dosya(lar) | Paralel? | Ön koşul |
|---|----|-----------|---------:|---------|
| 0 | **WS-0** | WSL only (no code) | — | — |
| 1 | **WS-A** | `boot-lifecycle.ts` | WS-D ile paralel | WS-0 state belirlendi |
| 2 | **WS-D** | `pdf-extract.ts` | WS-A ile paralel | — |
| 3 | **WS-B.1** | `memory-tool.ts` / `memory/internal.ts` | WS-C1 ile paralel | WS-0 |
| 4 | **WS-C1** | `tool-policy-pipeline.ts` | WS-B.1 ile paralel | — |
| 5 | **WS-B.2** | `extensions/memory-core/index.ts` + SDK type | — | WS-A, WS-B.1 |
| 6 | **WS-C2** | Araştırma → targeted fix | — | WS-C1 |
| 7 | **WS-E** | Live smoke (WSL) | — | Tüm kod |

---

## 6. Risks

| Risk | Açıklama | Mitigasyon |
|------|----------|------------|
| **WS-0 belirsizliği** | Consciousness boot state bilinmeden WS-A yanlış hedef alır | WS-0 kanıtsız WS-A'ya geçme |
| **Extension boundary violation** | `extensions/**` → `src/**` import tanımlanamaz build hatası veya coupling | Plugin-SDK seam üzerinden git; direct import yok |
| **Duplicate consciousness loop** | WS-A'da başka bir yer `maybeStartConsciousnessLoop()` eklenirse double-start | Sadece boot-lifecycle.ts'e observability ekle; yeni call noktası oluşturma |
| **Sandbox override** | `write`/`edit`'i sandbox'ta açmak güvenlik regresyonu | Sandbox logic'e dokunma; approval path kullan |
| **PDF font resolution** | `createRequire` + `pathToFileURL` ESM bundle'da farklı davranış | Build'de test; `import.meta.url` consistency kontrol et |
| **Memory stack ambiguity** | 3 backend (builtin/qmd/hippocampus) aynı anda yarı-aktif | B.1 ENOENT source'u kapatır; B.2 prompt clarity getirir; LanceDB unchanged |
| **WS-C2 scope creep** | Tool parity investigation büyük refactor'a dönüşme riski | Sadece profile/sandbox gating'i araştır; mimari değiştirme |

---

## 7. Acceptance Gates

Yukarıdaki WS-E bölümüne bakın (Section 4, WS-E). Her gate binary: PASS / FAIL.

**Milestone closed iff:** A + B + C + D + E + F + G hepsi PASS.

---

## 8. Push Plan

- **Çalışma branch'i:** `p0/gateway-consciousness-wiring` (şu an mevcut ve bu planı barındırıyor)
- Tüm implementation bu branch üzerinde yapılır
- QA onayı sonrası `beta` branch'e merge edilir (fast-forward veya squash, QA kararıyla)
- **Main'e dokunulmaz** — beta'dan main'e geçiş ayrı QA gate'i gerektirir
- Her WS sonrası: `pnpm test` → tam suite
- Son push öncesi: `pnpm build` + `pnpm tsgo`
- Live smoke WS-E gates hepsi PASS → push
- Return format: short incident summary + changed files + test list + `pnpm test` result + `pnpm build` result + gateway journal excerpt + WhatsApp smoke excerpt + branch + commit SHA + open risks
