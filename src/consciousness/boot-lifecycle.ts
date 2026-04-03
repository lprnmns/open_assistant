/**
 * src/consciousness/boot-lifecycle.ts — Production boot wiring for the Consciousness Loop
 *
 * Provides maybeStartConsciousnessLoop() — the single call-site that the app
 * bootstrap makes to wire the consciousness loop into the process lifecycle.
 *
 * Feature flag:
 *   CONSCIOUSNESS_ENABLED=1   — enables the loop (default: disabled)
 *
 * When enabled, this module:
 *   1. Creates a PendingReflectionQueue instance
 *   2. Constructs SnapshotAdapters from real in-process interaction sources
 *   3. Calls startConsciousnessLoop() with the wired adapters
 *   4. Registers SIGTERM / SIGINT handlers for graceful shutdown
 *   5. Returns a cleanup function for the call-site finally block
 *
 * Sub-Task 9.2 scope:
 *   - pendingNoteCount → PendingReflectionQueue.count()
 *   - lastUserInteractionAt → in-process InteractionTracker
 *   - activeChannelId / activeChannelType → in-process InteractionTracker route
 *   - firedTriggerIds → [] (no trigger registry yet)
 *   - sendToChannel → routeReply() for routable channels
 *   - appendNote → no-op (brain ingestion wired in a later sub-task)
 */

import process from "node:process";
import { startConsciousnessLoop } from "./boot.js";
import type { ConsciousnessScheduler } from "./boot.js";
import { DEFAULT_CONSCIOUSNESS_CONFIG } from "./types.js";
import {
  clearGlobalConsciousnessAuditLog,
  ConsciousnessAuditLog,
  setGlobalConsciousnessAuditLog,
} from "./audit.js";
import {
  getActiveChannelId,
  getActiveChannelType,
  getLastUserInteractionAt,
  seedInteractionTracker,
  setInteractionStore,
} from "./interaction-tracker.js";
import { FileInteractionStore } from "./interaction-store.js";
import { PendingReflectionQueue } from "./reflection-queue.js";
import { buildRealWorldSnapshot } from "./snapshot.js";

// ── Result type ───────────────────────────────────────────────────────────────

export type ConsciousnessLifecycle = {
  /** Stop the loop — safe to call multiple times. */
  stop: () => void;
  /** The underlying scheduler (for introspection / testing). */
  scheduler: ConsciousnessScheduler;
  /** The reflection queue that feeds pendingNoteCount. */
  reflectionQueue: PendingReflectionQueue;
  /** Structured audit trail for proactive sends, ticks, and mode transitions. */
  auditLog: ConsciousnessAuditLog;
  /**
   * Persistent interaction store backing the InteractionTracker.
   * undefined when persistence is disabled (CONSCIOUSNESS_STATE_PATH not set
   * and no default path was resolved).  Closed automatically on stop().
   */
  interactionStore?: FileInteractionStore;
};

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Start the consciousness loop if CONSCIOUSNESS_ENABLED=1.
 *
 * Returns null when the feature flag is off — the caller can treat this
 * as a clean no-op without branching.
 *
 * @param env  Process environment (injected for testability; default: process.env)
 */
