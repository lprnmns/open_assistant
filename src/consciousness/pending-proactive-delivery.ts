import {
  normalizeDeliveryTarget,
  type DeliveryTarget,
} from "./delivery-target.js";

export const PENDING_PROACTIVE_DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;
export const PENDING_PROACTIVE_DELIVERY_MAX_COUNT = 20;

export type PendingProactiveDelivery = {
  id: string;
  target: DeliveryTarget;
  content: string;
  queuedAt: number;
};

export function normalizePendingProactiveDelivery(
  value: PendingProactiveDelivery | null | undefined,
): PendingProactiveDelivery | undefined {
  if (!value) {
    return undefined;
  }
  const id = value.id?.trim();
  const target = normalizeDeliveryTarget(value.target);
  const content = value.content?.trim();
  const queuedAt = Number(value.queuedAt);
  if (!id || !target || target.kind !== "node" || !content || !Number.isFinite(queuedAt)) {
    return undefined;
  }
  return {
    id,
    target,
    content,
    queuedAt,
  };
}

export function prunePendingProactiveDeliveries(
  values: PendingProactiveDelivery[] | null | undefined,
  now = Date.now(),
): PendingProactiveDelivery[] {
  const normalized =
    values
      ?.map((value) => normalizePendingProactiveDelivery(value))
      .filter((value): value is PendingProactiveDelivery => Boolean(value))
      .filter((value) => now - value.queuedAt <= PENDING_PROACTIVE_DELIVERY_TTL_MS) ?? [];
  if (normalized.length <= PENDING_PROACTIVE_DELIVERY_MAX_COUNT) {
    return normalized;
  }
  return normalized.slice(-PENDING_PROACTIVE_DELIVERY_MAX_COUNT);
}
