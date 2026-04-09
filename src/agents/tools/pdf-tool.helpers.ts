import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { OpenClawConfig } from "../../config/config.js";
import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
} from "../../config/model-input.js";
import { parseJsonWithJson5Fallback } from "../../utils/parse-json-compat.js";
import { extractAssistantText } from "../pi-embedded-utils.js";

export type PdfModelConfig = { primary?: string; fallbacks?: string[] };
export const PDF_EXTRACTION_MODES = ["schedule"] as const;

export type PdfExtractionMode = (typeof PDF_EXTRACTION_MODES)[number];
export type PdfScheduleExtractionItemKind = "event" | "deadline" | "reminder" | "task" | "other";
export type PdfScheduleExtractionConfidence = "high" | "medium" | "low";

export type PdfScheduleExtractionItem = {
  kind: PdfScheduleExtractionItemKind;
  title: string;
  dateText: string;
  startAt: string | null;
  endAt: string | null;
  dueAt: string | null;
  allDay: boolean;
  confidence: PdfScheduleExtractionConfidence;
  sourceSnippet: string;
};

export type PdfScheduleCronCandidate = {
  sourceItemIndex: number;
  reason: "dueAt" | "startAt";
  toolName: "cron";
  toolInput: {
    action: "add";
    job: {
      name: string;
      schedule: { kind: "at"; at: string };
      payload: { kind: "systemEvent"; text: string };
    };
  };
  job: {
    name: string;
    schedule: { kind: "at"; at: string };
    payload: { kind: "systemEvent"; text: string };
  };
};

export type PdfScheduleCalendarCandidate = {
  sourceItemIndex: number;
  reason: "event";
  toolName: "nodes";
  toolInput: {
    action: "invoke";
    invokeCommand: "calendar.add";
    invokeParamsJson: string;
  };
  nodeRequirement: "required_unless_single_calendar_capable_node";
  params: {
    title: string;
    startISO: string;
    endISO: string;
    isAllDay?: boolean;
    notes?: string;
  };
  assumptions: string[];
};

export type PdfScheduleExtraction = {
  kind: "schedule_extract";
  timezone: string | null;
  notes: string[];
  items: PdfScheduleExtractionItem[];
  cronCandidates: PdfScheduleCronCandidate[];
  calendarCandidates: PdfScheduleCalendarCandidate[];
};

const PDF_SCHEDULE_EXTRACTION_ITEM_KINDS = [
  "event",
  "deadline",
  "reminder",
  "task",
  "other",
] as const;
const PDF_SCHEDULE_EXTRACTION_CONFIDENCE = ["high", "medium", "low"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeScheduleItem(raw: unknown): PdfScheduleExtractionItem | null {
  if (!isRecord(raw)) {
    return null;
  }
  const title = readOptionalString(raw.title);
  const dateText = readOptionalString(raw.dateText);
  if (!title || !dateText) {
    return null;
  }
  const kind = PDF_SCHEDULE_EXTRACTION_ITEM_KINDS.includes(
    raw.kind as PdfScheduleExtractionItemKind,
  )
    ? (raw.kind as PdfScheduleExtractionItemKind)
    : "other";
  const confidence = PDF_SCHEDULE_EXTRACTION_CONFIDENCE.includes(
    raw.confidence as PdfScheduleExtractionConfidence,
  )
    ? (raw.confidence as PdfScheduleExtractionConfidence)
    : "medium";
  return {
    kind,
    title,
    dateText,
    startAt: readOptionalString(raw.startAt),
    endAt: readOptionalString(raw.endAt),
    dueAt: readOptionalString(raw.dueAt),
    allDay: raw.allDay === true,
    confidence,
    sourceSnippet: readOptionalString(raw.sourceSnippet) ?? "",
  };
}

function buildScheduleCronCandidates(
  items: PdfScheduleExtractionItem[],
): PdfScheduleCronCandidate[] {
  const candidates: PdfScheduleCronCandidate[] = [];
  for (const [index, item] of items.entries()) {
    if (item.kind !== "deadline" && item.kind !== "reminder" && item.kind !== "task") {
      continue;
    }
    const rawAt = item.dueAt ?? item.startAt;
    if (!rawAt) {
      continue;
    }
    const parsedAtMs = Date.parse(rawAt);
    if (!Number.isFinite(parsedAtMs) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(rawAt)) {
      continue;
    }
    const at = new Date(parsedAtMs).toISOString();
    const job = {
      name: item.title,
      schedule: { kind: "at" as const, at },
      payload: { kind: "systemEvent" as const, text: `Reminder: ${item.title}` },
    };
    candidates.push({
      sourceItemIndex: index,
      reason: item.dueAt ? "dueAt" : "startAt",
      toolName: "cron",
      toolInput: {
        action: "add",
        job,
      },
      job,
    });
  }
  return candidates;
}

function parseIsoCandidate(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    return null;
  }
  const parsedAtMs = Date.parse(raw);
  if (!Number.isFinite(parsedAtMs)) {
    return null;
  }
  return new Date(parsedAtMs).toISOString();
}

