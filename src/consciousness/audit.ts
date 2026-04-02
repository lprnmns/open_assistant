import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { OriginatingChannelType } from "../auto-reply/templating.js";
import type { TickResult } from "./loop.js";
import type { CognitiveLoadSignals, CognitiveMode } from "./cognitive-load.js";

export type DispatchAuditDecision = "sent" | "rate_limited" | "send_error";

export type TickAuditEntry = {
  kind: "tick";
  timestamp: string;
  wake: boolean;
  decision?: TickResult["decision"] extends infer T
    ? T extends { action: infer A }
      ? A
      : never
    : never;
  phase: TickResult["state"]["phase"];
  llmCallCount: number;
};

export type DispatchAuditEntry = {
  kind: "dispatch";
  timestamp: string;
  channelId: string;
  channelType?: OriginatingChannelType;
  contentLength: number;
  contentPreview: string;
  decision: DispatchAuditDecision;
  success: boolean;
};

export type CognitiveModeAuditEntry = {
  kind: "cognitive_mode";
  timestamp: string;
  sessionKey: string;
  mode: CognitiveMode;
  previousMode?: CognitiveMode;
  signals: CognitiveLoadSignals;
};

export type ConsciousnessAuditEntry =
  | TickAuditEntry
  | DispatchAuditEntry
  | CognitiveModeAuditEntry;

export type ConsciousnessAuditLogOptions = {
  filePath?: string;
  ensureDir?: (directoryPath: string) => Promise<void>;
  appendLine?: (filePath: string, line: string) => Promise<void>;
  writer?: (entry: ConsciousnessAuditEntry) => Promise<void>;
};

const DEFAULT_PREVIEW_CHARS = 120;

let globalConsciousnessAuditLog: ConsciousnessAuditLog | undefined = undefined;
const lastCognitiveModeBySession = new Map<string, CognitiveMode>();

export class ConsciousnessAuditLog {
  private entries: ConsciousnessAuditEntry[] = [];
  private pendingPersist: Promise<void> = Promise.resolve();
  private ensuredDirectory = false;

  constructor(private readonly options: ConsciousnessAuditLogOptions = {}) {}

  append(entry: ConsciousnessAuditEntry): void {
    this.entries.push(entry);
    this.queuePersist(entry);
  }

  list(): ConsciousnessAuditEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }

  async flush(): Promise<void> {
    await this.pendingPersist;
  }

  private queuePersist(entry: ConsciousnessAuditEntry): void {
    if (!this.options.writer && !this.options.filePath) {
      return;
    }

    this.pendingPersist = this.pendingPersist
      .catch(() => undefined)
      .then(async () => {
        if (this.options.writer) {
          await this.options.writer(entry);
          return;
        }

        const filePath = this.options.filePath;
        if (!filePath) {
          return;
        }

        if (!this.ensuredDirectory) {
          await (this.options.ensureDir ?? ensureDirectoryPath)(path.dirname(filePath));
          this.ensuredDirectory = true;
        }

        const line = `${JSON.stringify(entry)}\n`;
        await (this.options.appendLine ?? appendAuditLine)(filePath, line);
      })
      .catch(() => undefined);
  }
}

export function createTickAuditEntry(params: {
  result: TickResult;
  timestamp?: number;
}): TickAuditEntry {
  return {
    kind: "tick",
    timestamp: new Date(params.timestamp ?? Date.now()).toISOString(),
    wake: params.result.watchdogResult.wake,
    decision: params.result.decision?.action,
    phase: params.result.state.phase,
    llmCallCount: params.result.state.llmCallCount,
  };
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
    kind: "dispatch",
    timestamp: new Date(params.timestamp ?? Date.now()).toISOString(),
    channelId: params.channelId,
    channelType: params.channelType,
    contentLength: params.content.length,
    contentPreview: buildContentPreview(params.content, params.previewChars),
    decision: params.decision,
    success: params.decision === "sent",
  };
}

export function createCognitiveModeAuditEntry(params: {
  sessionKey: string;
  mode: CognitiveMode;
  previousMode?: CognitiveMode;
  signals: CognitiveLoadSignals;
  timestamp?: number;
}): CognitiveModeAuditEntry {
  return {
    kind: "cognitive_mode",
    timestamp: new Date(params.timestamp ?? Date.now()).toISOString(),
    sessionKey: params.sessionKey,
    mode: params.mode,
    previousMode: params.previousMode,
    signals: params.signals,
  };
}

export function setGlobalConsciousnessAuditLog(
  log: ConsciousnessAuditLog | undefined,
): void {
  globalConsciousnessAuditLog = log;
}

export function clearGlobalConsciousnessAuditLog(
  log?: ConsciousnessAuditLog,
): void {
  if (log === undefined || globalConsciousnessAuditLog === log) {
    globalConsciousnessAuditLog = undefined;
  }
}

export function getGlobalConsciousnessAuditLog():
  | ConsciousnessAuditLog
  | undefined {
  return globalConsciousnessAuditLog;
}

export function recordCognitiveModeTransition(params: {
  sessionKey: string;
  mode: CognitiveMode;
  signals: CognitiveLoadSignals;
  timestamp?: number;
  auditLog?: ConsciousnessAuditLog;
}): void {
  const previousMode = lastCognitiveModeBySession.get(params.sessionKey);
  if (previousMode === params.mode) {
    return;
  }

  lastCognitiveModeBySession.set(params.sessionKey, params.mode);
  const auditLog = params.auditLog ?? globalConsciousnessAuditLog;
  auditLog?.append(
    createCognitiveModeAuditEntry({
      sessionKey: params.sessionKey,
      mode: params.mode,
      previousMode,
      signals: params.signals,
      timestamp: params.timestamp,
    }),
  );
}

export function _resetConsciousnessAuditStateForTest(): void {
  globalConsciousnessAuditLog = undefined;
  lastCognitiveModeBySession.clear();
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

async function ensureDirectoryPath(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}

async function appendAuditLine(filePath: string, line: string): Promise<void> {
  await appendFile(filePath, line, "utf8");
}
