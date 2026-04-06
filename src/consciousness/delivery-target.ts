import type { OriginatingChannelType } from "../auto-reply/templating.js";

export type DeliveryTarget =
  | {
      kind: "node";
      id: string;
      nodeId?: string;
      label?: string;
    }
  | {
      kind: "channel";
      id: string;
      channelType?: OriginatingChannelType;
      label?: string;
    }
  | {
      kind: "none";
      label?: string;
    };

export function makeChannelDeliveryTarget(
  id: string,
  channelType?: OriginatingChannelType,
): DeliveryTarget {
  return {
    kind: "channel",
    id,
    channelType,
  };
}

export function normalizeDeliveryTarget(
  target: DeliveryTarget | null | undefined,
): DeliveryTarget | undefined {
  if (!target) return undefined;
  if (target.kind === "none") {
    return { kind: "none", label: target.label };
  }
  const id = target.id.trim();
  if (!id) return undefined;
  if (target.kind === "node") {
    return {
      kind: "node",
      id,
      nodeId: target.nodeId?.trim() || undefined,
      label: target.label?.trim() || undefined,
    };
  }
  return {
    kind: "channel",
    id,
    channelType: target.channelType,
    label: target.label?.trim() || undefined,
  };
}

export function getDeliveryTargetChannelId(
  target: DeliveryTarget | null | undefined,
): string | undefined {
  if (!target || target.kind === "none") return undefined;
  return target.id;
}

export function getDeliveryTargetChannelType(
  target: DeliveryTarget | null | undefined,
): OriginatingChannelType | undefined {
  return target?.kind === "channel" ? target.channelType : undefined;
}

export function migrateLegacyActiveChannel(
  activeChannelId: string | undefined,
  activeChannelType?: string | undefined,
): DeliveryTarget | undefined {
  const id = activeChannelId?.trim();
  if (!id) return undefined;
  return makeChannelDeliveryTarget(
    id,
    activeChannelType?.trim() ? (activeChannelType as OriginatingChannelType) : undefined,
  );
}
