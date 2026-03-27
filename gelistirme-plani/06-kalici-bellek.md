# 06 — Deep Memory + Uyku Fazı: Asla Unutmayan, Gece Düşünen Beyin

> Eski vizyon: "Vektör DB ile kalıcı bellek, Mem0 entegrasyonu"
> Yeni vizyon: **"İnsan beynini taklit eden 4 katmanlı bellek + REM uyku fazında konsolidasyon + gece araştırma + çöp toplama"**

---

## Paradigma Değişimi

```
ESKİ MODEL (Passive Memory):          YENİ MODEL (Living Brain):
────────────────────────────           ─────────────────────────────
Kullanıcı "hatırla" derse sakla       Her mesajdan otomatik çıkarım
Gateway restart = kayıp                Crash-proof, asla kayıp yok
Düz vektör arama                       Vektör + Graf + Zaman katmanı
Bellek statik                          Bellek evrilir, çürür, güçlenir
Gece = kapalı                          Gece = REM fazı (konsolidasyon)
Token limiti = compaction kaybı        Akıllı katmanlama, kayıp yok
```

---

## Beyin Mimarisi: 4 Katmanlı Yaşayan Bellek

```
┌──────────────────────────────────────────────────────────┐
│                    THE LIVING BRAIN                        │
│                                                           │
│  ╔══════════════════════════════════════════════╗         │
│  ║  CORTEX (Her zaman context'te — ~2KB)        ║         │
│  ║                                               ║         │
│  ║  Kim: Manas, 22, bilgisayar müh. öğrencisi  ║         │
│  ║  Kişilik: Samimi, kısa cevap sever,          ║         │
│  ║           emoji ok, espri sever               ║         │
│  ║  Şu an: Sınav haftası, stresli               ║         │
│  ║  Aktif hedefler:                              ║         │
│  ║    - Fizik sınavı (18 Nisan)                 ║         │
│  ║    - X şirketi staj başvurusu bekliyor       ║         │
│  ║    - Günde 2L su hedefi                       ║         │
│  ║  Ton: Şu an YOĞUN mod (kısa cevaplar)       ║         │
│  ║                                               ║         │
│  ║  [Bu bölüm HER mesajda LLM context'ine       ║         │
│  ║   enjekte edilir. Sürekli güncellenir.]       ║         │
│  ╚══════════════════════════════════════════════╝         │
│                         │                                 │
│                         ▼                                 │
│  ┌──────────────────────────────────────────────┐        │
│  │  HIPPOCAMPUS (Yakın bellek — RAG ile erişim)  │        │
│  │  Son 30 günün etkileşimleri                   │        │
│  │                                                │        │
│  │  Depolama: LanceDB (vektör) + Kuzu (graf)    │        │
│  │  Erişim: Her mesajda semantic search          │        │
│  │  Boyut: ~50KB - 500KB                         │        │
│  │                                                │        │
│  │  Örnekler:                                     │        │
│  │  • "Dün React projesi hakkında konuştuk"      │        │
│  │  • "Geçen hafta Ali'yle toplantı sorunuydu"   │        │
│  │  • "3 gün önce fizik formülleri sordu"        │        │
│  │                                                │        │
│  │  [Consciousness Loop her tick'te buradan      │        │
│  │   yaklaşan deadline'ları ve bekleyen          │        │
│  │   görevleri kontrol eder]                     │        │
│  └──────────────────────────────────────────────┘        │
│                         │                                 │
│                         ▼                                 │
│  ┌──────────────────────────────────────────────┐        │
│  │  NEOCORTEX (Uzun vadeli bilgi — derin arama)  │        │
│  │  Damıtılmış gerçekler ve kalıplar             │        │
│  │                                                │        │
│  │  • "TypeScript'i JavaScript'e tercih eder"    │        │
│  │  • "Sabahçı — genelde 07:30'da uyanır"       │        │
│  │  • "Ali: en yakın arkadaş, aynı bölüm"       │        │
│  │  • "Prof. Ayşe: danışman, resmi hitap"       │        │
│  │  • "Spora Mart 2026'da başladı"              │        │
│  │                                                │        │
│  │  Depolama: LanceDB + Knowledge Graph (Kuzu)  │        │
│  │  Erişim: Hippocampus yetersiz kaldığında      │        │
│  │  Boyut: Sınırsız                              │        │
│  └──────────────────────────────────────────────┘        │
│                         │                                 │
│                         ▼                                 │
│  ┌──────────────────────────────────────────────┐        │
│  │  BEHAVIORAL MODEL (Davranış modeli)           │        │
│  │  Kalıplar, rutinler, anomali referansları     │        │
│  │                                                │        │
│  │  Rutinler:                                     │        │
│  │  • Hafta içi: 07:30 uyanış, 08-17 ders       │        │
│  │  • PzSaSa: Spor 18:00-19:30                  │        │
│  │  • Cuma akşam: Sosyal aktivite                │        │
│  │  • Mesaj paterni: Ortalama 15 msg/gün         │        │
│  │  • Yanıt süresi: Genelde 2-5dk                │        │
│  │                                                │        │
│  │  Ton profili:                                  │        │
│  │  • Normal: Samimi, emoji kullanır             │        │
│  │  • Stresli: Kısa, emoji yok                   │        │
│  │  • Heyecanlı: Uzun, çok emoji                 │        │
│  │                                                │        │
│  │  İlgi evrimi:                                  │        │
│  │  • React: ████████ (azalan)                   │        │
│  │  • Rust:  ████████████ (artan)                │        │
│  │  • AI/ML: ██████████████ (yeni, hızlı artış)  │        │
│  │                                                │        │
│  │  [Consciousness Loop anomali tespiti için      │        │
│  │   bu modeli referans alır]                    │        │
│  └──────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────┘
```

