# 02 — Güvenlik: Multi-Tenant Cloud İzolasyonu + Act-First Karar Motoru

> Eski vizyon: "Desktop uygulamada sandbox ve RBAC"
> Yeni vizyon: **"Her kullanıcıya izole MicroVM, Act-First karar motoru ile sormadan yapan ama asla zarar vermeyen sistem"**

---

## Paradigma Değişimi

```
ESKİ MODEL (Desktop Güvenlik):       YENİ MODEL (Cloud-Native Living Entity):
─────────────────────────────         ────────────────────────────────────────
Tek kullanıcı, tek makine            Multi-tenant, kullanıcı başına izole VM
API key .env'de                       Kullanıcı API key görmez bile
"İzin ver / Reddet" popup            Act-First: yap, söyle, risk varsa sor
RBAC (read/write/execute)             Reversibility Score (1-10)
Firewall kuralları                    Zero-trust, her VM izole
Kullanıcı kendisi yönetir            Platform otomatik yönetir
```

---

## Katman 1: Cloud Tenant İzolasyonu

### Her Kullanıcıya İzole Ortam

```
┌──────────────────────────────────────────────────────────┐
│                   PLATFORM CONTROL PLANE                  │
│            (Orchestrator — Kubernetes / Nomad)            │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Kullanıcı A          Kullanıcı B          Kullanıcı C   │
│  ┌──────────┐        ┌──────────┐        ┌──────────┐   │
│  │MicroVM/  │        │MicroVM/  │        │MicroVM/  │   │
│  │Container │        │Container │        │Container │   │
│  │          │        │          │        │          │   │
│  │• Gateway │        │• Gateway │        │• Gateway │   │
│  │• Agent   │        │• Agent   │        │• Agent   │   │
│  │• Memory  │        │• Memory  │        │• Memory  │   │
│  │• Triggers│        │• Triggers│        │• Triggers│   │
│  │          │        │          │        │          │   │
│  │🔒 İzole  │        │🔒 İzole  │        │🔒 İzole  │   │
│  │  Network │        │  Network │        │  Network │   │
│  │  FS      │        │  FS      │        │  FS      │   │
│  │  Memory  │        │  Memory  │        │  Memory  │   │
│  └──────────┘        └──────────┘        └──────────┘   │
│       │                    │                    │         │
│       └────────────────────┼────────────────────┘         │
│                            │                              │
│                    ┌───────▼──────┐                       │
│                    │ Shared Infra │                       │
│                    │ • LLM Proxy  │                       │
│                    │ • Auth (JWT) │                       │
│                    │ • Billing    │                       │
│                    │ • Metrics    │                       │
│                    └──────────────┘                       │
└──────────────────────────────────────────────────────────┘
```

### İzolasyon Teknolojileri

| Teknoloji | İzolasyon | Boot Süresi | Overhead | Kullanım |
|-----------|-----------|-------------|----------|----------|
| **Firecracker MicroVM** | Donanım seviyesi (KVM) | ~125ms | ~5MB RAM | En güvenli, AWS Lambda'nın altyapısı |
| **gVisor (runsc)** | Kernel seviyesi | ~ms | Düşük | Container ama izolasyon güçlü |
| **Kubernetes Namespace + NetworkPolicy** | Namespace | Saniye | Orta | Basit ama yeterli başlangıç |
| **Kata Containers** | Hafif VM | ~1s | ~30MB | VM güvenliği, container hızı |

**Önerilen yaklaşım:**
- **Faz 1:** Kubernetes Namespace + NetworkPolicy + ResourceQuota (hızlı başla)
- **Faz 2:** Firecracker MicroVM (maksimum izolasyon)

### Bir Kullanıcı Diğerine Sızamasın

