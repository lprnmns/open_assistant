# 01 — Arka Plan Bilinci: Sürekli Yaşayan Dijital Varlık

> Eski vizyon: "115 statik trigger ile event-driven asistan"
> Yeni vizyon: **"Oyun Motoru (Game Loop) mantığıyla sürekli uyanık, kendi trigger'larını derleyen, sessizliği veri olarak okuyan Yaşayan Varlık"**

---

## Paradigma Değişimi

```
ESKİ MODEL (Reaktif Chatbot):          YENİ MODEL (Yaşayan Varlık):
────────────────────────────            ─────────────────────────────
Kullanıcı yazar → AI cevaplar          AI sürekli "düşünür"
Cron tetikler → AI çalışır             AI kendi tetikleyicisini yazar
200 hardcoded trigger                   0 hardcoded trigger
"Hatırlatayım mı?" sorar               Hatırlatır. Nokta.
Sessizlik = boşta                       Sessizlik = veri
Sabah brifing şablonu                   Kullanıcıya göre şekillenen bilinç
```

---

## Çekirdek Kavram: Consciousness Loop (Bilinç Döngüsü)

Oyun motorları saniyede 60 kare çizer. Bu asistan da saniyede değil ama **dakikada 1 kez "düşünür"**. Hardcoded trigger listesi yok — döngünün her turunda AI kendi bağlamını değerlendirir.

**AMA:** Her tick'te LLM çağırmak mali intihardır. 1000 kullanıcı × dakikada 1 tick × 30 gün = ayda **43 milyon LLM çağrısı**. Çözüm: **Heuristic Watchdog**.

---

## ZIRH #1: Heuristic Watchdog (Nöbetçi)

LLM'den **önce** çalışan, sıfır maliyetli, deterministik bir filtre katmanı. Dünyada "değişen bir şey" yoksa LLM'i uyandırmaz.

```
┌──────────────────────────────────────────────────────────────┐
│              HEURISTIC WATCHDOG (Pre-LLM Filter)              │
│              Maliyet: $0.00 — Saf kod, LLM yok               │
│                                                               │
│  Her tick'te ÖNCE Watchdog çalışır:                          │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ DELTA CHECK (State Diff — Değişen Var mı?)           │     │
│  │                                                       │     │
│  │ 1. new_email_count > last_check_email_count?     [✓/✗]│    │
│  │ 2. calendar_event_in_next_30min?                 [✓/✗]│    │
│  │ 3. active_trigger_fired?                         [✓/✗]│    │
│  │ 4. silence_duration > user_silence_threshold?    [✓/✗]│    │
│  │ 5. pending_notes.length > 0?                     [✓/✗]│    │
│  │ 6. time_matches_compiled_cron?                   [✓/✗]│    │
│  │ 7. user_sent_message? (yeni mesaj geldi mi?)     [✓/✗]│    │
│  │                                                       │     │
│  │ Sonuç: ANY(✓) → LLM'i UYANDRIR                      │     │
│  │         ALL(✗) → LLM UYUMAYA DEVAM EDER              │     │
│  └──────────────────────┬──────────────────────────────┘     │
│                         │                                     │
│                    ┌────┴────┐                                │
│                    │         │                                │
│                 HİÇ DEĞİŞEN  EN AZ 1                        │
│                 YOK           DEĞİŞİKLİK                     │
│                    │         │                                │
│                    ▼         ▼                                │
│               TICK ATLA   LLM'İ ÇAĞIR                        │
│               (log only)  (full consciousness tick)          │
│                                                               │
│  Gerçek dünya etkisi:                                        │
│  • Gece 23:00-07:00: ~0 LLM çağrısı (hiçbir şey değişmez) │
│  • Sessiz öğleden sonra: ~2-3 LLM çağrısı/saat             │
│  • Aktif dönem: ~10-15 LLM çağrısı/saat                    │
│  • Tasarruf: %70-90 daha az LLM çağrısı                    │
└──────────────────────────────────────────────────────────────┘
```

### Watchdog Kodu