---

## Otomatik Bellek Çıkarımı (Her Mesajda)

Kullanıcı "hatırla" demez. AI **her mesajdan** potansiyel bellek çıkarır.

```
┌──────────────────────────────────────────────────────────┐
│            MEMORY EXTRACTION PIPELINE                     │
│            (Her konuşma turu sonunda çalışır)             │
│                                                           │
│  Kullanıcı mesajı: "Ali'yle yarın 3'te buluşacağız,     │
│  proje sunumu için hazırlanmamız lazım"                   │
│                                                           │
│  LLM Extraction (arka plan, kullanıcıya görünmez):       │
│                                                           │
│  Çıkarılan bilgiler:                                      │
│  ├── EVENT: Ali ile buluşma, yarın 15:00                 │
│  │   → Takvime ekle (Act-First, skor: 2)                │
│  │   → Hatırlatma kur: yarın 14:30                       │
│  ├── RELATIONSHIP: Ali = proje arkadaşı                  │
│  │   → Knowledge Graph güncelle                          │
│  ├── TASK: Proje sunumu hazırlığı                        │
│  │   → Aktif görevlere ekle                              │
│  └── IMPLICIT: Yarın yoğun olacak                        │
│      → Behavioral model notu: yarın deep work modu       │
│                                                           │
│  Cortex güncellenir:                                      │
│  "Aktif hedefler" → + "Proje sunumu (Ali ile, yarın)"   │
└──────────────────────────────────────────────────────────┘
```

### Ne Çıkarılır, Ne Çıkarılmaz

```
ÇIKAR (belleğe kaydet):
├── İsimler, ilişkiler, roller
├── Tarihler, deadline'lar, planlar
├── Tercihler, alışkanlıklar
├── Hedefler, projeler
├── Duygusal bağlam (stresli, mutlu)
├── Teknik tercihler
└── Rutinler, kalıplar

ÇIKARMA (geçici, bellekte tutma):
├── Selamlaşmalar ("merhaba", "naber")
├── Onaylar ("tamam", "ok")
├── Geçici teknik sorular (cevaplandı, bitti)
├── Debugging oturumları (çözüldü)
└── Anlık duygusal tepkiler (geçici sinir)
```

---

## ZIRH #4: Chrono-Spatial Memory (Zaman Körlüğü Koruması)

**Problem:** Vektör arama (semantic search) zamanı anlamaz. "Geçen hafta ne konuştuk?" dediğinde, 6 ay önceki semantik olarak benzer bir kaydı getirebilir. AI zamanda kaybolur.

**Çözüm:** Her bellek parçasına **zaman metadata'sı** ekle. Sorgu sırasında semantic search + temporal filter birlikte çalışsın.

### Zaman Damgalı Bellek Yapısı

