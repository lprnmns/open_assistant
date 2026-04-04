import { SessionManager, type SessionEntry as PiSessionEntry } from "@mariozechner/pi-coding-agent";
import {
  resolveDefaultSessionStorePath,
} from "../config/sessions/paths.js";
import { loadSessionStore, normalizeStoreSessionKey } from "../config/sessions/store.js";
import { resolveSessionTranscriptFile } from "../config/sessions/transcript.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import type { MemoryNote, MemoryRecallResult } from "./brain/types.js";
import { getConsciousnessRuntime, type ConsciousnessRuntime } from "./runtime.js";

const LOCAL_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const MAX_TRANSCRIPT_GROUND_TRUTH_LINES = 3;
const TRANSCRIPT_PREVIEW_MAX_CHARS = 160;
const TEMPORAL_QUERY_MARKERS = [
  "what time",
  "timestamp",
  "time",
  "date",
  "when",
  "ne zaman",
  "ani",
  "anı",
  "hangi gun",
  "hangi gün",
  "saat",
  "tarih",
] as const;
const QUERY_STOP_WORDS = new Set([
  "the",
  "this",
  "that",
  "what",
  "when",
  "where",
  "were",
  "was",
  "is",
  "are",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "for",
  "did",
  "tam",
  "olarak",
  "olan",
  "oldu",
  "neydi",
  "ne",
  "hangi",
  "gibi",
  "su",
  "şu",
  "an",
  "ani",
  "anı",
  "bu",
]);

type TranscriptGroundTruthEntry = {
  timestamp: number;
  localTimestamp: string;
  role: "user" | "assistant";
  text: string;
};

function formatMemoryList(title: string, notes: readonly MemoryNote[]): string | undefined {
  if (notes.length === 0) {
    return undefined;
  }
  return [title, ...notes.map((note) => `- ${note.content}`)].join("\n");
}

export function formatReactiveRecallSection(
  result: MemoryRecallResult,
  options: {
    transcriptGroundTruth?: string;
  } = {},
): string | undefined {
  const sections = [
    options.transcriptGroundTruth,
    result.warning ? `Temporal recall warning: ${result.warning}` : undefined,
    formatMemoryList("Recent conversation:", result.recent),
    formatMemoryList("Related memories:", result.recalled),
  ].filter(Boolean);

  if (sections.length === 0) {
    return undefined;
  }

  return [
    "Consciousness memory context:",
    ...sections,
  ].join("\n\n");
}

export async function buildReactiveRecallSection(params: {
  text?: string | null;
  sessionKey?: string;
  runtime?: ConsciousnessRuntime | null;
  storePath?: string;
}): Promise<string | undefined> {
  const queryText = params.text?.trim();
  if (!queryText || !params.sessionKey) {
    return undefined;
  }

  const transcriptGroundTruth = await buildTranscriptGroundTruthSection({
    text: queryText,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
  });
  const runtime = params.runtime ?? getConsciousnessRuntime();
  let recallResult: MemoryRecallResult = { recent: [], recalled: [] };

  if (runtime) {
    try {
      recallResult = await runtime.brain.recall.recall({
        text: queryText,
        sessionKey: params.sessionKey,
      });
    } catch {
      // Swallow recall failures; transcript ground truth can still answer
      // exact temporal questions from the active session transcript.
    }
  }

  if (!transcriptGroundTruth && recallResult.recent.length === 0 && recallResult.recalled.length === 0) {
    return undefined;
  }

  return formatReactiveRecallSection(recallResult, { transcriptGroundTruth });
}

async function buildTranscriptGroundTruthSection(params: {
  text: string;
  sessionKey: string;
  storePath?: string;
}): Promise<string | undefined> {
  if (!looksLikeTemporalQuery(params.text)) {
    return undefined;
  }

  const entries = await loadTranscriptGroundTruthEntries(params);
  if (entries.length === 0) {
    return undefined;
  }

  const stems = buildSearchStems(params.text);
  const rankedEntries = entries
    .map((entry, index) => ({
      entry,
      score: scoreTranscriptEntry(entry, stems),
      index,
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.entry.timestamp !== left.entry.timestamp) {
        return right.entry.timestamp - left.entry.timestamp;
      }
      return left.index - right.index;
    })
    .slice(0, MAX_TRANSCRIPT_GROUND_TRUTH_LINES)
    .sort((left, right) => left.entry.timestamp - right.entry.timestamp);

  if (rankedEntries.length === 0) {
    return undefined;
  }

  return [
    "Transcript ground truth (prefer this for exact dates/times):",
    ...rankedEntries.map(
      ({ entry }) => `- ${entry.localTimestamp} | ${entry.role} | ${truncateText(entry.text)}`,
    ),
  ].join("\n");
}

