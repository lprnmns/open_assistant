/**
 * Type and invariant tests for src/consciousness/types.ts.
 *
 * These tests are intentionally lightweight — the goal is to:
 *   1. Prove the types compile correctly
 *   2. Verify the discriminated union gates work at runtime
 *   3. Assert the critical "new_message absent" invariant
 *   4. Validate DEFAULT_CONSCIOUSNESS_CONFIG relationships
 *   5. Check makeInitialConsciousnessState zero values
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONSCIOUSNESS_CONFIG,
  makeInitialConsciousnessState,
  type ConsciousnessConfig,
  type ConsciousnessPhase,
  type ConsciousnessState,
  type ExhaustiveRecord,
  type TickAction,
  type TickDecision,
  type WakeReason,
  type WatchdogResult,
  type WorldSnapshot,
} from "./types.js";

// ── WakeReason exhaustiveness ─────────────────────────────────────────────────
//
// ExhaustiveRecord<WakeReason> forces a compile error if any member of
// WakeReason is missing from the object literal.  If a new value is added to
// the union without updating this object, `tsc` will reject the file.
// This is the real exhaustiveness guarantee — not a runtime array check.

const _WAKE_REASON_EXHAUSTIVE: ExhaustiveRecord<WakeReason> = {
  TRIGGER_FIRED: true,
  SILENCE_THRESHOLD: true,
  PENDING_NOTE: true,
  CRON_DUE: true,
  EXTERNAL_WORLD_DELTA: true,
};

describe("WakeReason", () => {
  it("exhaustive record covers all 5 reasons", () => {
    expect(Object.keys(_WAKE_REASON_EXHAUSTIVE)).toHaveLength(5);
  });

  it("does NOT include new_message (compile + runtime)", () => {
    const keys = Object.keys(_WAKE_REASON_EXHAUSTIVE);
    expect(keys).not.toContain("new_message");
    expect(keys).not.toContain("NEW_MESSAGE");
    expect(keys).not.toContain("INBOUND_MESSAGE");
  });
});

// ── TickAction exhaustiveness ─────────────────────────────────────────────────

const _TICK_ACTION_EXHAUSTIVE: ExhaustiveRecord<TickAction> = {
  SEND_MESSAGE: true,
  TAKE_NOTE: true,
  STAY_SILENT: true,
  ENTER_SLEEP: true,
};

describe("TickAction", () => {
  it("exhaustive record covers all 4 actions", () => {
    expect(Object.keys(_TICK_ACTION_EXHAUSTIVE)).toHaveLength(4);
  });
});

// ── ConsciousnessPhase state machine ─────────────────────────────────────────

const _PHASE_EXHAUSTIVE: ExhaustiveRecord<ConsciousnessPhase> = {
  IDLE: true,
  WATCHING: true,
  THINKING: true,
  SLEEPING: true,
  PAUSED: true,
};

describe("ConsciousnessPhase", () => {
  it("exhaustive record covers all 5 states", () => {
    expect(Object.keys(_PHASE_EXHAUSTIVE)).toHaveLength(5);
  });
});

// ── WatchdogResult discriminated union ───────────────────────────────────────

describe("WatchdogResult", () => {
  it("wake=false carries no reason", () => {
    const result: WatchdogResult = { wake: false };
    expect(result.wake).toBe(false);
    // TypeScript: accessing .reason on wake=false is a compile error.
    // At runtime we verify the key is absent.
    expect("reason" in result).toBe(false);
  });

  it("wake=true carries reason and context", () => {
    const result: WatchdogResult = {
      wake: true,
      reason: "SILENCE_THRESHOLD",
      context: "Owner has been silent for 32 minutes",
      nextSilenceThresholdMs: 2_700_000,
    };
    expect(result.wake).toBe(true);
    expect(result.reason).toBe("SILENCE_THRESHOLD");
    expect(result.context).toBeTruthy();
    expect(result.nextSilenceThresholdMs).toBe(2_700_000);
  });

  it("wake=true for TRIGGER_FIRED does not require nextSilenceThresholdMs", () => {
    const result: WatchdogResult = {
      wake: true,
      reason: "TRIGGER_FIRED",
      context: "trigger:daily-reflection fired",
    };
    expect(result.wake).toBe(true);
    expect(result.nextSilenceThresholdMs).toBeUndefined();
  });
});

// ── WorldSnapshot structure ───────────────────────────────────────────────────

describe("WorldSnapshot", () => {
  it("can be constructed with all required fields", () => {
    const snap: WorldSnapshot = {
      capturedAt: Date.now(),
      lastUserInteractionAt: Date.now() - 60_000,
      pendingNoteCount: 2,
      firedTriggerIds: [],
      dueCronExpressions: [],
      externalWorldEvents: [],
      activeChannelId: "web-chat",
      lastTickAt: undefined,
      effectiveSilenceThresholdMs: 1_800_000,
    };
    expect(snap.pendingNoteCount).toBe(2);
    expect(snap.lastTickAt).toBeUndefined();
  });

  it("lastUserInteractionAt may be undefined for brand-new agents", () => {
    const snap: WorldSnapshot = {
      capturedAt: Date.now(),
      lastUserInteractionAt: undefined,
      pendingNoteCount: 0,
      firedTriggerIds: [],
      dueCronExpressions: [],
      externalWorldEvents: [],
      activeChannelId: undefined,
      lastTickAt: undefined,
      effectiveSilenceThresholdMs: 1_800_000,
    };
    expect(snap.lastUserInteractionAt).toBeUndefined();
    expect(snap.activeChannelId).toBeUndefined();
  });
});

// ── TickDecision ──────────────────────────────────────────────────────────────

describe("TickDecision (discriminated union)", () => {
  it("SEND_MESSAGE requires messageContent — compile+runtime", () => {
    // If messageContent were optional, the next line would compile without it.
    // With the discriminated union it is required — tsc enforces this.
    const decision: TickDecision = {
      action: "SEND_MESSAGE",
      messageContent: "Hey, I noticed your calendar has a free slot tomorrow.",
      reasoning: "Owner seems idle and has an actionable context.",
    };
    expect(decision.action).toBe("SEND_MESSAGE");
    expect(decision.messageContent).toBeTruthy();
  });

  it("TAKE_NOTE requires noteContent — compile+runtime", () => {
    const decision: TickDecision = {
      action: "TAKE_NOTE",
      noteContent: "User mentioned they want to review the Q1 report next week.",
    };
    expect(decision.action).toBe("TAKE_NOTE");
    expect(decision.noteContent).toBeTruthy();
  });

  it("STAY_SILENT requires no payload fields", () => {
    const decision: TickDecision = { action: "STAY_SILENT" };
    expect(decision.action).toBe("STAY_SILENT");
    // Narrowed type has no messageContent or noteContent
    if (decision.action === "SEND_MESSAGE") {
      // unreachable — proves TS narrows correctly
      expect(decision.messageContent).toBeTruthy();
    }
  });

  it("ENTER_SLEEP can carry suggestedNextTickDelayMs", () => {
    const decision: TickDecision = {
      action: "ENTER_SLEEP",
      suggestedNextTickDelayMs: 7 * 60 * 60_000,
    };
    expect(decision.action).toBe("ENTER_SLEEP");
    expect(decision.suggestedNextTickDelayMs).toBeGreaterThan(0);
  });

  it("narrowing on action gives access to variant-specific fields", () => {
    const decisions: TickDecision[] = [
      { action: "SEND_MESSAGE", messageContent: "hello" },
      { action: "TAKE_NOTE", noteContent: "note text" },
      { action: "STAY_SILENT" },
      { action: "ENTER_SLEEP" },
    ];
    for (const d of decisions) {
      switch (d.action) {
        case "SEND_MESSAGE":
          expect(typeof d.messageContent).toBe("string");
          break;
        case "TAKE_NOTE":
          expect(typeof d.noteContent).toBe("string");
          break;
        case "STAY_SILENT":
        case "ENTER_SLEEP":
          expect(d.action).toBeTruthy();
          break;
      }
    }
  });
});

// ── DEFAULT_CONSCIOUSNESS_CONFIG ──────────────────────────────────────────────

describe("DEFAULT_CONSCIOUSNESS_CONFIG", () => {
  it("watchdogIntervalMs is less than minTickIntervalMs", () => {
    expect(DEFAULT_CONSCIOUSNESS_CONFIG.watchdogIntervalMs).toBeLessThan(
      DEFAULT_CONSCIOUSNESS_CONFIG.minTickIntervalMs,
    );
  });

  it("minTickIntervalMs is less than maxTickIntervalMs", () => {
    expect(DEFAULT_CONSCIOUSNESS_CONFIG.minTickIntervalMs).toBeLessThan(
      DEFAULT_CONSCIOUSNESS_CONFIG.maxTickIntervalMs,
    );
  });

  it("baseSilenceThresholdMs is less than maxSilenceThresholdMs", () => {
    expect(DEFAULT_CONSCIOUSNESS_CONFIG.baseSilenceThresholdMs).toBeLessThan(
      DEFAULT_CONSCIOUSNESS_CONFIG.maxSilenceThresholdMs,
    );
  });

  it("sleepStartHourUtc and sleepEndHourUtc are valid 0-23 values", () => {
    expect(DEFAULT_CONSCIOUSNESS_CONFIG.sleepStartHourUtc).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_CONSCIOUSNESS_CONFIG.sleepStartHourUtc).toBeLessThanOrEqual(23);
    expect(DEFAULT_CONSCIOUSNESS_CONFIG.sleepEndHourUtc).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_CONSCIOUSNESS_CONFIG.sleepEndHourUtc).toBeLessThanOrEqual(23);
  });

  it("llmSource is always 'consciousness'", () => {
    expect(DEFAULT_CONSCIOUSNESS_CONFIG.llmSource).toBe("consciousness");
  });
});

// ── makeInitialConsciousnessState ─────────────────────────────────────────────

describe("makeInitialConsciousnessState", () => {
  it("starts in IDLE phase", () => {
    const state = makeInitialConsciousnessState();
    expect(state.phase).toBe("IDLE");
  });

  it("starts with zero counts", () => {
    const state = makeInitialConsciousnessState();
    expect(state.tickCount).toBe(0);
    expect(state.llmCallCount).toBe(0);
  });

  it("starts with no prior snapshot, watchdog result, or decision", () => {
    const state = makeInitialConsciousnessState();
    expect(state.lastSnapshot).toBeUndefined();
    expect(state.lastWatchdogResult).toBeUndefined();
    expect(state.lastDecision).toBeUndefined();
  });

  it("accepts a custom config", () => {
    const custom: ConsciousnessConfig = {
      ...DEFAULT_CONSCIOUSNESS_CONFIG,
      minTickIntervalMs: 60_000,
    };
    const state = makeInitialConsciousnessState(custom);
    expect(state.config.minTickIntervalMs).toBe(60_000);
  });

  it("state satisfies ConsciousnessState type", () => {
    const state: ConsciousnessState = makeInitialConsciousnessState();
    expect(state).toBeTruthy();
  });
});
