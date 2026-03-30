/**
 * src/consciousness/sleep/trigger.ts — Consolidation trigger evaluation
 *
 * Answers a single question deterministically ($0, zero I/O):
 *   "Should the consolidation pass start right now?"
 *
 * ── Separation of concerns ────────────────────────────────────────────────────
 *
 *   ENTER_SLEEP (TickDecision)       — phase signal only; produced by LLM
 *                                      when it decides to sleep; carries NO
 *                                      consolidation payload
 *   consolidation pass (Sub-Task 5.2) — the actual episodic → semantic
 *                                        extraction work; triggered here
 *
 * These two concerns are intentionally separate:
 *   - The loop/LLM decides WHEN to sleep.
 *   - The trigger (this module) decides WHETHER to consolidate given the
 *     current phase and state — pure function, no LLM involvement.
 *   - The consolidation pipeline (Sub-Task 5.2) does the actual work.
 *
 * ── Trigger logic ─────────────────────────────────────────────────────────────
 *
 * `shouldConsolidate` is true iff ALL of:
 *   1. phase === "SLEEPING"                  — must be in sleep phase
 *   2. sleepEnteredAt !== undefined           — a sleep cycle has started
 *   3. sleepEnteredAt > (consolidationCompletedAt ?? -Infinity)
 *                                            — this cycle has NOT been
 *                                              consolidated yet
 *
 * Invariant guaranteed by condition 3:
 *   Consolidation runs AT MOST ONCE per sleep cycle.
 *   A new sleep cycle begins when ENTER_SLEEP is decided; the loop sets
 *   sleepEnteredAt = Date.now() at that moment.  Once the consolidation pass
 *   completes, the caller sets consolidationCompletedAt = Date.now().
 *   Subsequent evaluations see consolidationCompletedAt > sleepEnteredAt and
 *   return shouldConsolidate: false until the next sleep entry.
 *
 * ── Zero cost guarantee ────────────────────────────────────────────────────────
 *
 * evaluateConsolidationTrigger() is a pure function:
 *   - No I/O, no async, no LLM call.
 *   - Takes phase and ConsolidationTriggerState; returns ConsolidationTriggerResult.
 *   - Safe to call on every scheduler tick without any cost penalty.
 */

import type { ConsciousnessPhase } from "../types.js";

// ── State ─────────────────────────────────────────────────────────────────────

/**
 * The fragment of ConsciousnessState that governs the consolidation trigger.
 * Owned by the Loop Engine; updated at two specific points:
 *
 *   sleepEnteredAt          set by loop.ts when decision.action === "ENTER_SLEEP"
 *   consolidationCompletedAt set by the caller (scheduler / Sub-Task 5.3)
 *                            when the consolidation pipeline finishes
 */
export type ConsolidationTriggerState = {
  /**
   * Unix ms timestamp of the most recent ENTER_SLEEP decision.
   * undefined = loop has never entered sleep since it started.
   */
  readonly sleepEnteredAt: number | undefined;

  /**
   * Unix ms timestamp of the most recent successful consolidation pass.
   * undefined = consolidation has never run.
   */
  readonly consolidationCompletedAt: number | undefined;
};

/** Zero-value ConsolidationTriggerState — use in makeInitialConsciousnessState. */
export const INITIAL_CONSOLIDATION_TRIGGER_STATE: ConsolidationTriggerState = {
  sleepEnteredAt: undefined,
  consolidationCompletedAt: undefined,
};

// ── Result ────────────────────────────────────────────────────────────────────

export type ConsolidationTriggerResult = {
  /** Whether the consolidation pass should begin right now. */
  readonly shouldConsolidate: boolean;
  /** Human-readable explanation for logging / telemetry. */
  readonly reason: string;
};

// ── Evaluation ────────────────────────────────────────────────────────────────

/**
 * Evaluate whether the consolidation pass should start now.
 *
 * Pure function — $0, zero I/O.  Safe to call on every scheduler tick.
 *
 * @param phase         Current ConsciousnessPhase from ConsciousnessState.
 * @param triggerState  ConsolidationTriggerState from ConsciousnessState.consolidation.
 */
export function evaluateConsolidationTrigger(
  phase: ConsciousnessPhase,
  triggerState: ConsolidationTriggerState,
): ConsolidationTriggerResult {
  if (phase !== "SLEEPING") {
    return {
      shouldConsolidate: false,
      reason: `phase is ${phase}, not SLEEPING`,
    };
  }

  if (triggerState.sleepEnteredAt === undefined) {
    return {
      shouldConsolidate: false,
      reason: "no sleep cycle has been entered yet (sleepEnteredAt is undefined)",
    };
  }

  const lastCompleted = triggerState.consolidationCompletedAt ?? -Infinity;

  if (triggerState.sleepEnteredAt <= lastCompleted) {
    return {
      shouldConsolidate: false,
      reason: `consolidation already ran for this sleep cycle (sleepEnteredAt=${triggerState.sleepEnteredAt}, consolidationCompletedAt=${triggerState.consolidationCompletedAt})`,
    };
  }

  return {
    shouldConsolidate: true,
    reason: `sleep cycle started at ${triggerState.sleepEnteredAt} has not been consolidated yet`,
  };
}
