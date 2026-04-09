import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductionBrain } from "./brain/brain-factory.js";
import {
  extractIngestibleAssistantTexts,
  formatConversationTurnContent,
  ingestAssistantPayloads,
  ingestConversationTurn,
} from "./turn-ingestion.js";
import { __resetConsciousnessRuntimesForTest, setConsciousnessRuntime } from "./runtime.js";

function makeFakeBrain(): ProductionBrain {
  return {
    cortex: {
      stage: () => {},
      recent: () => [],
      clear: () => {},
    },
    hippocampus: {
      ingest: async () => {},
      recall: async () => [],
      close: async () => {},
    },
    embedder: {
      embed: async () => [],
    },
    ingestion: {
      ingest: vi.fn().mockResolvedValue(undefined),
    },
    recall: {
      recall: vi.fn().mockResolvedValue({ recent: [], recalled: [] }),
    },
    sessionKey: "consciousness-main",
    dbPath: "data/consciousness.db",
    providerId: "test-provider",
    model: "test-model",
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("turn-ingestion", () => {
  afterEach(async () => {
    await __resetConsciousnessRuntimesForTest();
  });

  it("formats user and assistant turn prefixes", () => {
    expect(
      formatConversationTurnContent({
        direction: "user",
        text: "  hello  ",
      }),
    ).toBe("[user]: hello");
    expect(
      formatConversationTurnContent({
        direction: "assistant/proactive",
        text: "status check",
      }),
    ).toBe("[assistant/proactive]: status check");
  });

  it("skips blank turn content", async () => {
    const brain = makeFakeBrain();
    setConsciousnessRuntime({ brain });

    await expect(
      ingestConversationTurn({
        direction: "user",
        sessionKey: "main",
        text: "   ",
      }),
    ).resolves.toBe(false);
    expect(brain.ingestion.ingest).not.toHaveBeenCalled();
  });

  it("writes a formatted turn into the active consciousness runtime", async () => {
    const brain = makeFakeBrain();
    setConsciousnessRuntime({ brain });

    await expect(
      ingestConversationTurn({
        direction: "assistant",
        sessionKey: "main",
        text: "hello founder",
      }),
    ).resolves.toBe(true);

    expect(brain.ingestion.ingest).toHaveBeenCalledWith({
      content: "[assistant]: hello founder",
      sessionKey: "main",
    });
  });

  it("filters silent, reasoning, compaction, and empty assistant payloads", async () => {
    const brain = makeFakeBrain();
    setConsciousnessRuntime({ brain });

    expect(
      extractIngestibleAssistantTexts([
        { text: "NO_REPLY" },
        { text: "  " },
        { text: "thinking", isReasoning: true },
        { text: "compacting", isCompactionNotice: true },
        { text: "real answer" },
      ]),
    ).toEqual(["real answer"]);

    await expect(
      ingestAssistantPayloads({
        sessionKey: "main",
        payloads: [
          { text: "NO_REPLY" },
          { text: "real answer" },
          { text: "compacting", isCompactionNotice: true },
        ],
      }),
    ).resolves.toBe(1);

    expect(brain.ingestion.ingest).toHaveBeenCalledWith({
      content: "[assistant]: real answer",
      sessionKey: "main",
    });
  });

  it("uses the scoped runtime when runtimeScope is provided", async () => {
    const defaultRuntime = { brain: makeFakeBrain() };
    const scopedRuntime = { brain: makeFakeBrain() };

    setConsciousnessRuntime(defaultRuntime);
    setConsciousnessRuntime(scopedRuntime, "account:user-a");

    await expect(
      ingestConversationTurn({
        direction: "user",
        sessionKey: "agent:main:webchat:direct:123",
        text: "scoped hello",
        runtimeScope: "account:user-a",
      }),
    ).resolves.toBe(true);

    expect(defaultRuntime.brain.ingestion.ingest).not.toHaveBeenCalled();
    expect(scopedRuntime.brain.ingestion.ingest).toHaveBeenCalledWith({
      content: "[user]: scoped hello",
      sessionKey: "agent:main:webchat:direct:123",
    });
  });
});
