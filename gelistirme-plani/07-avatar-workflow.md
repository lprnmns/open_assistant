# 7. Animasyonlu Avatar ve No-Code Workflow Builder

## BÖLÜM A: Animasyonlu AI Avatar — "Canlı Hissettiren Asistan"

### Vizyon
Bir chatbot ile konuşmak soğuktur. Ama karşında **düşünen, gülen, şaşıran, sıkılan** bir karakter varsa — etkileşim tamamen değişir. Avatar, AI'ı "canlı" hissettirir.

---

### Talking Head / Lip-Sync Projeleri

| Proje | Stars | Açıklama | Gerçek Zamanlı? |
|-------|-------|----------|-----------------|
| **SadTalker** | 45k+ | Tek fotoğraf + ses → konuşan kafa | Hayır (işlem süresi) |
| **MuseTalk** (Tencent) | 10k+ | Gerçek zamanlı lip-sync | Evet ✅ |
| **LivePortrait** (Kuaishou) | 12k+ | Hızlı portrait animasyonu | Evet ✅ |
| **Wav2Lip** | 12k+ | Herhangi videoya lip-sync | Hayır |
| **Hallo2** (Fudan) | 8k+ | Uzun süreli, yüksek çözünürlük | Hayır |
| **AniPortrait** (Tencent) | 5k+ | Ses-driven yüz animasyonu | Kısmen |
| **EchoMimic** | 4k+ | Audio-pose conditioning | Kısmen |

**Önerim:** İnteraktif kullanım için **MuseTalk** veya **LivePortrait** — gerçek zamanlı ve yeterince kaliteli.

---

### 3D Avatar Sistemleri

| Proje/Platform | Tip | Açıklama |
|---------------|-----|----------|
| **ReadyPlayerMe** | Platform (ücretsiz tier) | Cross-platform 3D avatar. GLB/glTF format. React SDK |
| **VRoid Studio** | Ücretsiz araç | 3D karakter oluşturucu, VRM format export |
| **three-vrm** | Açık kaynak (2k+) | Three.js'te VRM modeli yükleme + kontrol |
| **react-three-fiber** | Açık kaynak (28k+) | React için three.js renderer |
| **Kalidokit** | Açık kaynak (5k+) | Yüz/poz takibi → avatar blend shapes |
| **CharacterStudio** | Açık kaynak (1k+) | Browser'da VRM avatar oluşturma/özelleştirme |

### 2D Avatar / Animasyon Sistemleri

