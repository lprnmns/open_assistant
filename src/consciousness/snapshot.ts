/**
 * src/consciousness/snapshot.ts — Production WorldSnapshot builder
 *
 * Provides buildRealWorldSnapshot() — the production implementation of the
 * buildSnapshot() callback required by ConsciousnessScheduler.
 *
 * Design: dependency-injection.  All data sources are passed as functions
 * on SnapshotAdapters so the caller (production app or test) controls the
 * actual backends (Redis, DB, session store, etc.).
 *
 * Usage (production):
 *
 *   const adapters: SnapshotAdapters = {
 *     getLastUserInteractionAt: () => redis.get("lastUserMsg:session-1").then(Number),
 *     getPendingNoteCount: () => reflectionQueue.count(),
 *     getFiredTriggerIds: () => triggerRegistry.drainFired(),
 *     getActiveChannelId: () => sessionStore.getActiveChannel("session-1"),
 *     getLastTickAt: () => scheduler.lastTickAt,
 *     getEffectiveSilenceThresholdMs: () => scheduler.effectiveSilenceThresholdMs,
 *   };
 *
 *   const scheduler = startConsciousnessLoop({
 *     buildSnapshot: () => buildRealWorldSnapshot(adapters),
 *     dispatch: { ... },
 *   });
 *
 * Fields left to their zero-values in the first iteration:
 *   - dueCronExpressions: [] (cron registry not yet wired)
 *   - externalWorldEvents: [] (external webhook pipeline not yet wired)
 *
 * These are intentionally explicit empty-array defaults — not missing.
 * When the cron and external-event pipelines are wired (Sub-Task 9.2+),
 * callers add the corresponding adapters without changing this module.
 */

import type { WorldSnapshot } from "./types.js";
import { DEFAULT_CONSCIOUSNESS_CONFIG } from "./types.js";
import type { OriginatingChannelType } from "../auto-reply/templating.js";
import type { DeliveryTarget } from "./delivery-target.js";
import {
  getDeliveryTargetChannelId,
  getDeliveryTargetChannelType,
  makeChannelDeliveryTarget,
} from "./delivery-target.js";

// ── Adapters ──────────────────────────────────────────────────────────────────

/**
 * Caller-supplied data sources for snapshot construction.
 *
 * Each adapter is an async (or sync returning a value) function so that
 * production callers can hit Redis/DB/session store while tests inject stubs.
 */
export type SnapshotAdapters = {
  /**
   * Unix ms of the last user interaction (any direction).
   * Returns undefined if no interaction has occurred yet.
   */
  getLastUserInteractionAt: () => Promise<number | undefined> | number | undefined;

  /**
   * Number of notes currently queued for LLM reflection.
   * Must come from PendingReflectionQueue.count(), NOT Cortex.size().
   */
  getPendingNoteCount: () => number;

  /**
   * Trigger IDs that have fired since the last tick.
   * Callers should drain the registry each call (return-and-clear).
   */
  getFiredTriggerIds: () => Promise<string[]> | string[];

  /**
   * Cron expressions that are due this tick.
   * Return [] if cron registry is not wired yet.
   */
  getDueCronExpressions?: () => Promise<string[]> | string[];

  /**
   * External world event descriptors since the last tick.
   * Format: "<source>:<kind>:<id>".
   * Return [] if external event pipeline is not wired yet.
   */
  getExternalWorldEvents?: () => Promise<string[]> | string[];

  /**
   * The ID of the owner's currently active channel.
   * Returns undefined when no channel session is active.
   */
  getActiveChannelId: () => Promise<string | undefined> | string | undefined;

  /**
   * Provider/channel type for the owner's active route.
   * Returns undefined when the route is unknown or not yet tracked.
   */
  getActiveChannelType?: () =>
    | Promise<OriginatingChannelType | undefined>
    | OriginatingChannelType
    | undefined;

  /**
   * Canonical proactive delivery target.
   * When omitted, snapshot construction derives it from the legacy channel adapters.
   */
  getActiveDeliveryTarget?: () => Promise<DeliveryTarget | undefined> | DeliveryTarget | undefined;

  /**
   * Unix ms of the last completed consciousness tick.
   * Returns undefined if the loop has never ticked.
   */
  getLastTickAt: () => number | undefined;

  /**
   * The silence threshold currently active in the loop.
   * Defaults to DEFAULT_CONSCIOUSNESS_CONFIG.baseSilenceThresholdMs if not provided.
   */
  getEffectiveSilenceThresholdMs?: () => number;
};

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Build a WorldSnapshot from real data sources.
 *
 * Designed to be called as `buildSnapshot` in ConsciousnessScheduler.
 * Each field is populated by the corresponding adapter.
 * Missing optional adapters fall back to safe empty defaults.
 *
 * @throws never — all adapter errors are caught and substituted with safe
 *   defaults so the scheduler never crashes on a snapshot build failure.
 */
