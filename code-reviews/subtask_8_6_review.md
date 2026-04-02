DURUM: ONAYLANDI - MAIN'E MERGE EDILEBILIR

Sonuc:
- `8.6` landing kodu tarafinda tamamlandi.
- Gercek demo asset ve gercek static form artik mevcut.

Dogruladigim noktalar:
- `landing/demo.gif`
  - Gercek demo asset mevcut
- `landing/index.html:468-526`
  - CTA artik gercek demo GIF preview + link gosteriyor
  - `Request Early Access` artik gercek HTML form
- `scripts/render-landing-demo.py`
  - Demo asset repo icindeki benchmark/runtime kanitlarindan uretiliyor
- `gelistirme-plani/08-landing-demo-plan.md:338-351`
  - `8.6` durumu complete/static delivery olarak guncellenmis

QA yorumu:
- Kod ve asset tarafinda `8.6` kapanmis durumda
- Tek residual nokta operasyonel:
  - FormSubmit ilk canli gonderimde inbox confirmation isteyebilir

Sonraki gerekli adim:
- `beta`dan `main`e alinmasi
