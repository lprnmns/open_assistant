/**
 * src/consciousness/sleep/wake.ts — Sleep-phase wake transition evaluation
 *
 * Answers a single question deterministically ($0, zero I/O):
 *   "Should the agent wake from the Sleep Phase right now?"
 *
 * ── Two-condition wake policy ─────────────────────────────────────────────────
 *
 *   Hard wake (time-based)
 *     capturedAt >= scheduledWakeAt
 *     where scheduledWakeAt = the first occurrence of sleepEndHourUtc:00:00 UTC
 *     that is strictly AFTER sleepEnteredAt.
 *
 *     "Strictly after" prevents the pathological case where sleep is entered
 *     at or after sleepEndHourUtc (e.g. entered at 14:00 UTC with endHour=7):
 *     a naïve `capturedAt.hour >= sleepEndHourUtc` check would wake immediately.
 *     nextOccurrenceOfHourUtc() always returns a future boundary.
 *
 *   Soft early wake (consolidation-based)
 *     consolidationCompletedAt !== undefined AND
 *     capturedAt >= consolidationCompletedAt + postConsolidationDelayMs
 *
 *     Allows waking before the hard wake time once consolidation is done and
 *     a configurable cool-down has elapsed.  Fail-soft: if consolidation never
 *     completes, this condition is never true and the hard wake fires instead.
 *
 *   shouldWake = hardWake OR softWake
 *
 * ── Zero cost guarantee ────────────────────────────────────────────────────────
 *
 *   evaluateSleepWakeTransition() is a pure function:
 *     - No I/O, no async, no LLM call.
 *     - Safe to call on every tick inside tick() at zero cost.
 */

// ── Scheduled wake time helper ────────────────────────────────────────────────

/**
 * Returns the Unix ms timestamp of the first occurrence of `hourUtc:00:00.000 UTC`
 * that is strictly AFTER `afterMs`.
 *
 * Examples:
 *   afterMs = 2026-03-31T14:00:00Z, hourUtc = 7  →  2026-04-01T07:00:00Z
 *   afterMs = 2026-03-31T06:00:00Z, hourUtc = 7  →  2026-03-31T07:00:00Z
 *   afterMs = 2026-03-31T07:00:00Z, hourUtc = 7  →  2026-04-01T07:00:00Z  (strictly after)
 *   afterMs = 2026-03-31T23:00:00Z, hourUtc = 0  →  2026-04-01T00:00:00Z
 */
export function nextOccurrenceOfHourUtc(afterMs: number, hourUtc: number): number {
  const d = new Date(afterMs);
  // Candidate: same UTC calendar day as afterMs, at hourUtc:00:00.000
  const candidate = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    hourUtc,
    0,
    0,
    0,
  );
  // Must be strictly after — if equal or earlier, advance one full day.
  return candidate > afterMs ? candidate : candidate + 24 * 60 * 60 * 1000;
}

// ── Wake transition types ─────────────────────────────────────────────────────

export type SleepWakeInput = {
  /** Unix ms from the current WorldSnapshot (current wall-clock reading). */
  capturedAt: number;
  /**
   * Unix ms when the ENTER_SLEEP decision was applied.
   * undefined = the scheduler has never entered sleep this session.
   */
  sleepEnteredAt: number | undefined;
  /**
   * Unix ms when the last consolidation pass completed.
   * undefined = consolidation has never run (or failed).
   */
  consolidationCompletedAt: number | undefined;
  /** UTC hour (0–23) for the hard wake. From ConsciousnessConfig.sleepEndHourUtc. */
  sleepEndHourUtc: number;
  /**
   * Milliseconds to wait after consolidationCompletedAt before the soft early wake.
   * From ConsciousnessConfig.postConsolidationDelayMs.
   */
  postConsolidationDelayMs: number;
};

export type SleepWakeResult = {
  /** Whether the agent should leave the Sleep Phase now. */
  readonly shouldWake: boolean;
  /** Human-readable explanation for logging / telemetry. */
  readonly reason: string;
};

// ── Evaluation ────────────────────────────────────────────────────────────────

/**
 * Evaluate whether the agent should wake from the Sleep Phase.
 *
 * Pure function — $0, zero I/O.  Safe to call on every tick.
 */
export function evaluateSleepWakeTransition(input: SleepWakeInput): SleepWakeResult {
  const {
    capturedAt,
    sleepEnteredAt,
    consolidationCompletedAt,
    sleepEndHourUtc,
    postConsolidationDelayMs,
  } = input;

  if (sleepEnteredAt === undefined) {
    return {
      shouldWake: false,
      reason: "no sleep cycle active (sleepEnteredAt is undefined)",
    };
  }

  // ── Hard wake (time-based) ──────────────────────────────────────────────────
  const scheduledWakeAt = nextOccurrenceOfHourUtc(sleepEnteredAt, sleepEndHourUtc);
  if (capturedAt >= scheduledWakeAt) {
    return {
      shouldWake: true,
      reason: `hard wake: capturedAt ${capturedAt} >= scheduledWakeAt ${scheduledWakeAt} (sleepEndHour=${sleepEndHourUtc}h UTC)`,
    };
  }

  // ── Soft early wake (consolidation-based) ──────────────────────────────────
  if (
    consolidationCompletedAt !== undefined &&
    capturedAt >= consolidationCompletedAt + postConsolidationDelayMs
  ) {
    return {
      shouldWake: true,
      reason: `soft wake: consolidation completed at ${consolidationCompletedAt}, delay ${postConsolidationDelayMs}ms elapsed (capturedAt=${capturedAt})`,
    };
  }

  return {
    shouldWake: false,
    reason: [
      `scheduled hard wake at ${scheduledWakeAt}`,
      consolidationCompletedAt === undefined
        ? "consolidation not yet completed"
        : `soft wake eligible at ${consolidationCompletedAt + postConsolidationDelayMs}`,
    ].join("; "),
  };
}