function buildScheduleCalendarCandidates(
  items: PdfScheduleExtractionItem[],
): PdfScheduleCalendarCandidate[] {
  const candidates: PdfScheduleCalendarCandidate[] = [];
  for (const [index, item] of items.entries()) {
    if (item.kind !== "event") {
      continue;
    }
    const startISO = parseIsoCandidate(item.startAt);
    if (!startISO) {
      continue;
    }
    const assumptions: string[] = [];
    let endISO = parseIsoCandidate(item.endAt);
    if (!endISO && item.allDay) {
      const startMs = Date.parse(startISO);
      endISO = new Date(startMs + 24 * 60 * 60 * 1000).toISOString();
      assumptions.push("endISO inferred as startISO + 1 day for all-day event");
    }
    if (!endISO || Date.parse(endISO) <= Date.parse(startISO)) {
      continue;
    }
    candidates.push({
      sourceItemIndex: index,
      reason: "event",
      toolName: "nodes",
      toolInput: {
        action: "invoke",
        invokeCommand: "calendar.add",
        invokeParamsJson: JSON.stringify({
          title: item.title,
          startISO,
          endISO,
          ...(item.allDay ? { isAllDay: true } : {}),
          ...(item.sourceSnippet ? { notes: item.sourceSnippet } : {}),
        }),
      },
      nodeRequirement: "required_unless_single_calendar_capable_node",
      params: {
        title: item.title,
        startISO,
        endISO,
        ...(item.allDay ? { isAllDay: true } : {}),
        ...(item.sourceSnippet ? { notes: item.sourceSnippet } : {}),
      },
      assumptions,
    });
  }
  return candidates;
}

export function buildPdfStructuredPrompt(params: {
  mode: PdfExtractionMode;
  request?: string;
}): string {
  if (params.mode === "schedule") {
    const request = readOptionalString(params.request);
    return [
      "Extract schedule, reminder, deadline, and task candidates from this PDF.",
      "Return raw JSON only. Do not use markdown fences or explanatory prose.",
      "Use exactly this object shape:",
      "{",
      '  "timezone": "IANA timezone or null",',
      '  "notes": ["short ambiguity notes"],',
      '  "items": [',
      "    {",
      '      "kind": "event|deadline|reminder|task|other",',
      '      "title": "short human-readable title",',
      '      "dateText": "original date/time wording from the PDF",',
      '      "startAt": "ISO-8601 datetime or null",',
      '      "endAt": "ISO-8601 datetime or null",',
      '      "dueAt": "ISO-8601 datetime or null",',
      '      "allDay": true,',
      '      "confidence": "high|medium|low",',
      '      "sourceSnippet": "short supporting quote or snippet"',
      "    }",
      "  ]",
      "}",
      "Use null when a field is unknown.",
      "For meetings or events, prefer startAt/endAt.",
      "For deadlines, reminders, or follow-ups, prefer dueAt.",
      'If no schedule information exists, return {"timezone":null,"notes":["No schedule information found."],"items":[]}.',
      ...(request ? [`Additional extraction request: ${request}`] : []),
    ].join("\n");
  }
  return params.request ?? "";
}

