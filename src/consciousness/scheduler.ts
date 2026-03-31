/**
 * src/consciousness/scheduler.ts — Consciousness Loop Scheduler
 *
 * Drives the adaptive tick loop using a self-rescheduling setTimeout chain:
 *
 *   ① Wait nextDelayMs
 *   ② Build fresh WorldSnapshot (caller-provided)
 *   ③ tick(snap, state) → TickResult
 *   ④ If decision present → dispatchDecision(decision, snap, ctx)
 *   ⑤ Reschedule after result.nextDelayMs  →  back to ①
 *
 * Adaptive interval:
 *   wake:true  → next wait = minTickIntervalMs  (stay alert)
 *   wake:false → next wait grows toward maxTickIntervalMs (relax)
 *   LLM suggests delay → honoured, clamped to [min, max]
 *
 * CRITICAL: The scheduler has NO inbound-message hook.
 * User messages must NEVER trigger a scheduler tick — they are handled
 * exclusively by the gateway reply path.  There is no handleMessage(),
 * onMessage(), or similar method on this class.
 */

import { tick, type TickContext, type TickResult } from "./loop.js";
import { dispatchDecision, type DispatchContext } from "./integration.js";
import type { MemoryRecallPipeline } from "./brain/types.js";
import { evaluateConsolidationTrigger } from "./sleep/trigger.js";
import type { ConsolidationPipeline } from "./sleep/consolidation.js";
import {
  DEFAULT_CONSCIOUSNESS_CONFIG,
  makeInitialConsciousnessState,
  type ConsciousnessConfig,
  type ConsciousnessState,
  type WorldSnapshot,
} from "./types.js";

// ── Scheduler options ─────────────────────────────────────────────────────────

export type SchedulerOptions = {
  /**
   * Builds a fresh WorldSnapshot from Redis/DB before each tick.
   * If this throws, the scheduler reschedules with minTickIntervalMs and
   * continues — it never crashes.
   */
  buildSnapshot: () => Promise<WorldSnapshot>;

  /** Side-effect callbacks for SEND_MESSAGE / TAKE_NOTE decisions. */
  dispatch: DispatchContext;

  /** Override default ConsciousnessConfig values. */
  config?: Partial<ConsciousnessConfig>;

  /**
   * Called after each completed tick (regardless of wake outcome).
   * Useful for logging, telemetry, and test assertions.
   */
  onTick?: (result: TickResult) => void;

  /**
   * Optional Living Brain components wired at boot.
   * When provided, each tick enriches the LLM prompt with recent Cortex notes
   * and semantically similar Hippocampus notes before the LLM call.
   *
   * Omitting this field is safe — the scheduler falls back to pre-4.5 behaviour
   * (no memory enrichment) without any change to tick semantics.
   *
   * appendNote wiring: the caller closes over ingestion + sessionKey when
   * constructing dispatch.appendNote so the loop itself never sees sessionKey.
   * Only the recall pipeline needs sessionKey here (for session-scoped ANN search).
   */
  brain?: {
    /** Recall pipeline for prompt enrichment (read path). */
    recall: MemoryRecallPipeline;
    /** Session key forwarded to Hippocampus for session-scoped recall. */
    sessionKey: string;
  };

  /**
   * Optional Sleep-Phase consolidation pipeline.
   * When provided, the scheduler evaluates the consolidation trigger after each
   * tick and, when appropriate, runs the pipeline to convert episodic notes into
   * semantic notes.
   *
   * Omitting this field is safe — the scheduler runs without consolidation.
   *
   * ── Guarantees ──────────────────────────────────────────────────────────────
   *
   *   1. Trigger evaluation is $0 (pure function; called every tick).
   *   2. Pipeline is never entered when shouldConsolidate is false (hard gate).
   *   3. At most one consolidation run is active at a time (in-progress guard).
   *      The guard is cleared in a finally block — never leaked after failure.
   *   4. consolidationCompletedAt is written only after a successful (non-throwing)
   *      pipeline.run() completion.  A pipeline that violates its fail-soft
   *      contract leaves consolidationCompletedAt unset, allowing a retry.
   *   5. Consolidation runs fire-and-forget — the tick reschedule is not blocked.
   */
  consolidation?: {
    /** Pipeline that converts episodic notes into semantic notes. */
    pipeline: ConsolidationPipeline;
    /** Session key passed to pipeline.run(). */
    sessionKey: string;
  };
};

// ── Scheduler ─────────────────────────────────────────────────────────────────

export class ConsciousnessScheduler {
  private state: ConsciousnessState;
  private timer: ReturnType<typeof setTimeout> | undefined = undefined;
  private running = false;
  /**
   * Separate pause flag — does NOT alias state.phase.
   * Reason: tick() returns a new ConsciousnessState with phase:"IDLE", and
   * runTick() writes `this.state = result.state`, which would silently
   * overwrite any "PAUSED" phase set by pause() while the tick was in-flight.
   * A dedicated boolean is immune to that overwrite.
   */
  private paused = false;
  /**
   * True while a consolidation pipeline run is in flight.
   * Prevents concurrent consolidation runs within the same sleep cycle.
   * Always cleared in a finally block — never leaked after failure.
   */
  private consolidating = false;
  private readonly options: SchedulerOptions;

