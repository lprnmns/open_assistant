export type CognitiveMode = "executive" | "companion" | "standard";

export type CognitiveLoadSignals = {
  messageLength: number;
  punctuationDensity: number;
  urgencyHits: number;
  typoCompressionRatio: number;
  capsRatio: number;
  hasQuestion: boolean;
  imperativeHits: number;
  companionHits: number;
};

export type CognitiveLoadAssessment = {
  mode: CognitiveMode;
  signals: CognitiveLoadSignals;
  scores: {
    executive: number;
    companion: number;
  };
};

const URGENCY_TERMS = [
  "acil",
  "urgent",
  "asap",
  "hemen",
  "simdi",
  "simdi",
  "now",
  "down",
  "patladi",
  "patladı",
  "yardim",
  "yardım",
] as const;

const IMPERATIVE_TERMS = [
  "bak",
  "kontrol",
  "check",
  "fix",
  "coz",
  "çöz",
  "cek",
  "çek",
  "yap",
  "ekle",
  "sil",
  "gonder",
  "gönder",
  "pull",
  "incele",
  "ara",
  "run",
  "loglara bak",
] as const;

const COMPANION_TERMS = [
  "dusunelim",
  "düşünelim",
  "konusalim",
  "konuşalım",
  "sence",
  "bence",
  "anlat",
  "acikla",
  "açıkla",
  "neden",
  "merak",
  "yardimci olur musun",
  "yardımcı olur musun",
  "ne dersin",
] as const;

function normalizeText(message: string): string {
  return message.trim().toLowerCase();
}

function countHits(text: string, terms: readonly string[]): number {
  return terms.reduce((count, term) => (text.includes(term) ? count + 1 : count), 0);
}

export function extractCognitiveSignals(message: string): CognitiveLoadSignals {
  const normalized = normalizeText(message);
  const letters = Array.from(message).filter((char) => /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(char));
  const uppercaseLetters = letters.filter((char) => char === char.toUpperCase());
  const punctuationChars = Array.from(message).filter((char) => /[!?.,:;]/.test(char));
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const shortTokenCount = tokens.filter((token) => token.length <= 3).length;

  return {
    messageLength: normalized.length,
    punctuationDensity: normalized.length > 0 ? punctuationChars.length / normalized.length : 0,
    urgencyHits: countHits(normalized, URGENCY_TERMS),
    typoCompressionRatio: tokens.length > 0 ? shortTokenCount / tokens.length : 0,
    capsRatio: letters.length > 0 ? uppercaseLetters.length / letters.length : 0,
    hasQuestion: normalized.includes("?"),
    imperativeHits: countHits(normalized, IMPERATIVE_TERMS),
    companionHits: countHits(normalized, COMPANION_TERMS),
  };
}

export function detectCognitiveMode(message: string): CognitiveLoadAssessment {
  const signals = extractCognitiveSignals(message);

  let executive = 0;
  let companion = 0;

  if (signals.messageLength <= 60) executive += 2;
  if (signals.messageLength >= 140) companion += 2;

  if (signals.punctuationDensity <= 0.015) executive += 1;
  if (signals.punctuationDensity >= 0.03) companion += 1;

  executive += signals.urgencyHits * 3;

  if (signals.typoCompressionRatio >= 0.5) executive += 2;
  if (signals.typoCompressionRatio <= 0.2 && signals.messageLength >= 80) companion += 1;

  if (signals.capsRatio >= 0.35) executive += 2;

  if (signals.hasQuestion) companion += 1;
  if (signals.hasQuestion && signals.messageLength >= 60) companion += 1;

  executive += signals.imperativeHits * 2;
  companion += signals.companionHits * 2;

  if (executive >= 5 && executive > companion) {
    return {
      mode: "executive",
      signals,
      scores: { executive, companion },
    };
  }

  if (companion >= 4 && companion >= executive) {
    return {
      mode: "companion",
      signals,
      scores: { executive, companion },
    };
  }

  return {
    mode: "standard",
    signals,
    scores: { executive, companion },
  };
}
