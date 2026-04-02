import type { OriginatingChannelType } from "../auto-reply/templating.js";

export type DispatchAuditDecision = "sent" | "rate_limited" | "send_error";

export type DispatchAuditEntry = {
  timestamp: string;
  channelId: string;
  channelType?: OriginatingChannelType;
  contentPreview: string;
  decision: DispatchAuditDecision;
};

const DEFAULT_PREVIEW_CHARS = 120;

export class DispatchAuditLog {
  private entries: DispatchAuditEntry[] = [];

  append(entry: DispatchAuditEntry): void {
    this.entries.push(entry);
  }

  list(): DispatchAuditEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}

export function createDispatchAuditEntry(params: {
  channelId: string;
  channelType?: OriginatingChannelType;
  content: string;
  decision: DispatchAuditDecision;
  timestamp?: number;
  previewChars?: number;
}): DispatchAuditEntry {
  return {
    timestamp: new Date(params.timestamp ?? Date.now()).toISOString(),
    channelId: params.channelId,
    channelType: params.channelType,
    contentPreview: buildContentPreview(params.content, params.previewChars),
    decision: params.decision,
  };
}

function buildContentPreview(content: string, maxChars = DEFAULT_PREVIEW_CHARS): string {
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    return "";
  }
  if (content.length <= maxChars) {
    return content;
  }
  if (maxChars <= 3) {
    return content.slice(0, maxChars);
  }
  return `${content.slice(0, maxChars - 3).trimEnd()}...`;
}
