import { describe, expect, it } from "vitest";
import {
  evaluateConsolidationTrigger,
  INITIAL_CONSOLIDATION_TRIGGER_STATE,
  type ConsolidationTriggerState,
} from "./trigger.js";
import type { ConsciousnessPhase } from "../types.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function state(overrides: Partial<ConsolidationTriggerState> = {}): ConsolidationTriggerState {
  return { ...INITIAL_CONSOLIDATION_TRIGGER_STATE, ...overrides };
}

const T1 = 1_700_000_000_000; // arbitrary fixed timestamp
const T2 = T1 + 10_000;       // 10 s after T1
const T3 = T1 + 20_000;       // 20 s after T1

// ── INITIAL_CONSOLIDATION_TRIGGER_STATE ───────────────────────────────────────

describe("INITIAL_CONSOLIDATION_TRIGGER_STATE", () => {
  it("sleepEnteredAt is undefined", () => {
    expect(INITIAL_CONSOLIDATION_TRIGGER_STATE.sleepEnteredAt).toBeUndefined();
  });

  it("consolidationCompletedAt is undefined", () => {
    expect(INITIAL_CONSOLIDATION_TRIGGER_STATE.consolidationCompletedAt).toBeUndefined();
  });
});

// ── phase not SLEEPING → never consolidate ────────────────────────────────────

describe("evaluateConsolidationTrigger — non-SLEEPING phases", () => {
  const nonSleepingPhases: ConsciousnessPhase[] = ["IDLE", "WATCHING", "THINKING", "PAUSED"];

  for (const phase of nonSleepingPhases) {
    it(`phase ${phase} → shouldConsolidate: false`, () => {
      const result = evaluateConsolidationTrigger(phase, state({ sleepEnteredAt: T1 }));
      expect(result.shouldConsolidate).toBe(false);
    });

    it(`phase ${phase} reason mentions phase name`, () => {
      const result = evaluateConsolidationTrigger(phase, state({ sleepEnteredAt: T1 }));
      expect(result.reason).toContain(phase);
    });
  }
});

// ── SLEEPING but no sleep cycle entered ───────────────────────────────────────

describe("evaluateConsolidationTrigger — SLEEPING, no cycle entered yet", () => {
  it("sleepEnteredAt undefined → shouldConsolidate: false", () => {
    const result = evaluateConsolidationTrigger("SLEEPING", state());
    expect(result.shouldConsolidate).toBe(false);
  });

  it("reason mentions sleepEnteredAt being undefined", () => {
    const result = evaluateConsolidationTrigger("SLEEPING", state());
    expect(result.reason).toMatch(/sleepEnteredAt/);
  });
});

// ── SLEEPING, first sleep cycle (never consolidated) ─────────────────────────

describe("evaluateConsolidationTrigger — first sleep cycle, no prior consolidation", () => {
  it("sleepEnteredAt set, consolidationCompletedAt undefined → shouldConsolidate: true", () => {
    const result = evaluateConsolidationTrigger("SLEEPING", state({ sleepEnteredAt: T1 }));
    expect(result.shouldConsolidate).toBe(true);
  });

  it("reason mentions the sleep cycle timestamp", () => {
    const result = evaluateConsolidationTrigger("SLEEPING", state({ sleepEnteredAt: T1 }));
    expect(result.reason).toContain(String(T1));
  });
});

// ── SLEEPING, consolidation already ran this cycle ───────────────────────────

describe("evaluateConsolidationTrigger — consolidation already completed this cycle", () => {
  it("consolidationCompletedAt > sleepEnteredAt → shouldConsolidate: false", () => {
    // T1 = sleep entered, T2 = consolidation completed
    const result = evaluateConsolidationTrigger("SLEEPING", state({
      sleepEnteredAt: T1,
      consolidationCompletedAt: T2,
    }));
    expect(result.shouldConsolidate).toBe(false);
  });

  it("reason mentions both timestamps", () => {
    const result = evaluateConsolidationTrigger("SLEEPING", state({
      sleepEnteredAt: T1,
      consolidationCompletedAt: T2,
    }));
    expect(result.reason).toContain(String(T1));
    expect(result.reason).toContain(String(T2));
  });

  it("consolidationCompletedAt === sleepEnteredAt → shouldConsolidate: false (same-ms treated as done)", () => {
    const result = evaluateConsolidationTrigger("SLEEPING", state({
      sleepEnteredAt: T1,
      consolidationCompletedAt: T1,
    }));
    expect(result.shouldConsolidate).toBe(false);
  });
});

