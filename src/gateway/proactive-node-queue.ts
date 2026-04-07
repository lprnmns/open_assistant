import type { DeliveryTargetSender } from "../consciousness/delivery-runtime.js";
import {
  acknowledgePendingProactiveDeliveries,
  getPendingProactiveDeliveries,
} from "../consciousness/interaction-tracker.js";

export async function drainPendingProactiveNodeDeliveries(params: {
  nodeId: string;
  sender: DeliveryTargetSender;
  limit?: number;
}): Promise<{ delivered: number; remaining: number }> {
  const nodeId = params.nodeId.trim();
  if (!nodeId) {
    return { delivered: 0, remaining: 0 };
  }
  const matching = getPendingProactiveDeliveries().filter((entry) => {
    if (entry.target.kind !== "node") {
      return false;
    }
    return (entry.target.nodeId?.trim() || entry.target.id.trim()) === nodeId;
  });
  const queued = matching.slice(0, Math.max(0, params.limit ?? matching.length));
  let delivered = 0;
  for (const entry of queued) {
    try {
      await params.sender(entry.target, entry.content);
      acknowledgePendingProactiveDeliveries([entry.id]);
      delivered += 1;
    } catch {
      break;
    }
  }
  return {
    delivered,
    remaining: Math.max(0, queued.length - delivered),
  };
}
