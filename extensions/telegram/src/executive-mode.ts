import type {
  TelegramAccountConfig,
  TelegramDirectConfig,
  TelegramGroupConfig,
} from "openclaw/plugin-sdk/config-runtime";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";

const EMOJI_RE = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;
const EMOJI_SHORTCODE_RE = /(^|[\s(])(:[a-z0-9_+-]+:)(?=$|[\s).,!?:;])/giu;
const TEXT_EMOTICON_RE = /(^|[\s(])(<3|[:;=8xX][\-^']?[)(DPpOo/\\|])(?=$|[\s).,!?:;])/g;
const LEADING_FILLER_RE =
  /^\s*(?:tabii ki|elbette|memnuniyetle|hemen bak(?:\u0131yorum|iyorum)|of course|sure thing|happy to help|absolutely)(?:[,:.!-]+\s*|\s+)/i;
const TRAILING_CLOSING_RE =
  /^(?:baska bir sey var mi\??|ba\u015fka bir \u015fey var m\u0131\??|yard\u0131mc\u0131 olabildiysem ne mutlu\.?|yardimci olabildiysem ne mutlu\.?|let me know if you need anything else\.?|happy to help\.?|anything else\??)$/i;

export function resolveTelegramExecutiveMode(params: {
  isGroup: boolean;
  telegramCfg: TelegramAccountConfig;
  groupConfig?: TelegramGroupConfig | TelegramDirectConfig;
}): boolean {
  if (params.isGroup) {
    return false;
  }
  const dmPolicy =
    params.groupConfig && "dmPolicy" in params.groupConfig
      ? (params.groupConfig.dmPolicy ?? params.telegramCfg.dmPolicy ?? "pairing")
      : (params.telegramCfg.dmPolicy ?? "pairing");
  return dmPolicy === "allowlist";
}

function sanitizeTelegramExecutiveText(text: string): string {
  const cleaned = text
    .replace(EMOJI_SHORTCODE_RE, "$1")
    .replace(TEXT_EMOTICON_RE, "$1")
    .replace(EMOJI_RE, "");
  const lines = cleaned
    .split("\n")
    .map((line) => line.replace(LEADING_FILLER_RE, ""))
    .filter((line, index, allLines) => {
      if (index !== allLines.length - 1) {
        return true;
      }
      return !TRAILING_CLOSING_RE.test(line.trim());
    });
  return lines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeTelegramExecutiveReplyPayload(payload: ReplyPayload): ReplyPayload {
  if (!payload.text) {
    return payload;
  }
  const sanitizedText = sanitizeTelegramExecutiveText(payload.text);
  if (sanitizedText === payload.text) {
    return payload;
  }
  return {
    ...payload,
    text: sanitizedText,
  };
}
