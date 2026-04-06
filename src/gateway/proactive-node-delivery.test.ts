import { describe, expect, it, vi } from "vitest";
import { createNodeProactiveDeliverySender } from "./proactive-node-delivery.js";

describe("createNodeProactiveDeliverySender", () => {
  it("invokes system.notify on the targeted node", async () => {
    const nodeRegistry = {
      invoke: vi.fn().mockResolvedValue({ ok: true }),
    };
    const sender = createNodeProactiveDeliverySender(nodeRegistry);

    await sender(
      {
        kind: "node",
        id: "android-node-1",
        nodeId: "android-node-1",
      },
      "Exam starts in 2 hours",
    );

    expect(nodeRegistry.invoke).toHaveBeenCalledWith({
      nodeId: "android-node-1",
      command: "system.notify",
      params: {
        title: "OpenClaw",
        body: "Exam starts in 2 hours",
        priority: "active",
      },
    });
  });

  it("fails when the node invoke returns an error", async () => {
    const nodeRegistry = {
      invoke: vi.fn().mockResolvedValue({
        ok: false,
        error: { message: "node not connected" },
      }),
    };
    const sender = createNodeProactiveDeliverySender(nodeRegistry);

    await expect(
      sender(
        {
          kind: "node",
          id: "android-node-1",
        },
        "Exam starts in 2 hours",
      ),
    ).rejects.toThrow("node not connected");
  });
});