export async function buildRealWorldSnapshot(
  adapters: SnapshotAdapters,
): Promise<WorldSnapshot> {
  const capturedAt = Date.now();

  // Resolve all adapters concurrently; substitute safe defaults on error.
  const [
    lastUserInteractionAt,
    firedTriggerIds,
    dueCronExpressions,
    externalWorldEvents,
    activeDeliveryTarget,
    activeChannelId,
    activeChannelType,
  ] = await Promise.all([
    safeFetch(() => adapters.getLastUserInteractionAt(), undefined as number | undefined),
    safeFetch(() => adapters.getFiredTriggerIds(), [] as string[]),
    adapters.getDueCronExpressions
      ? safeFetch(() => adapters.getDueCronExpressions!(), [] as string[])
      : ([] as string[]),
    adapters.getExternalWorldEvents
      ? safeFetch(() => adapters.getExternalWorldEvents!(), [] as string[])
      : ([] as string[]),
    adapters.getActiveDeliveryTarget
      ? safeFetch(
          () => adapters.getActiveDeliveryTarget!(),
          undefined as DeliveryTarget | undefined,
        )
      : (undefined as DeliveryTarget | undefined),
    safeFetch(() => adapters.getActiveChannelId(), undefined as string | undefined),
    adapters.getActiveChannelType
      ? safeFetch(
          () => adapters.getActiveChannelType!(),
          undefined as OriginatingChannelType | undefined,
        )
      : (undefined as OriginatingChannelType | undefined),
  ]);

  // Synchronous fields — not in Promise.all to preserve error isolation.
  const pendingNoteCount = safeSync(() => adapters.getPendingNoteCount(), 0);
  const lastTickAt = safeSync(() => adapters.getLastTickAt(), undefined as number | undefined);
  const effectiveSilenceThresholdMs = adapters.getEffectiveSilenceThresholdMs
    ? safeSync(() => adapters.getEffectiveSilenceThresholdMs!(), DEFAULT_CONSCIOUSNESS_CONFIG.baseSilenceThresholdMs)
    : DEFAULT_CONSCIOUSNESS_CONFIG.baseSilenceThresholdMs;

  const resolvedDeliveryTarget =
    activeDeliveryTarget ??
    (activeChannelId ? makeChannelDeliveryTarget(activeChannelId, activeChannelType) : undefined);
  const resolvedActiveChannelId = resolvedDeliveryTarget
    ? getDeliveryTargetChannelId(resolvedDeliveryTarget)
    : activeChannelId;
  const resolvedActiveChannelType = resolvedDeliveryTarget
    ? getDeliveryTargetChannelType(resolvedDeliveryTarget)
    : activeChannelType;

  return {
    capturedAt,
    lastUserInteractionAt,
    pendingNoteCount,
    firedTriggerIds,
    dueCronExpressions,
    externalWorldEvents,
    activeChannelId: resolvedActiveChannelId,
    activeChannelType: resolvedActiveChannelType,
    activeDeliveryTarget: resolvedDeliveryTarget,
    lastTickAt,
    effectiveSilenceThresholdMs,
    // eventBuffer is injected by the scheduler — not built here
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function safeFetch<T>(
  fn: () => T | Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function safeSync<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
