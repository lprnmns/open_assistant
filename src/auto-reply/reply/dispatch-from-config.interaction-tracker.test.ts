import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import {
  _resetInteractionTrackerForTest,
  getActiveChannelId,
  getLastUserInteractionAt,
} from "../../consciousness/interaction-tracker.js";
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

describe("dispatchReplyFromConfig interaction tracking", () => {
  afterEach(() => {
    _resetInteractionTrackerForTest();
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
  });
});
