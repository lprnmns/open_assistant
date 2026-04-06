import type { OpenClawConfig } from "../../config/config.js";
import { loadCronStore, resolveCronStorePath } from "../../cron/store.js";
import { callGateway } from "../../gateway/call.js";
import type { ReplyPayload } from "../types.js";

export const UNSCHEDULED_REMINDER_NOTE =
  "Note: I did not schedule a reminder in this turn, so this will not trigger automatically.";

const REMINDER_COMMITMENT_PATTERNS: RegExp[] = [
  /\b(?:i\s*'?ll|i will)\s+(?:make sure to\s+)?(?:remember|remind|ping|follow up|follow-up|check back|circle back)\b/i,
  /\b(?:i\s*'?ll|i will)\s+(?:set|create|schedule)\s+(?:a\s+)?reminder\b/i,
  /\b(?:hatirlat|yokla|yoklar|haber ver|donerim|geri don|yazarim)\b/i,
];

const SHORT_DELAY_PATTERNS: RegExp[] = [
  /\b(?:in\s+)?(?<value>\d+)\s*(?<unit>seconds?|secs?|sec|minutes?|mins?|min|hours?|hrs?|hr)\b/i,
  /\b(?<value>\d+)\s*(?<unit>sn|saniye|dk|dakika|saat)\s+sonra\b/i,
  /\bbir\s+(?<unit>dakika|dk|saat|saniye)\s+sonra\b/i,
];

const AUTO_REMINDER_MIN_DELAY_MS = 15_000;
const AUTO_REMINDER_MAX_DELAY_MS = 12 * 60 * 60 * 1000;
const AUTO_REMINDER_EXACT_THRESHOLD_MS = 4 * 60 * 60 * 1000;

type GatewayCaller = typeof callGateway;

type ConnectedNodeSummary = {
  nodeId?: string;
  connected?: boolean;
  commands?: string[];
  caps?: string[];
};

type NodeListResult = {
  nodes?: ConnectedNodeSummary[];
};

export type AutoReminderCommitment = {
  delayMs: number;
  dueAtMs: number;
  sourceText: string;
};

function normalizeReminderText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "");
}

function parseReminderDelayMs(text: string): number | null {
  const normalized = normalizeReminderText(text);
  for (const pattern of SHORT_DELAY_PATTERNS) {
    const match = normalized.match(pattern);
    if (!match?.groups) {
      continue;
    }
    const rawValue = match.groups.value?.trim();
    const rawUnit = match.groups.unit?.trim();
    const parsedValue =
      rawValue && rawValue.length > 0 ? Number.parseInt(rawValue, 10) : Number.NaN;
    const amount = Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 1;
    if (!rawUnit) {
      continue;
    }
    let multiplierMs: number | null = null;
    if (rawUnit.startsWith("sec") || rawUnit === "sn" || rawUnit === "saniye") {
      multiplierMs = 1_000;
    } else if (rawUnit.startsWith("min") || rawUnit === "dk" || rawUnit === "dakika") {
      multiplierMs = 60_000;
    } else if (rawUnit.startsWith("hr") || rawUnit.startsWith("hour") || rawUnit === "saat") {
      multiplierMs = 60 * 60_000;
    }
    if (!multiplierMs) {
      continue;
    }
    const delayMs = amount * multiplierMs;
    if (delayMs < AUTO_REMINDER_MIN_DELAY_MS || delayMs > AUTO_REMINDER_MAX_DELAY_MS) {
      return null;
    }
    return delayMs;
  }
  return null;
}

export function extractAutoReminderCommitment(text: string): AutoReminderCommitment | null {
  if (!hasUnbackedReminderCommitment(text)) {
    return null;
  }
  const delayMs = parseReminderDelayMs(text);
  if (!delayMs) {
    return null;
  }
  return {
    delayMs,
    dueAtMs: Date.now() + delayMs,
    sourceText: text.trim(),
  };
}

function formatReminderDelay(delayMs: number): string {
  if (delayMs % (60 * 60_000) === 0) {
    const hours = delayMs / (60 * 60_000);
    return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
  }
  if (delayMs % 60_000 === 0) {
    const minutes = delayMs / 60_000;
    return minutes === 1 ? "in 1 minute" : `in ${minutes} minutes`;
  }
  const seconds = Math.max(1, Math.round(delayMs / 1_000));
  return seconds === 1 ? "in 1 second" : `in ${seconds} seconds`;
}

function buildAutoReminderJobName(commitment: AutoReminderCommitment): string {
  const compact = commitment.sourceText.replace(/\s+/g, " ").slice(0, 48).trim();
  return compact ? `Auto follow-up: ${compact}` : "Auto follow-up";
}

function buildAutoReminderSystemEvent(commitment: AutoReminderCommitment): string {
  const promise = commitment.sourceText.replace(/\s+/g, " ").slice(0, 220);
  return [
    "A scheduled follow-up is due now.",
    `You previously promised the user a follow-up ${formatReminderDelay(commitment.delayMs)}.`,
    "Send that follow-up now in the active conversation.",
    `Original promise: "${promise}"`,
  ].join(" ");
}

function buildAutoReminderNotificationBody(commitment: AutoReminderCommitment): string {
  return commitment.sourceText.replace(/\s+/g, " ").slice(0, 220);
}