```typescript
interface WorldSnapshot {
  emailCount: number;
  calendarNextEvent: Date | null;
  activeTriggersFired: string[];
  lastUserMessage: Date;
  pendingNotes: number;
  compiledCronsDue: string[];
}

class HeuristicWatchdog {
  private lastSnapshot: WorldSnapshot;
  private silenceThreshold: number; // kullanıcıya özel, behavioral model'den

  async shouldWakeLLM(): Promise<{wake: boolean, reasons: string[]}> {
    const current = await this.takeSnapshot();
    const reasons: string[] = [];

    // 1. Yeni mail geldi mi?
    if (current.emailCount > this.lastSnapshot.emailCount) {
      reasons.push(`new_email: +${current.emailCount - this.lastSnapshot.emailCount}`);
    }

    // 2. Takvim event'i 30dk içinde mi?
    if (current.calendarNextEvent &&
        current.calendarNextEvent.getTime() - Date.now() < 30 * 60 * 1000) {
      reasons.push(`calendar_approaching: ${current.calendarNextEvent}`);
    }

    // 3. Aktif trigger tetiklendi mi?
    if (current.activeTriggersFired.length > 0) {
      reasons.push(`triggers_fired: ${current.activeTriggersFired.join(',')}`);
    }

    // 4. Sessizlik eşiği aşıldı mı?
    const silenceDuration = Date.now() - current.lastUserMessage.getTime();
    if (silenceDuration > this.silenceThreshold) {
      reasons.push(`silence_exceeded: ${Math.floor(silenceDuration / 60000)}min`);
      // Eşiği %50 artır — aynı sebepten tekrar uyandırma
      this.silenceThreshold *= 1.5;
    }

    // 5. Bekleyen notlar var mı?
    if (current.pendingNotes > 0) {
      reasons.push(`pending_notes: ${current.pendingNotes}`);
    }

    // 6. Compiled cron tetiklendi mi?
    if (current.compiledCronsDue.length > 0) {
      reasons.push(`crons_due: ${current.compiledCronsDue.join(',')}`);
    }

    this.lastSnapshot = current;

    return {
      wake: reasons.length > 0,
      reasons
    };
  }
}
```

### Watchdog + Consciousness Loop Entegrasyonu

```typescript
async tick() {
  // ADIM 0: Watchdog — LLM'den ÖNCE çalışır ($0)
  const watchdog = await this.watchdog.shouldWakeLLM();

  if (!watchdog.wake) {
    // Hiçbir şey değişmedi → LLM'i ÇAĞIRMA → $0 maliyet
    this.metrics.skippedTicks++;
    return;
  }

  // ADIM 1: Bir şey değişti → LLM'i uyandır ($ maliyet)
  this.metrics.activeTicks++;
  this.metrics.wakeReasons.push(...watchdog.reasons);

  // ... mevcut consciousness loop kodu (aşağıda) ...
}
```

### Maliyet Etkisi

```
Watchdog OLMADAN (eski tasarım):
├── 1440 tick/gün × LLM çağrısı = ~$2-5/kullanıcı/gün
├── 1000 kullanıcı × 30 gün = $60,000-150,000/ay
└── SÜRDÜRÜLEMEZ ❌

Watchdog İLE (yeni tasarım):
├── 1440 tick/gün × Watchdog ($0) = $0
├── ~50-100 LLM uyandırma/gün = ~$0.10-0.30/kullanıcı/gün
├── 1000 kullanıcı × 30 gün = $3,000-9,000/ay
└── SÜRDÜRÜLEBİLİR ✅ (%93-95 tasarruf)
```

---

## Consciousness Loop (Watchdog Geçtikten Sonra)