```typescript
interface TemporalMemory {
  id: string;
  content: string;                    // Doğal dilde bellek
  embedding: Float32Array;            // Vektör (semantic search için)

  // CHRONO-SPATIAL METADATA
  temporal: {
    created_at: Date;                 // Oluşturulma zamanı
    last_accessed: Date;              // Son erişim
    refers_to_date?: Date;            // Bahsettiği tarih ("yarın" → mutlak tarih)
    refers_to_range?: {               // Bahsettiği dönem
      start: Date;
      end: Date;
    };
    day_of_week?: number;             // 0=Pz, 6=Ct (rutin tespiti için)
    time_of_day?: 'morning' | 'afternoon' | 'evening' | 'night';
    is_recurring?: boolean;           // "Her pazartesi" gibi tekrarlı mı?
    recurrence_pattern?: string;      // Cron veya RRULE formatı
  };

  // Mevcut alanlar
  importance: number;
  access_count: number;
  type: 'episodic' | 'semantic' | 'procedural' | 'emotional';
  tags: string[];
}
```

### Temporal Query Engine

```
Kullanıcı: "Geçen hafta Ali ile ne konuştuk?"

ESKI YÖNTEM (sadece semantic search):
├── "Ali ile konuşma" embedding'i oluştur
├── Tüm belleklerde cosine similarity ara
├── Sonuç: 6 ay önceki Ali konuşması da gelir ❌ (zaman körlüğü)
└── AI kafası karışır

YENİ YÖNTEM (semantic + temporal filter):
├── "Ali ile konuşma" embedding'i oluştur
├── Temporal parse: "geçen hafta" → 2026-03-20 ~ 2026-03-27
├── LanceDB sorgusu:
│   SELECT * FROM memories
│   WHERE vector_distance(embedding, query_vec) < 0.5
│     AND created_at BETWEEN '2026-03-20' AND '2026-03-27'
│     AND content LIKE '%Ali%'     -- opsiyonel entity filter
│   ORDER BY vector_distance ASC
│   LIMIT 10
├── Sonuç: Sadece geçen haftanın Ali konuşmaları ✅
└── AI net ve doğru cevap verir
```

### Doğal Dil → Zaman Aralığı Çözücü

```typescript
class TemporalResolver {
  resolve(query: string, referenceDate: Date = new Date()): TimeRange | null {
    const patterns: Record<string, () => TimeRange> = {
      'bugün':        () => todayRange(referenceDate),
      'dün':          () => yesterdayRange(referenceDate),
      'geçen hafta':  () => lastWeekRange(referenceDate),
      'bu hafta':     () => thisWeekRange(referenceDate),
      'geçen ay':     () => lastMonthRange(referenceDate),
      'bu ay':        () => thisMonthRange(referenceDate),
      'salı günü':    () => lastSpecificDay(referenceDate, 2), // 2=Salı
      'geçen salı':   () => lastSpecificDay(referenceDate, 2),
      'son 3 gün':    () => lastNDays(referenceDate, 3),
      'son 1 hafta':  () => lastNDays(referenceDate, 7),
      'mart ayında':  () => specificMonth(referenceDate, 3),
      'ocaktan beri': () => sinceMonth(referenceDate, 1),
    };

    for (const [pattern, resolver] of Object.entries(patterns)) {
      if (query.toLowerCase().includes(pattern)) {
        return resolver();
      }
    }

    // Regex: "15 Mart", "2026-03-15" gibi mutlak tarihler
    const absoluteDate = this.parseAbsoluteDate(query);
    if (absoluteDate) return { start: absoluteDate, end: absoluteDate };

    return null; // Zamansal referans yok → sadece semantic search
  }
}
```

### Memory Extraction'da Zaman Çözümleme

```
Kullanıcı: "Ali'yle yarın 3'te buluşacağız"

Extraction sonucu:
{
  content: "Ali ile buluşma, proje sunumu için",
  temporal: {
    created_at: "2026-03-27T14:00:00Z",
    refers_to_date: "2026-03-28T15:00:00Z",   // "yarın 3'te" → mutlak
    day_of_week: 6,                             // Cumartesi
    time_of_day: "afternoon"
  }
}

NEDEN ÖNEMLİ:
"yarın" → 3 ay sonra "yarın" hala "yarın" mı?
HAYIR. "yarın" kaydedilirken mutlak tarihe çevrilir: "2026-03-28"
Böylece 3 ay sonra "Mart sonunda ne yaptık?" diye sorduğunda
doğru tarih çıkar.
```

