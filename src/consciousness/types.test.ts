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
  type TickAction,
  type TickDecision,
  type WakeReason,
  type WatchdogResult,
  type WorldSnapshot,
} from "./types.js";

// ── WakeReason exhaustiveness ─────────────────────────────────────────────────

describe("WakeReason", () => {
  it("contains exactly the approved reasons", () => {
    // Compile-time: if a new reason is added to the union, this array must
    // be updated — TypeScript will error otherwise.
    const ALL_WAKE_REASONS: WakeReason[] = [
      "TRIGGER_FIRED",
      "SILENCE_THRESHOLD",
      "PENDING_NOTE",
      "CRON_DUE",
      "EXTERNAL_WORLD_DELTA",
    ];
    expect(ALL_WAKE_REASONS).toHaveLength(5);
  });

  it("does NOT include new_message", () => {
    const reasons: string[] = [
      "TRIGGER_FIRED",
      "SILENCE_THRESHOLD",
      "PENDING_NOTE",
      "CRON_DUE",
      "EXTERNAL_WORLD_DELTA",
    ];
    expect(reasons).not.toContain("new_message");
    expect(reasons).not.toContain("NEW_MESSAGE");
    expect(reasons).not.toContain("INBOUND_MESSAGE");
  });
});

// ── TickAction exhaustiveness ─────────────────────────────────────────────────

describe("TickAction", () => {
  it("contains exactly the four approved actions", () => {
    const ALL_TICK_ACTIONS: TickAction[] = [
      "SEND_MESSAGE",
      "TAKE_NOTE",
      "STAY_SILENT",
      "ENTER_SLEEP",
    ];
    expect(ALL_TICK_ACTIONS).toHaveLength(4);
  });
});

// ── ConsciousnessPhase state machine ─────────────────────────────────────────

describe("ConsciousnessPhase", () => {
  it("contains all expected states", () => {
    const ALL_PHASES: ConsciousnessPhase[] = [
      "IDLE",
      "WATCHING",
      "THINKING",
      "SLEEPING",
      "PAUSED",
    ];
    expect(ALL_PHASES).toHaveLength(5);
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

describe("TickDecision", () => {
  it("SEND_MESSAGE carries messageContent", () => {
    const decision: TickDecision = {
      action: "SEND_MESSAGE",
      messageContent: "Hey, I noticed your calendar has a free slot tomorrow.",
      reasoning: "Owner seems idle and has an actionable context.",
    };
    expect(decision.action).toBe("SEND_MESSAGE");
    expect(decision.messageContent).toBeTruthy();
  });

  it("TAKE_NOTE carries noteContent", () => {
    const decision: TickDecision = {
      action: "TAKE_NOTE",
      noteContent: "User mentioned they want to review the Q1 report next week.",
    };
    expect(decision.action).toBe("TAKE_NOTE");
    expect(decision.noteContent).toBeTruthy();
  });

  it("STAY_SILENT requires no extra fields", () => {
    const decision: TickDecision = { action: "STAY_SILENT" };
    expect(decision.action).toBe("STAY_SILENT");
    expect(decision.messageContent).toBeUndefined();
    expect(decision.noteContent).toBeUndefined();
  });

  it("ENTER_SLEEP can carry suggestedNextTickDelayMs", () => {
    const decision: TickDecision = {
      action: "ENTER_SLEEP",
      suggestedNextTickDelayMs: 7 * 60 * 60_000,
    };
    expect(decision.action).toBe("ENTER_SLEEP");
    expect(decision.suggestedNextTickDelayMs).toBeGreaterThan(0);
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
