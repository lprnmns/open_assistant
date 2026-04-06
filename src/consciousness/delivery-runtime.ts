import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import type { DeliveryTarget } from "./delivery-target.js";

export type DeliveryTargetSender = (
  target: DeliveryTarget,
  content: string,
) => Promise<void>;

type DeliveryRuntimeStore = {
  sender: DeliveryTargetSender | null;
};

const DELIVERY_RUNTIME_KEY = Symbol.for("openclaw.consciousness.delivery-runtime");

function getDeliveryRuntimeStore(): DeliveryRuntimeStore {
  return resolveGlobalSingleton(DELIVERY_RUNTIME_KEY, () => ({
    sender: null,
  }));
}

export function setConsciousnessDeliveryTargetSender(
  sender: DeliveryTargetSender | null,
): void {
  getDeliveryRuntimeStore().sender = sender;
}

export function getConsciousnessDeliveryTargetSender(): DeliveryTargetSender | null {
  return getDeliveryRuntimeStore().sender;
}