export function maybeStartConsciousnessLoop(
  env: NodeJS.ProcessEnv = process.env,
): ConsciousnessLifecycle | null {
  if (!isTruthy(env.CONSCIOUSNESS_ENABLED)) {
    return null;
  }

  // ── Interaction store (persistence) ────────────────────────────────────────
  // Seed in-memory tracker from disk before the loop starts so that silence
  // detection and channel routing survive process restarts.
  const interactionStore = resolveInteractionStorePath(env)
    ? new FileInteractionStore({ filePath: resolveInteractionStorePath(env)! })
    : undefined;

  // Load persisted state once at boot (synchronous — safe at startup).
  const loaded = interactionStore ? interactionStore.loadSync() : null;
  if (loaded) {
    seedInteractionTracker(loaded);
  }
  if (interactionStore) {
    setInteractionStore(interactionStore);
  }

  // ── Silence threshold resolution ───────────────────────────────────────────
  // Priority: persisted (survives backoff expansion across restarts)
  //         > CONSCIOUSNESS_SILENCE_THRESHOLD_MS env (operator intent)
  //         > DEFAULT_CONSCIOUSNESS_CONFIG.baseSilenceThresholdMs (engine default)
  //
  // The engine default (30 min) is intentionally low for generic use.
  // The MVP / Yaşayan Varlık production intent is 3 days (259_200_000 ms).
  // Operators set CONSCIOUSNESS_SILENCE_THRESHOLD_MS=259200000 in .env.
  const envThreshold = resolvePositiveIntEnv(env.CONSCIOUSNESS_SILENCE_THRESHOLD_MS);
  const baseSilenceThresholdMs =
    envThreshold ?? DEFAULT_CONSCIOUSNESS_CONFIG.baseSilenceThresholdMs;

  // Mutable refs — updated by onTick after every tick and persisted to store.
  // Initialized from disk (persisted backoff) or the resolved base threshold.
  const effectiveThresholdRef = {
    value: loaded?.effectiveSilenceThresholdMs ?? baseSilenceThresholdMs,
  };
  const lastTickAtRef = { value: loaded?.lastTickAt as number | undefined };

  const reflectionQueue = new PendingReflectionQueue();
  const auditLog = new ConsciousnessAuditLog({
    filePath: resolveAuditLogPath(env),
  });
  setGlobalConsciousnessAuditLog(auditLog);
  const proactiveState: { lastSentAt?: number } = {};

  const scheduler = startConsciousnessLoop({
    config: { baseSilenceThresholdMs },
    buildSnapshot: () =>
      buildRealWorldSnapshot({
        getLastUserInteractionAt: () => getLastUserInteractionAt(),
        getPendingNoteCount: () => reflectionQueue.count(),
        getFiredTriggerIds: () => [],
        getActiveChannelId: () => getActiveChannelId(),
        getActiveChannelType: () => getActiveChannelType(),
        getLastTickAt: () => lastTickAtRef.value,
        getEffectiveSilenceThresholdMs: () => effectiveThresholdRef.value,
      }),
    onTick: (result) => {
      // Persist lastTickAt after every tick.
      lastTickAtRef.value = Date.now();
      // Persist backoff-expanded threshold when SILENCE_THRESHOLD fired.
      if (
        result.watchdogResult.wake === true &&
        result.watchdogResult.reason === "SILENCE_THRESHOLD" &&
        result.watchdogResult.nextSilenceThresholdMs !== undefined
      ) {
        effectiveThresholdRef.value = result.watchdogResult.nextSilenceThresholdMs;
      }
      interactionStore?.save({
        lastTickAt: lastTickAtRef.value,
        effectiveSilenceThresholdMs: effectiveThresholdRef.value,
      });
    },
    dispatch: {
      sendToChannel: async (channelId: string, content: string, channelType?: string) => {
        const { loadConfig } = await import("../config/config.js");
        const { isRoutableChannel, routeReply } = await import(
          "../auto-reply/reply/route-reply.js"
        );

        if (!channelType || !isRoutableChannel(channelType)) {
          throw new Error(
            `Active channel is not routable for consciousness dispatch: ${String(channelType ?? "(unknown)")}`,
          );
        }

        const result = await routeReply({
          payload: { text: content },
          channel: channelType,
          to: channelId,
          cfg: loadConfig(),
          mirror: false,
        });
        if (!result.ok) {
          throw new Error(result.error ?? `Failed to route proactive message to ${channelType}`);
        }
      },
      appendNote: async (_content: string) => {},
      proactiveState,
      auditLog,
    },
    auditLog,
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────

  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    scheduler.stop();
    clearGlobalConsciousnessAuditLog(auditLog);
    if (interactionStore) {
      setInteractionStore(null);
      void interactionStore.close();
    }
  };

  // SIGTERM is sent by process managers (Docker, systemd, k8s).
  // SIGINT is Ctrl-C in terminal.
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  return { stop, scheduler, reflectionQueue, auditLog, interactionStore };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function resolveAuditLogPath(env: NodeJS.ProcessEnv): string | undefined {
  const filePath = env.CONSCIOUSNESS_AUDIT_LOG_PATH?.trim();
  return filePath ? filePath : undefined;
}

/**
 * Parse an env var as a positive integer.
 * Returns undefined when the value is absent, non-numeric, or <= 0.
 */
function resolvePositiveIntEnv(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const n = Number(value.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function resolveInteractionStorePath(env: NodeJS.ProcessEnv): string | undefined {
  const explicit = env.CONSCIOUSNESS_STATE_PATH?.trim();
  if (explicit) return explicit;
  // Default: data/consciousness-state.json relative to CWD.
  // Operators can disable by setting CONSCIOUSNESS_STATE_PATH="" (empty string).
  if (env.CONSCIOUSNESS_STATE_PATH === "") return undefined;
  return "data/consciousness-state.json";
}
