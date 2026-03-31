import { describe, expect, it } from "vitest";
import { evaluateSleepWakeTransition, nextOccurrenceOfHourUtc } from "./wake.js";

// ── nextOccurrenceOfHourUtc ───────────────────────────────────────────────────

describe("nextOccurrenceOfHourUtc", () => {
  // Fixed reference: 2026-03-31T14:00:00.000Z = 1743429600000
  const T14 = Date.UTC(2026, 2, 31, 14, 0, 0, 0); // 14:00 UTC
  const T06 = Date.UTC(2026, 2, 31, 6, 0, 0, 0);  //  6:00 UTC
  const T07 = Date.UTC(2026, 2, 31, 7, 0, 0, 0);  //  7:00 UTC
  const T23 = Date.UTC(2026, 2, 31, 23, 0, 0, 0); // 23:00 UTC

  it("returns next-day occurrence when afterMs is past the target hour", () => {
    // 14:00 UTC, wakeHour=7 → next 07:00 is April 1
    const result = nextOccurrenceOfHourUtc(T14, 7);
    const expected = Date.UTC(2026, 3, 1, 7, 0, 0, 0); // April 1 07:00 UTC
    expect(result).toBe(expected);
  });

  it("returns same-day occurrence when afterMs is before the target hour", () => {
    // 6:00 UTC, wakeHour=7 → same day 07:00
    const result = nextOccurrenceOfHourUtc(T06, 7);
    expect(result).toBe(T07);
  });

  it("returns next-day occurrence when afterMs is exactly on the target hour (strict greater-than)", () => {
    // 7:00 UTC exactly, wakeHour=7 → next day 07:00 (must be strictly after)
    const result = nextOccurrenceOfHourUtc(T07, 7);
    const expected = Date.UTC(2026, 3, 1, 7, 0, 0, 0);
    expect(result).toBe(expected);
  });

  it("returns next-day midnight when afterMs is 23:00 and wakeHour=0", () => {
    // 23:00, wakeHour=0 → next 00:00 is April 1
    const result = nextOccurrenceOfHourUtc(T23, 0);
    const expected = Date.UTC(2026, 3, 1, 0, 0, 0, 0);
    expect(result).toBe(expected);
  });

  it("result is always strictly greater than afterMs", () => {
    // Test multiple hours to verify the strict invariant
    for (const hour of [0, 3, 7, 12, 18, 23]) {
      const result = nextOccurrenceOfHourUtc(T14, hour);
      expect(result).toBeGreaterThan(T14);
    }
  });

  it("result is always at :00:00.000 (clean hour boundary)", () => {
    const result = nextOccurrenceOfHourUtc(T14, 7);
    const d = new Date(result);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });
});

// ── evaluateSleepWakeTransition ───────────────────────────────────────────────

describe("evaluateSleepWakeTransition — no sleep cycle", () => {
  it("shouldWake:false when sleepEnteredAt is undefined", () => {
    const result = evaluateSleepWakeTransition({
      capturedAt: Date.UTC(2026, 3, 1, 12, 0, 0),
      sleepEnteredAt: undefined,
      consolidationCompletedAt: undefined,
      sleepEndHourUtc: 7,
      postConsolidationDelayMs: 300_000,
    });
    expect(result.shouldWake).toBe(false);
  });
});

describe("evaluateSleepWakeTransition — hard wake", () => {
  // sleep entered at 2026-03-31 22:00 UTC → scheduledWakeAt = 2026-04-01 07:00 UTC
  const sleepEnteredAt = Date.UTC(2026, 2, 31, 22, 0, 0);
  const scheduledWakeAt = Date.UTC(2026, 3, 1, 7, 0, 0);

  it("shouldWake:true when capturedAt >= scheduledWakeAt", () => {
    const result = evaluateSleepWakeTransition({
      capturedAt: scheduledWakeAt,
      sleepEnteredAt,
      consolidationCompletedAt: undefined,
      sleepEndHourUtc: 7,
      postConsolidationDelayMs: 300_000,
    });
    expect(result.shouldWake).toBe(true);
  });

  it("shouldWake:true when capturedAt is well past scheduledWakeAt", () => {
    const result = evaluateSleepWakeTransition({
      capturedAt: scheduledWakeAt + 3_600_000, // 1 hour past
      sleepEnteredAt,
      consolidationCompletedAt: undefined,
      sleepEndHourUtc: 7,
      postConsolidationDelayMs: 300_000,
    });
    expect(result.shouldWake).toBe(true);
  });

  it("shouldWake:false when capturedAt < scheduledWakeAt", () => {
    const result = evaluateSleepWakeTransition({
      capturedAt: scheduledWakeAt - 1, // 1ms before
      sleepEnteredAt,
      consolidationCompletedAt: undefined,
      sleepEndHourUtc: 7,
      postConsolidationDelayMs: 300_000,
    });
    expect(result.shouldWake).toBe(false);
  });

  it("hard wake fires even when consolidation never completed (fail-soft)", () => {
    // consolidationCompletedAt:undefined must not prevent hard wake
    const result = evaluateSleepWakeTransition({
      capturedAt: scheduledWakeAt + 1,
      sleepEnteredAt,
      consolidationCompletedAt: undefined,
      sleepEndHourUtc: 7,
      postConsolidationDelayMs: 300_000,
    });
    expect(result.shouldWake).toBe(true);
  });

  it("sleep at 14:00 UTC with sleepEndHourUtc=7 does NOT wake immediately (no same-day early wake)", () => {
    // This is the pathological case: sleep entered AFTER the wake hour.
    // Without nextOccurrenceOfHourUtc, capturedAt.hour >= 7 would be true immediately.
    const sleepAt14 = Date.UTC(2026, 2, 31, 14, 0, 0);
    const justAfter = sleepAt14 + 60_000; // 1 minute later, still same day
    const result = evaluateSleepWakeTransition({
      capturedAt: justAfter,
      sleepEnteredAt: sleepAt14,
      consolidationCompletedAt: undefined,
      sleepEndHourUtc: 7,
      postConsolidationDelayMs: 300_000,
    });
    // scheduledWakeAt = April 1 07:00, so capturedAt is still hours away
    expect(result.shouldWake).toBe(false);
  });
});

