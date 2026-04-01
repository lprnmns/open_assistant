# 08 — Landing Page & Demo Plan

## Amac

Open Assistant'in ilk halka acik yuzunu olusturmak: kanita dayali landing page + canli demo akisi.

Sayfa iki katmanli bir anlatim tasiyacak:

1. **Fair same-model proof** — ayni `gpt-5.4` modelinde continuity farki
2. **Runtime/proactive proof** — prompt benchmark'tan bagimsiz, test edilmis sistem davranislari

Bu iki katman birbirinden net ayrilacak. Prompt benchmark ile kanitlanan seyler prompt benchmark olarak, runtime davranislari ise urun ozelligi olarak sunulacak. Karistirilmayacak.

---

## Hedef Kitleler

### 1. Teknik kullanici (gelistirici / AI muhendisi)

- Mimari detaylari gormek ister: consciousness loop, DPE, event buffer
- Benchmark verisi, test suite, latency farki ile ikna olur
- Kaynak koda ve test sonuclarina link ister

### 2. Non-technical visitor (merakli kullanici / girisimci)

- "Bu ne ise yariyor?" sorusuna 10 saniyede cevap ister
- Yan yana karsilastirma ve gunluk hayat senaryolari ile anlar
- Teknik jargon degil, somut fark gormek ister

### 3. Startup credit / grant reviewer

- "Neden bu ekip, neden simdi?" sorusuna cevap arar
- Kanit disiplini (overclaim olmasin), test altyapisi, mimari olgunluk onemli
- Benchmark tablosu + test suite coverage + mimari diagram yeterli
- Hosted SaaS vaadi beklemiyor, erken asama prototip gormek yeterli

---

## Primary Narrative

### Ana mesaj

> Ayni model. Daha iyi sureklilik.

### Acilim

Open Assistant, OpenClaw baseline'ini surekli bellek, sleep-phase consolidation ve guardrail'li proaktif davranis ile genisletir. Ayni `gpt-5.4` modelinde gecikmeli not hatirlama ve yanlis bilgiye direnc testlerinde baseline'dan daha iyi sonuc verdi.

### Anlatim akisi

```
Hero (ilk fold)
  |
  v
Fair same-model benchmark tablosu
  |
  v
Timeline storyboard (09:00 → gun sonu)
  |
  v
Runtime guardrails (owner drain, 3rd party guard, quiet tick)
  |
  v
Mimari gorsel (4 sutun)
  |
  v
BYOK / OpenRouter uyumluluk notu
  |
  v
CTA
```

---

## Safe Claims vs Unsafe Claims

### GUVENLI (mevcut kanita dayanan)

| # | Claim | Kanit |
|---|-------|-------|
| S1 | Ayni `gpt-5.4` modelinde OA gecikmeli not hatirlama ve distractor-resistant recall'da baseline'dan daha iyi sonuc verdi | H05, H08 — iki temiz Codex run |
| S2 | OA 10/12, OpenClaw 8/12 pass rate (ayni model, ayni operator, ayni harness) | Codex v1 aggregate |
| S3 | OA ortalama benchmark latency'si 43.4s vs OpenClaw 85.2s | Codex v1 aggregate |
| S4 | Owner event drain, third-party no-auto-reply ve quiet no-op tick'ler test edilmis runtime davranislaridir | loop.test 59/59, scheduler.test 29/29 |
| S5 | OA yeni OpenRouter BYOK lane'inde uc uca calisiyor | C01 smoke, openrouter-smoke.test |
| S6 | OA, OpenClaw uzerine consciousness loop, DPE, living brain ve sleep phase ekler | Mimari gercek |

### YASAK (mevcut kanitla desteklenmeyen)

| # | Claim | Neden yasak |
|---|-------|-------------|
| U1 | "Her gorevde OpenClaw'dan iyidir" | 12 senaryo, 2'sinde ikisi de basarisiz |
| U2 | "Zaman algisi ustunlugu" | H06, H09'da ikisi de 0 dondurdu |
| U3 | "OpenClaw cevap veremez" | OpenRouter lane timeout — uyumluluk bulgusu, kalite iddiasi degil |
| U4 | "Token maliyeti X% daha az" | Ozel maliyet karsilastirmasi yapilmadi |
| U5 | "Uretim-hazir barindirilan SaaS" | Deploy/monitoring/backup henuz tamamlanmadi |
| U6 | Prompt benchmark'ta kanitlanmamis runtime davranislari sanki A/B ile kanitlanmis gibi sunmak | Iki katman karistirilmamali |

