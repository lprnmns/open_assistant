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

import { tick, type TickResult } from "./loop.js";
import { dispatchDecision, type DispatchContext } from "./integration.js";
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
};

// ── Scheduler ─────────────────────────────────────────────────────────────────

export class ConsciousnessScheduler {
  private state: ConsciousnessState;
  private timer: ReturnType<typeof setTimeout> | undefined = undefined;
  private running = false;
  private readonly options: SchedulerOptions;

  constructor(options: SchedulerOptions) {
    const config: ConsciousnessConfig = {
      ...DEFAULT_CONSCIOUSNESS_CONFIG,
      ...(options.config ?? {}),
    };
    this.state = makeInitialConsciousnessState(config);
    this.options = options;
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
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.state = { ...this.state, phase: "PAUSED" };
  }

  /**
   * Resume from PAUSED.  Schedules the next tick after minTickIntervalMs.
   * No-op if the scheduler was never started.
   */
  resume(): void {
    if (!this.running) return;
    this.state = { ...this.state, phase: "IDLE" };
    this.scheduleNext(this.state.config.minTickIntervalMs);
  }

  // ── Internal tick loop ──────────────────────────────────────────────────────

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
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

    // ② Run one consciousness tick
    const result = await tick(snap, this.state);
    this.state = result.state;

    // ③ Dispatch decision side-effects (errors caught inside dispatchDecision)
    if (result.decision !== undefined) {
      await dispatchDecision(result.decision, snap, this.options.dispatch);
    }

    // ④ Notify telemetry / test observers
    this.options.onTick?.(result);

    // ⑤ Reschedule with adaptive delay
    this.scheduleNext(result.nextDelayMs);
  }
}
