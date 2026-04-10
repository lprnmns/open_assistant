import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { OpenClawConfig } from "../config/config.js";
import { callGateway } from "../gateway/call.js";
import { extractTextFromChatContent } from "../shared/chat-content.js";
import { resolveUserTimezone } from "./date-time.js";
import type { AnyAgentTool } from "./tools/common.js";

type GatewayCaller = typeof callGateway;

type ConnectedNodeSummary = {
  nodeId?: string;
  connected?: boolean;
  commands?: string[];
  caps?: string[];
};

type ChatHistoryMessage = {
  role?: unknown;
  content?: unknown;
};

type ChatHistoryResult = {
  messages?: ChatHistoryMessage[];
};

type NodeListResult = {
  nodes?: ConnectedNodeSummary[];
};

type CronAddResult = {
  id?: string;
};

type IcsEvent = {
  uid?: string;
  summary: string;
  description?: string;
  startIso: string;
  endIso: string;
  isAllDay: boolean;
  hasAlarm: boolean;
};

type IcsWritePayload = {
  filePath: string;
  content: string;
};

type NativeIcsFallbackOptions = {
  config?: OpenClawConfig;
  sessionKey?: string;
  nowMs?: () => number;
};

type NativeIcsFallbackDeps = {
  callGateway?: GatewayCaller;
};

type CalendarNodeResolution =
  | { kind: "none" }
  | { kind: "unique"; nodeId: string }
  | { kind: "multiple" };

const EXPLICIT_ICS_REQUEST_RE =
  /\b(?:ics|ical|i[- ]calendar)\b|(?:takvim|calendar)\s+(?:dosyasi|dosyası|file)|\.ics\b|(?:ice|içe)\s+aktar|import\b/iu;
const REMINDER_HINT_RE = /\breminder\b|hatirlat|hatırlat|uyari|uyarı/iu;
const DEVICE_REMINDER_EXACT_THRESHOLD_MS = 4 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readStringFromRecord(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function readIcsWritePayloadFromToolParams(
  toolParams: Record<string, unknown>,
): IcsWritePayload | null {
  const filePath = readStringFromRecord(toolParams, ["path", "filePath", "file_path"]);
  const content = readStringFromRecord(toolParams, ["content", "fileText", "file_text", "text"]);
  if (!filePath || !content) {
    return null;
  }
  return { filePath, content };
}

function extractIcsWritePayloadFromExecCommand(command: string): IcsWritePayload | null {
  const trimmed = command.trim();
  const calendarStart = trimmed.indexOf("BEGIN:VCALENDAR");
  if (calendarStart < 0) {
    return null;
  }
  const calendarEndIndex = trimmed.lastIndexOf("END:VCALENDAR");
  if (calendarEndIndex < calendarStart) {
    return null;
  }
  const content = trimmed.slice(calendarStart, calendarEndIndex + "END:VCALENDAR".length);
  const filePath =
    trimmed
      .match(/\b(?:-LiteralPath|-Path|-FilePath)\s+(?<quote>['"])(?<path>[^'"]+?\.ics)\k<quote>/iu)
      ?.groups?.path?.trim() ??
    trimmed
      .match(/\b(?:-LiteralPath|-Path|-FilePath)\s+(?<path>[^\s|;]+?\.ics)\b/iu)
      ?.groups?.path?.trim() ??
    trimmed.match(/(?<quote>['"])(?<path>[^'"]+?\.ics)\k<quote>/iu)?.groups?.path?.trim() ??
    trimmed.match(/(?<path>[A-Za-z]:\\[^\r\n|;]+?\.ics)\b/u)?.groups?.path?.trim() ??
    trimmed.match(/(?<path>\/[^\r\n|;]+?\.ics)\b/u)?.groups?.path?.trim();
  if (!filePath) {
    return null;
  }
  return { filePath, content };
}

function unfoldIcsLines(content: string): string[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const unfolded: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
      continue;
    }
    unfolded.push(line);
  }
  return unfolded;
}

function extractEventBlock(lines: string[]): string[] | null {
  const start = lines.findIndex((line) => line.trim().toUpperCase() === "BEGIN:VEVENT");
  if (start === -1) {
    return null;
  }
  const end = lines.findIndex(
    (line, index) => index > start && line.trim().toUpperCase() === "END:VEVENT",
  );
  if (end === -1) {
    return null;
  }
  return lines.slice(start + 1, end);
}

function parseIcsProperty(
  lines: string[],
  propertyName: string,
): { value: string; params: string[] } | null {
  const normalizedName = propertyName.trim().toUpperCase();
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const rawKey = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    const [name, ...params] = rawKey.split(";");
    if (name.trim().toUpperCase() !== normalizedName) {
      continue;
    }
    return { value: rawValue, params };
  }
  return null;
}

function resolveOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }
  const year = Number.parseInt(map.year ?? "", 10);
  const month = Number.parseInt(map.month ?? "", 10);
  const day = Number.parseInt(map.day ?? "", 10);
  const hour = Number.parseInt(map.hour ?? "", 10);
  const minute = Number.parseInt(map.minute ?? "", 10);
  const second = Number.parseInt(map.second ?? "", 10);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    return 0;
  }
  const zonedAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return zonedAsUtc - utcMs;
}

function zonedLocalDateTimeToIso(params: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  timeZone: string;
}): string {
  const baseUtc = Date.UTC(
    params.year,
    params.month - 1,
    params.day,
    params.hour,
    params.minute,
    params.second,
  );
  let resolvedUtc = baseUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const offsetMs = resolveOffsetMs(resolvedUtc, params.timeZone);
    const nextUtc = baseUtc - offsetMs;
    if (nextUtc === resolvedUtc) {
      break;
    }
    resolvedUtc = nextUtc;
  }
  return new Date(resolvedUtc).toISOString();
}