// ── SLEEPING, new sleep cycle after prior consolidation ───────────────────────

describe("evaluateConsolidationTrigger — new sleep cycle after a previous consolidation", () => {
  it("sleepEnteredAt > consolidationCompletedAt → shouldConsolidate: true (new cycle)", () => {
    // T1 = consolidation completed (previous cycle), T2 = new sleep entered
    const result = evaluateConsolidationTrigger("SLEEPING", state({
      sleepEnteredAt: T2,          // new sleep cycle started AFTER consolidation
      consolidationCompletedAt: T1, // consolidation ran for an earlier cycle
    }));
    expect(result.shouldConsolidate).toBe(true);
  });

  it("multiple cycles: each new sleepEnteredAt triggers consolidation once", () => {
    // Cycle 1: entered T1, consolidated T2
    const afterCycle1 = evaluateConsolidationTrigger("SLEEPING", state({
      sleepEnteredAt: T1,
      consolidationCompletedAt: T2,
    }));
    expect(afterCycle1.shouldConsolidate).toBe(false);

    // Cycle 2: entered T3 (> T2), not yet consolidated
    const cycle2Start = evaluateConsolidationTrigger("SLEEPING", state({
      sleepEnteredAt: T3,
      consolidationCompletedAt: T2,
    }));
    expect(cycle2Start.shouldConsolidate).toBe(true);
  });
});

// ── at-most-once invariant ────────────────────────────────────────────────────

describe("evaluateConsolidationTrigger — at-most-once invariant", () => {
  it("calling twice with same state returns same result (pure function)", () => {
    const s = state({ sleepEnteredAt: T1 });
    const r1 = evaluateConsolidationTrigger("SLEEPING", s);
    const r2 = evaluateConsolidationTrigger("SLEEPING", s);
    expect(r1.shouldConsolidate).toBe(r2.shouldConsolidate);
    expect(r1.reason).toBe(r2.reason);
  });

  it("after simulated consolidation (completedAt updated) → false on re-evaluation", () => {
    // Simulate: sleep entered at T1 → shouldConsolidate: true
    const before = evaluateConsolidationTrigger("SLEEPING", state({ sleepEnteredAt: T1 }));
    expect(before.shouldConsolidate).toBe(true);

    // Simulate: consolidation completed at T2 → state updated
    const after = evaluateConsolidationTrigger("SLEEPING", state({
      sleepEnteredAt: T1,
      consolidationCompletedAt: T2,
    }));
    expect(after.shouldConsolidate).toBe(false);
  });

  it("regression — completed cycle + same-phase ENTER_SLEEP does NOT re-open consolidation", () => {
    // Simulate: sleep entered T1 → consolidated T2 → LLM fires ENTER_SLEEP again
    // (same SLEEPING phase, sleepEnteredAt stays T1 because of the non-SLEEPING guard)
    // Trigger must remain false — at-most-once invariant holds.
    const s = state({ sleepEnteredAt: T1, consolidationCompletedAt: T2 });
    // sleepEnteredAt (T1) <= consolidationCompletedAt (T2): trigger is false
    const result = evaluateConsolidationTrigger("SLEEPING", s);
    expect(result.shouldConsolidate).toBe(false);
  });

  it("result has defined reason in all outcomes", () => {
    const cases: Array<[ConsciousnessPhase, ConsolidationTriggerState]> = [
      ["IDLE", state()],
      ["SLEEPING", state()],
      ["SLEEPING", state({ sleepEnteredAt: T1 })],
      ["SLEEPING", state({ sleepEnteredAt: T1, consolidationCompletedAt: T2 })],
      ["SLEEPING", state({ sleepEnteredAt: T2, consolidationCompletedAt: T1 })],
    ];
    for (const [phase, s] of cases) {
      const result = evaluateConsolidationTrigger(phase, s);
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});