describe("evaluateSleepWakeTransition — soft early wake", () => {
  const sleepEnteredAt = Date.UTC(2026, 2, 31, 22, 0, 0);
  // scheduledWakeAt = April 1 07:00 UTC (9 hours away)
  const consolidationDoneAt = Date.UTC(2026, 2, 31, 22, 30, 0); // 30 min into sleep
  const delay = 300_000; // 5 min

  it("shouldWake:true when consolidation done and delay elapsed", () => {
    const capturedAt = consolidationDoneAt + delay; // exactly at threshold
    const result = evaluateSleepWakeTransition({
      capturedAt,
      sleepEnteredAt,
      consolidationCompletedAt: consolidationDoneAt,
      sleepEndHourUtc: 7,
      postConsolidationDelayMs: delay,
    });
    expect(result.shouldWake).toBe(true);
  });

  it("shouldWake:false when consolidation done but delay not yet elapsed", () => {
    const capturedAt = consolidationDoneAt + delay - 1; // 1ms short
    const result = evaluateSleepWakeTransition({
      capturedAt,
      sleepEnteredAt,
      consolidationCompletedAt: consolidationDoneAt,
      sleepEndHourUtc: 7,
      postConsolidationDelayMs: delay,
    });
    expect(result.shouldWake).toBe(false);
  });

  it("shouldWake:false when consolidationCompletedAt is undefined (pipeline not done)", () => {
    const capturedAt = consolidationDoneAt + delay + 1_000_000; // way past where delay would fire
    const result = evaluateSleepWakeTransition({
      capturedAt,
      sleepEnteredAt,
      consolidationCompletedAt: undefined, // never ran
      sleepEndHourUtc: 7,
      postConsolidationDelayMs: delay,
    });
    // Hard wake not yet (capturedAt still before scheduledWakeAt) and soft wake requires defined value
    expect(result.shouldWake).toBe(false);
  });

  it("postConsolidationDelayMs=0 wakes immediately when consolidation completes", () => {
    const result = evaluateSleepWakeTransition({
      capturedAt: consolidationDoneAt, // exactly at completion
      sleepEnteredAt,
      consolidationCompletedAt: consolidationDoneAt,
      sleepEndHourUtc: 7,
      postConsolidationDelayMs: 0,
    });
    expect(result.shouldWake).toBe(true);
  });
});

describe("evaluateSleepWakeTransition — shouldWake:false (neither condition met)", () => {
  it("stays asleep when too early for both hard and soft wake", () => {
    const sleepEnteredAt = Date.UTC(2026, 2, 31, 22, 0, 0);
    // scheduledWakeAt = April 1 07:00; capturedAt = 22:01 same day
    const capturedAt = sleepEnteredAt + 60_000;
    const result = evaluateSleepWakeTransition({
      capturedAt,
      sleepEnteredAt,
      consolidationCompletedAt: undefined,
      sleepEndHourUtc: 7,
      postConsolidationDelayMs: 300_000,
    });
    expect(result.shouldWake).toBe(false);
  });
});

// ── cross-cycle stale timestamp regression ────────────────────────────────────

describe("evaluateSleepWakeTransition — cross-cycle stale timestamp (regression)", () => {
  it("shouldWake:false when consolidationCompletedAt is from a previous cycle (before sleepEnteredAt)", () => {
    // Previous cycle completed consolidation at T_prev.
    // New cycle entered sleep at T_new > T_prev.
    // Without the guard, capturedAt >= T_prev + delay would be trivially true.
    const T_prev = Date.UTC(2026, 2, 31, 22, 35, 0); // previous cycle's completion
    const T_new  = Date.UTC(2026, 3, 2, 22, 0, 0);   // new cycle entered two nights later
    const capturedAt = T_new + 60_000;                // 1 minute into new sleep

    const result = evaluateSleepWakeTransition({
      capturedAt,
      sleepEnteredAt: T_new,
      consolidationCompletedAt: T_prev,              // stale — belongs to old cycle
      sleepEndHourUtc: 7,
      postConsolidationDelayMs: 300_000,
    });
    expect(result.shouldWake).toBe(false);
  });

  it("shouldWake:true for soft wake only when consolidationCompletedAt >= sleepEnteredAt (current cycle)", () => {
    const sleepEnteredAt = Date.UTC(2026, 3, 2, 22, 0, 0);
    const consolidationCompletedAt = sleepEnteredAt + 30 * 60_000; // 30 min in — same cycle
    const delay = 300_000; // 5 min

    const result = evaluateSleepWakeTransition({
      capturedAt: consolidationCompletedAt + delay,
      sleepEnteredAt,
      consolidationCompletedAt,
      sleepEndHourUtc: 7,
      postConsolidationDelayMs: delay,
    });
    expect(result.shouldWake).toBe(true);
  });
});
