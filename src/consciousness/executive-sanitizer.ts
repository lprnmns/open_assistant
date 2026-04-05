import type { ReplyPayload } from "../auto-reply/types.js";

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const EMOJI_RE = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;
const EMOJI_SHORTCODE_RE = /(^|[\s(])(:[a-z0-9_+-]+:)(?=$|[\s).,!?:;])/giu;
const TEXT_EMOTICON_RE = /(^|[\s(])(<3|[:;=8xX][-^']?[)(DPpOo/\\|])(?=$|[\s).,!?:;])/g;

const LEADING_FILLER_PHRASES = [
  "Tabii ki",
  "Elbette",
  "Memnuniyetle",
  "Hemen bak\u0131yorum",
  "Hemen bakiyorum",
  "Of course",
  "Sure thing",
  "Happy to help",
  "Absolutely",
] as const;

const TRAILING_CLOSING_PHRASES = new Set(
  [
    "Baska bir sey var mi?",
    "Ba\u015fka bir \u015fey var m\u0131?",
    "Yardimci olabildiysem ne mutlu.",
    "Yard\u0131mc\u0131 olabildiysem ne mutlu.",
    "Let me know if you need anything else.",
    "Happy to help.",
    "Anything else?",
  ].map((phrase) => phrase.toLowerCase()),
);

function stripLeadingFiller(line: string): string {
  let sanitized = line;
  for (const phrase of LEADING_FILLER_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    sanitized = sanitized.replace(new RegExp(`^\\s*${escaped}(?:[,:.!-]+\\s*|\\s+)`, "i"), "");
  }
  return sanitized;
}

function isTrailingClosingLine(line: string): boolean {
  const normalized = line.trim().replace(/\s+/g, " ").toLowerCase();
  return TRAILING_CLOSING_PHRASES.has(normalized);
}

function sanitizePlainSegment(text: string): string {
  const withoutEmoji = text
    .replace(EMOJI_SHORTCODE_RE, "$1")
    .replace(TEXT_EMOTICON_RE, "$1")
    .replace(EMOJI_RE, "");
  const lines = withoutEmoji
    .split("\n")
    .map((line) => stripLeadingFiller(line))
    .filter((line, index, allLines) => {
      if (index !== allLines.length - 1) {
        return true;
      }
      return !isTrailingClosingLine(line);
    });

  return lines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeExecutiveOutput(text: string): string {
  const codeBlocks: string[] = [];
  const protectedText = text.replace(CODE_BLOCK_RE, (match) => {
    const placeholder = `__OPENCLAW_CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(match);
    return placeholder;
  });

  const sanitized = sanitizePlainSegment(protectedText)
    .replace(/__OPENCLAW_CODE_BLOCK_(\d+)__/g, (_match, index: string) => {
      return codeBlocks[Number(index)] ?? "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return sanitized;
}

export function sanitizeExecutiveReplyPayload(payload: ReplyPayload): ReplyPayload {
  if (!payload.text) {
    return payload;
  }
  const sanitizedText = sanitizeExecutiveOutput(payload.text);
  if (sanitizedText === payload.text) {
    return payload;
  }
  return {
    ...payload,
    text: sanitizedText,
  };
}