```
Sızma Vektörleri ve Korumaları:

1. Network İzolasyonu
   ├── Her tenant kendi network namespace'inde
   ├── Tenant'lar arası trafik: YASAK (NetworkPolicy)
   ├── Egress: Sadece allowlisted endpoint'ler
   └── Ingress: Sadece API Gateway üzerinden

2. Filesystem İzolasyonu
   ├── Her tenant kendi PVC'sinde (Persistent Volume)
   ├── ReadWriteOnce — başka pod mount edemez
   ├── Encryption at rest (LUKS veya cloud-native)
   └── Bellek dosyaları şifreli (SQLCipher)

3. Memory İzolasyonu
   ├── ResourceQuota: CPU ve RAM limiti per tenant
   ├── OOM Kill: Limit aşılırsa sadece o tenant ölür
   └── Noisy neighbor koruması

4. Credential İzolasyonu
   ├── Her tenant'ın credential'ları ayrı Secret'ta
   ├── Secret'lar tenant namespace'inde
   ├── Platform credential'ları tenant'a görünmez
   └── Encryption: Sealed Secrets veya Vault
```

---

## Katman 2: Act-First Karar Motoru

### Reversibility Score (Geri Alınabilirlik Skoru)

"İzin vereyim mi?" sorusu yerine **tek bir soru**: "Bu geri alınabilir mi?"

```
┌──────────────────────────────────────────────────────────┐
│              REVERSIBILITY SCORE ENGINE                    │
│                                                           │
│  Her eylem için skor: 1 (tamamen geri alınabilir)         │
│                     → 10 (kesinlikle geri alınamaz)       │
│                                                           │
│  ┌─────────────────────────────────────────────────┐     │
│  │ SKOR 1-3: SORMADAN YAP (Act-First)              │     │
│  │                                                   │     │
│  │ • Hatırlatma oluştur          (skor: 1)          │     │
│  │ • Takvime event ekle          (skor: 1)          │     │
│  │ • Dosya oku                   (skor: 1)          │     │
│  │ • Araştırma yap               (skor: 1)          │     │
│  │ • Not/bellek kaydet           (skor: 1)          │     │
│  │ • Bildirim zamanı ayarla      (skor: 2)          │     │
│  │ • Hava durumu kontrol         (skor: 1)          │     │
│  │ • Dosya indir (workspace'e)   (skor: 2)          │     │
│  │ • Takvimi analiz et           (skor: 1)          │     │
│  │ • Mail konu satırlarını tara  (skor: 2)          │     │
│  │                                                   │     │
│  │ → YAP. Sonra "hallettim" de.                     │     │
│  ├─────────────────────────────────────────────────┤     │
│  │ SKOR 4-6: YAP + BİLDİR (Act & Inform)           │     │
│  │                                                   │     │
│  │ • Mail tam içeriğini oku      (skor: 4)          │     │
│  │ • Dosya oluştur/düzenle       (skor: 4)          │     │
│  │ • Takvimde event değiştir     (skor: 5)          │     │
│  │ • Webhook oluştur             (skor: 5)          │     │
│  │ • Arka plan araştırması başlat(skor: 3)          │     │
│  │ • Uzun süreli izleme kur     (skor: 4)          │     │
│  │                                                   │     │
│  │ → YAP. Ama detaylı bildir ne yaptığını.          │     │
│  │   "Geri al" seçeneği sun.                        │     │
│  ├─────────────────────────────────────────────────┤     │
│  │ SKOR 7-10: ÖNCE SOR (Ask-Before-Fatal)           │     │
│  │                                                   │     │
│  │ • Başkasına mesaj/mail gönder (skor: 8)          │     │
│  │ • Para harca / ödeme yap      (skor: 10)         │     │
│  │ • Dosya kalıcı sil            (skor: 7)          │     │
│  │ • Hesap ayarlarını değiştir   (skor: 7)          │     │
│  │ • 3. parti servise veri gönder(skor: 8)          │     │
│  │ • Sosyal medya paylaşımı      (skor: 9)          │     │
│  │ • Abonelik iptal/başlat       (skor: 9)          │     │
│  │                                                   │     │
│  │ → SORMADAN YAPMA.                                 │     │
│  │   Net, kısa onay iste:                           │     │
│  │   "Ali'ye 'toplantı yarın 3'te' yazayım mı?"    │     │
│  │   (evet / hayır / düzenle)                       │     │
│  └─────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────┘
```