  constructor(options: SchedulerOptions) {
    const config: ConsciousnessConfig = {
      ...DEFAULT_CONSCIOUSNESS_CONFIG,
      ...(options.config ?? {}),
    };
    this.state = makeInitialConsciousnessState(config);
    this.options = options;
  }

  // ── Observability ───────────────────────────────────────────────────────────

  /** Read-only view of the current runtime state.  Useful for telemetry and tests. */
  getState(): Readonly<ConsciousnessState> {
    return this.state;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /** Start the tick loop.  No-op if already running. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(this.state.config.minTickIntervalMs);
  }

  /** Stop the tick loop permanently.  Clears any pending timer. */
  stop(): void {
    this.running = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Pause ticks.  Any tick already in flight completes normally but does not
   * reschedule.  State phase is set to PAUSED.
   */
  pause(): void {
    this.paused = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.state = { ...this.state, phase: "PAUSED" };
  }

  /**
   * Resume from PAUSED.  Schedules the next tick after minTickIntervalMs.
   * No-op if the scheduler was never started OR if it is not currently paused
   * (guards against duplicate timers when called from a non-paused state).
   */
  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.state = { ...this.state, phase: "IDLE" };
    this.scheduleNext(this.state.config.minTickIntervalMs);
  }

  // ── Internal tick loop ──────────────────────────────────────────────────────

  private scheduleNext(delayMs: number): void {
    // paused flag is authoritative — immune to state.phase being overwritten by tick()
    if (!this.running || this.paused) return;
    this.timer = setTimeout(() => {
      void this.runTick();
    }, delayMs);
  }

  private async runTick(): Promise<void> {
    if (!this.running) return;

    // ① Build snapshot — if this fails, reschedule and stay alive
    let snap: WorldSnapshot;
    try {
      snap = await this.options.buildSnapshot();
    } catch {
      this.scheduleNext(this.state.config.minTickIntervalMs);
      return;
    }

    // ② Run one consciousness tick (with optional memory context)
    const tickCtx: TickContext | undefined = this.options.brain
      ? { recall: this.options.brain.recall, sessionKey: this.options.brain.sessionKey }
      : undefined;
    const result = await tick(snap, this.state, tickCtx);
    // Preserve PAUSED phase if pause() was called while this tick was in-flight;
    // tick() always returns phase:"IDLE" and would otherwise overwrite it.
    this.state = this.paused ? { ...result.state, phase: "PAUSED" } : result.state;

    // ③ Dispatch decision side-effects (errors caught inside dispatchDecision)
    if (result.decision !== undefined) {
      await dispatchDecision(result.decision, snap, this.options.dispatch);
    }

    // ④ Notify telemetry / test observers
    this.options.onTick?.(result);

    // ⑤ Maybe consolidate (fire-and-forget — does not block tick reschedule)
    void this.maybeConsolidate();

    // ⑥ Reschedule with adaptive delay
    this.scheduleNext(result.nextDelayMs);
  }

  // ── Consolidation ────────────────────────────────────────────────────────────

  /**
   * Evaluate the consolidation trigger and, when appropriate, run the pipeline.
   *
   * Called fire-and-forget after each tick so the tick reschedule is not blocked.
   *
   * Guarantees:
   *   - evaluateConsolidationTrigger() is called every invocation ($0, pure).
   *   - When shouldConsolidate is false the method returns before entering the pipeline.
   *   - The in-progress guard (this.consolidating) prevents concurrent runs.
   *     It is cleared in a finally block so it cannot leak after pipeline failure.
   *   - consolidationCompletedAt is written only after a successful (non-throwing)
   *     pipeline.run() completion.  If pipeline violates its fail-soft contract
   *     the timestamp is NOT written — the cycle may retry on the next tick.
   */
  private async maybeConsolidate(): Promise<void> {
    if (!this.options.consolidation) return;

    // $0 pure gate — safe to call every tick, no pipeline entry when false
    const trigger = evaluateConsolidationTrigger(
      this.state.phase,
      this.state.consolidation,
    );
    if (!trigger.shouldConsolidate) return;

    // In-progress guard — at most one active run per scheduler instance
    if (this.consolidating) return;
    this.consolidating = true;

    try {
      await this.options.consolidation.pipeline.run({
        sessionKey: this.options.consolidation.sessionKey,
      });

      // Write consolidationCompletedAt only after a non-throwing run completion.
      // Spread the CURRENT this.state (not a captured snapshot) so this merge
      // survives any concurrent ticks that may have overwritten this.state.
      this.state = {
        ...this.state,
        consolidation: {
          ...this.state.consolidation,
          consolidationCompletedAt: Date.now(),
        },
      };
    } catch {
      // pipeline.run() violated its fail-soft contract.
      // consolidationCompletedAt is intentionally NOT written — the cycle may retry.
    } finally {
      // Always clear the flag, even when pipeline threw.
      this.consolidating = false;
    }
  }
}
