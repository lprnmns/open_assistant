import type { MemoryNote, MemoryRecallResult } from "./brain/types.js";
import { getConsciousnessRuntime, type ConsciousnessRuntime } from "./runtime.js";

function formatMemoryList(title: string, notes: readonly MemoryNote[]): string | undefined {
  if (notes.length === 0) {
    return undefined;
  }
  return [title, ...notes.map((note) => `- ${note.content}`)].join("\n");
}

export function formatReactiveRecallSection(
  result: MemoryRecallResult,
): string | undefined {
  const sections = [
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
}): Promise<string | undefined> {
  const queryText = params.text?.trim();
  if (!queryText || !params.sessionKey) {
    return undefined;
  }

  const runtime = params.runtime ?? getConsciousnessRuntime();
  if (!runtime) {
    return undefined;
  }

  try {
    const result = await runtime.brain.recall.recall({
      text: queryText,
      sessionKey: params.sessionKey,
    });
    return formatReactiveRecallSection(result);
  } catch {
    return undefined;
  }
}
