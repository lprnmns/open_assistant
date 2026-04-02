/**
 * src/consciousness/scheduler.ts — Consciousness Loop Scheduler
 *
 * Drives the adaptive tick loop using a self-rescheduling setTimeout chain:
 *
 *   1. Wait nextDelayMs
 *   2. Build fresh WorldSnapshot (caller-provided)
 *   3. tick(snap, state) -> TickResult
 *   4. If decision present -> dispatchDecision(decision, snap, ctx)
 *   5. Reschedule after result.nextDelayMs -> back to 1
 *
 * Adaptive interval:
 *   wake:true  -> next wait = minTickIntervalMs  (stay alert)
 *   wake:false -> next wait grows toward maxTickIntervalMs (relax)
 *   LLM suggests delay -> honoured, clamped to [min, max]
 *
 * CRITICAL: The scheduler has NO inbound-message hook.
 * User messages must NEVER trigger a scheduler tick — they are handled
 * exclusively by the gateway reply path. There is no handleMessage(),
 * onMessage(), or similar method on this class.
 */

import { tick, type TickContext, type TickResult } from "./loop.js";
import { dispatchDecision, type DispatchContext } from "./integration.js";
import { createTickAuditEntry, type ConsciousnessAuditLog } from "./audit.js";
import type { MemoryRecallPipeline } from "./brain/types.js";
import {
  DEFAULT_CONSCIOUSNESS_CONFIG,
  makeInitialConsciousnessState,
  type ConsciousnessConfig,
  type ConsciousnessState,
  type WorldSnapshot,
} from "./types.js";

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
   * Optional passive audit sink for tick-level observability.
   * This never affects scheduler behavior; write failures are swallowed by the sink.
   */
  auditLog?: ConsciousnessAuditLog;

  /**
   * Optional Living Brain components wired at boot.
   * When provided, each tick enriches the LLM prompt with recent Cortex notes
   * and semantically similar Hippocampus notes before the LLM call.
   */
  brain?: {
    /** Recall pipeline for prompt enrichment (read path). */
    recall: MemoryRecallPipeline;
    /** Session key forwarded to Hippocampus for session-scoped recall. */
    sessionKey: string;
  };
};

export class ConsciousnessScheduler {
  private state: ConsciousnessState;
  private timer: ReturnType<typeof setTimeout> | undefined = undefined;
  private running = false;
  /**
   * Separate pause flag — does NOT alias state.phase.
   * Reason: tick() returns a new ConsciousnessState with phase:"IDLE", and
   * runTick() writes this.state = result.state, which would silently
   * overwrite any "PAUSED" phase set by pause() while the tick was in-flight.
   */
  private paused = false;
  private readonly options: SchedulerOptions;

  constructor(options: SchedulerOptions) {
    const config: ConsciousnessConfig = {
      ...DEFAULT_CONSCIOUSNESS_CONFIG,
      ...(options.config ?? {}),
    };
    this.state = makeInitialConsciousnessState(config);
    this.options = options;
  }

  /** Start the tick loop. No-op if already running. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(this.state.config.minTickIntervalMs);
  }

  /** Stop the tick loop permanently. Clears any pending timer. */
  stop(): void {
    this.running = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** Pause ticks and cancel any pending timer. */
  pause(): void {
    this.paused = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.state = { ...this.state, phase: "PAUSED" };
  }

  /** Resume from PAUSED and schedule the next tick after minTickIntervalMs. */
  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.state = { ...this.state, phase: "IDLE" };
    this.scheduleNext(this.state.config.minTickIntervalMs);
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running || this.paused) return;
    this.timer = setTimeout(() => {
      void this.runTick();
    }, delayMs);
  }

  private async runTick(): Promise<void> {
    if (!this.running) return;

    let snap: WorldSnapshot;
    try {
      snap = await this.options.buildSnapshot();
    } catch {
      this.scheduleNext(this.state.config.minTickIntervalMs);
      return;
    }

    const tickCtx: TickContext | undefined = this.options.brain
      ? { recall: this.options.brain.recall, sessionKey: this.options.brain.sessionKey }
      : undefined;
    const result = await tick(snap, this.state, tickCtx);
    this.state = this.paused ? { ...result.state, phase: "PAUSED" } : result.state;

    if (result.decision !== undefined) {
      await dispatchDecision(result.decision, snap, this.options.dispatch, this.state.config);
    }

    this.options.auditLog?.append(
      createTickAuditEntry({
        wake: result.watchdogResult.wake,
        decision: result.decision?.action,
        phase: result.state.phase,
        llmCallCount: result.state.llmCallCount,
      }),
    );
    this.options.onTick?.(result);
    this.scheduleNext(result.nextDelayMs);
  }
}