### Kuzu (Graph DB) ile Zaman Noktaları

```
Knowledge Graph'a TIME NODE'lar eklenir:

      ┌──────────┐
      │ 2026-W13 │ (Hafta 13, Mart sonu)
      │ (TimeNode)│
      └─────┬────┘
            │ happened_during
      ┌─────┴──────────────┐
      │                    │
┌─────▼────┐        ┌─────▼────┐
│Ali ile    │        │Fizik     │
│buluşma    │        │sınavı   │
│28 Mart    │        │çalışması│
└──────────┘        └──────────┘

Kuzu sorgusu:
MATCH (e:Event)-[:happened_during]->(t:TimeNode)
WHERE t.week = 13 AND t.year = 2026
RETURN e

→ O haftanın tüm olayları zaman sırasıyla
```

### LanceDB Temporal Index

```sql
-- LanceDB'de temporal metadata index
CREATE INDEX idx_temporal ON memories (created_at);
CREATE INDEX idx_refers ON memories (refers_to_date);

-- Composite query: semantic + temporal
SELECT *,
  vector_distance(embedding, ?) as semantic_score,
  ABS(DATEDIFF(created_at, ?)) as temporal_distance
FROM memories
WHERE created_at BETWEEN ? AND ?              -- temporal filter
ORDER BY (0.6 * semantic_score +              -- %60 anlam
          0.4 * (1.0 / (1 + temporal_distance))) -- %40 zaman yakınlığı
LIMIT 10;
```

**Scoring formülü güncellemesi:**
```
ESKİ:  skor = α×benzerlik + β×güncellik + γ×önem + δ×erişim
YENİ:  skor = α×benzerlik + β×güncellik + γ×önem + δ×erişim
             + ε×temporal_relevance
             // temporal_relevance: sorgu bir zaman aralığı içeriyorsa
             // o aralıktaki belleklere bonus puan ver
```

---

## REM Uyku Fazı (Sleep Phase)

Kullanıcı uyuduğunda asistan **uyumaz** — beyin gibi **konsolide eder**.

