# Open Assistant: Sürekli Yaşayan Dijital Varlık (Continuous Living Entity)

> Bu bir chatbot projesi değil. Bu, **kendi API key'ini getirdiğin anda, sana özel 7/24 yaşayan bir container'da canlanan, seni tanıyan, uyuduğunda bile çalışan, sormadan yapan** bir dijital varlık inşa etme planı.

## İş Modeli: BYOK (Bring Your Own Keys)

**Biz zeka satmıyoruz, zekanın 7/24 yaşayacağı evi satıyoruz.**

- Kullanıcı kendi OpenAI / Anthropic / Gemini API key'ini getirir
- Platform bu key'i güvenli kasada (Vault) saklar
- Kullanıcıya izole, 7/24 yaşayan bir container tahsis edilir
- LLM maliyeti kullanıcıya ait — platform sadece altyapı + bilinç satır (~$10/ay)

## Mimari Dokümanlar

| # | Dosya | İçerik |
|---|-------|--------|
| **00** | [Mega Mimari](00-mega-mimari.md) | Sistem geneli, BYOK iş modeli, bileşen etkileşimleri, bir günün hikayesi, Milestone planı |
| **01** | [Arka Plan Bilinci](01-proaktif-zeka.md) | Consciousness Loop, Heuristic Watchdog, Dynamic Trigger Compiler, Silence-is-Data, Cognitive Load |
| **02** | [Güvenlik](02-guvenlik-sandbox.md) | Cloud tenant izolasyonu, Act-First Reversibility Score, DPE, Zero-trust, Vault BYOK, Audit trail |
| **03** | [BYOK SaaS](03-kolay-kurulum.md) | BYOK Key Vault, Auto-provisioning, Fiyatlandırma, Onboarding UX, Hetzner M1 planı |
| **04** | [BYOK Maliyet Dashboard](04-maliyet-dashboard.md) | Kullanıcının kendi API harcamasını izleme, bütçe kontrol, model seçimi, key health monitoring |
| **05** | [Türkçe & i18n](05-turkce-i18n.md) | Çok dilli destek, Türkçe NLP/TTS/STT, cross-lingual memory |
| **06** | [Living Brain](06-kalici-bellek.md) | 4 katmanlı beyin (Cortex/Hippocampus/Neocortex/Behavioral), REM Sleep Phase, Knowledge Graph |
| **07** | [Avatar & Workflow](07-avatar-workflow.md) | Animasyonlu avatar, duygu sistemi, no-code workflow builder |

## Temel İlkeler

1. **BYOK**: Kendi key'ini getir. Biz zeka satmıyoruz, 7/24 yaşayan ev satıyoruz.
2. **Act-First**: Geri alınabilir işlemi sormadan yap. Risk varsa sor.
3. **Always-On**: Consciousness Loop — kullanıcı yazmasa bile düşünür.
4. **Silence is Data**: Sessizlik de bilgidir. 3 gün yazmazsan fark eder.
5. **Self-Programming**: Hardcoded trigger yok. AI kendi trigger'larını yazar.
6. **Never Forget**: 4 katmanlı beyin. Crash-proof. Restart-proof.
7. **Sleep & Dream**: Gece çöp toplar, konsolide eder, araştırır, sabah sunar.
8. **Adapts to You**: Sen asistana değil, asistan sana adapte olur.

## Milestone Planı (3 Aşamalı Yol Haritası)

```
MILESTONE 1: "Single-Tenant MVP" — Sadece Benim İçin (Proof of Concept)
────────────────────────────────────────────────────────────────────────
Hedef: Hetzner VPS + kendi API key'lerimle 7/24 çalışan tek kişilik varlık.
Stack: Docker Compose, Redis, LanceDB, LiteLLM, Node.js/TypeScript.
Çıktı: Watchdog + Consciousness Loop + Living Brain + Act-First = Yaşayan Varlık.

MILESTONE 2: "Startup Landing & Yatırım" — Demo Aşaması
────────────────────────────────────────────────────────────
Hedef: M1'in ekran kayıtlarıyla Landing Page + waitlist + bulut kredisi başvuruları.
Çıktı: AWS/Azure/GCP $10,000+ kredi hibesi + erken kullanıcı listesi.

MILESTONE 3: "Multi-Tenant SaaS" — Production
───────────────────────────────────────────────
Hedef: Kubernetes + Vault + Scale-to-Zero + Stripe billing = genel kullanıma açık SaaS.
Fiyat: ~$10/ay (BYOK — LLM maliyeti kullanıcıya ait).
```
