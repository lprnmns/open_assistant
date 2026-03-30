/**
 * src/consciousness/boot.ts — Consciousness Loop application entry point
 *
 * Provides a single `startConsciousnessLoop()` factory that the application
 * calls once at startup.  It wires the caller-supplied snapshot builder and
 * dispatch callbacks into a ConsciousnessScheduler and starts the tick loop.
 *
 * Usage (application layer) — without Living Brain:
 *
 *   const scheduler = startConsciousnessLoop({
 *     buildSnapshot: () => buildWorldSnapshotFromRedis(),
 *     dispatch: {
 *       sendToChannel: (channelId, content) => gateway.send(channelId, content),
 *       appendNote:    (content)             => noteStore.append(content),
 *     },
 *   });
 *
 * Usage — with Living Brain (recommended for production):
 *
 *   const scheduler = startConsciousnessLoop({
 *     buildSnapshot: () => buildWorldSnapshotFromRedis(),
 *     dispatch: {
 *       sendToChannel: (channelId, content) => gateway.send(channelId, content),
 *       // appendNote is OMITTED — boot wires it to brain.ingestion automatically
 *     },
 *     brain: {
 *       ingestion: createNoteIngestionPipeline({ cortex, embedder, hippocampus }),
 *       recall:    createMemoryRecallPipeline({ cortex, embedder, hippocampus }),
 *       sessionKey: session.id,
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
 *   - When brain is provided, appendNote is auto-wired to brain.ingestion.ingest so
 *     the loop never sees sessionKey and the write path uses the full pipeline.
 *   - When brain is absent the caller-provided appendNote is used (or a silent no-op).
 */

import type { NoteIngestionPipeline, MemoryRecallPipeline } from "./brain/types.js";
import { type DispatchContext } from "./integration.js";
import { ConsciousnessScheduler, type SchedulerOptions } from "./scheduler.js";

export { ConsciousnessScheduler };
export type { SchedulerOptions };

// ── ConsciousnessBootOptions ──────────────────────────────────────────────────

/**
 * Options for startConsciousnessLoop().
 *
 * Extends SchedulerOptions with an optional `brain` block that wires the full
 * Living Brain write + read paths.  When `brain` is provided:
 *   - dispatch.appendNote is auto-wired to brain.ingestion.ingest({ content, sessionKey })
 *     so the loop itself never handles sessionKey (closure isolation).
 *   - brain.recall is forwarded to tick() for prompt enrichment.
 *
 * When `brain` is absent the caller must supply dispatch.appendNote (or accept
 * the silent no-op fallback).
 */
export type ConsciousnessBootOptions = Omit<SchedulerOptions, "dispatch" | "brain"> & {
  dispatch: Omit<DispatchContext, "appendNote"> & {
    /**
     * Override for callers that do NOT provide brain.
     * When brain is provided this field is ignored — ingestion pipeline takes over.
     */
    appendNote?: DispatchContext["appendNote"];
  };
  brain?: {
    /** Write path — NoteIngestionPipeline wired to appendNote closure. */
    ingestion: NoteIngestionPipeline;
    /** Read path — MemoryRecallPipeline forwarded to tick() for prompt enrichment. */
    recall: MemoryRecallPipeline;
    /**
     * Session key closed over by both the appendNote closure and the recall filter.
     * The loop never sees this value directly.
     */
    sessionKey: string;
  };
};

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create and start the Consciousness Loop.
 * Returns the running scheduler so the caller can stop/pause it on shutdown.
 *
 * When options.brain is provided:
 *   - appendNote is auto-wired to brain.ingestion.ingest({ content, sessionKey })
 *   - brain.recall + brain.sessionKey are forwarded to the scheduler for tick enrichment
 *
 * @param options  Snapshot builder, dispatch callbacks, brain, and optional config.
 */
export function startConsciousnessLoop(options: ConsciousnessBootOptions): ConsciousnessScheduler {
  // ── Wire dispatch.appendNote to ingestion pipeline when brain is provided ──
  // The loop calls appendNote(content) — it never sees sessionKey.
  // Boot closes over brain.sessionKey here so the loop is fully isolated.
  const dispatch: DispatchContext = options.brain
    ? {
        ...options.dispatch,
        appendNote: async (content: string) => {
          await options.brain!.ingestion.ingest({
            content,
            sessionKey: options.brain!.sessionKey,
          });
        },
      }
    : {
        ...options.dispatch,
        appendNote: options.dispatch.appendNote ?? (async () => {}),
      };

  const scheduler = new ConsciousnessScheduler({
    ...options,
    dispatch,
    brain: options.brain
      ? { recall: options.brain.recall, sessionKey: options.brain.sessionKey }
      : undefined,
  });

  scheduler.start();
  return scheduler;
}
