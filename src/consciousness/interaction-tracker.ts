import type { OriginatingChannelType } from "../auto-reply/templating.js";
import {
  getDeliveryTargetChannelId,
  getDeliveryTargetChannelType,
  makeChannelDeliveryTarget,
  migrateLegacyActiveChannel,
  type DeliveryTarget,
} from "./delivery-target.js";
import type { InteractionStore, PersistedInteractionState } from "./interaction-store.js";

/**
 * src/consciousness/interaction-tracker.ts
 *
 * Lightweight in-memory tracker for the most recent owner interaction.
 * Updated by the shared inbound reply pipeline on every user→bot message.
 * Read by the consciousness snapshot adapters to populate:
 *   - lastUserInteractionAt
 *   - activeDeliveryTarget
 *
 * Persistence: when an InteractionStore is wired via setInteractionStore(),
 *   every recordUserInteraction() call debounce-flushes state to disk so that
 *   process restarts do not reset the interaction timeline.
 *   Boot-lifecycle seeds the in-memory state via seedInteractionTracker()
 *   before the consciousness loop starts.
 */

export type InteractionRouteLike = {
  OriginatingTo?: string;
  NativeChannelId?: string;
  To?: string;
  From?: string;
};

let _lastUserInteractionAt: number | undefined = undefined;
let _activeDeliveryTarget: DeliveryTarget | undefined = undefined;
let _store: InteractionStore | null = null;

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

export function resolveDeliveryTargetFromInteraction(
  route: InteractionRouteLike,
  channelType?: OriginatingChannelType,
): DeliveryTarget | undefined {
  const channelId = resolveActiveChannelIdFromInteraction(route);
  return channelId ? makeChannelDeliveryTarget(channelId, channelType) : undefined;
}

/**
 * Wire a persistent store so that every recordUserInteraction() call is
 * debounce-flushed to disk.  Call once at boot (before the first message
 * can arrive).  Pass null to detach the store (shutdown / test teardown).
 */
export function setInteractionStore(store: InteractionStore | null): void {
  _store = store;
}

/**
 * Seed in-memory state from a previously persisted snapshot.
 * Called by boot-lifecycle after loadSync() — must run before the first
 * inbound message can arrive so the tracker never returns stale undefined.
 */
export function seedInteractionTracker(state: PersistedInteractionState): void {
  if (state.lastUserInteractionAt !== undefined) {
    _lastUserInteractionAt = state.lastUserInteractionAt;
  }
  const activeDeliveryTarget =
    state.activeDeliveryTarget ??
    migrateLegacyActiveChannel(state.activeChannelId, state.activeChannelType);
  if (activeDeliveryTarget !== undefined) {
    _activeDeliveryTarget = activeDeliveryTarget;
  }
}

export function recordDeliveryTargetInteraction(
  target: DeliveryTarget,
): void {
  _lastUserInteractionAt = Date.now();
  _activeDeliveryTarget = target;
  _store?.save({
    lastUserInteractionAt: _lastUserInteractionAt,
    activeDeliveryTarget: _activeDeliveryTarget,
    activeChannelId: getDeliveryTargetChannelId(_activeDeliveryTarget),
    activeChannelType: getDeliveryTargetChannelType(_activeDeliveryTarget),
  });
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
  recordDeliveryTargetInteraction(makeChannelDeliveryTarget(channelId, channelType));
}

/** Returns the epoch-ms timestamp of the last owner message, or undefined if none yet. */
export function getLastUserInteractionAt(): number | undefined {
  return _lastUserInteractionAt;
}

/** Returns the canonical delivery target for the last owner interaction, if any. */
export function getActiveDeliveryTarget(): DeliveryTarget | undefined {
  return _activeDeliveryTarget;
}

/** Returns the channel where the owner last interacted, or undefined if none yet. */
export function getActiveChannelId(): string | undefined {
  return getDeliveryTargetChannelId(_activeDeliveryTarget);
}

/** Returns the active channel type for the last owner interaction, if known. */
export function getActiveChannelType(): OriginatingChannelType | undefined {
  return getDeliveryTargetChannelType(_activeDeliveryTarget);
}

/** Reset state — for tests only, never call in production. */
export function _resetInteractionTrackerForTest(): void {
  _lastUserInteractionAt = undefined;
  _activeDeliveryTarget = undefined;
  _store = null;
}
