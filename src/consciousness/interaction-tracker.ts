/**
 * src/consciousness/interaction-tracker.ts
 *
 * Lightweight in-memory tracker for the most recent owner interaction.
 * Updated by the inbound message pipeline on every user→bot message.
 * Read by the consciousness snapshot adapters to populate:
 *   - lastUserInteractionAt
 *   - activeChannelId
 *
 * Scope: process lifetime only — no persistence, no Redis.
 * Real persistence (Redis) is wired in Sub-Task 9.2.
 */

let _lastUserInteractionAt: number | undefined = undefined;
let _activeChannelId: string | undefined = undefined;

/**
 * Called by the inbound message pipeline when a user message arrives.
 * @param channelId  Normalized channel identifier (e.g. "telegram", "whatsapp").
 */
export function recordUserInteraction(channelId: string): void {
  _lastUserInteractionAt = Date.now();
  _activeChannelId = channelId;
}

/** Returns the epoch-ms timestamp of the last owner message, or undefined if none yet. */
export function getLastUserInteractionAt(): number | undefined {
  return _lastUserInteractionAt;
}

/** Returns the channel where the owner last interacted, or undefined if none yet. */
export function getActiveChannelId(): string | undefined {
  return _activeChannelId;
}

/** Reset state — for tests only, never call in production. */
export function _resetInteractionTrackerForTest(): void {
  _lastUserInteractionAt = undefined;
  _activeChannelId = undefined;
}
