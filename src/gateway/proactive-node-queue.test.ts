import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetInteractionTrackerForTest,
  getPendingProactiveDeliveries,
  queuePendingProactiveDelivery,
} from "../consciousness/interaction-tracker.js";
import { drainPendingProactiveNodeDeliveries } from "./proactive-node-queue.js";

describe("drainPendingProactiveNodeDeliveries", () => {
  afterEach(() => {
    _resetInteractionTrackerForTest();
  });

  it("delivers queued messages for the matching node and acknowledges them", async () => {
    const queuedAt = Date.now() - 1_000;
    queuePendingProactiveDelivery({
      id: "queued-1",
      target: { kind: "node", id: "android-node-1" },
      content: "first",
      queuedAt,
    });
    queuePendingProactiveDelivery({
      id: "queued-2",
      target: { kind: "node", id: "android-node-2" },
      content: "second",
      queuedAt: queuedAt + 1_000,
    });
    const sender = vi.fn().mockResolvedValue(undefined);

    const result = await drainPendingProactiveNodeDeliveries({
      nodeId: "android-node-1",
      sender,
    });

    expect(result).toEqual({ delivered: 1, remaining: 0 });
    expect(sender).toHaveBeenCalledWith(
      {
        kind: "node",
        id: "android-node-1",
        nodeId: undefined,
        label: undefined,
      },
      "first",
    );
    expect(getPendingProactiveDeliveries()).toEqual([
      {
        id: "queued-2",
        target: {
          kind: "node",
          id: "android-node-2",
          nodeId: undefined,
          label: undefined,
        },
        content: "second",
        queuedAt: queuedAt + 1_000,
      },
    ]);
  });

  it("stops draining after the first failed delivery and leaves the rest queued", async () => {
    const queuedAt = Date.now() - 1_000;
    queuePendingProactiveDelivery({
      id: "queued-1",
      target: { kind: "node", id: "android-node-1" },
      content: "first",
      queuedAt,
    });
    queuePendingProactiveDelivery({
      id: "queued-2",
      target: { kind: "node", id: "android-node-1" },
      content: "second",
      queuedAt: queuedAt + 1_000,
    });
    const sender = vi
      .fn()
      .mockRejectedValueOnce(new Error("node not connected"))
      .mockResolvedValue(undefined);

    const result = await drainPendingProactiveNodeDeliveries({
      nodeId: "android-node-1",
      sender,
    });

    expect(result).toEqual({ delivered: 0, remaining: 2 });
    expect(getPendingProactiveDeliveries()).toHaveLength(2);
  });
});