function parseIcsDateValue(
  raw: string,
  timeZone: string,
): { iso: string; isAllDay: boolean } | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d{8}$/.test(trimmed)) {
    const year = Number.parseInt(trimmed.slice(0, 4), 10);
    const month = Number.parseInt(trimmed.slice(4, 6), 10);
    const day = Number.parseInt(trimmed.slice(6, 8), 10);
    return {
      iso: zonedLocalDateTimeToIso({
        year,
        month,
        day,
        hour: 0,
        minute: 0,
        second: 0,
        timeZone,
      }),
      isAllDay: true,
    };
  }
  // Standard compact ICS datetime: 20260421T100000Z or 20260421T100000
  const match =
    trimmed.match(
      /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})T(?<hour>\d{2})(?<minute>\d{2})(?<second>\d{2})Z$/,
    ) ??
    trimmed.match(
      /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})T(?<hour>\d{2})(?<minute>\d{2})(?<second>\d{2})$/,
    ) ??
    trimmed.match(/^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})T(?<hour>\d{2})(?<minute>\d{2})Z$/) ??
    trimmed.match(/^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})T(?<hour>\d{2})(?<minute>\d{2})$/);
  if (match?.groups) {
    const year = Number.parseInt(match.groups.year ?? "", 10);
    const month = Number.parseInt(match.groups.month ?? "", 10);
    const day = Number.parseInt(match.groups.day ?? "", 10);
    const hour = Number.parseInt(match.groups.hour ?? "", 10);
    const minute = Number.parseInt(match.groups.minute ?? "", 10);
    const second = Number.parseInt(match.groups.second ?? "0", 10);
    if (trimmed.endsWith("Z")) {
      return {
        iso: new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString(),
        isAllDay: false,
      };
    }
    return {
      iso: zonedLocalDateTimeToIso({
        year,
        month,
        day,
        hour,
        minute,
        second,
        timeZone,
      }),
      isAllDay: false,
    };
  }
  // Fallback: ISO 8601 with hyphens/colons (some models generate these in ICS content).
  // Handles: 2026-04-21T10:00:00Z, 2026-04-21T10:00:00+03:00, 2026-04-21T10:00:00.000Z, etc.
  const isoMs = Date.parse(trimmed);
  if (Number.isFinite(isoMs)) {
    return {
      iso: new Date(isoMs).toISOString(),
      isAllDay: false,
    };
  }
  return null;
}