---

## Landing Page Section Listesi

### Section 1: Hero

**Amac:** 3 saniyede ziyaretciyi yakalamak.

**Icerik:**
- Headline: `Same model. Better continuity.`
- Subhead: `Open Assistant turns a reactive assistant into a continuous runtime that remembers, waits, wakes, and acts with guardrails.`
- Tek gorsel: sabahtan aksama akan minimal timeline ikonu veya consciousness loop animasyonu

**Kanit dayanagi:** Tum sayfa boyunca kanitlanacak; hero sadece vaat.

---

### Section 2: Fair Same-Model Benchmark

**Amac:** "Ayni model, ayni sartlar, olculebilir fark" mesajini vermek.

**Gosterecegi kanit:**
- Tablo: OA 10/12 vs OpenClaw 8/12
- Latency: 43.4s vs 85.2s
- Ozellikle H05 (delayed note recall) ve H08 (distractor-resistant recall) satirlari vurgulu

**Dayandigi artifact'ler:**
- `benchmarks/runs/openassistant-vs-openclaw-tr-human-codex-v1-2026-04-01T16-19-20.069Z`
- `benchmarks/runs/openassistant-vs-openclaw-tr-human-codex-v1-2026-04-01T16-40-52.693Z`
- `benchmarks/nontechnical-comparison-tr-2026-04-01.json`

**Gorsel yaklasim:**
- Iki sutunlu karsilastirma tablosu
- Gecen satirlar yesil, kalan satirlar kirmizi
- H05 ve H08 satiri buyuk font ile yan yana gosterim (kullanici promptu + iki cevap)

**Dikkat:**
- H06, H09 satirlari tabloda "ikisi de basarisiz" olarak gorulecek; gizlenmeyecek ama vurgulanmayacak
- Tablo altina kucuk metin: "Provider: OpenAI Codex, Model: gpt-5.4, Ayni makine, ayni operator"

---

### Section 3: Timeline Storyboard

**Amac:** Benchmark tablosunun otesinde, gunluk hayatta farkini "hissettirmek".

**Gosterecegi kanit:**
- S1 (09:00): Not birakma — ikisi de basarili
- S2 (09:05): Dogal geri sorma — OA temiz, OpenClaw format bozar
- S3 (09:15): Yanlis bilgiyle sasirtma — OA notu korur, OpenClaw kaybeder
- S4 (gun icinde): Sessizlikte gereksiz LLM cagrisi yok
- S5 (owner event): Event gelir, islem yapilir, tekrar edilmez
- S6 (3rd party): Ucuncu kisi mesaji gelir, otomatik cevap atilmaz

**Dayandigi artifact'ler:**
- `benchmarks/landing-runtime-storyboard-tr.json`
- `benchmarks/proactive-human-demo-tr.json`
- S1-S3: H02, H05, H08 benchmark verileri (verified)
- S4-S6: loop.test.ts, scheduler.test.ts (verified runtime)

**Gorsel yaklasim — iki farkli sahne tipi:**

S1-S3 (prompt-based, dogrudan benchmark verisi):
- Dikey zaman cizelgesi, sol: OpenClaw, sag: Open Assistant
- Her sahnede kullanici promptu ortada, iki gercek cevap yanlarda
- Veri benchmark run'larindan birebir alinir

S4-S6 (runtime davranisi, yalnizca OA tarafinda dogrulanmis):
- Ayni timeline'da devam eder AMA format degisir
- Sol taraf (OpenClaw sutunu) tamamen bos veya gri — karsilastirma YAPILMAZ
- Sag taraf (OA): davranis aciklamasi + "Verified in loop.test.ts" etiketi
- Uzerinde acik etiket: "Runtime capability — yalnizca Open Assistant'ta dogrulanmis"
- OpenClaw hakkinda ima, cikarim veya uydurma davranis YAZILMAZ

**Dikkat:**
- S4-S6 "OA bunu yapabiliyor" olarak sunulacak; "OpenClaw bunu yapamiyor" YAZILMAYACAK
- Runtime sahneleri prompt benchmark sonucu gibi CERCEVELENMEYECEK
- OpenClaw sutunu bos birakilarak gorsel olarak "bu karsilastirma degil, urun ozelligi tanitimi" mesaji verilecek

---