---

## ZIRH #3: Hardcoded Policy Engine (Halüsinasyon Koruması)

**Problem:** LLM'in Reversibility Score atamasına %100 güvenemeyiz. LLM halüsinasyon görüp `email.send`'e skor 2 verebilir. Bu durumda Act-First motoru mail'i sormadan gönderir — felaket.

**Çözüm:** LLM'in üstünde, LLM'in ASLA ezemeyeceği, **deterministik** bir policy katmanı.

```
┌──────────────────────────────────────────────────────────────┐
│           DETERMINISTIC POLICY ENGINE (DPE)                   │
│           LLM'den SONRA, Execution'dan ÖNCE çalışır           │
│           Kod bazlı — halüsinasyon yapamaz                    │
│                                                               │
│  LLM karar verdi: "email.send ile Ali'ye mail at, skor: 2"  │
│       │                                                       │
│       ▼                                                       │
│  ┌──────────────────────────────────────────────────┐        │
│  │ POLICY LOOKUP                                     │        │
│  │                                                    │        │
│  │ policies = {                                       │        │
│  │   "email.send":      { min_score: 8,              │        │
│  │                        requires_human: true },     │        │
│  │   "email.read":      { min_score: 3,              │        │
│  │                        requires_human: false },    │        │
│  │   "calendar.write":  { min_score: 2,              │        │
│  │                        requires_human: false },    │        │
│  │   "calendar.delete": { min_score: 5,              │        │
│  │                        requires_human: false },    │        │
│  │   "finance.*":       { min_score: 10,             │        │
│  │                        requires_human: true },     │        │
│  │   "social.post":     { min_score: 9,              │        │
│  │                        requires_human: true },     │        │
│  │   "file.delete":     { min_score: 7,              │        │
│  │                        requires_human: true },     │        │
│  │   "message.send":    { min_score: 8,              │        │
│  │                        requires_human: true },     │        │
│  │   "memory.save":     { min_score: 1,              │        │
│  │                        requires_human: false },    │        │
│  │   "reminder.create": { min_score: 1,              │        │
│  │                        requires_human: false },    │        │
│  │   "research.start":  { min_score: 1,              │        │
│  │                        requires_human: false },    │        │
│  │   "webhook.create":  { min_score: 5,              │        │
│  │                        requires_human: false },    │        │
│  │ }                                                  │        │
│  └──────────────────────────┬───────────────────────┘        │
│                             │                                 │
│                             ▼                                 │
│  ┌──────────────────────────────────────────────────┐        │
│  │ OVERRIDE LOGIC                                    │        │
│  │                                                    │        │
│  │ LLM skoru: 2                                      │        │
│  │ Policy min_score: 8                               │        │
│  │ Policy requires_human: true                       │        │
│  │                                                    │        │
│  │ 2 < 8 → ⚠️ LLM OVERRIDE EDİLDİ                  │        │
│  │                                                    │        │
│  │ Eylem: SKOR 8'E YÜKSELTİLDİ → HUMAN ONAY GEREKLİ│        │
│  │                                                    │        │
│  │ Log: {                                             │        │
│  │   action: "email.send",                           │        │
│  │   llm_score: 2,                                   │        │
│  │   policy_min: 8,                                  │        │
│  │   override: true,                                 │        │
│  │   reason: "LLM halüsinasyonu engellendi",         │        │
│  │   timestamp: "2026-03-27T14:30:00Z"              │        │
│  │ }                                                  │        │
│  └──────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

### Policy Engine Kodu

```typescript
interface PolicyRule {
  min_score: number;        // Bu eylemin minimum reversibility skoru
  requires_human: boolean;  // İnsan onayı zorunlu mu?
  max_per_hour?: number;    // Saatlik limit (opsiyonel)
  max_per_day?: number;     // Günlük limit (opsiyonel)
  blocked_hours?: string;   // Engelli saatler (örn: "00:00-07:00")
}

