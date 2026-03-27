# 5. Türkçe Dil Desteği ve Uluslararasılaşma (i18n)

## Vizyon
i18n, OpenClaw'un **114 yorumla en çok tartışılan issue'su** (#3460). Türkçe dahil birçok dil desteği yok. Global bir ürün olmak için çoklu dil desteği şart.

---

## Türkçe Dilin Özgün Zorlukları

### Agglutinative (Bitişimli) Yapı
Tek bir kelime cümle anlamı taşıyabilir:
- `"gelebilecekmiydiler"` = "Were they going to be able to come?" — tek kelime
- Bu, token bazlı NLP sistemleri için zorluk yaratır

### Ünlü Uyumu (Vowel Harmony)
- Ekler önceki ünlüye göre değişir (kalın/ince, düz/yuvarlak)
- `ev-ler` ama `göz-ler`, `araba-lar` ama `gece-ler`

### Serbest Sözcük Dizimi
- Varsayılan SOV (Özne-Nesne-Yüklem) ama pragmatik değişime açık
- "Ben okula gittim" = "Okula ben gittim" = "Gittim ben okula"

### Cinsiyet Yok
- Türkçede grammatik cinsiyet yok
- "O" = he/she/it → çevirirken bilgi kaybı

---

## Mimari: 3 Katmanlı i18n

### Katman 1: Statik UI Çevirisi (i18next)

```
/locales/
├── en/
│   ├── common.json      {"greeting": "Hello", "settings": "Settings"}
│   ├── dashboard.json    {"cost": "Cost", "budget": "Budget"}
│   └── onboarding.json   {"welcome": "Welcome to OpenClaw"}
├── tr/
│   ├── common.json      {"greeting": "Merhaba", "settings": "Ayarlar"}
│   ├── dashboard.json    {"cost": "Maliyet", "budget": "Bütçe"}
│   └── onboarding.json   {"welcome": "OpenClaw'a Hoş Geldiniz"}
├── de/
├── fr/
├── ar/  (RTL)
├── zh/
└── ja/
```

**Teknoloji:** `i18next` + `i18next-fs-backend` + `i18next-browser-languageDetector`

### Katman 2: LLM Yanıt Lokalizasyonu

System prompt ile dinamik dil kontrolü:
```
System: Always respond in {user_locale}.
Adapt cultural references, date formats, and idioms.
For Turkish: Use formal register (siz/sizin) unless the user
uses informal (sen/senin). Use Turkish date format (24 Mart 2026).
```

**Avantaj:** Modern LLM'ler (Claude, GPT-4, Gemini) Türkçeyi iyi üretir
**Risk:** Domain-spesifik terminolojide hata yapabilir

### Katman 3: Kültürel Adaptasyon

```javascript
const locale = user.locale || 'tr-TR';

// Tarih: "24 Mart 2026"
new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date);

// Para: "₺1.234,56"
new Intl.NumberFormat(locale, { style: 'currency', currency: 'TRY' }).format(amount);

// Göreceli zaman: "1 gün önce"
new Intl.RelativeTimeFormat(locale).format(-1, 'day');

// Hitap: siz/sen algılama
function detectFormality(message) {
  const informalPatterns = /\b(sen|senin|sana|seni|yap|gel|bak)\b/i;
  return informalPatterns.test(message) ? 'informal' : 'formal';
}
```

---

## Türkçe NLP Araçları

### Dil Modelleri

| Model | Açıklama | Kullanım |
|-------|----------|----------|
| **BERTurk** | Türkçe BERT modeli | Sınıflandırma, NER, sentiment |
| **TURNA** | Boğaziçi Üniversitesi, encoder-decoder | Türkçe-spesifik NLP |
| **Zephyr-7B-Turkish** | Fine-tuned açık LLM | Türkçe metin üretimi |
| **XLM-RoBERTa** | Çok dilli, Türkçe güçlü | Cross-lingual görevler |

### NLP Kütüphaneleri

| Kütüphane | Açıklama |
|-----------|----------|
| **Zemberek-NLP** (`ahmetaa/zemberek-nlp`) | En kapsamlı Türkçe NLP (Java). Morfoloji, tokenization, yazım denetimi |
| **Stanza** (Stanford) | Türkçe model: tokenization, POS, lemma, dependency parsing |
| **spaCy** | Çok dilli model ile Türkçe destek |

### Türkçe TTS (Metin-Konuşma)

| Araç | Tip | Kalite | Kullanım |
|------|-----|--------|----------|
| **Piper TTS** (`rhasspy/piper`) | Açık kaynak, offline | İyi | Edge/yerel deployment |
| **XTTS v2** (Coqui fork) | Açık kaynak, ses klonlama | Çok iyi | Kişiselleştirilmiş ses |
| **Azure Neural TTS** | Ticari (ücretsiz tier) | Mükemmel | Cloud TTS |
| **Google Cloud TTS** | Ticari | Mükemmel | WaveNet sesleri |
| **ElevenLabs** | Ticari | Mükemmel | Çok dilli ses klonlama |

### Türkçe STT (Konuşma-Metin)

| Araç | Tip | Kalite |
|------|-----|--------|
| **Whisper large-v3** | Açık kaynak | Mükemmel |
| **faster-whisper** | CTranslate2 tabanlı, 4x hızlı | Mükemmel |
| **Vosk** (`alphacephei.com/vosk`) | Hafif, offline | İyi |

---

## Çok Dilli Bellek Sistemi

### Cross-Lingual Retrieval (Diller Arası Erişim)

```
Kullanıcı Türkçe sorar → Embedding (BGE-M3) → Vektör araması
                                                    │
                                          ┌─────────┴──────────┐
                                          │                     │
                                    Türkçe bellek        İngilizce bellek
                                    "Kullanıcı React     "User prefers
                                     tercih ediyor"       dark mode"
                                          │                     │
                                          └─────────┬──────────┘
                                                    │
                                                    ▼
                                          LLM Türkçe yanıt üretir
                                          (her iki kaynaktan)
```

### Çok Dilli Embedding Modelleri

| Model | Açıklama | Dil Sayısı |
|-------|----------|-----------|
| **BGE-M3** (BAAI) | SOTA çok dilli embedding | 100+ |
| **multilingual-e5-large** (Microsoft) | Güçlü cross-lingual | 100+ |
| **SONAR** (Meta) | Multimodal, çok dilli | 200+ |
| **LaBSE** (Google) | Cross-lingual sentence similarity | 109 |

### Bellek Saklama Stratejisi

```json
{
  "memory_id": "mem_001",
  "content": "Kullanıcı TypeScript'i JavaScript'e tercih ediyor",
  "lang": "tr",
  "original_lang": "tr",
  "embedding": [0.12, -0.34, ...],
  "tags": ["tercihler", "programlama"],
  "created_at": "2026-03-24T14:00:00Z"
}
```

- Orijinal dilde sakla, dil metadata'sı ekle
- Cross-lingual embedding ile her dilden erişilebilir kıl
- LLM yanıtı hedef dilde sentezlesin

---

## Çeviri Yönetim Sistemi

### Tolgee (`tolgee/tolgee-platform`)
- Açık kaynak Crowdin alternatifi
- In-context çeviri düzenleme
- Git entegrasyonu
- AI destekli çeviri önerileri
- Self-host veya cloud

### Weblate (`WeblateOrg/weblate`)
- Açık kaynak, self-hosted
- Git entegrasyonu
- Makine çeviri backend'leri (LLM dahil)
- Topluluk çeviri desteği

---

## RTL (Sağdan Sola) Desteği

Arapça, İbranice, Farsça, Urduca için:

```css
/* CSS Logical Properties */
.message {
  margin-inline-start: 1rem;  /* margin-left yerine */
  padding-inline-end: 1rem;   /* padding-right yerine */
}

/* Otomatik yön tespiti */
[dir="auto"] {
  text-align: start;
}

/* Chat baloncukları */
.user-message {
  margin-inline-start: auto;  /* Mantıksal "sağ" taraf */
}
```

---

## Sesli Çok Dilli Etkileşim

### Dil Tespiti Pipeline
```
Ses girişi → Whisper dil tespiti (ilk 30 sn)
                    │
              ┌─────┴──────┐
              │             │
          Türkçe        İngilizce
              │             │
              ▼             ▼
        Türkçe STT    İngilizce STT
              │             │
              ▼             ▼
        Türkçe LLM    İngilizce LLM
         yanıtı          yanıtı
              │             │
              ▼             ▼
        Türkçe TTS    İngilizce TTS
        (Piper)       (OpenAI)
```

### Dil Bazlı Ses Eşleme
```javascript
const voiceMap = {
  'tr-TR': { tts: 'piper-tr', voice: 'tr_TR-dfki-medium' },
  'en-US': { tts: 'openai', voice: 'nova' },
  'de-DE': { tts: 'piper-de', voice: 'de_DE-thorsten-medium' },
  'ar-SA': { tts: 'azure', voice: 'ar-SA-HamedNeural' }
};
```

---

## Uygulama Yol Haritası

### Faz 1: Temel i18n Altyapısı
- i18next entegrasyonu
- Türkçe ve İngilizce locale dosyaları
- System prompt lokalizasyonu
- Intl API ile tarih/sayı formatlaması

### Faz 2: Türkçe Ses
- Whisper (faster-whisper) ile Türkçe STT
- Piper TTS ile Türkçe konuşma
- Dil tespiti ve otomatik geçiş

### Faz 3: Çok Dilli Bellek
- BGE-M3 embedding entegrasyonu
- Cross-lingual memory retrieval
- Dil metadata'sı ile bellek saklama

### Faz 4: Topluluk Çevirisi
- Tolgee/Weblate entegrasyonu
- Topluluk katkı altyapısı
- 10+ dil hedefi
- RTL desteği (Arapça, İbranice)