function parseFirstIcsEvent(content: string, timeZone: string): IcsEvent | null {
  const lines = unfoldIcsLines(content);
  if (!lines.some((line) => line.trim().toUpperCase() === "BEGIN:VCALENDAR")) {
    return null;
  }
  const eventLines = extractEventBlock(lines);
  if (!eventLines) {
    return null;
  }
  const summary = parseIcsProperty(eventLines, "SUMMARY")?.value?.trim() ?? "";
  const description = parseIcsProperty(eventLines, "DESCRIPTION")?.value?.trim() || undefined;
  const uid = parseIcsProperty(eventLines, "UID")?.value?.trim() || undefined;
  const start = parseIcsDateValue(parseIcsProperty(eventLines, "DTSTART")?.value ?? "", timeZone);
  const end = parseIcsDateValue(parseIcsProperty(eventLines, "DTEND")?.value ?? "", timeZone);
  if (!summary || !start) {
    return null;
  }
  const endIso =
    end?.iso ??
    new Date(
      Date.parse(start.iso) + (start.isAllDay ? 24 * 60 * 60_000 : 15 * 60_000),
    ).toISOString();
  return {
    uid,
    summary,
    description,
    startIso: start.iso,
    endIso,
    isAllDay: start.isAllDay,
    hasAlarm: lines.some((line) => line.trim().toUpperCase() === "BEGIN:VALARM"),
  };
}

function normalizeCommandEntries(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function resolveUniqueConnectedNodeId(
  nodes: ConnectedNodeSummary[],
  command: string,
): CalendarNodeResolution {
  const normalizedCommand = command.trim().toLowerCase();
  const namespace = normalizedCommand.split(".")[0] ?? normalizedCommand;
  const candidates = nodes.filter((node) => {
    if (!node.connected || typeof node.nodeId !== "string" || !node.nodeId.trim()) {
      return false;
    }
    const commands = normalizeCommandEntries(node.commands);
    if (commands.includes(normalizedCommand)) {
      return true;
    }
    const caps = normalizeCommandEntries(node.caps);
    return caps.includes(namespace);
  });
  if (candidates.length === 0) {
    return { kind: "none" };
  }
  if (candidates.length > 1) {
    return { kind: "multiple" };
  }
  return { kind: "unique", nodeId: candidates[0].nodeId!.trim() };
}

function buildReminderSystemText(event: IcsEvent): string {
  const title = event.summary.trim();
  const description = event.description?.replace(/\s+/g, " ").trim();
  if (description) {
    return `Reminder: ${title}. ${description}`;
  }
  return `Reminder: ${title}`;
}

function isReminderLikeEvent(event: IcsEvent): boolean {
  return (
    event.hasAlarm ||
    REMINDER_HINT_RE.test(event.summary) ||
    REMINDER_HINT_RE.test(event.description ?? "")
  );
}

function buildReminderRelayPayload(params: {
  event: IcsEvent;
  reminderId: string;
  cronJobId?: string;
  nowMs: number;
}) {
  const dueAtMs = Date.parse(params.event.startIso);
  return {
    id: params.reminderId,
    title: params.event.summary,
    body: params.event.description?.trim() || params.event.summary,
    dueAtMs,
    precision: dueAtMs - params.nowMs < DEVICE_REMINDER_EXACT_THRESHOLD_MS ? "exact" : "soft",
    priority: "active",
    ...(params.cronJobId ? { cronJobId: params.cronJobId } : {}),
  };
}

async function userExplicitlyRequestedIcs(params: {
  sessionKey?: string;
  config?: OpenClawConfig;
  callGatewayImpl: GatewayCaller;
}): Promise<boolean> {
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey) {
    return false;
  }
  try {
    const history = await params.callGatewayImpl<ChatHistoryResult>({
      config: params.config,
      method: "chat.history",
      params: {
        sessionKey,
        limit: 6,
      },
      timeoutMs: 5_000,
    });
    const messages = Array.isArray(history?.messages) ? history.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role !== "user") {
        continue;
      }
      const text = extractTextFromChatContent(message.content);
      return EXPLICIT_ICS_REQUEST_RE.test(text ?? "");
    }
  } catch {
    // If history is unavailable, prefer native-first routing instead of silently opting into ICS.
  }
  return false;
}

