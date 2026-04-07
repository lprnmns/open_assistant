import type { OriginatingChannelType } from "../auto-reply/templating.js";
import type { OpenClawConfig } from "../config/config.js";
import {
  getConsciousnessDeliveryTargetSender,
  type DeliveryTargetSender,
} from "./delivery-runtime.js";
import {
  getDeliveryTargetChannelType,
  type DeliveryTarget,
} from "./delivery-target.js";
import { queuePendingProactiveDelivery } from "./interaction-tracker.js";
import { ingestConversationTurn } from "./turn-ingestion.js";

type BootChannelSender = (params: {
  channelType: OriginatingChannelType;
  channelId: string;
  content: string;
  cfg: OpenClawConfig;
}) => Promise<void>;

export type BootDeliveryTargetSenderDeps = {
  loadConfig: () => OpenClawConfig;
  sessionKey: string;
  ingestTurn?: typeof ingestConversationTurn;
  resolveRuntimeSender?: () => DeliveryTargetSender | null;
  sendChannelReply?: BootChannelSender;
  queuePendingDelivery?: typeof queuePendingProactiveDelivery;
};

export function createBootDeliveryTargetSender(
  deps: BootDeliveryTargetSenderDeps,
): DeliveryTargetSender {
  const ingestTurn = deps.ingestTurn ?? ingestConversationTurn;
  const sendChannelReply = deps.sendChannelReply ?? defaultSendChannelReply;
  const resolveRuntimeSender =
    deps.resolveRuntimeSender ?? getConsciousnessDeliveryTargetSender;
  const queuePendingDelivery = deps.queuePendingDelivery ?? queuePendingProactiveDelivery;

  return async (target: DeliveryTarget, content: string) => {
    if (target.kind === "node") {
      const runtimeSender = resolveRuntimeSender();
      if (!runtimeSender) {
        queuePendingDelivery({ target, content });
        await ingestTurn({
          direction: "assistant/proactive",
          sessionKey: deps.sessionKey,
          text: content,
        });
        return;
      }
      try {
        await runtimeSender(target, content);
      } catch (error) {
        if (!isQueueableNodeDeliveryError(error)) {
          throw error;
        }
        queuePendingDelivery({ target, content });
        await ingestTurn({
          direction: "assistant/proactive",
          sessionKey: deps.sessionKey,
          text: content,
        });
        return;
      }
      await ingestTurn({
        direction: "assistant/proactive",
        sessionKey: deps.sessionKey,
        text: content,
      });
      return;
    }

    if (target.kind !== "channel") {
      throw new Error(
        `No proactive transport available for delivery target kind "${target.kind}"`,
      );
    }

    const channelType = getDeliveryTargetChannelType(target);
    if (!channelType) {
      throw new Error(
        `Active channel is not routable for consciousness dispatch: ${String(channelType ?? "(unknown)")}`,
      );
    }

    await sendChannelReply({
      channelType,
      channelId: target.id,
      content,
      cfg: deps.loadConfig(),
    });
    await ingestTurn({
      direction: "assistant/proactive",
      sessionKey: deps.sessionKey,
      text: content,
    });
  };
}

function isQueueableNodeDeliveryError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.trim().toLowerCase()
      : String(error).trim().toLowerCase();
  return (
    message.includes("not connected") ||
    message.includes("disconnected") ||
    message.includes("timed out") ||
    message.includes("failed to send invoke")
  );
}

async function defaultSendChannelReply(params: {
  channelType: OriginatingChannelType;
  channelId: string;
  content: string;
  cfg: OpenClawConfig;
}): Promise<void> {
  const { isRoutableChannel, routeReply } = await import(
    "../auto-reply/reply/route-reply.js"
  );
  if (!isRoutableChannel(params.channelType)) {
    throw new Error(
      `Active channel is not routable for consciousness dispatch: ${String(params.channelType ?? "(unknown)")}`,
    );
  }
  const result = await routeReply({
    payload: { text: params.content },
    channel: params.channelType,
    to: params.channelId,
    cfg: params.cfg,
    mirror: false,
  });
  if (!result.ok) {
    throw new Error(
      result.error ??
        `Failed to route proactive message to ${params.channelType}`,
    );
  }
}