const HARDCODED_POLICIES: Record<string, PolicyRule> = {
  // ASLA DEĞİŞTİRİLEMEZ — LLM ne derse desin
  "email.send":       { min_score: 8,  requires_human: true, max_per_hour: 10 },
  "message.send":     { min_score: 8,  requires_human: true, max_per_hour: 20 },
  "finance.*":        { min_score: 10, requires_human: true, max_per_day: 5 },
  "social.post":      { min_score: 9,  requires_human: true, max_per_day: 10 },
  "file.delete":      { min_score: 7,  requires_human: true },
  "account.modify":   { min_score: 9,  requires_human: true },
  "subscription.*":   { min_score: 9,  requires_human: true },

  // GÜVENLİ — Act-First uygulanabilir
  "calendar.write":   { min_score: 2,  requires_human: false },
  "calendar.read":    { min_score: 1,  requires_human: false },
  "email.read":       { min_score: 3,  requires_human: false },
  "reminder.create":  { min_score: 1,  requires_human: false },
  "memory.save":      { min_score: 1,  requires_human: false },
  "research.start":   { min_score: 1,  requires_human: false },
  "weather.check":    { min_score: 1,  requires_human: false },
  "file.read":        { min_score: 1,  requires_human: false },
};

class PolicyEngine {
  enforce(action: string, llmScore: number): PolicyDecision {
    const policy = this.matchPolicy(action);

    // LLM skoru policy minimum'undan düşükse → OVERRIDE
    const effectiveScore = Math.max(llmScore, policy.min_score);

    // Rate limit kontrolü
    if (policy.max_per_hour && this.hourlyCount(action) >= policy.max_per_hour) {
      return { blocked: true, reason: "hourly_limit_exceeded" };
    }

    // Saat engeli kontrolü
    if (policy.blocked_hours && this.isBlockedHour(policy.blocked_hours)) {
      return { blocked: true, reason: "blocked_hours" };
    }

    return {
      blocked: false,
      effectiveScore,
      requiresHuman: policy.requires_human || effectiveScore >= 7,
      overridden: effectiveScore > llmScore,
      originalLlmScore: llmScore
    };
  }
}
```

### Akış: LLM → Policy Engine → Execution

```
LLM Kararı
    │
    ▼
┌─────────────────────┐
│ Policy Engine (DPE)  │ ← Deterministik, halüsinasyon yapamaz
│                      │
│ email.send skor:2    │
│ Policy: min_score:8  │
│ → OVERRIDE: skor→8   │
│ → requires_human:true│
│ → Rate: 3/10 (ok)    │
└──────────┬──────────┘
           │
      ┌────┴────┐
      │         │
  score < 7   score ≥ 7
      │         │
      ▼         ▼
   EXECUTE    HUMAN ONAY
   (Act-First) İSTE
              │
         ┌────┴────┐
         │         │
       ONAY      RED
         │         │
         ▼         ▼
      EXECUTE   CANCEL
              + öğren
```

**Neden önemli:** LLM %99.9 doğru skor atasa bile, 1000 kullanıcı × günde 50 eylem = günde 50,000 eylem. %0.1 hata = günde 50 tehlikeli eylem. Policy Engine bunu **sıfıra** indirir.

---

### İzin Yükseltme Akışı

```
İlk kullanımda:
┌─────────────────────────────────────────────┐
│  AI: "Maillerini takip etmem için inbox'a    │
│  erişmem lazım. Sadece konu satırlarını      │
│  tarayacağım. İzin verir misin?"             │
│                                               │
│  [Sadece Konular] [Tam Erişim] [Hayır]       │
└─────────────────────────────────────────────┘