```
┌──────────────────────────────────────────────────────────────┐
│                 CONSCIOUSNESS LOOP                            │
│       (Sadece Watchdog "wake" dediğinde çalışır)             │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ TICK: Watchdog reasons + zaman + son durum snapshot  │     │
│  └──────────────────────┬──────────────────────────────┘     │
│                         │                                     │
│                         ▼                                     │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ 1. ZAMAN FARKINDALIGI                                │     │
│  │    - Saat kaç? Kullanıcı normalde şimdi ne yapar?   │     │
│  │    - Son mesajdan ne kadar zaman geçti?              │     │
│  │    - Yaklaşan deadline/event var mı?                 │     │
│  │    - Bugün özel bir gün mü? (doğum günü, bayram)    │     │
│  └──────────────────────┬──────────────────────────────┘     │
│                         │                                     │
│                         ▼                                     │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ 2. DÜNYA DURUMU TARAMASI                             │     │
│  │    - Yeni mail geldi mi? (izin varsa)                │     │
│  │    - Takvimde değişiklik var mı?                     │     │
│  │    - Takip edilen konularda gelişme var mı?          │     │
│  │    - Aktif trigger'lardan tetiklenen var mı?         │     │
│  └──────────────────────┬──────────────────────────────┘     │
│                         │                                     │
│                         ▼                                     │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ 3. DAVRANIŞSAL ANOMALİ TARAMASI                      │     │
│  │    - Kullanıcı normalden sessiz mi?                  │     │
│  │    - Bekleyen görevde gecikme var mı?                │     │
│  │    - Ton/hız değişikliği algılandı mı?              │     │
│  │    - Beklenen süre anomalisi var mı?                 │     │
│  └──────────────────────┬──────────────────────────────┘     │
│                         │                                     │
│                         ▼                                     │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ 4. MESAJ KARARI                                      │     │
│  │    "Bu tick'te kullanıcıya mesaj atmalı mıyım?"     │     │
│  │                                                      │     │
│  │    Girdi:                                            │     │
│  │    - Aciliyet skoru (0-10)                           │     │
│  │    - Kullanıcı müsaitlik tahmini                    │     │
│  │    - Son 24 saatte kaç mesaj attım?                 │     │
│  │    - Saat uygun mu?                                  │     │
│  │    - Bu bilgi "sonraki doğal etkileşimi bekleyebilir │     │
│  │      mi" yoksa "şimdi söylenmeli mi"?               │     │
│  │                                                      │     │
│  │    Çıktı: MESAJ_AT / NOT_AL_BEKLE / SESSIZ_KAL     │     │
│  └─────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

**Kritik fark:** Bu döngü hiçbir hardcoded kural içermiyor. Her tick'te LLM, kullanıcının Deep Memory profili + dünya durumu + zaman bilgisi ile **kendi kararını veriyor**.

---

## Dinamik Trigger Derleyici (Dynamic Compiler)

Statik trigger listesi yerine, AI konuşmadan intent çıkarıp **kendi micro-script'lerini yazıyor**.

### Primitives (Yapı Taşları — AI'ın Kullandığı Tool'lar)

```typescript
// AI'a verilen primitive tool'lar:
const primitives = {
  // Zamanlama
  schedule_once(datetime, action),      // Tek seferlik
  schedule_recurring(cron, action),     // Tekrarlı
  cancel_schedule(id),                  // İptal

  // İzleme
  watch_inbox(filter, on_match),        // E-posta izle
  watch_url(url, condition, on_change), // Web sayfası izle
  watch_calendar(on_event),             // Takvim değişikliği

  // Eylem
  notify(message, urgency),             // Kullanıcıya bildir
  add_to_calendar(event),               // Takvime ekle
  save_to_memory(fact, importance),     // Belleğe kaydet
  run_research(query),                  // Arka plan araştırması

  // Sensör
  check_weather(location),              // Hava durumu
  check_time(),                         // Zaman kontrolü
  read_inbox(count),                    // Mail oku
  read_calendar(range),                 // Takvim oku
};
```

### Nasıl Çalışır: Gerçek Örnekler

**Kullanıcı:** "Günde 2 litre su içmeliyim"

```
AI düşünce süreci (internal, kullanıcıya gösterilmez):
├── Sağlık hedefi tespit edildi
├── Somut: 2L/gün = takip edilebilir
├── Bu geri alınabilir bir eylem mi? EVET (hatırlatma)
├── → Act-First: direkt kur, sormadan
└── → Primitive: schedule_recurring

AI arka planda oluşturur:
{
  type: "compiled_trigger",
  source: "conversation",
  logic: "schedule_recurring('0 9,12,15,18 * * *',
    () => notify('Su iç! Bugünkü 2L hedefe yaklaş 💧', 'low')
  )",
  context: "Kullanıcı spor yapıyor, günde 2L su hedefi var",
  reversible: true,
  auto_approved: true  // geri alınabilir → sorma
}

AI yanıtı:
"Günde 4 kez (09, 12, 15, 18) hatırlatacağım.
Rahatsız ederse 'su hatırlatmasını kapat' de yeter."
```

**Kullanıcı:** "Sınav takvimi açıklandı" + [görsel]

```
AI düşünce süreci:
├── Görsel analiz → Matematik 15/4, Fizik 18/4, Kimya 22/4
├── Takvim erişimim var mı?
│   ├── EVET → add_to_calendar (Act-First, geri alınabilir)
│   └── HAYIR → ask_permission (tek seferlik izin iste)
├── Hatırlatma → Act-First (geri alınabilir)
├── Hazırlık takibi → Act-First
└── 3 sınav × (takvim + 7gün_önce + 1gün_önce + hazırlık_check) = 12 trigger