| Proje | Açıklama | Avantaj |
|-------|----------|---------|
| **Live2D Cubism** | Endüstri standardı 2D animasyon | En iyi kalite (indie'ler için ücretsiz) |
| **Inochi2D** | Açık kaynak Live2D alternatifi | Tamamen ücretsiz |
| **pixi-live2d-display** (1k+) | PixiJS ile Live2D render | Web entegrasyonu kolay |
| **Rive** (eski Flare) | Vektör animasyon + state machine | Reaktif ifadeler için mükemmel |
| **Lottie** (Airbnb) | JSON animasyon format | Hafif, her yerde çalışır |
| **Spine** | 2D iskelet animasyonu | Oyun kalitesi |

---

### Duygusal İfade Sistemi

#### LLM → Duygu → Animasyon Pipeline

```
LLM Yanıtı
    │
    ▼
┌───────────────────────┐
│ Sentiment Analizi      │
│ (LLM structured       │
│  output veya           │
│  sentiment kütüphane)  │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│ Duygu Etiketleri       │
│ joy: 0.8               │
│ surprise: 0.2          │
│ thinking: 0.0          │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│ Blend Shape Mapper     │
│ mouthSmile: 0.8        │
│ eyeSquint: 0.3         │
│ browUp: 0.1            │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│ Avatar Renderer        │
│ (WebGL/Canvas/CSS)     │
└───────────────────────┘
```

#### Duygu → Blend Shape Eşleme

| Duygu | Blend Shapes |
|-------|-------------|
| 😊 Mutlu | mouthSmile + eyeSquint |
| 😢 Üzgün | mouthFrown + browDown |
| 😮 Şaşkın | eyeWide + mouthOpen + browUp |
| 🤔 Düşünme | browFurrow + lookUp + headTilt |
| 😕 Kafası karışık | browFurrow + headTilt + lookAway |
| 😡 Sinirli | browDown + mouthTight + nostrilFlare |
| 😴 Uykulu | eyeDroop + headNod + yawn |
| 🎉 Heyecanlı | browUp + mouthOpen + bodyBounce |

#### Idle Animasyonlar (Boşta Hareketler)

```javascript
const idleAnimations = {
  breathing: {
    target: 'chest',
    type: 'sinusoidal',
    amplitude: 0.02,
    frequency: 0.3  // Hz
  },
  blinking: {
    target: 'eyeBlink',
    interval: { min: 2000, max: 6000 },  // ms
    duration: 150
  },
  eyeSaccades: {
    target: 'eyeLook',
    interval: { min: 500, max: 3000 },
    amplitude: 0.05  // küçük rastgele göz hareketleri
  },
  headMicroMovements: {
    target: 'headRotation',
    type: 'perlinNoise',
    amplitude: 0.01
  }
};
```

---

### TTS + Lip-Sync Entegrasyonu

#### Yaklaşım 1: Viseme Tabanlı (En Kaliteli)

```
TTS Engine (Azure/ElevenLabs)
    │
    ├── Ses stream
    │
    └── Viseme event'leri (zaman damgalı)
         │
         ▼
    ┌──────────────────┐
    │ Viseme → Blend    │
    │ Shape Mapper      │
    │                    │
    │ aa → mouthOpen:0.8 │
    │ ee → mouthSmile:0.6│
    │ oo → mouthRound:0.7│
    │ ...                │
    └──────────────────┘
         │
         ▼
    Avatar ağzı senkronize hareket eder
```

~15 viseme şekli İngilizce/Türkçe fonemleri kapsar.

#### Yaklaşım 2: Ses Reaktif (Daha Basit)

```javascript
// Web Audio API ile ses seviyesini analiz et
const analyser = audioContext.createAnalyser();
const dataArray = new Uint8Array(analyser.frequencyBinCount);

function animate() {
  analyser.getByteFrequencyData(dataArray);
  const volume = average(dataArray) / 255;

  avatar.setBlendShape('mouthOpen', volume * 0.8);
  avatar.setBlendShape('jawOpen', volume * 0.5);

  requestAnimationFrame(animate);
}
```

Daha az doğru ama herhangi TTS ile çalışır.

---

### Desktop Companion (Masaüstü Arkadaş)

```
Yaklaşım Seçenekleri:

1. Electron + Transparent Window
   - Çerçevesiz, şeffaf, always-on-top pencere
   - Avatar WebGL/Canvas ile render
   - Non-avatar alanları click-through
   - setIgnoreMouseEvents(true, {forward: true})

2. Tauri (daha hafif)
   - ~10MB vs Electron ~100MB+
   - Aynı transparent window konsepti
   - Rust backend

3. System Tray + Popover
   - Daha basit: avatar system tray'den açılan popup'ta
   - Düşük kaynak kullanımı

4. PWA + PiP (Picture-in-Picture)
   - Tarayıcıda floating avatar
   - Native app gerektirmez
   - Sınırlı ama hızlı prototip
```

---

### Teknik Uygulama Karşılaştırması

| Yaklaşım | Kalite | Performans | Karmaşıklık | En İyi Kullanım |
|----------|--------|------------|-------------|-----------------|
| **CSS/SVG** | Düşük (cartoon) | Mükemmel | Düşük | Basit maskot, her yerde çalışır |
| **Lottie/Rive** | Orta (2D vektör) | Çok iyi | Düşük-Orta | Stilize 2D karakter, state machine |
| **PixiJS + Live2D** | Orta-Yüksek | İyi | Orta | VTuber tarzı avatar |
| **Three.js + VRM** | Yüksek (3D) | İyi-Orta | Yüksek | Tam 3D karakter |
| **react-three-fiber + RPM** | Yüksek (3D) | İyi | Orta | React uygulamalar |
| **Canvas 2D** | Düşük-Orta | Mükemmel | Düşük | Basit animasyonlu yüz, mobil uyumlu |

**Önerim:** Başlangıç için **Rive** (2D, state machine, hafif, reaktif) → İleri aşamada **Three.js + VRM** (3D, tam ifade kontrolü)

---

### Ticari Referanslar

| Platform | Özellik | Not |
|----------|---------|-----|
| **Soul Machines** | Digital People, otonom animasyon, emotion detection | Enterprise fiyat |
| **NVIDIA ACE** | Full stack: STT + TTS + LLM + facial animation | Geliştirici ücretsiz |
| **HeyGen** | Real-time streaming avatar | Ticari API |
| **D-ID** | Talking head API, real-time | Ticari API |
| **Synthesia** | AI video platformu | Ticari |

---

## BÖLÜM B: No-Code Workflow Builder

### Vizyon
Geliştiriciler olmayan kullanıcıların da **kendi otomasyon akışlarını** görsel olarak oluşturabilmesi.

---

### Büyük Açık Kaynak Platformlar

| Proje | Stars | Açıklama | AI Desteği |
|-------|-------|----------|------------|
| **Dify** | 60k+ | LLMOps platform, görsel workflow builder | Tam (RAG, agent, model yönetimi) |
| **n8n** | 55k+ | Workflow automation, 400+ entegrasyon | LangChain node'ları |
| **ComfyUI** | 65k+ | Stable Diffusion node editor | Görsel AI (image generation) |
| **Langflow** | 40k+ | LangChain görsel builder | Tam (multi-agent, RAG) |
| **Flowise** | 35k+ | Drag-drop LLM flow builder | Tam (chatflow, agent flow) |
| **Activepieces** | 12k+ | Zapier alternatifi | AI pieces |
| **Windmill** | 12k+ | Script/flow/app platformu | Python/TS/Go/Bash |
| **AutoGen Studio** | 5k+ | Microsoft multi-agent görsel UI | AutoGen framework |
| **Rivet** | 3k+ | AI programming environment | TypeScript, debugging |

---

### Node Editor Kütüphaneleri (Custom Builder İçin)

| Kütüphane | Stars | Framework | Avantaj |
|-----------|-------|-----------|---------|
| **React Flow** | 26k+ | React | Dominant standart, Flowise/Langflow kullanıyor |
| **Rete.js** | 10k+ | Framework-agnostic | v2 ile gelişmiş mimari |
| **Litegraph.js** | 6k+ | Vanilla JS | ComfyUI kullanıyor, hafif |
| **Node-RED** | 20k+ | Standalone | En olgun, dev ekosistem |
| **Flume** | 1.5k | React | Basit API, type-safe |
| **Drawflow** | 4.5k | Vanilla JS | Minimal, dependency yok |
| **X6 (AntV)** | 6k+ | React/Vue | Ant Group, flowchart/DAG |

---

### Workflow Builder Mimarisi

```
┌─────────────────────────────────────────────────────┐
│                  FRONTEND (React)                    │
│                                                      │
│  ┌─────────────────────────────────────────┐        │
│  │           React Flow Canvas              │        │
│  │                                          │        │
│  │  ┌─────┐    ┌─────┐    ┌─────┐         │        │
│  │  │Tetik│───→│ LLM │───→│Koşul│         │        │
│  │  │leyici│    │Çağrı│    │     │         │        │
│  │  └─────┘    └─────┘    └──┬──┘         │        │
│  │                        ┌──┴──┐          │        │
│  │                        │     │          │        │
│  │                     ┌──┴┐  ┌─┴──┐       │        │
│  │                     │Evet│  │Hayır│      │        │
│  │                     │    │  │     │      │        │
│  │                     │Mail│  │Slack│      │        │
│  │                     │Gön.│  │Mes. │      │        │
│  │                     └────┘  └─────┘      │        │
│  └─────────────────────────────────────────┘        │
│                                                      │
│  Node Palette:                                       │
│  [Tetikleyici] [LLM] [Koşul] [Döngü]              │
│  [E-posta] [Slack] [HTTP] [Dosya]                   │
│  [Zamanlama] [Filtre] [Transform]                   │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼ (JSON DAG)
┌─────────────────────────────────────────────────────┐
│                  BACKEND                             │
│                                                      │
│  ┌─────────────────────────────────────────┐        │
│  │         Workflow Execution Engine         │        │
│  │  1. DAG'ı topological sort              │        │
│  │  2. Her node'u sırayla çalıştır         │        │
│  │  3. Çıktıları bağlı girdilere aktar     │        │
│  │  4. Koşullu dallanma uygula             │        │
│  │  5. Hata yakalama ve retry              │        │
│  └─────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────┘
```

### Temel Node Tipleri

```
Tetikleyiciler (Trigger):
├── Cron (zamanlama)
├── Webhook (dış tetik)
├── E-posta geldi
├── Mesaj geldi (WhatsApp/Telegram)
├── Dosya değişti
├── Fiyat değişti
└── Manuel başlat

İşlemciler (Processor):
├── LLM Çağrısı (model seçimi + prompt)
├── HTTP İsteği (API çağrısı)
├── Dosya Oku/Yaz
├── Veritabanı Sorgusu
├── Metin İşleme (regex, format)
├── Veri Dönüşümü (JSON → CSV vb.)
└── Kod Çalıştır (JavaScript/Python)

Kontrol Akışı:
├── Koşul (if/else)
├── Switch (çoklu dal)
├── Döngü (for each)
├── Paralel (aynı anda)
├── Bekleme (delay/sleep)
├── Hata Yakalama (try/catch)
└── Alt Akış (sub-workflow)

Çıktılar (Output):
├── Mesaj Gönder (kanal seçimi)
├── E-posta Gönder
├── Dosyaya Kaydet
├── Webhook Çağır
├── Bildirim Gönder
└── Belleğe Kaydet
```

### Template Marketplace

```
Hazır Şablonlar:
├── 📧 "Günlük E-posta Özeti" — Sabah önemli e-postaları özetle
├── 📊 "Haftalık Rapor" — Proje ilerlemesini derle, Slack'e gönder
├── 💰 "Fiyat Takibi" — Amazon'da fiyat düşünce bildir
├── 📅 "Toplantı Hazırlığı" — Toplantı öncesi katılımcı notları
├── 🔔 "GitHub PR Review" — Yeni PR gelince analiz et, özet çıkar
├── 🌤️ "Sabah Brifing" — Hava + takvim + haberler
├── 🏋️ "Fitness Takibi" — Günlük aktivite kontrolü
└── 📖 "Okuma Listesi" — Kaydedilen makaleleri haftalık özetle
```

---

## Uygulama Yol Haritası

### Avatar - Faz 1: Basit 2D Avatar
- Rive ile 2D karakter tasarımı
- 6 temel duygu state'i (mutlu, üzgün, şaşkın, düşünen, nötr, heyecanlı)
- Ses reaktif lip-sync (Web Audio API)
- Idle animasyonlar (nefes, göz kırpma)

### Avatar - Faz 2: Gelişmiş Etkileşim
- Viseme tabanlı lip-sync (TTS provider'dan)
- LLM → sentiment → avatar emotion pipeline
- Desktop companion modu (transparent window)
- Kullanıcı customization (renk, stil, karakter seçimi)

### Avatar - Faz 3: 3D Avatar
- Three.js + VRM entegrasyonu
- ReadyPlayerMe veya VRoid karakter seçimi
- Kamera takibi (Kalidokit) ile webcam-driven mod
- Tam blend shape kontrolü

### Workflow - Faz 1: Temel Editor
- React Flow ile node-based editor
- 10 temel node tipi (trigger, LLM, koşul, output)
- JSON serializasyon
- Basit execution engine

### Workflow - Faz 2: Gelişmiş Özellikler
- Template marketplace
- Hata yakalama ve retry
- Paralel execution
- Zamanlama entegrasyonu (cron)

### Workflow - Faz 3: AI-Assisted Building
- "Bu akışı oluştur" — doğal dilde workflow tanımlama
- LLM ile otomatik node bağlama
- Akıllı öneriler ("bu node'dan sonra genelde X eklenir")
- Workflow debugging ve test araçları