async function loadTranscriptGroundTruthEntries(params: {
  sessionKey: string;
  storePath?: string;
}): Promise<TranscriptGroundTruthEntry[]> {
  try {
    const agentId = resolveAgentIdFromSessionKey(params.sessionKey);
    const storePath = params.storePath?.trim() || resolveDefaultSessionStorePath(agentId);
    const store = loadSessionStore(storePath, { skipCache: true });
    const normalizedKey = normalizeStoreSessionKey(params.sessionKey);
    const sessionEntry = (store[normalizedKey] ?? store[params.sessionKey]) as
      | SessionEntry
      | undefined;
    if (!sessionEntry?.sessionId) {
      return [];
    }

    const resolved = await resolveSessionTranscriptFile({
      sessionId: sessionEntry.sessionId,
      sessionKey: params.sessionKey,
      sessionEntry,
      sessionStore: store,
      storePath,
      agentId,
    });
    const sessionFile = resolved.sessionFile;
    const entries = SessionManager.open(sessionFile).getEntries() as PiSessionEntry[];
    return extractTranscriptGroundTruthEntries(entries);
  } catch {
    return [];
  }
}

function extractTranscriptGroundTruthEntries(
  entries: readonly PiSessionEntry[],
): TranscriptGroundTruthEntry[] {
  return entries
    .map((entry) => toTranscriptGroundTruthEntry(entry))
    .filter((entry): entry is TranscriptGroundTruthEntry => Boolean(entry));
}

function toTranscriptGroundTruthEntry(entry: PiSessionEntry): TranscriptGroundTruthEntry | undefined {
  const record = entry as {
    message?: {
      role?: unknown;
      content?: unknown;
      timestamp?: unknown;
    };
    role?: unknown;
    content?: unknown;
    timestamp?: unknown;
  };
  const message = record.message ?? record;
  const role = normalizeTranscriptRole(message.role);
  if (!role) {
    return undefined;
  }
  const text = extractTranscriptText(message.content);
  const timestamp = resolveTranscriptTimestamp(message.timestamp ?? record.timestamp);
  if (!text || timestamp === undefined) {
    return undefined;
  }
  return {
    timestamp,
    localTimestamp: formatLocalTimestamp(timestamp),
    role,
    text,
  };
}

function normalizeTranscriptRole(role: unknown): "user" | "assistant" | undefined {
  if (typeof role !== "string") {
    return undefined;
  }
  const normalized = role.trim().toLowerCase();
  if (normalized === "user" || normalized === "assistant") {
    return normalized;
  }
  return undefined;
}

function extractTranscriptText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }
        if (!item || typeof item !== "object") {
          return "";
        }
        const record = item as { text?: unknown; content?: unknown };
        if (typeof record.text === "string") {
          return record.text.trim();
        }
        if (typeof record.content === "string") {
          return record.content.trim();
        }
        return "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  if (content && typeof content === "object") {
    const record = content as { text?: unknown; content?: unknown };
    if (typeof record.text === "string") {
      return record.text.trim();
    }
    if (typeof record.content === "string") {
      return record.content.trim();
    }
  }
  return "";
}

function resolveTranscriptTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function looksLikeTemporalQuery(text: string): boolean {
  const normalized = normalizeSearchText(text);
  return TEMPORAL_QUERY_MARKERS.some((marker) => normalized.includes(normalizeSearchText(marker)));
}

function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchStems(text: string): string[] {
  const stems = new Set<string>();
  for (const token of normalizeSearchText(text).split(" ")) {
    if (!token || QUERY_STOP_WORDS.has(token)) {
      continue;
    }
    if (token.length >= 4) {
      stems.add(token.slice(0, 4));
      stems.add(token.slice(0, 3));
      continue;
    }
    if (token.length >= 3) {
      stems.add(token);
    }
  }
  return [...stems];
}

function scoreTranscriptEntry(entry: TranscriptGroundTruthEntry, stems: readonly string[]): number {
  const normalizedText = normalizeSearchText(entry.text);
  let score = entry.role === "user" ? 1 : 0;
  for (const stem of stems) {
    if (stem && normalizedText.includes(stem)) {
      score += stem.length >= 4 ? 3 : 1;
    }
  }
  return score;
}

function truncateText(value: string): string {
  return value.length <= TRANSCRIPT_PREVIEW_MAX_CHARS
    ? value
    : `${value.slice(0, TRANSCRIPT_PREVIEW_MAX_CHARS - 3).trimEnd()}...`;
}

function formatLocalTimestamp(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const map = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second} ${LOCAL_TIME_ZONE}`;
}
