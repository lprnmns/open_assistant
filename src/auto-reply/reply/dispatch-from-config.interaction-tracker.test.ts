import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { ProductionBrain } from "../../consciousness/brain/brain-factory.js";
import {
  _resetInteractionTrackerForTest,
  getActiveChannelId,
  getActiveChannelType,
  getLastUserInteractionAt,
} from "../../consciousness/interaction-tracker.js";
import { setConsciousnessRuntime } from "../../consciousness/runtime.js";
import type { ReplyDispatcher } from "./reply-dispatcher.js";
import { dispatchReplyFromConfig } from "./dispatch-from-config.js";
import { buildTestCtx } from "./test-ctx.js";

function createDispatcher(): ReplyDispatcher {
  return {
    sendToolResult: () => true,
    sendBlockReply: () => true,
    sendFinalReply: () => true,
    getQueuedCounts: () => ({ tool: 0, block: 0, final: 0 }),
    markComplete: () => {},
    waitForIdle: async () => {},
  };
}

function createRecordingDispatcher() {
  const sent = {
    tool: [] as unknown[],
    block: [] as unknown[],
    final: [] as unknown[],
  };

  const dispatcher: ReplyDispatcher = {
    sendToolResult: (payload) => {
      sent.tool.push(payload);
      return true;
    },
    sendBlockReply: (payload) => {
      sent.block.push(payload);
      return true;
    },
    sendFinalReply: (payload) => {
      sent.final.push(payload);
      return true;
    },
    getQueuedCounts: () => ({ tool: sent.tool.length, block: sent.block.length, final: sent.final.length }),
    markComplete: () => {},
    waitForIdle: async () => {},
  };

  return { dispatcher, sent };
}

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

describe("dispatchReplyFromConfig interaction tracking", () => {
  afterEach(() => {
    _resetInteractionTrackerForTest();
    setConsciousnessRuntime(null);
  });

  it("records OriginatingTo as the active route instead of the provider label", async () => {
    await dispatchReplyFromConfig({
      ctx: buildTestCtx({
        Provider: "webchat",
        Surface: "webchat",
        OriginatingChannel: "telegram",
        OriginatingTo: "telegram:123456789",
      }),
      cfg: {} as OpenClawConfig,
      dispatcher: createDispatcher(),
      replyResolver: async () => ({ text: "ok" }),
    });

    expect(getActiveChannelId()).toBe("telegram:123456789");
    expect(getActiveChannelType()).toBe("telegram");
    expect(getLastUserInteractionAt()).toBeTypeOf("number");
  });

  it("falls back to the current turn target when OriginatingTo is absent", async () => {
    await dispatchReplyFromConfig({
      ctx: buildTestCtx({
        OriginatingChannel: undefined,
        OriginatingTo: undefined,
        NativeChannelId: undefined,
        To: "channel:C123",
      }),
      cfg: {} as OpenClawConfig,
      dispatcher: createDispatcher(),
      replyResolver: async () => ({ text: "ok" }),
    });

    expect(getActiveChannelId()).toBe("channel:C123");
    expect(getActiveChannelType()).toBe("whatsapp");
  });

  it("ingests the normalized inbound user turn into the consciousness brain", async () => {
    const brain = makeFakeBrain();
    setConsciousnessRuntime({ brain });

    await dispatchReplyFromConfig({
      ctx: buildTestCtx({
        SessionKey: "main",
        Body: "hello founder",
        BodyForAgent: "hello founder",
        CommandBody: "hello founder",
      }),
      cfg: {} as OpenClawConfig,
      dispatcher: createDispatcher(),
      replyResolver: async () => ({ text: "ok" }),
    });

    expect(brain.ingestion.ingest).toHaveBeenCalledWith({
      content: "[user]: hello founder",
      sessionKey: "main",
    });
  });

  it("sanitizes executive final replies before delivery", async () => {
    const { dispatcher, sent } = createRecordingDispatcher();

    await dispatchReplyFromConfig({
      ctx: buildTestCtx({
        SessionKey: "main",
        Body: "kod patladi acil bak",
        BodyForAgent: "kod patladi acil bak",
        CommandBody: "kod patladi acil bak",
      }),
      cfg: {} as OpenClawConfig,
      dispatcher,
      replyResolver: async (_ctx, opts) => {
        opts?.onCognitiveModeResolved?.("executive");
        return {
          text: "Tabii ki 😊\nKok neden bu.\nBaşka bir şey var mı?",
        };
      },
    });

    expect(sent.final).toEqual([
      {
        text: "Kok neden bu.",
      },
    ]);
  });
});