export function coercePdfStructuredResult(params: {
  mode: PdfExtractionMode;
  raw: string;
}): PdfScheduleExtraction {
  if (params.mode === "schedule") {
    let parsed: unknown;
    try {
      parsed = parseJsonWithJson5Fallback(params.raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`PDF structured extraction returned invalid JSON: ${message}`, {
        cause: error,
      });
    }
    if (!isRecord(parsed)) {
      throw new Error("PDF structured extraction must return a JSON object.");
    }
    const itemsRaw = Array.isArray(parsed.items) ? parsed.items : [];
    const items = itemsRaw
      .map((item) => normalizeScheduleItem(item))
      .filter((item): item is PdfScheduleExtractionItem => item !== null);
    return {
      kind: "schedule_extract",
      timezone: readOptionalString(parsed.timezone),
      notes: readStringArray(parsed.notes),
      items,
      cronCandidates: buildScheduleCronCandidates(items),
      calendarCandidates: buildScheduleCalendarCandidates(items),
    };
  }
  throw new Error("Unsupported PDF extraction mode");
}

/**
 * Providers known to support native PDF document input.
 * When the model's provider is in this set, the tool sends raw PDF bytes
 * via provider-specific API calls instead of extracting text/images first.
 */
export const NATIVE_PDF_PROVIDERS = new Set(["anthropic", "google"]);

/**
 * Check whether a provider supports native PDF document input.
 */
export function providerSupportsNativePdf(provider: string): boolean {
  return NATIVE_PDF_PROVIDERS.has(provider.toLowerCase().trim());
}

/**
 * Parse a page range string (e.g. "1-5", "3", "1-3,7-9") into an array of 1-based page numbers.
 */
export function parsePageRange(range: string, maxPages: number): number[] {
  const pages = new Set<number>();
  const parts = range.split(",").map((p) => p.trim());
  for (const part of parts) {
    if (!part) {
      continue;
    }
    const dashMatch = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (dashMatch) {
      const start = Number(dashMatch[1]);
      const end = Number(dashMatch[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
        throw new Error(`Invalid page range: "${part}"`);
      }
      for (let i = start; i <= Math.min(end, maxPages); i++) {
        pages.add(i);
      }
    } else {
      const num = Number(part);
      if (!Number.isFinite(num) || num < 1) {
        throw new Error(`Invalid page number: "${part}"`);
      }
      if (num <= maxPages) {
        pages.add(num);
      }
    }
  }
  return Array.from(pages).toSorted((a, b) => a - b);
}

export function coercePdfAssistantText(params: {
  message: AssistantMessage;
  provider: string;
  model: string;
}): string {
  const label = `${params.provider}/${params.model}`;
  const errorMessage = params.message.errorMessage?.trim();
  const fail = (message?: string) => {
    throw new Error(
      message ? `PDF model failed (${label}): ${message}` : `PDF model failed (${label})`,
    );
  };
  if (params.message.stopReason === "error" || params.message.stopReason === "aborted") {
    fail(errorMessage);
  }
  if (errorMessage) {
    fail(errorMessage);
  }
  const text = extractAssistantText(params.message);
  const trimmed = text.trim();
  if (trimmed) {
    return trimmed;
  }
  throw new Error(`PDF model returned no text (${label}).`);
}

export function coercePdfModelConfig(cfg?: OpenClawConfig): PdfModelConfig {
  const primary = resolveAgentModelPrimaryValue(cfg?.agents?.defaults?.pdfModel);
  const fallbacks = resolveAgentModelFallbackValues(cfg?.agents?.defaults?.pdfModel);
  const modelConfig: PdfModelConfig = {};
  if (primary?.trim()) {
    modelConfig.primary = primary.trim();
  }
  if (fallbacks.length > 0) {
    modelConfig.fallbacks = fallbacks;
  }
  return modelConfig;
}

export function resolvePdfToolMaxTokens(
  modelMaxTokens: number | undefined,
  requestedMaxTokens = 4096,
) {
  if (
    typeof modelMaxTokens !== "number" ||
    !Number.isFinite(modelMaxTokens) ||
    modelMaxTokens <= 0
  ) {
    return requestedMaxTokens;
  }
  return Math.min(requestedMaxTokens, modelMaxTokens);
}