```
┌──────────────────────────────────────────────────────────┐
│                    REM SLEEP PHASE                         │
│            (Kullanıcı inaktif, gece saatleri)             │
│                                                           │
│  Tetikleme:                                               │
│  • Kullanıcının normal uyku saatinden 1 saat sonra       │
│  • VEYA 4+ saat inaktivite                               │
│                                                           │
│  ┌──────────────────────────────────────────────┐        │
│  │ FAZA 1: ÇÖP TOPLAMA (Garbage Collection)     │        │
│  │                                                │        │
│  │ Bugünkü konuşmaları tara:                     │        │
│  │ • Önemli bilgileri çıkar → Hippocampus'a kaydet│       │
│  │ • Geçici/önemsiz mesajları sil                │        │
│  │ • Token tasarrufu: ~%40-60 context küçülmesi  │        │
│  │                                                │        │
│  │ Önce:  [selamlaşma][soru][cevap][debug][debug] │       │
│  │        [debug][teşekkür][yeni konu][soru][cevap│       │
│  │ Sonra: [önemli bilgi özeti][çıkarılan gerçekler│       │
│  │        [güncellenen profil]                    │        │
│  └──────────────────────────────────────────────┘        │
│                                                           │
│  ┌──────────────────────────────────────────────┐        │
│  │ FAZ 2: KONSOLİDASYON (Memory Consolidation)  │        │
│  │                                                │        │
│  │ • Hippocampus'taki benzer bellek parçalarını   │        │
│  │   birleştir (dedup + merge)                   │        │
│  │ • Çok erişilen bellekleri güçlendir            │        │
│  │   (importance skor artır)                     │        │
│  │ • 30 gündür erişilmeyen bellekleri              │        │
│  │   Neocortex'e taşı (arşivle)                  │        │
│  │ • Behavioral Model'i güncelle                 │        │
│  │   (yeni kalıplar tespit et)                   │        │
│  └──────────────────────────────────────────────┘        │
│                                                           │
│  ┌──────────────────────────────────────────────┐        │
│  │ FAZ 3: YANSIMA (Reflection)                   │        │
│  │                                                │        │
│  │ LLM'e sor: "Son 7 günün belleklerinden         │        │
│  │ üst düzey çıkarımlar yap"                     │        │
│  │                                                │        │
│  │ Çıkarımlar:                                    │        │
│  │ • "Kullanıcı React'tan Rust'a geçiş yapıyor"  │        │
│  │ • "Staj konusunda endişeli — sık soruyor"      │        │
│  │ • "Ali ile proje yoğunlaşıyor"                │        │
│  │ • "Spor rutini oturdu, su içme alışkanlığı     │        │
│  │   henüz tam yerleşmedi"                        │        │
│  │                                                │        │
│  │ → Neocortex'e üst düzey insight olarak kaydet  │        │
│  └──────────────────────────────────────────────┘        │
│                                                           │
│  ┌──────────────────────────────────────────────┐        │
│  │ FAZ 4: GECE ARAŞTIRMASI (Night Research)      │        │
│  │                                                │        │
│  │ Kullanıcının takıldığı / merak ettiği konuları│        │
│  │ gece arka planda araştır.                     │        │
│  │                                                │        │
│  │ Tetik örnekleri:                               │        │
│  │ • "Fizik sınavı var ama formül sorusu cevap-   │        │
│  │   lanmamış kaldı" → Formül listesi hazırla    │        │
│  │ • "Rust öğrenmek istiyor" → Kaynak listesi    │        │
│  │   derle                                        │        │
│  │ • "X şirketine başvuru yaptı" → Şirket hakkında│       │
│  │   bilgi topla, mülakat soruları araştır        │        │
│  │                                                │        │
│  │ Sabah mesajı olarak sun:                       │        │
│  │ "Günaydın! Gece şunları araştırdım:            │        │
│  │  • Fizik formül listeni hazırladım              │        │
│  │  • X şirketinin mülakat tarzı hakkında          │        │
│  │    bilgi buldum, ister misin?"                  │        │
│  └──────────────────────────────────────────────┘        │
│                                                           │
│  ┌──────────────────────────────────────────────┐        │
│  │ FAZ 5: CORTEX GÜNCELLEMESİ                   │        │
│  │                                                │        │
│  │ Tüm fazların sonuçlarıyla Cortex'i yeniden    │        │
│  │ derle. Sabah ilk tick'te güncel profil hazır.  │        │
│  │                                                │        │
│  │ Cortex (sabah güncellenmiş):                   │        │
│  │ "Manas, öğrenci, sınav haftası.                │        │
│  │  Fizik sınavı 3 gün sonra — hazırlık takibi.  │        │
│  │  X şirketi başvurusu bekliyor — hassas konu.   │        │
│  │  Rust'a ilgisi artıyor — kaynak önerilebilir.  │        │
│  │  Dünkü ton: yoğun/stresli — bugün dikkatli ol."│       │
│  └──────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────┘
```

---

## Knowledge Graph: İlişki Haritası

```
                    ┌─────────┐
            ┌──────│  Manas   │──────┐
            │      └────┬────┘      │
            │           │            │
     works_with    studies        interested_in
            │           │            │
            ▼           ▼            ▼
       ┌────────┐ ┌─────────┐ ┌─────────┐
       │  Ali   │ │ BİL.MÜH.│ │  Rust   │
       │(arkadaş│ │(Üniv. X)│ │(yeni    │
       │ proje  │ │         │ │ artan)  │
       │ ortağı)│ │         │ │         │
       └────────┘ └────┬────┘ └─────────┘
                       │
                   teaches
                       │
                       ▼
                  ┌─────────┐
                  │Prof.Ayşe│
                  │(danışman│
                  │ resmi   │
                  │ hitap)  │
                  └─────────┘

Kuzu Graph Query örnekleri:
• "Manas'ın proje arkadaşları kim?" → Ali
• "Prof. Ayşe ile ilişki ne?" → danışman, resmi hitap
• "Artan ilgi alanları?" → Rust, AI/ML
• "Spor rutini ne?" → PzSaSa 18:00
```

---

## Bellek Skoru ve Çürüme