AI arka planda 12 compiled trigger oluşturur.

AI yanıtı:
"Sınavlarını gördüm, takvime ekledim:
• Matematik — 15 Nisan
• Fizik — 18 Nisan
• Kimya — 22 Nisan
Birer hafta ve birer gün önce uyaracağım.
Araya da soracağım hazırlık nasıl gidiyor diye."
```

**Kullanıcı:** "X şirketine iş başvurusu yaptım"

```
AI düşünce süreci:
├── E-posta izleme gerekiyor
├── İnbox okuma iznim var mı?
│   ├── EVET → watch_inbox (Act-First)
│   └── HAYIR → izin iste (geri alınamaz eylem, sorulmalı)
├── "İş başvurusu" → önemli, duygusal yatırım var
└── Takip süresi: genelde 1-2 hafta

İzin yoksa, AI yanıtı:
"Takip edeyim. Bunun için maillerini taramam lazım —
sadece konu satırlarına bakacağım, X şirketinden
bir şey geldiğinde haber vereceğim. İzin verir misin?"

İzin varsa, AI yanıtı:
"Takip ediyorum. X şirketinden bir şey geldiğinde
hemen haber veririm. Genelde 1-2 hafta sürer —
10 gün geçerse de hatırlatırım ki follow-up atabilesin."
```

---

## "Silence is Data" — Sessizlik Okuma

```
┌──────────────────────────────────────────────────────────────┐
│              SESSİZLİK ANALİZ MOTORU                          │
│                                                               │
│  Input: last_message_timestamp, user_profile, active_context │
│                                                               │
│  ┌─────────────────────────────────────────────────┐         │
│  │ Sessizlik Süresi    │ Normal Kalıp  │ Eylem     │         │
│  ├─────────────────────┼───────────────┼───────────┤         │
│  │ 2 saat              │ Öğle arası    │ Sessiz kal│         │
│  │ 5 saat (iş saati)   │ Anormal       │ Bekle ama │         │
│  │                      │               │ not al    │         │
│  │ 1 gün               │ Hafta sonu    │ Sessiz kal│         │
│  │                      │ olabilir      │           │         │
│  │ 1 gün (hafta içi)   │ Anormal       │ Hafif     │         │
│  │                      │               │ check-in  │         │
│  │ 3 gün               │ Kesinlikle    │ "Nasılsın"│         │
│  │                      │ anormal       │ mesajı    │         │
│  │ 1 hafta+             │ Çok anormal   │ Samimi    │         │
│  │                      │               │ check-in  │         │
│  │ 1 ay                 │ Uzun ayrılık  │ Sıcak     │         │
│  │                      │               │ karşılama │         │
│  └─────────────────────┴───────────────┴───────────┘         │
│                                                               │
│  Ama her zaman bağlama bak:                                  │
│  - Sınav haftasında 3 gün sessizlik = NORMAL (çalışıyor)    │
│  - Tatilde 1 hafta sessizlik = NORMAL (tatilde)              │
│  - Proje deadline'ında sessizlik = belki takıldı             │
│  - Normalde her gün yazan biri 2 gün yazmazsa = check-in     │
└──────────────────────────────────────────────────────────────┘
```

---

## Zaman Anomali Motoru (Temporal Anomaly Engine)

AI her verdiği göreve **beklenen süre** atar ve sonucu değerlendirir.

```
┌──────────────────────────────────────────────────────────────┐
│             TEMPORAL ANOMALY ENGINE                            │
│                                                               │
│  Görev verildi → Beklenen süre tahmini → Zamanlayıcı başla  │
│                                                               │
│  ┌──────────────────────────────────────────────┐            │
│  │ SENARYO: Çok Erken Bitirme                    │            │
│  │                                                │            │
│  │ Görev: "Bu raporu hazırla" (tahmini: ~30dk)   │            │
│  │ Yanıt: 3 dakika sonra "Bitti"                 │            │
│  │                                                │            │
│  │ AI değerlendirmesi:                            │            │
│  │ • Süre anomalisi: %90 erken (kırmızı bayrak)  │            │
│  │ • Olasılıklar:                                 │            │
│  │   1. Önceden hazırlamıştı (en olası)           │            │
│  │   2. Yarım bıraktı                            │            │
│  │   3. Gerçekten çok hızlı (düşük olas.)        │            │
│  │                                                │            │
│  │ AI yanıtı:                                     │            │
│  │ "3 dakikada mı bitti? 😏 Önceden başlamıştın   │            │
│  │  galiba. X ve Y kısmı tamam mı bi bakayım?"   │            │
│  └──────────────────────────────────────────────┘            │
│                                                               │
│  ┌──────────────────────────────────────────────┐            │
│  │ SENARYO: Gecikme                              │            │
│  │                                                │            │
│  │ Görev: "Şu maili cevapla" (tahmini: ~5dk)    │            │
│  │ 15 dakika geçti, yanıt yok                    │            │
│  │                                                │            │
│  │ AI (proaktif mesaj):                           │            │
│  │ "Mailde takıldığın yer mi var?                 │            │
│  │  Yardımcı olabilirim — yoksa başka işle        │            │
│  │  uğraşıyorsan daha sonra hallederiz."         │            │
│  └──────────────────────────────────────────────┘            │
│                                                               │
│  ┌──────────────────────────────────────────────┐            │
│  │ SENARYO: Deadline Yaklaşıyor + İnaktivite     │            │
│  │                                                │            │
│  │ Memory: "Fizik sınavı 2 gün sonra"            │            │
│  │ Gözlem: 3 gündür fizikle ilgili hiçbir şey     │            │
│  │         sorulmadı/yapılmadı                    │            │
│  │                                                │            │
│  │ AI (proaktif mesaj):                           │            │
│  │ "Fizik sınavın perşembe. Hazırlık nasıl?      │            │
│  │  İstersen konu listesi çıkarayım — ya da       │            │
│  │  çalıştığın bir konu varsa soru sorabilirim."  │            │
│  └──────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────┘
```

---

## Bilişsel Yük Algılama (Cognitive Load Detection)

```
┌──────────────────────────────────────────────────────────────┐
│          COGNITIVE LOAD DETECTOR                              │
│                                                               │
│  Girdiler:                                                    │
│  • Mesaj uzunluğu (kısa=yoğun, uzun=rahat)                  │
│  • Yanıt süresi (hızlı kısa cevap = meşgul)                │
│  • Emoji/ton kullanımı (yoksa → ciddi/stresli)               │
│  • Saat (gece 3 = yorgun veya stresli)                       │
│  • Mesaj frekansı (patlama = acil, seyrek = rahat)           │
│  • İçerik (sorular = öğrenme modu, emirler = icraat modu)   │
│                                                               │
│  Çıktı: Kullanıcı Modu                                      │
│                                                               │
│  ┌──────────────────────────────────────────────┐            │
│  │ RAHAT MOD (casual)                            │            │
│  │ Tetik: Uzun mesajlar, emoji, sohbet tonu      │            │
│  │ AI davranışı:                                  │            │
│  │ • Samimi, espirili ton                        │            │
│  │ • Detaylı açıklamalar OK                      │            │
│  │ • Proaktif öneriler OK                        │            │
│  │ • Emoji kullanabilir                          │            │
│  ├──────────────────────────────────────────────┤            │
│  │ YOĞUN MOD (busy)                              │            │
│  │ Tetik: "tmm", "ok", kısa cevaplar             │            │
│  │ AI davranışı:                                  │            │
│  │ • Kısa, direkt sonuç                          │            │
│  │ • Sıfır emoji                                  │            │
│  │ • Gereksiz öneri yapma                        │            │
│  │ • "Yönetici özeti" modu                       │            │
│  ├──────────────────────────────────────────────┤            │
│  │ STRESLİ MOD (stressed)                        │            │
│  │ Tetik: Sert ton, hızlı ardışık mesaj, hata    │            │
│  │ AI davranışı:                                  │            │
│  │ • Sakin, empatik                              │            │
│  │ • Çözüm odaklı                               │            │
│  │ • Gereksiz soru sorma                         │            │
│  │ • "Hallederiz" yaklaşımı                      │            │
│  ├──────────────────────────────────────────────┤            │
│  │ ODAKLI MOD (focused / deep work)              │            │
│  │ Tetik: Tek konuda derin sorular               │            │
│  │ AI davranışı:                                  │            │
│  │ • Minimum interruption                        │            │
│  │ • Proaktif mesajları ertele                   │            │
│  │ • Sadece acil konularda bildir                │            │
│  │ • Deep dive cevapları                         │            │
│  └──────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────┘
```

---

## Asenkron, Parçalı İletişim

Chatbot modeli: Kullanıcı sorar → AI düşünür → Tek blok cevap verir → Sessizlik.
Yaşayan Varlık modeli: **İnsan gibi mesajlaşır.**

```
Kullanıcı: "Son 50 mailime bak, önemli olanları özetle"

