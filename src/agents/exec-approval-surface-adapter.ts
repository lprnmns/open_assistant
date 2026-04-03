import { randomUUID } from "node:crypto";
import type { ApprovalRequest, ApprovalSurface } from "./approval-surface.js";
import { requestExecApprovalDecision } from "./bash-tools.exec-approval-request.js";
import { normalizeToolName } from "./tool-policy.js";

type ExecApprovalSurfaceAdapterOptions = {
  workdir?: string;
  agentId?: string;
  sessionKey?: string;
  turnSourceChannel?: string;
  turnSourceTo?: string;
  turnSourceAccountId?: string;
  turnSourceThreadId?: string | number;
  requestDecision?: typeof requestExecApprovalDecision;
};

const allowAlwaysByScope = new Map<string, Set<string>>();

function resolveScopeKey(params: { sessionKey?: string; agentId?: string }): string | undefined {
  const sessionKey = params.sessionKey?.trim();
  if (sessionKey) {
    return `session:${sessionKey}`;
  }
  const agentId = params.agentId?.trim();
  return agentId ? `agent:${agentId}` : undefined;
}

function truncateText(value: string, maxChars = 64): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function formatScalar(value: string | number | boolean | null): string {
  if (typeof value === "string") {
    return JSON.stringify(truncateText(value));
  }
  return String(value);
}

function summarizeRecord(record: Record<string, unknown>): string {
  const entries: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (entries.length >= 5) {
      entries.push("…");
      break;
    }
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      entries.push(`${key}=${formatScalar(value)}`);
      continue;
    }
    if (Array.isArray(value)) {
      entries.push(`${key}=[${value.length}]`);
      continue;
    }
    if (typeof value === "object") {
      entries.push(`${key}={…}`);
    }
  }
  return entries.join(" ");
}

function summarizeArgs(args: readonly unknown[]): string {
  if (args.length === 0) {
    return "";
  }
  const [first] = args;
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const summary = summarizeRecord(first as Record<string, unknown>);
    return summary || "{…}";
  }
  try {
    return truncateText(JSON.stringify(args));
  } catch {
    return "{…}";
  }
}

function buildToolApprovalCommand(request: ApprovalRequest): string {
  const summary = summarizeArgs(request.args);
  return summary ? `tool ${request.toolName} ${summary}` : `tool ${request.toolName}`;
}

function getAllowAlwaysSet(scopeKey: string): Set<string> {
  let set = allowAlwaysByScope.get(scopeKey);
  if (!set) {
    set = new Set<string>();
    allowAlwaysByScope.set(scopeKey, set);
  }
  return set;
}

export function resetExecApprovalSurfaceAdapterForTest(): void {
  allowAlwaysByScope.clear();
}

export function createExecApprovalSurfaceAdapter(
  options: ExecApprovalSurfaceAdapterOptions,
): ApprovalSurface {
  const scopeKey = resolveScopeKey({
    sessionKey: options.sessionKey,
    agentId: options.agentId,
  });
  const workdir = options.workdir?.trim() || process.cwd();
  const requestDecision = options.requestDecision ?? requestExecApprovalDecision;

  return {
    onApprovalRequest: async (request) => {
      const normalizedToolName = normalizeToolName(request.toolName);
      if (scopeKey && normalizedToolName) {
        const allowAlways = allowAlwaysByScope.get(scopeKey);
        if (allowAlways?.has(normalizedToolName)) {
          return true;
        }
      }

      const decision = await requestDecision({
        id: randomUUID(),
        command: buildToolApprovalCommand(request),
        cwd: workdir,
        host: "gateway",
        security: "full",
        ask: "always",
        agentId: options.agentId,
        sessionKey: options.sessionKey,
        turnSourceChannel: options.turnSourceChannel,
        turnSourceTo: options.turnSourceTo,
        turnSourceAccountId: options.turnSourceAccountId,
        turnSourceThreadId: options.turnSourceThreadId,
      });

      if (decision === "allow-always" && scopeKey && normalizedToolName) {
        getAllowAlwaysSet(scopeKey).add(normalizedToolName);
      }

      return decision === "allow-once" || decision === "allow-always";
    },
  };
}
