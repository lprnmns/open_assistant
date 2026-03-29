/**
 * src/consciousness/boot.ts — Consciousness Loop application entry point
 *
 * Provides a single `startConsciousnessLoop()` factory that the application
 * calls once at startup.  It wires the caller-supplied snapshot builder and
 * dispatch callbacks into a ConsciousnessScheduler and starts the tick loop.
 *
 * Usage (application layer):
 *
 *   import { startConsciousnessLoop } from "./consciousness/boot.js";
 *
 *   const scheduler = startConsciousnessLoop({
 *     buildSnapshot: () => buildWorldSnapshotFromRedis(),
 *     dispatch: {
 *       sendToChannel: (channelId, content) => gateway.send(channelId, content),
 *       appendNote:    (content)             => noteStore.append(content),
 *     },
 *   });
 *
 *   // later, on shutdown:
 *   scheduler.stop();
 *
 * Design constraints enforced here:
 *   - No inbound-message hook is wired; the gateway reply path stays separate.
 *   - SEND_MESSAGE routes only to snap.activeChannelId (enforced in integration.ts).
 *   - TAKE_NOTE errors do not propagate to the scheduler (enforced in integration.ts).
 */

import { ConsciousnessScheduler, type SchedulerOptions } from "./scheduler.js";

export { ConsciousnessScheduler };
export type { SchedulerOptions };

/**
 * Create and start the Consciousness Loop.
 * Returns the running scheduler so the caller can stop/pause it on shutdown.
 *
 * @param options  Snapshot builder, dispatch callbacks, and optional config overrides.
 */
export function startConsciousnessLoop(options: SchedulerOptions): ConsciousnessScheduler {
  const scheduler = new ConsciousnessScheduler(options);
  scheduler.start();
  return scheduler;
}
