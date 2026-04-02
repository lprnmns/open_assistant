import type { OriginatingChannelType } from "../auto-reply/templating.js";

/**
 * src/consciousness/interaction-tracker.ts
 *
 * Lightweight in-memory tracker for the most recent owner interaction.
 * Updated by the shared inbound reply pipeline on every user→bot message.
 * Read by the consciousness snapshot adapters to populate:
 *   - lastUserInteractionAt
 *   - activeChannelId
 *   - activeChannelType
 *
 * Scope: process lifetime only — no persistence, no Redis.
 * Real persistence (Redis) is wired in Sub-Task 9.2.
 */

export type InteractionRouteLike = {
  OriginatingTo?: string;
  NativeChannelId?: string;
  To?: string;
  From?: string;
};

let _lastUserInteractionAt: number | undefined = undefined;
let _activeChannelId: string | undefined = undefined;
let _activeChannelType: OriginatingChannelType | undefined = undefined;

function normalizeRouteValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve the best available active-route key for proactive follow-up.
 *
 * Order matters:
 * - OriginatingTo is the explicit reply target carried across channels/extensions
 * - NativeChannelId is the provider-specific conversation id when present
 * - To / From are best-effort fallbacks for legacy contexts
 */
export function resolveActiveChannelIdFromInteraction(
  route: InteractionRouteLike,
): string | undefined {
  return (
    normalizeRouteValue(route.OriginatingTo) ??
    normalizeRouteValue(route.NativeChannelId) ??
    normalizeRouteValue(route.To) ??
    normalizeRouteValue(route.From)
  );
}

/**
 * Called by the shared inbound reply pipeline when a user message arrives.
 * @param channelId    Stable route key (for example "telegram:123" or "channel:C1").
 * @param channelType  Provider/channel type required for routeReply().
 */
export function recordUserInteraction(
  channelId: string,
  channelType?: OriginatingChannelType,
): void {
  _lastUserInteractionAt = Date.now();
  _activeChannelId = channelId;
  _activeChannelType = channelType;
}

/** Returns the epoch-ms timestamp of the last owner message, or undefined if none yet. */
export function getLastUserInteractionAt(): number | undefined {
  return _lastUserInteractionAt;
}

/** Returns the channel where the owner last interacted, or undefined if none yet. */
export function getActiveChannelId(): string | undefined {
  return _activeChannelId;
}

/** Returns the active channel type for the last owner interaction, if known. */
export function getActiveChannelType(): OriginatingChannelType | undefined {
  return _activeChannelType;
}

/** Reset state — for tests only, never call in production. */
export function _resetInteractionTrackerForTest(): void {
  _lastUserInteractionAt = undefined;
  _activeChannelId = undefined;
  _activeChannelType = undefined;
}