### Section 4: Runtime Guardrails

**Amac:** Prompt benchmark'in olcmedigi asil urun farkini gostermek.

**Gosterecegi kanit (3 guardrail):**

1. **Owner event drain:** Gelen event islem sonrasi tekrar edilmez
   - Kanit: scheduler.test.ts, openrouter-smoke.test.ts
2. **Third-party no-auto-reply:** Dis kisi mesaji alinir ama owner onayi olmadan cevap uretilmez
   - Kanit: loop.test.ts
3. **Quiet no-op ticks:** Anlamli delta yoksa LLM cagrilmaz
   - Kanit: loop.test.ts, scheduler.test.ts

**Gorsel yaklasim:**
- 3 kart veya ikon grubu
- Her kartta: baslik + bir cumlelik aciklama + dogrulama notu
- Badge dili spesifik olmali, file-level suite sayisi degil:
  - Owner event drain: "Verified in scheduler.test.ts"
  - Third-party no-auto-reply: "Verified in loop.test.ts"
  - Quiet no-op ticks: "Verified in loop.test.ts + scheduler.test.ts"
- "59/59 passed" gibi genis suite sayilari KULLANILMAZ (o sayi tum loop testlerini kapsar, tek guardrail'e esit degildir)
- Teknik olmayan mesaj: "Proaktif ama kontrolsuz degil."

---

### Section 5: Mimari / 4 Sutun

**Amac:** Teknik kitleye OA'nin OpenClaw uzerine ne ekledigi gorsel olarak gostermek.

**Gosterecegi 4 sutun:**
1. **Consciousness Loop** — surekli tick-based dusunme dongusa
2. **Deterministic Policy Engine (DPE)** — guardrail'li karar mekanizmasi
3. **Living Brain** — surekli bellek ve not alma
4. **Sleep Phase** — uyku fazinda consolidation

**Gorsel yaklasim:**
- 4 sutunlu ikon grid veya minimal mimari diyagram
- Her sutunun altinda tek cumlelik aciklama

**Dayandigi artifact:** Mimari gercek; ayrica `gelistirme-plani/01-proaktif-zeka.md`

---

### Section 6: BYOK / OpenRouter Uyumluluk

**Amac:** "Kendi API key'inizi getirin" esnekligini gostermek.

**Gosterecegi kanit:**
- OpenRouter lane'inde OA calisti (C01 SMOKE_OK)
- Desteklenen providerlar: Anthropic, OpenAI, Google, OpenRouter

**Dayandigi artifact:**
- `benchmarks/runs/openassistant-vs-openclaw-v1-2026-03-31T20-55-31.635Z`
- src/llm/proxy-client.ts (4 provider)

**Dikkat:**
- Bu ana kalite benchmark'i olarak SUNULMAYACAK
- "Uyumluluk kaniti" etiketi ile gosterilecek
- "OpenClaw bu lane'de cevap veremedi" YAZILMAYACAK; yerine "OA bu lane'de uc uca calisiyor"

---

### Section 7: CTA

**Amac:** Erken asama ilgisini toplamak.

**Yaklasim:**
- Birincil: `Request early access` (form / waitlist)
- Ikincil: `See the benchmark` (JSON veya detay sayfasi linki)
- Ucuncu: `Watch the live demo` (demo video/gif linki)

**Dikkat:**
- "Buy now", "Sign up for enterprise" gibi SaaS vaatleri YAPILMAYACAK
- Erken asama prototip tonu korunacak

---

## Demo Akisi

### Sira ve gerekce

| Sira | Sahne | Icerik | Neden bu sirada |
|------|-------|--------|-----------------|
| 1 | Kontrol promptlari | K01, K02, K03 | Adil baslangic: ikisi de yapiyor |
| 2 | Gecikmeli sureklilik | H01 → H02 → H04 → H05 → H07 → H08 | Fark burada ortaya cikiyor; H05 ve H08 en guclu anlar |
| 3 | OpenRouter smoke | C01 | Uyumluluk kaniti — kalite A/B'den sonra gelmeli |
| 4 | Runtime: owner event drain | B1 | Prompt-otesi ilk demo |
| 5 | Runtime: 3rd party guard | B2 | En kritik guardrail |
| 6 | Runtime: sessiz tick | B3 | "Pahali degil" mesaji ile kapanis |

### Neden bu sira?

1. **Kontrol oncelikli:** Izleyici once "ikisi de temel seyleri yapabiliyor" gormeli; aksi halde "model farki mi?" suphelenir
2. **Fark ortaya ciksin:** H05 ve H08 en temiz, en kolay anlasilan farklar — burada "wow" ani
3. **Uyumluluk ara gecis:** Ana A/B'den runtime'a gecerken OpenRouter BYOK'u "ve baska modellerle de calisiyor" olarak goster
4. **Runtime son:** Prompt-only A/B yapamayacagi davranislari en sonda goster — izleyici artik "bu sadece daha iyi prompt degil, farkli bir sistem" sonucuna variyor

---

## Uygulama Sub-Task'lari

### Sub-Task 8.1 — Landing Page Scaffold

**Icerik:** HTML/CSS temel yapisi + section placelholderlar + responsive grid

**Kabul kriterleri:**
- [ ] 7 section icin bos ama yapilandirilmis container'lar
- [ ] Mobile-first responsive layout (360px → 1440px)
- [ ] Koyu tema, minimal tipografi
- [ ] `landing/index.html` ve `landing/styles.css` (veya framework karari verildiyse o)
- [ ] Hero section baslik ve alt baslik gorunur

### Sub-Task 8.2 — Benchmark Karsilastirma Section

**Icerik:** Same-model benchmark tablosu + H05/H08 yan yana gosterim

**Kabul kriterleri:**
- [ ] Tablo 12 satir: her senaryo icin OA vs OpenClaw sonucu
- [ ] H05 ve H08 satirlari buyutulmus yan yana kart olarak da gosterilir
- [ ] Tablo altinda fairness notu: "Same model: gpt-5.4, Same operator, Same harness"
- [ ] Veri `benchmarks/nontechnical-comparison-tr-2026-04-01.json` dosyasindan cekilir veya statik kopyalanir
- [ ] H06, H09 satirlari "ikisi de basarisiz" olarak gorulur (gizlenmez)

### Sub-Task 8.3 — Timeline Storyboard Section

**Icerik:** Dikey akan zaman cizelgesi, 6-7 sahne, sol/sag karsilastirma

**Kabul kriterleri:**
- [ ] S1-S3 prompt-based sahneler: kullanici promptu + iki gercek cevap yan yana (benchmark verisinden)
- [ ] S4-S6 runtime sahneler: yalnizca OA tarafi gosterilir; OpenClaw sutunu bos/gri
- [ ] S4-S6'da gorsel etiket: "Runtime capability — yalnizca Open Assistant'ta dogrulanmis"
- [ ] OpenClaw hakkinda runtime sahnelerinde ima veya uydurma davranis YOK
- [ ] Gorsel olarak akan timeline hissi (dikey cizgi + zaman etiketleri)
- [ ] Veri `benchmarks/landing-runtime-storyboard-tr.json` ile tutarli

### Sub-Task 8.4 — Runtime Guardrails Section

**Icerik:** 3 kart: owner drain, 3rd party guard, quiet tick

**Kabul kriterleri:**
- [ ] 3 guardrail'in her biri icin baslik + bir cumlelik aciklama + ikon
- [ ] Her kartta spesifik dogrulama notu (ornek: "Verified in scheduler.test.ts") — file-level suite sayisi degil
- [ ] Teknik olmayan alt mesaj: "Proaktif ama kontrolsuz degil."
- [ ] Kartlar responsive grid'de 3 sutun (desktop) → 1 sutun (mobile)

### Sub-Task 8.5 — Mimari + BYOK Section

**Icerik:** 4 sutun mimari gorsel + BYOK provider listesi

**Kabul kriterleri:**
- [ ] 4 sutun: Consciousness Loop, DPE, Living Brain, Sleep Phase — her biri baslik + aciklama
- [ ] BYOK: "4 provider destegi" notu + OpenRouter uyumluluk kaniti
- [ ] Mimari gorsel minimal ve temiz (karmasik diyagram degil, anlasilan ikon grid)

### Sub-Task 8.6 — Demo Video / GIF + CTA

**Icerik:** Demo recording + landing page'e embed + CTA formu

**Kabul kriterleri:**
- [ ] Demo 6 sahneyi takip eden 2-4 dakikalik video veya terminal GIF
- [ ] CTA: "Request early access" formu (email toplama)
- [ ] Ikincil CTA'lar: "See the benchmark", "Watch the demo"
- [ ] SaaS / enterprise vaadi YAPILMAMIS

### Sub-Task 8.7 — Claim Audit + QA Review

**Icerik:** Tum sayfa metinlerinin safe/unsafe claim tablosuna karsi denetimi

**Kabul kriterleri:**
- [ ] Her section'daki her ifade S1-S6 (safe) veya U1-U6 (unsafe) tablosuna karsi kontrol edilmis
- [ ] Yasak claim'lerden hicbiri sayfada bulunmuyor
- [ ] H06/H09 gizlenmemis
- [ ] OpenRouter lane "uyumluluk" olarak etiketlenmis, "kalite kaniti" olarak degil
- [ ] Runtime davranislari "prompt benchmark sonucu" olarak sunulmamis
- [ ] Reviewer (QA) yazili onay vermis

---

## Riskler ve Acik Noktalar

| # | Risk | Etki | Onlem |
|---|------|------|-------|
| R1 | Overclaim kayma | Guvenilirlik kaybi | Safe/unsafe tablosu + Sub-Task 8.7 audit |
| R2 | Timeline storyboard teknik gorunurse non-technical kitle kaybedilir | Hedef kitle kaybi | S1-S3 gunluk hayat dili, S4-S6 minimal ikon + tek cumle |
| R3 | Benchmark verileri guncellenirse sayfa tutarsizlasir | Yaniltici bilgi | Veri tek kaynak dosyadan cekilsin veya statik kopyalandiysa tarih notu koysun |
| R4 | Demo video'da canli API key gorunmesi | Guvenlik | Tum cikti redactLogLine'dan gecsin, video oncesi son kontrol |
| R5 | OpenRouter lane stall'u "OpenClaw cevap veremez" olarak alinir | Agresif claim | Framing: "OA bu lane'de calisiyor" — baseline hakkinda yorum yapma |
| R6 | Zaman algisi claim'i iceri sizdirilir | Kanitlanmamis iddia | U2 acikca yasak listede; audit'te kontrol |
| R7 | Landing page generic AI-slop olur | Farksizlasma | Tum icerik mevcut kanita baglanmali; soyut vaat yerine somut sahne/veri |

---

## "Do Not Overclaim" Checklist

Landing page yayina alinmadan once su sorularin hepsine "Evet" cevaplanmis olmali:

- [ ] Hero claim'i mevcut benchmark verisine dayaniyor mu?
- [ ] Benchmark tablosu basarisiz satirlari (H06, H09) gizlemiyor mu?
- [ ] OpenRouter lane "uyumluluk kaniti" olarak etiketlenmis mi?
- [ ] Runtime davranislari prompt A/B sonucu olarak SUNULMAMIS mi?
- [ ] "OpenClaw cevap veremez / yapamiyor" gibi agresif claim KULLANILMAMIS mi?
- [ ] Zaman algisi ustunlugu iddiasi YAZILMAMIS mi?
- [ ] Token maliyeti karsilastirmasi (kanitlanmamis) YAPILMAMIS mi?
- [ ] "Uretim-hazir SaaS" vaadi VERILMEMIS mi?
- [ ] Tum canli demo ciktilari redactLogLine'dan gecmis mi?
- [ ] Fairness notu (ayni model, ayni operator, ayni harness) benchmark tablosu altinda gorunuyor mu?

---

## Kanit Referans Haritasi

| Sayfa Section'i | Dayandigi Artifact |
|-----------------|-------------------|
| Hero | Tum sayfa kanit butunu |
| Benchmark tablosu | `benchmarks/nontechnical-comparison-tr-2026-04-01.json`, Codex v1 run'lar |
| H05/H08 spotlight | Ayni JSON, satirlar H05 ve H08 |
| Timeline S1-S3 | `benchmarks/landing-runtime-storyboard-tr.json` (verified sahneler) |
| Timeline S4-S6 | `loop.test.ts` (59/59), `scheduler.test.ts` (29/29) |
| Runtime guardrails | `loop.test.ts`, `scheduler.test.ts`, `openrouter-smoke.test.ts` |
| Mimari | Kod tabani ve `gelistirme-plani/01-proaktif-zeka.md` |
| BYOK/OpenRouter | `C01` smoke run, `src/llm/proxy-client.ts` |

---

## Sonraki Adim

Bu plan QA onayindan gectikten sonra Sub-Task 8.1'den baslayarak implementasyona gecilebilir. Her sub-task tamamlandiginda QA review beklenecek.
