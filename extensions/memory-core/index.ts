import type { MemoryPromptSectionBuilder } from "openclaw/plugin-sdk/memory-core";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export const buildPromptSection: MemoryPromptSectionBuilder = ({
  availableTools,
  citationsMode,
  hasPrimaryRecallContext,
}) => {
  const hasMemorySearch = availableTools.has("memory_search");
  const hasMemoryGet = availableTools.has("memory_get");

  if (!hasMemorySearch && !hasMemoryGet) {
    return [];
  }

  let toolGuidance: string;
  if (hasPrimaryRecallContext) {
    if (hasMemorySearch && hasMemoryGet) {
      toolGuidance =
        "Primary recall is already loaded into active context automatically. Use memory_search only when you need to look up a specific note or memory file, then use memory_get to pull just the supporting lines you still need. Do not probe memory files with generic file tools unless the user explicitly asks for raw file contents.";
    } else if (hasMemorySearch) {
      toolGuidance =
        "Primary recall is already loaded into active context automatically. Use memory_search only when you need to look up a specific note or memory file that is not already covered. Do not probe memory files with generic file tools unless the user explicitly asks for raw file contents.";
    } else {
      toolGuidance =
        "Primary recall is already loaded into active context automatically. Use memory_get only when you already know the exact memory file or note you still need to inspect. Do not probe memory files with generic file tools unless the user explicitly asks for raw file contents.";
    }
  } else if (hasMemorySearch && hasMemoryGet) {
      toolGuidance =
      "Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search first, then use memory_get to pull only the needed lines. Treat memory_search and memory_get as the memory interface; do not probe memory files with generic file tools unless the user explicitly asks for raw file contents. If low confidence after search, say you checked.";
  } else if (hasMemorySearch) {
    toolGuidance =
      "Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search and answer from the matching results. Treat memory_search as the memory interface; do not probe memory files with generic file tools unless the user explicitly asks for raw file contents. If low confidence after search, say you checked.";
  } else {
    toolGuidance =
      "Before answering anything about prior work, decisions, dates, people, preferences, or todos that already point to a specific memory file or note: run memory_get to pull only the needed lines. Treat memory_get as the memory interface; do not probe memory files with generic file tools unless the user explicitly asks for raw file contents. If low confidence after reading them, say you checked.";
  }

  const lines = ["## Memory Recall", toolGuidance];
  if (citationsMode === "off") {
    lines.push(
      "Citations are disabled: do not mention file paths or line numbers in replies unless the user explicitly asks.",
    );
  } else {
    lines.push(
      "Citations: include Source: <path#line> when it helps the user verify memory snippets.",
    );
  }
  lines.push("");
  return lines;
};

export default definePluginEntry({
  id: "memory-core",
  name: "Memory (Core)",
  description: "File-backed memory search tools and CLI",
  kind: "memory",
  register(api) {
    api.registerMemoryPromptSection(buildPromptSection);

    api.registerTool(
      (ctx) =>
        api.runtime.tools.createMemorySearchTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      { names: ["memory_search"] },
    );

    api.registerTool(
      (ctx) =>
        api.runtime.tools.createMemoryGetTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      { names: ["memory_get"] },
    );

    api.registerCli(
      ({ program }) => {
        api.runtime.tools.registerMemoryCli(program);
      },
      { commands: ["memory"] },
    );
  },
});