CHATBOT:
  [30 saniye bekleme...]
  "İşte 50 mailinizin özeti: 1) ... 2) ... 3) ..."

YAŞAYAN VARLIK:
  AI: "Bakıyorum..." (anında)
  [arka planda çalışıyor]
  AI: "50 mail var, 7'si önemli görünüyor, detay çıkarıyorum..."
  [kullanıcı araya girebilir]
  Kullanıcı: "Sadece X şirketinden gelenler yeter"
  AI: "Tamam, sadece X şirketine bakıyorum..."
  AI: "X şirketinden 3 mail var:
       • Mülakat daveti — 28 Mart 14:00 (takvime ekledim)
       • Gerekli belgeler listesi — PDF ekte
       • HR'den hoş geldin maili
       İlk ikisi acil, üçüncü bilgilendirme."
```

**Asenkron pattern:**
```
IMMEDIATE_ACK    → "Bakıyorum..." (0-1 saniye)
PROGRESS_UPDATE  → "7 önemli mail buldum..." (işlem sırasında)
INTERRUPTIBLE    → Kullanıcı araya girerse pivot yap
FINAL_RESULT     → Sonuç + yapılan eylemler
```

---

## Kişilik Katmanı: Bot Değil, Varlık

```
YASAK İFADELER:                    DOĞRU İFADELER:
─────────────────                   ──────────────────
"Hatırlatayım mı?"                 "Hallettim."
"İster misiniz...?"                 "Şunu yaptım: ..."
"Şunları yapabilirim: 1,2,3"       [Yapar, sonra söyler]
"Yardımcı olabilir miyim?"         [Zaten yardım ediyor]
"Başka bir şey var mı?"            [Konuşma doğal akar]
"Size nasıl yardımcı olabilirim?"  [Bunu hiçbir zaman söylemez]
"Bir hata oluştu."                 "Bu olmadı, şöyle deniyorum..."

