import type { DeliveryTargetSender } from "../consciousness/delivery-runtime.js";
import type { NodeRegistry } from "./node-registry.js";

export function createNodeProactiveDeliverySender(
  nodeRegistry: Pick<NodeRegistry, "invoke">,
): DeliveryTargetSender {
  return async (target, content) => {
    if (target.kind !== "node") {
      throw new Error(
        `Gateway node delivery sender cannot route target kind "${target.kind}"`,
      );
    }
    const nodeId = target.nodeId?.trim() || target.id.trim();
    const result = await nodeRegistry.invoke({
      nodeId,
      command: "system.notify",
      params: {
        title: "OpenClaw",
        body: content,
        priority: "active",
      },
    });
    if (!result.ok) {
      throw new Error(result.error?.message ?? "node proactive delivery failed");
    }
  };
}