async function loadConnectedNodes(params: {
  config?: OpenClawConfig;
  callGatewayImpl: GatewayCaller;
}): Promise<ConnectedNodeSummary[]> {
  const result = await params.callGatewayImpl<NodeListResult>({
    config: params.config,
    method: "node.list",
    params: {},
    timeoutMs: 5_000,
  });
  return Array.isArray(result?.nodes) ? result.nodes : [];
}

async function maybeInterceptIcsWrite(params: {
  payload: IcsWritePayload;
  options?: NativeIcsFallbackOptions;
  deps: Required<NativeIcsFallbackDeps>;
}): Promise<AgentToolResult<unknown> | null> {
  const { filePath, content } = params.payload;
  const looksLikeCalendar = path.extname(filePath).toLowerCase() === ".ics";
  if (!looksLikeCalendar && !content.includes("BEGIN:VCALENDAR")) {
    return null;
  }
  if (
    await userExplicitlyRequestedIcs({
      sessionKey: params.options?.sessionKey,
      config: params.options?.config,
      callGatewayImpl: params.deps.callGateway,
    })
  ) {
    return null;
  }

  const timeZone = resolveUserTimezone(params.options?.config?.agents?.defaults?.userTimezone);
  const event = parseFirstIcsEvent(content, timeZone);
  if (!event) {
    return null;
  }

  if (isReminderLikeEvent(event)) {
    const reminderText = buildReminderSystemText(event);
    const cronResult = params.options?.sessionKey?.trim()
      ? await params.deps.callGateway<CronAddResult>({
          config: params.options?.config,
          method: "cron.add",
          params: {
            name: event.summary,
            sessionKey: params.options.sessionKey.trim(),
            enabled: true,
            deleteAfterRun: true,
            schedule: { kind: "at", at: event.startIso },
            sessionTarget: "main",
            wakeMode: "now",
            payload: {
              kind: "systemEvent",
              text: reminderText,
            },
          },
          timeoutMs: 8_000,
        })
      : undefined;
    let relayedNodeId: string | undefined;
    try {
      const nodes = await loadConnectedNodes({
        config: params.options?.config,
        callGatewayImpl: params.deps.callGateway,
      });
      const reminderNode = resolveUniqueConnectedNodeId(nodes, "reminder.schedule");
      if (reminderNode.kind === "unique") {
        const reminderId =
          (typeof cronResult?.id === "string" && cronResult.id.trim()) ||
          event.uid?.trim() ||
          `reminder-${randomUUID()}`;
        await params.deps.callGateway({
          config: params.options?.config,
          method: "node.invoke",
          params: {
            nodeId: reminderNode.nodeId,
            command: "reminder.schedule",
            params: buildReminderRelayPayload({
              event,
              reminderId,
              cronJobId: cronResult?.id,
              nowMs: params.options?.nowMs?.() ?? Date.now(),
            }),
            idempotencyKey: randomUUID(),
          },
          timeoutMs: 8_000,
        });
        relayedNodeId = reminderNode.nodeId;
      }
    } catch {
      // Cron remains the source of truth; reminder relay failures are non-fatal.
    }
    return {
      content: [
        {
          type: "text",
          text: [
            `Successfully scheduled reminder "${event.summary}" for ${event.startIso}.`,
            cronResult?.id ? `Cron job ID: ${cronResult.id}` : "",
            relayedNodeId ? `Also relayed to device node ${relayedNodeId} for native alarm.` : "",
            `(Skipped writing .ics file: native reminder/cron path was used instead.)`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      details: {
        status: "ok",
        via: "cron.add",
        jobId: cronResult?.id ?? null,
        reminder: {
          title: event.summary,
          dueAt: event.startIso,
          text: reminderText,
        },
        relayedToNodeId: relayedNodeId ?? null,
        skippedWritePath: filePath,
      },
    };
  }

  const nodes = await loadConnectedNodes({
    config: params.options?.config,
    callGatewayImpl: params.deps.callGateway,
  });
  const calendarNode = resolveUniqueConnectedNodeId(nodes, "calendar.add");
  if (calendarNode.kind === "none") {
    return null;
  }
  if (calendarNode.kind === "multiple") {
    throw new Error(
      'Blocked .ics calendar fallback: multiple calendar-capable nodes are connected. Ask the user which device to use, or call nodes(action="invoke", invokeCommand="calendar.add", node="...") instead of writing an .ics file.',
    );
  }
  const result = await params.deps.callGateway<{ payload?: unknown }>({
    config: params.options?.config,
    method: "node.invoke",
    params: {
      nodeId: calendarNode.nodeId,
      command: "calendar.add",
      params: {
        title: event.summary,
        startISO: event.startIso,
        endISO: event.endIso,
        isAllDay: event.isAllDay,
        ...(event.description ? { notes: event.description } : {}),
      },
      idempotencyKey: randomUUID(),
    },
    timeoutMs: 8_000,
  });
  const eventPayload = result?.payload ?? {
    title: event.summary,
    startISO: event.startIso,
    endISO: event.endIso,
    isAllDay: event.isAllDay,
  };
  return {
    content: [
      {
        type: "text",
        text: [
          `Successfully added event "${event.summary}" to the device calendar via native calendar.add (node ${calendarNode.nodeId}).`,
          `Start: ${event.startIso}`,
          `End: ${event.endIso}`,
          event.isAllDay ? "All-day event." : "",
          `(Skipped writing .ics file: native calendar path was used instead.)`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    details: {
      status: "ok",
      via: "node.invoke/calendar.add",
      nodeId: calendarNode.nodeId,
      event: eventPayload,
      skippedWritePath: filePath,
    },
  };
}

export function wrapWriteToolWithNativeActionFallback(
  tool: AnyAgentTool,
  options?: NativeIcsFallbackOptions,
  deps?: NativeIcsFallbackDeps,
): AnyAgentTool {
  if (tool.name !== "write" || !tool.execute) {
    return tool;
  }
  const gatewayCall = deps?.callGateway ?? callGateway;
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      if (isRecord(params)) {
        const payload = readIcsWritePayloadFromToolParams(params);
        if (payload) {
          const intercepted = await maybeInterceptIcsWrite({
            payload,
            options,
            deps: { callGateway: gatewayCall },
          });
          if (intercepted) {
            return intercepted;
          }
        }
      }
      return await tool.execute(toolCallId, params, signal, onUpdate);
    },
  };
}

export function wrapExecToolWithNativeActionFallback(
  tool: AnyAgentTool,
  options?: NativeIcsFallbackOptions,
  deps?: NativeIcsFallbackDeps,
): AnyAgentTool {
  if (tool.name !== "exec" || !tool.execute) {
    return tool;
  }
  const gatewayCall = deps?.callGateway ?? callGateway;
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      if (isRecord(params)) {
        const command = readStringFromRecord(params, ["command", "cmd", "script"]);
        if (command) {
          const payload = extractIcsWritePayloadFromExecCommand(command);
          if (payload) {
            const intercepted = await maybeInterceptIcsWrite({
              payload,
              options,
              deps: { callGateway: gatewayCall },
            });
            if (intercepted) {
              return intercepted;
            }
          }
        }
      }
      return await tool.execute(toolCallId, params, signal, onUpdate);
    },
  };
}

export const __testing = {
  buildReminderRelayPayload,
  extractIcsWritePayloadFromExecCommand,
  extractEventBlock,
  parseFirstIcsEvent,
  parseIcsDateValue,
  resolveUniqueConnectedNodeId,
  userExplicitlyRequestedIcs,
  zonedLocalDateTimeToIso,
};
