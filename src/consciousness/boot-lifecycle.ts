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
 *   2. Constructs SnapshotAdapters (minimal wiring for Sub-Task 9.1;
 *      real DB/Redis adapters are added incrementally in 9.2+)
 *   3. Calls startConsciousnessLoop() with the wired adapters
 *   4. Registers SIGTERM / SIGINT handlers for graceful shutdown
 *   5. Returns a cleanup function for the call-site finally block
 *
 * Sub-Task 9.1 scope (minimal wiring):
 *   - pendingNoteCount → PendingReflectionQueue.count()
 *   - lastUserInteractionAt → undefined (not wired; no-op Watchdog path)
 *   - activeChannelId → undefined (SEND_MESSAGE falls back to silent drop)
 *   - firedTriggerIds → [] (no trigger registry yet)
 *   - sendToChannel → no-op (real transport wired in 9.2)
 *   - appendNote → no-op (brain ingestion wired in 9.2)
 *
 * These no-op defaults mean the scheduler runs but does not produce
 * visible output. The loop's existence in the process is the acceptance
 * criterion for Sub-Task 9.1; real dispatching is scoped to 9.2.
 */

import process from "node:process";
import { startConsciousnessLoop } from "./boot.js";
import type { ConsciousnessScheduler } from "./boot.js";
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

  const scheduler = startConsciousnessLoop({
    buildSnapshot: () =>
      buildRealWorldSnapshot({
        // Sub-Task 9.1: minimal wiring — no external sources yet.
        // Real adapters (Redis / session store / trigger registry) are wired in 9.2.
        getLastUserInteractionAt: () => undefined,
        getPendingNoteCount: () => reflectionQueue.count(),
        getFiredTriggerIds: () => [],
        getActiveChannelId: () => undefined,
        getLastTickAt: () => undefined,
      }),
    dispatch: {
      // No-op dispatch for 9.1: scheduler runs but produces no visible output.
      // Real transport (gateway sendToChannel) is wired in Sub-Task 9.2.
      sendToChannel: async (_channelId: string, _content: string) => {},
      appendNote: async (_content: string) => {},
    },
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────

  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    scheduler.stop();
  };

  // SIGTERM is sent by process managers (Docker, systemd, k8s).
  // SIGINT is Ctrl-C in terminal.
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  return { stop, scheduler, reflectionQueue };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}
