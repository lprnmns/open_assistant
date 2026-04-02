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
import {
  clearGlobalConsciousnessAuditLog,
  ConsciousnessAuditLog,
  setGlobalConsciousnessAuditLog,
} from "./audit.js";
import {
  getActiveChannelId,
  getActiveChannelType,
  getLastUserInteractionAt,
} from "./interaction-tracker.js";
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

  const reflectionQueue = new PendingReflectionQueue();
  const auditLog = new ConsciousnessAuditLog({
    filePath: resolveAuditLogPath(env),
  });
  setGlobalConsciousnessAuditLog(auditLog);
  const proactiveState: { lastSentAt?: number } = {};

  const scheduler = startConsciousnessLoop({
    buildSnapshot: () =>
      buildRealWorldSnapshot({
        // Real in-process sources — updated by the shared inbound reply pipeline.
        // Persisted (Redis) sources are wired in Sub-Task 9.2.
        getLastUserInteractionAt: () => getLastUserInteractionAt(),
        getPendingNoteCount: () => reflectionQueue.count(),
        getFiredTriggerIds: () => [],
        getActiveChannelId: () => getActiveChannelId(),
        getActiveChannelType: () => getActiveChannelType(),
        getLastTickAt: () => undefined,
      }),
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
  };

  // SIGTERM is sent by process managers (Docker, systemd, k8s).
  // SIGINT is Ctrl-C in terminal.
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  return { stop, scheduler, reflectionQueue, auditLog };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function resolveAuditLogPath(env: NodeJS.ProcessEnv): string | undefined {
  const filePath = env.CONSCIOUSNESS_AUDIT_LOG_PATH?.trim();
  return filePath ? filePath : undefined;
}