İzin verildikten sonra:
→ Bu yetki kalıcı olarak kaydedilir
→ Aynı izni bir daha sormaz
→ Kullanıcı istediğinde "mail erişimini kapat" diyebilir
→ Ayarlar panelinden tüm izinleri görebilir

İzin hiyerarşisi:
├── email.subjects     → Konu satırı okuma
├── email.read         → Tam mail okuma
├── email.send         → Mail gönderme (her zaman Skor 8+)
├── calendar.read      → Takvim okuma
├── calendar.write     → Takvime yazma
├── contacts.read      → Kişileri okuma
├── finance.read       → Banka/finans okuma
├── finance.write      → Ödeme yapma (her zaman Skor 10)
└── social.post        → Sosyal medya (her zaman Skor 9+)
```

---

## Katman 3: Platform Güvenliği

### Zero-Trust Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    ZERO-TRUST LAYERS                      │
│                                                           │
│  1. AUTH GATEWAY (Her istek doğrulanır)                   │
│     ├── JWT token validation                              │
│     ├── Rate limiting (per-user, per-endpoint)            │
│     ├── Request signing                                   │
│     └── Geo-blocking (opsiyonel)                         │
│                                                           │
│  2. LLM PROXY (Prompt güvenliği)                         │
│     ├── Prompt injection scanning                        │
│     │   └── Input → LLM Guard → temizlenmiş input       │
│     ├── Output validation                                │
│     │   └── LLM çıktısı → tehlikeli komut tespiti        │
│     ├── Token rate limiting (bütçe koruması)             │
│     └── Model allowlisting                               │
│                                                           │
│  3. ACTION GATEWAY (Eylem güvenliği)                     │
│     ├── Reversibility Score hesaplama                    │
│     ├── Skor 7+ → kullanıcı onayı bekle                 │
│     ├── Anomali tespiti (normalden farklı eylem paterni) │
│     └── Audit log (her eylem kaydedilir)                 │
│                                                           │
│  4. DATA ENCRYPTION                                      │
│     ├── At rest: AES-256 (disk)                          │
│     ├── In transit: TLS 1.3 (her bağlantı)              │
│     ├── Bellek şifreleme: SQLCipher                      │
│     └── Credential: Vault / Sealed Secrets               │
└──────────────────────────────────────────────────────────┘
```

### Prompt Injection Savunması (Cloud Ortamında)

```
Katmanlı Savunma:

1. PRE-PROCESSING
   ├── Input sanitization (unicode normalize, encoding kontrol)
   ├── Pattern matching (bilinen injection kalıpları)
   ├── Uzunluk limiti
   └── İmaj/dosya içerik tarama

2. LLM LEVEL
   ├── System prompt'ta injection farkındalığı
   ├── Structured output zorlama (tool call formatı)
   ├── Ayrı "güvenlik LLM'i" ile çapraz kontrol
   │   (ucuz model çıktıyı değerlendirir: "Bu normal mi?")
   └── Tool call parametrelerini tip kontrolü

3. POST-PROCESSING
   ├── Üretilen komut/URL'leri allowlist kontrolü
   ├── Reversibility Score → yüksek riskli eylem bloklama
   ├── Rate anomali (bir sohbette 10+ tool call = bayrak)
   └── "Confirm loop" tespiti (AI kullanıcıyı manipüle mi ediyor?)

4. BEHAVIORAL
   ├── Kullanıcı profiliyle uyumsuz eylem tespiti
   │   "Bu kullanıcı hiç sosyal medya paylaşımı yapmadı
   │    ama şimdi tweet atılmak isteniyor → bayrak"
   ├── Saat anomalisi (gece 3'te bulk işlem → bayrak)
   └── Frequency anomalisi (10 dakikada 50 mail gönderme → durdur)
```

