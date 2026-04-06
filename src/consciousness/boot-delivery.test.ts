import { describe, expect, it, vi } from "vitest";
import { createBootDeliveryTargetSender } from "./boot-delivery.js";

describe("createBootDeliveryTargetSender", () => {
  it("uses the runtime sender for node targets and ingests the proactive turn", async () => {
    const runtimeSender = vi.fn().mockResolvedValue(undefined);
    const ingestTurn = vi.fn().mockResolvedValue(undefined);
    const sendToTarget = createBootDeliveryTargetSender({
      loadConfig: () => ({}) as never,
      sessionKey: "main",
      ingestTurn,
      resolveRuntimeSender: () => runtimeSender,
    });

    await sendToTarget(
      {
        kind: "node",
        id: "android-node-1",
        nodeId: "android-node-1",
      },
      "Ping me",
    );

    expect(runtimeSender).toHaveBeenCalledWith(
      {
        kind: "node",
        id: "android-node-1",
        nodeId: "android-node-1",
      },
      "Ping me",
    );
    expect(ingestTurn).toHaveBeenCalledWith({
      direction: "assistant/proactive",
      sessionKey: "main",
      text: "Ping me",
    });
  });

  it("fails for node targets when no runtime sender is registered", async () => {
    const ingestTurn = vi.fn().mockResolvedValue(undefined);
    const sendToTarget = createBootDeliveryTargetSender({
      loadConfig: () => ({}) as never,
      sessionKey: "main",
      ingestTurn,
      resolveRuntimeSender: () => null,
    });

    await expect(
      sendToTarget(
        {
          kind: "node",
          id: "android-node-1",
          nodeId: "android-node-1",
        },
        "Ping me",
      ),
    ).rejects.toThrow('No proactive transport available for delivery target kind "node"');
    expect(ingestTurn).not.toHaveBeenCalled();
  });

  it("routes channel targets through the channel sender and ingests the proactive turn", async () => {
    const ingestTurn = vi.fn().mockResolvedValue(undefined);
    const sendChannelReply = vi.fn().mockResolvedValue(undefined);
    const sendToTarget = createBootDeliveryTargetSender({
      loadConfig: () => ({ feature: "test" }) as never,
      sessionKey: "main",
      ingestTurn,
      sendChannelReply,
    });

    await sendToTarget(
      {
        kind: "channel",
        id: "telegram:owner",
        channelType: "telegram",
      },
      "Hello there",
    );

    expect(sendChannelReply).toHaveBeenCalledWith({
      channelType: "telegram",
      channelId: "telegram:owner",
      content: "Hello there",
      cfg: { feature: "test" },
    });
    expect(ingestTurn).toHaveBeenCalledWith({
      direction: "assistant/proactive",
      sessionKey: "main",
      text: "Hello there",
    });
  });
});
