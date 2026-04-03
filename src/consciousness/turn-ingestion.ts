import type { ReplyPayload } from "../auto-reply/types.js";
import { isSilentReplyText } from "../auto-reply/tokens.js";
import { getConsciousnessRuntime } from "./runtime.js";

export type ConversationTurnDirection =
  | "user"
  | "assistant"
  | "assistant/proactive";

export function formatConversationTurnContent(params: {
  direction: ConversationTurnDirection;
  text?: string | null;
}): string | undefined {
  const trimmed = params.text?.trim();
  if (!trimmed) {
    return undefined;
  }
  return `[${params.direction}]: ${trimmed}`;
}

export function extractIngestibleAssistantTexts(
  payloads: readonly ReplyPayload[],
): string[] {
  const texts: string[] = [];
  for (const payload of payloads) {
    if (payload.isReasoning || payload.isCompactionNotice) {
      continue;
    }
    const trimmed = payload.text?.trim();
    if (!trimmed || isSilentReplyText(trimmed)) {
      continue;
    }
    texts.push(trimmed);
  }
  return texts;
}

export async function ingestConversationTurn(params: {
  direction: ConversationTurnDirection;
  sessionKey?: string;
  text?: string | null;
}): Promise<boolean> {
  const runtime = getConsciousnessRuntime();
  if (!runtime || !params.sessionKey) {
    return false;
  }

  const content = formatConversationTurnContent({
    direction: params.direction,
    text: params.text,
  });
  if (!content) {
    return false;
  }

  try {
    await runtime.brain.ingestion.ingest({
      content,
      sessionKey: params.sessionKey,
    });
    return true;
  } catch {
    return false;
  }
}

export async function ingestAssistantPayloads(params: {
  payloads: readonly ReplyPayload[];
  sessionKey?: string;
  direction?: Extract<ConversationTurnDirection, "assistant" | "assistant/proactive">;
}): Promise<number> {
  if (!params.sessionKey) {
    return 0;
  }

  let ingested = 0;
  for (const text of extractIngestibleAssistantTexts(params.payloads)) {
    if (
      await ingestConversationTurn({
        direction: params.direction ?? "assistant",
        sessionKey: params.sessionKey,
        text,
      })
    ) {
      ingested += 1;
    }
  }
  return ingested;
}