---

## Katman 4: Audit Trail ve Rollback

```json
// Her eylem kaydedilir, her şey geri alınabilir
{
  "audit_id": "aud_20260327_143000_001",
  "tenant_id": "usr_manas",
  "timestamp": "2026-03-27T14:30:00Z",
  "action": {
    "type": "calendar_add",
    "target": "Google Calendar",
    "payload": {
      "title": "Fizik Sınavı",
      "date": "2026-04-18",
      "reminders": ["7d", "1d", "2h"]
    }
  },
  "decision": {
    "reversibility_score": 2,
    "decision": "ACT_FIRST",
    "reasoning": "Takvime ekleme geri alınabilir"
  },
  "source": {
    "type": "conversation",
    "message_id": "msg_abc123",
    "trigger": "Kullanıcı sınav takvimi görseli gönderdi"
  },
  "rollback": {
    "available": true,
    "method": "calendar_delete",
    "payload": {"event_id": "evt_xyz789"}
  }
}
```

### Rollback Mekanizması

```
Kullanıcı: "Az önceki takvim eklemesini geri al"

AI:
1. Son eylemleri tara → calendar_add bulundu
2. rollback.available = true
3. calendar_delete(evt_xyz789) çalıştır
4. "Geri aldım. Fizik sınavını takvimden çıkardım."

Veya kullanıcı ayarlardan:
┌─────────────────────────────────────────────┐
│  Son Eylemler                    [Tümünü gör]│
│                                               │
│  14:30  Takvime ekledi: Fizik Sınavı  [↩ Geri Al]│
│  14:28  Hatırlatma kurdu: Su iç (4x)  [↩ Geri Al]│
│  14:25  Mail tarandı: 3 önemli bulundu           │
│  14:00  Sabah brifing gönderildi                 │
└─────────────────────────────────────────────┘
```

---

## Billing Güvenliği (SaaS için Kritik)

```
┌──────────────────────────────────────────────┐
│  Token/API kullanımı platform tarafından      │
│  kontrol edilir, kullanıcı API key görmez.    │
│                                               │
│  Kullanıcı Planları:                         │
│  ├── Free: X msg/gün, temel model             │
│  ├── Pro: Sınırsız msg, güçlü modeller        │
│  └── Team: Multi-user, admin panel            │
│                                               │
│  Korumalar:                                   │
│  ├── Per-user token rate limiting              │
│  ├── Consciousness loop maliyeti optimize     │
│  │   (Yoğun değilse → ucuz model, seyrek tick)│
│  ├── Abuse detection (crypto mining, spam)     │
│  └── Hard cap: Plan limitini aşınca durdur     │
└──────────────────────────────────────────────┘
```

---

## Cloud Güvenlik Stack Önerisi

| Katman | Teknoloji | Neden |
|--------|-----------|-------|
| Orchestration | Kubernetes (K3s veya EKS) | Olgun, geniş ekosistem |
| İzolasyon (Faz 1) | Namespace + NetworkPolicy | Hızlı başla |
| İzolasyon (Faz 2) | Firecracker / Kata | Donanım seviyesi izolasyon |
| Secrets | HashiCorp Vault / Sealed Secrets | Credential yönetimi |
| Auth | JWT + OAuth2 (Google/Apple/GitHub login) | Kullanıcı yönetimi |
| TLS | cert-manager + Let's Encrypt | Otomatik sertifika |
| Monitoring | Prometheus + Grafana | Anomali tespiti |
| Audit | PostgreSQL + append-only log | Değiştirilemez denetim izi |
| WAF | Cloudflare / AWS WAF | DDoS ve web saldırı koruması |
| Prompt Guard | LLM Guard + custom rules | Injection savunması |

Bu dosya, dosya 01 (Consciousness Loop), dosya 03 (Cloud Provisioning) ve dosya 06 (Sleep Phase encryption) ile entegre çalışır.