```
Her bellek parçasının skoru:

skor = α × benzerlik     // Şu anki bağlamla ne kadar ilgili
     + β × güncellik     // Ne kadar yeni (exponential decay)
     + γ × önem          // LLM'in atadığı önem (1-10)
     + δ × erişim_sıklığı // Kaç kez hatırlandı

Çürüme kuralları:
├── 7 gün erişilmez → skor %50 azalır
├── 30 gün erişilmez → Hippocampus'tan Neocortex'e taşınır
├── 90 gün erişilmez → arşivlenir (ama silinmez)
├── Kullanıcı "unut" derse → kalıcı silinir
├── 3 kez ardışık erişilirse → "güçlü bellek" olur
└── REM fazında güçlendirilirse → çürüme yavaşlar

Güçlenme kuralları:
├── Kullanıcı aynı konudan tekrar bahsederse → skor artar
├── AI bu belleği kullanıp olumlu tepki alırsa → skor artar
├── REM fazında reflection'da referans verilirse → skor artar
└── Consciousness Loop'ta tetiklenirse → erişim_sıklığı++
```

---

## Crash-Proof Persistence

```
Her yazma işlemi 2 aşamalı:

1. Write-Ahead Log (WAL):
   Bellek değişikliği önce WAL'a yazılır.
   Crash olursa WAL'dan recover edilir.

2. Main Store:
   WAL başarılıysa ana depoya commit edilir.

Cloud ortamda:
├── PersistentVolume → Container ölse bile veri kalır
├── LanceDB WAL mode → Crash-safe by design
├── Kuzu → ACID transactions
├── Periodic backup → S3/MinIO'ya (saatlik)
└── Point-in-time recovery → Herhangi ana geri dönüş
```

---

## Gizlilik: Kullanıcı Kontrolünde

```
┌──────────────────────────────────────────────────────────┐
│  Bellek Ayarları                                          │
│                                                           │
│  ┌─────────────────────────────────────────────┐         │
│  │ Bellekte neler var?              [Tümünü Gör]│         │
│  │                                              │         │
│  │ Son kaydedilenler:                           │         │
│  │ • "TypeScript tercih eder"         [🗑️ Sil] │         │
│  │ • "Ali: proje arkadaşı"           [🗑️ Sil] │         │
│  │ • "Fizik sınavı 18 Nisan"         [🗑️ Sil] │         │
│  │ • "Günde 2L su hedefi"            [🗑️ Sil] │         │
│  └─────────────────────────────────────────────┘         │
│                                                           │
│  ☑ Konuşmalardan otomatik bilgi çıkar                   │
│  ☑ Gece konsolidasyonu (REM fazı)                       │
│  ☐ Gece araştırması (açıkça izin verilirse)             │
│                                                           │
│  [🧹 Tüm Belleği Sil — "Beni Unut"]                    │
│                                                           │
│  [📤 Belleğimi Dışa Aktar (JSON)]                       │
│  [📥 Bellek İçe Aktar]                                   │
└──────────────────────────────────────────────────────────┘
```

**"Beni Unut" butonu:** Tek tıkla tüm bellek silinir. GDPR uyumlu.
**Dışa aktarım:** Kullanıcı belleğini JSON olarak indirebilir — platform lock-in yok.

---

## Teknik Stack

| Bileşen | Teknoloji | Neden |
|---------|-----------|-------|
| Vektör Depo | LanceDB (embedded) | Crash-safe, sunucu gereksiz, hızlı |
| Knowledge Graph | Kuzu (embedded) | SQLite kadar hafif, Cypher query |
| Embedding (Cloud) | BGE-M3 (çok dilli) | Cross-lingual retrieval |
| Embedding (Yerel) | nomic-embed-text (ONNX) | Gizlilik, düşük latency |
| Cortex Store | JSON/YAML (bellekte) | Her mesajda hızlı erişim |
| WAL | SQLite WAL mode | Crash-proof |
| Backup | S3/MinIO | Saatlik otomatik yedekleme |
| Extraction LLM | Ucuz model (Haiku/Flash) | Maliyet optimize |

Bu dosya, dosya 01 (Consciousness Loop → bellek erişimi), dosya 02 (encryption + gizlilik) ve dosya 04 (LLM maliyet → extraction maliyeti) ile entegre çalışır.
