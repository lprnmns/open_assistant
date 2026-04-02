import { describe, expect, it } from "vitest";
import {
  detectCognitiveMode,
  extractCognitiveSignals,
} from "./cognitive-load.js";

describe("extractCognitiveSignals", () => {
  it("extracts urgency hits", () => {
    const signals = extractCognitiveSignals("acil bak hemen");
    expect(signals.urgencyHits).toBeGreaterThanOrEqual(2);
  });

  it("extracts imperative hits", () => {
    const signals = extractCognitiveSignals("loglara bak ve kontrol et");
    expect(signals.imperativeHits).toBeGreaterThanOrEqual(2);
  });

  it("detects question marks", () => {
    const signals = extractCognitiveSignals("Bunu neden boyle yaptik?");
    expect(signals.hasQuestion).toBe(true);
  });

  it("measures caps ratio", () => {
    const signals = extractCognitiveSignals("ACIL PROD DOWN");
    expect(signals.capsRatio).toBeGreaterThan(0.8);
  });

  it("measures punctuation density", () => {
    const signals = extractCognitiveSignals("Merhaba, bunu birlikte dusunelim mi?");
    expect(signals.punctuationDensity).toBeGreaterThan(0.02);
  });

  it("measures typo compression ratio", () => {
    const signals = extractCognitiveSignals("kod patladi loglara bak acil");
    expect(signals.typoCompressionRatio).toBeGreaterThan(0.3);
  });
});

describe("detectCognitiveMode", () => {
  it("classifies the AT-4 urgent message as executive", () => {
    const assessment = detectCognitiveMode("kod patladi loglara bak acil");
    expect(assessment.mode).toBe("executive");
  });

  it("classifies all-caps urgency as executive", () => {
    const assessment = detectCognitiveMode("ACIL PROD DOWN SIMDI BAK");
    expect(assessment.mode).toBe("executive");
  });

  it("classifies short command bursts as executive", () => {
    const assessment = detectCognitiveMode("check logs now");
    expect(assessment.mode).toBe("executive");
  });

  it("classifies imperative troubleshooting prompts as executive", () => {
    const assessment = detectCognitiveMode("bak su hata neden geliyor coz");
    expect(assessment.mode).toBe("executive");
  });

  it("classifies reflective Turkish prompts as companion", () => {
    const assessment = detectCognitiveMode(
      "Biraz dusunelim mi, sence onboarding akisini nasil sadeleştirebiliriz?",
    );
    expect(assessment.mode).toBe("companion");
  });

  it("classifies warm explanatory prompts as companion", () => {
    const assessment = detectCognitiveMode(
      "Bence burada kullanici davranisini daha iyi anlamamiz gerekiyor, ne dersin?",
    );
    expect(assessment.mode).toBe("companion");
  });

  it("classifies question-heavy planning prompts as companion", () => {
    const assessment = detectCognitiveMode(
      "Neden bu kadar cok retry var, bunu birlikte aciklayip sonra sadeleştirelim mi?",
    );
    expect(assessment.mode).toBe("companion");
  });

  it("keeps neutral status checks in standard mode", () => {
    const assessment = detectCognitiveMode("Bugunku durum ne");
    expect(assessment.mode).toBe("standard");
  });

  it("keeps straightforward factual asks in standard mode", () => {
    const assessment = detectCognitiveMode("Dunun benchmark sonucunu ozetle");
    expect(assessment.mode).toBe("standard");
  });

  it("does not over-classify a polite short request as companion", () => {
    const assessment = detectCognitiveMode("Rica etsem bunu ozetler misin?");
    expect(assessment.mode).not.toBe("executive");
  });

  it("gives executive a higher score on urgent outage messages", () => {
    const assessment = detectCognitiveMode("ACIL servis down hemen bak");
    expect(assessment.scores.executive).toBeGreaterThan(assessment.scores.companion);
  });

  it("gives companion a higher score on reflective prompts", () => {
    const assessment = detectCognitiveMode(
      "Sence kullanici neden burada vazgeciyor, biraz dusunelim mi?",
    );
    expect(assessment.scores.companion).toBeGreaterThan(assessment.scores.executive);
  });

  it("treats long explanatory prompts without warmth as standard", () => {
    const assessment = detectCognitiveMode(
      "Bu degisiklik sadece dispatch yolunu etkiliyor ve testler yesil, ama type gate hala eski loop hatalarina dusuyor.",
    );
    expect(assessment.mode).toBe("standard");
  });

  it("recognizes companion cues even with Turkish diacritics", () => {
    const assessment = detectCognitiveMode(
      "Düşünelim mi, kullanıcı yolculuğunu neden burada kaybediyoruz?",
    );
    expect(assessment.mode).toBe("companion");
  });

  it("recognizes urgency with Turkish diacritics", () => {
    const assessment = detectCognitiveMode("çok acil, loglara bak");
    expect(assessment.mode).toBe("executive");
  });

  it("does not mark empty input as executive", () => {
    const assessment = detectCognitiveMode("");
    expect(assessment.mode).toBe("standard");
  });

  it("classifies compressed Turkish outage reports as executive", () => {
    const assessment = detectCognitiveMode("api down acil bak");
    expect(assessment.mode).toBe("executive");
  });

  it("classifies exploratory product discussion as companion", () => {
    const assessment = detectCognitiveMode(
      "Bence landing anlatisini biraz daha insani hale getirebiliriz, sen ne dersin?",
    );
    expect(assessment.mode).toBe("companion");
  });

  it("keeps direct but non-urgent action requests in standard mode", () => {
    const assessment = detectCognitiveMode("Yarin icin toplanti notlarini hazirla");
    expect(assessment.mode).toBe("standard");
  });

  it("prefers executive when urgency and imperatives stack", () => {
    const assessment = detectCognitiveMode("acil check et simdi fixle");
    expect(assessment.mode).toBe("executive");
  });

  it("prefers companion when explanation and question cues stack", () => {
    const assessment = detectCognitiveMode(
      "Bence burada biraz durup neden boyle hissettigimizi konusalim mi?",
    );
    expect(assessment.mode).toBe("companion");
  });
});