function resolveAutoReminderPrecision(
  commitment: AutoReminderCommitment,
): "exact" | "soft" {
  return commitment.delayMs < AUTO_REMINDER_EXACT_THRESHOLD_MS ? "exact" : "soft";
}

export function findConnectedReminderNode(nodes: ConnectedNodeSummary[]): string | null {
  for (const node of nodes) {
    if (!node.connected || typeof node.nodeId !== "string" || !node.nodeId.trim()) {
      continue;
    }
    const commands = Array.isArray(node.commands) ? node.commands : [];
    const caps = Array.isArray(node.caps) ? node.caps : [];
    if (commands.includes("reminder.schedule") || caps.includes("reminder")) {
      return node.nodeId.trim();
    }
  }
  return null;
}

export async function relayAutoReminderToConnectedNode(params: {
  commitment: AutoReminderCommitment;
  cronJobId?: string;
  cfg?: OpenClawConfig;
  timeoutMs?: number;
  callGatewayImpl?: GatewayCaller;
}): Promise<boolean> {
  const gatewayCall = params.callGatewayImpl ?? callGateway;
  const nodeList = await gatewayCall<NodeListResult>({
    config: params.cfg,
    method: "node.list",
    timeoutMs: params.timeoutMs ?? 10_000,
    params: {},
  });
  const nodeId = findConnectedReminderNode(Array.isArray(nodeList.nodes) ? nodeList.nodes : []);
  if (!nodeId) {
    return false;
  }

  await gatewayCall({
    config: params.cfg,
    method: "node.invoke",
    timeoutMs: params.timeoutMs ?? 10_000,
    params: {
      nodeId,
      command: "reminder.schedule",
      params: {
        id: params.cronJobId ?? `auto-reminder-${params.commitment.dueAtMs}`,
        title: "OpenClaw follow-up",
        body: buildAutoReminderNotificationBody(params.commitment),
        dueAtMs: params.commitment.dueAtMs,
        precision: resolveAutoReminderPrecision(params.commitment),
        priority: "active",
        cronJobId: params.cronJobId,
      },
    },
  });
  return true;
}

export async function autoScheduleReminderCommitment(params: {
  payloads: ReplyPayload[];
  cfg?: OpenClawConfig;
  sessionKey?: string;
  agentId?: string;
  timeoutMs?: number;
  callGatewayImpl?: GatewayCaller;
}): Promise<number> {
  if (!params.sessionKey || params.cfg?.cron?.enabled === false) {
    return 0;
  }

  const gatewayCall = params.callGatewayImpl ?? callGateway;
  for (const payload of params.payloads) {
    if (payload.isError || typeof payload.text !== "string") {
      continue;
    }
    const commitment = extractAutoReminderCommitment(payload.text);
    if (!commitment) {
      continue;
    }
    const cronJob = await gatewayCall<{ id?: string }>({
      config: params.cfg,
      method: "cron.add",
      timeoutMs: params.timeoutMs ?? 10_000,
      params: {
        name: buildAutoReminderJobName(commitment),
        ...(params.agentId ? { agentId: params.agentId } : {}),
        sessionKey: params.sessionKey,
        enabled: true,
        deleteAfterRun: true,
        schedule: { kind: "at", at: new Date(commitment.dueAtMs).toISOString() },
        sessionTarget: "main",
        wakeMode: "now",
        payload: {
          kind: "systemEvent",
          text: buildAutoReminderSystemEvent(commitment),
        },
      },
    });
    try {
      await relayAutoReminderToConnectedNode({
        commitment,
        cronJobId: typeof cronJob?.id === "string" ? cronJob.id : undefined,
        cfg: params.cfg,
        timeoutMs: params.timeoutMs,
        callGatewayImpl: gatewayCall,
      });
    } catch {
      // Cron remains the source of truth; device relay failures are non-fatal.
    }
    return 1;
  }

  return 0;
}

export function hasUnbackedReminderCommitment(text: string): boolean {
  const normalized = normalizeReminderText(text);
  if (!normalized.trim()) {
    return false;
  }
  if (normalized.includes(UNSCHEDULED_REMINDER_NOTE.toLowerCase())) {
    return false;
  }
  return REMINDER_COMMITMENT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Returns true when the cron store has at least one enabled job that shares the
 * current session key. Used to suppress the "no reminder scheduled" guard note
 * when an existing cron (created in a prior turn) already covers the commitment.
 */
export async function hasSessionRelatedCronJobs(params: {
  cronStorePath?: string;
  sessionKey?: string;
}): Promise<boolean> {
  try {
    const storePath = resolveCronStorePath(params.cronStorePath);
    const store = await loadCronStore(storePath);
    if (store.jobs.length === 0) {
      return false;
    }
    if (params.sessionKey) {
      return store.jobs.some((job) => job.enabled && job.sessionKey === params.sessionKey);
    }
    return false;
  } catch {
    // If we cannot read the cron store, do not suppress the note.
    return false;
  }
}

export function appendUnscheduledReminderNote(payloads: ReplyPayload[]): ReplyPayload[] {
  let appended = false;
  return payloads.map((payload) => {
    if (appended || payload.isError || typeof payload.text !== "string") {
      return payload;
    }
    if (!hasUnbackedReminderCommitment(payload.text)) {
      return payload;
    }
    appended = true;
    const trimmed = payload.text.trimEnd();
    return {
      ...payload,
      text: `${trimmed}\n\n${UNSCHEDULED_REMINDER_NOTE}`,
    };
  });
}