DOĞAL İFADELER (bağlama göre):
"Vay hızlıydın 😏"
"Fizik sınavın yarın, çalıştın mı bari?"
"3 gündür ortalarda yoksun, iyi misin?"
"Bu saatte mi çalışıyorsun? Yarın erken toplantın var."
"X şirketinden mail geldi! Aç bak, olumlu gibi."
"Bugün hiç durmadın, helal olsun. Biraz dinlen."
```

---

## Mega Akış: Bir Gün Yaşayan Varlık Olarak

```
07:00  Consciousness Loop tetiklenir
       → Kullanıcı genelde 07:30'da uyanır (profil)
       → Bugün takvimde 3 toplantı var
       → Hava yağmurlu
       → Önemli mail gelmiş gece
       → Karar: 07:30'da sabah mesajı at

07:30  AI: "Günaydın. Bugün yağmur var, şemsiye al.
       3 toplantın var, ilki 09:00'da Ali ile.
       Gece X şirketinden mail gelmiş — mülakat daveti,
       takvime ekledim (28 Mart 14:00). Cevap yazmamı
       ister misin?"

09:50  Toplantı 10 dk önce bitti (takvimden bilir)
       AI sessiz. Not alır: "Toplantı bitti"

10:30  Consciousness Loop: Kullanıcı 40 dk sessiz.
       Normal — toplantı sonrası mola olabilir.
       → SESSIZ_KAL

12:00  AI: "X şirketinin mailine hala cevap yazmadın.
       Yarına bırakırsan geç kalabilirsin."

12:05  Kullanıcı: "tmm hemen yazıyorum"
       AI: Cognitive Load = YOĞUN (kısa cevap, "tmm")
       → Kısa modda kal, gereksiz ekleme yapma

12:08  Kullanıcı: "yazdım"
       AI: "Güzel." (kısa mod — uzun övgü yok)

15:00  Consciousness Loop: Sınav 3 gün sonra.
       3 gündür çalışma sorusu sorulmadı.
       → NOT_AL_BEKLE (saat 18'de bir sor)

18:00  AI: "Kimya sınavın pazartesi. Nerdesin hazırlıkta?
       İstersen bu akşam konu taraması yapabiliriz."

23:30  Kullanıcı inaktif. Normal uyku saati.
       → UYKU FAZI BAŞLAT (bkz. dosya 06)
```

---

## Teknik Uygulama

### Consciousness Loop Engine

```typescript
class ConsciousnessLoop {
  private interval: number = 60_000; // 1 dakika default
  private adaptiveInterval: number;  // kullanıcı durumuna göre

  async tick() {
    const worldState = await this.gatherWorldState();
    const userState = await this.getUserState();
    const activeTriggers = await this.getActiveTriggers();
    const pendingNotes = await this.getPendingNotes();

    // LLM'e tek bir "düşünce" promptu gönder
    const decision = await this.llm.think({
      system: CONSCIOUSNESS_SYSTEM_PROMPT,
      context: {
        currentTime: now(),
        worldState,        // hava, mail, takvim, haberler
        userProfile: userState.deepMemory,
        userBehavior: userState.recentPatterns,
        cognitiveLoad: userState.currentLoad,
        activeTriggers,    // AI'ın daha önce kurduğu trigger'lar
        pendingNotes,      // önceki tick'lerde alınan notlar
        timeSinceLastMessage: userState.silenceDuration,
      }
    });

    // Karar uygula
    switch (decision.action) {
      case 'SEND_MESSAGE':
        await this.sendToUser(decision.message, decision.urgency);
        break;
      case 'CREATE_TRIGGER':
        await this.compileTrigger(decision.triggerSpec);
        break;
      case 'TAKE_NOTE':
        await this.saveNote(decision.note); // sonraki tick'te değerlendir
        break;
      case 'STAY_SILENT':
        break; // hiçbir şey yapma
      case 'ENTER_SLEEP':
        await this.startSleepPhase(); // bkz. dosya 06
        break;
    }

    // Adaptive interval: acil durumlarda daha sık, sakin zamanlarda seyrek
    this.adaptiveInterval = this.calculateInterval(decision.urgencyLevel);
  }

  private calculateInterval(urgency: number): number {
    // Yüksek aciliyet → 30 saniye, düşük → 5 dakika
    return Math.max(30_000, Math.min(300_000, 300_000 / urgency));
  }
}
```

### Dynamic Trigger Compiler

```typescript
interface CompiledTrigger {
  id: string;
  source: 'conversation' | 'consciousness_loop' | 'sleep_phase';
  created_at: Date;
  expires_at?: Date;                    // opsiyonel son kullanma
  logic: {
    type: 'cron' | 'event' | 'condition';
    schedule?: string;                  // cron expression
    event?: string;                     // 'email_received', 'calendar_changed'
    condition?: string;                 // doğal dilde koşul
  };
  action: {
    type: 'notify' | 'add_calendar' | 'run_research' | 'execute_tool';
    payload: any;
  };
  context: string;                      // neden oluşturuldu
  reversible: boolean;
  auto_approved: boolean;               // reversible ise true
  fire_count: number;                   // kaç kez tetiklendi
  user_feedback?: 'positive' | 'negative' | 'dismissed';
}
```

---

## Öz-Evrim: Trigger'lar Öğrenir

```
Trigger oluşturuldu → Tetiklendi → Kullanıcı tepkisi →

Tepki: Kullanıcı ilgiyle okudu → fire_count++, önem artır
Tepki: Kullanıcı "tamam" dedi → nötr, devam
Tepki: Kullanıcı görmezden geldi → önem azalt
Tepki: Kullanıcı "bunu kapatı" dedi → trigger sil + öğren
Tepki: Kullanıcı "daha sık hatırlat" → sıklık artır

3 kez üst üste görmezden gelinen trigger otomatik deaktive olur.
Kullanıcı tepki vermeden kapattığı bildirimler "düşük değer" olarak işaretlenir.
```

Bu dosya, dosya 02 (Act-First karar motoru), dosya 03 (Cloud altyapısı) ve dosya 06 (Deep Memory + Uyku Fazı) ile entegre çalışır. Mega mimari için bkz. `00-mega-mimari.md`.
