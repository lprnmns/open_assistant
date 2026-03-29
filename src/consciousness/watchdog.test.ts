import { describe, expect, it } from "vitest";
import { runWatchdog } from "./watchdog.js";
import {
  DEFAULT_CONSCIOUSNESS_CONFIG,
  type ConsciousnessConfig,
  type WorldSnapshot,
} from "./types.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function makeSnap(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    capturedAt: NOW,
    lastUserInteractionAt: NOW - 60_000, // 1 min ago — within threshold
    pendingNoteCount: 0,
    firedTriggerIds: [],
    dueCronExpressions: [],
    externalWorldEvents: [],
    activeChannelId: "web-chat",
    lastTickAt: undefined,
    effectiveSilenceThresholdMs: DEFAULT_CONSCIOUSNESS_CONFIG.baseSilenceThresholdMs,
    ...overrides,
  };
}

const cfg = DEFAULT_CONSCIOUSNESS_CONFIG;

// ── No delta → wake: false ($0) ───────────────────────────────────────────────

describe("runWatchdog — no background delta", () => {
  it("returns wake:false when nothing has changed", () => {
    const result = runWatchdog(makeSnap(), cfg);
    expect(result.wake).toBe(false);
  });

  it("does NOT fire when owner sent a message recently (silence not exceeded)", () => {
    const snap = makeSnap({ lastUserInteractionAt: NOW - 30_000 }); // 30s ago
    expect(runWatchdog(snap, cfg).wake).toBe(false);
  });

  it("does NOT fire for brand-new agent with no interaction record", () => {
    const snap = makeSnap({ lastUserInteractionAt: undefined });
    expect(runWatchdog(snap, cfg).wake).toBe(false);
  });

  it("returns wake:false even when an inbound message field is absent (new_message is not a check)", () => {
    // There is no 'inboundMessage' field on WorldSnapshot at all — this test
    // documents the design: the Watchdog has no path to fire on user messages.
    const snap = makeSnap();
    const result = runWatchdog(snap, cfg);
    expect(result.wake).toBe(false);
    expect("reason" in result).toBe(false);
  });
});

// ── TRIGGER_FIRED ─────────────────────────────────────────────────────────────

describe("runWatchdog — TRIGGER_FIRED", () => {
  it("fires when firedTriggerIds is non-empty", () => {
    const snap = makeSnap({ firedTriggerIds: ["daily-reflection"] });
    const result = runWatchdog(snap, cfg);
    expect(result.wake).toBe(true);
    if (!result.wake) return;
    expect(result.reason).toBe("TRIGGER_FIRED");
    expect(result.context).toContain("daily-reflection");
  });

  it("includes all trigger IDs in context", () => {
    const snap = makeSnap({ firedTriggerIds: ["t1", "t2", "t3"] });
    const result = runWatchdog(snap, cfg);
    if (!result.wake) throw new Error("expected wake");
    expect(result.context).toContain("t1");
    expect(result.context).toContain("t2");
    expect(result.context).toContain("t3");
  });
});

// ── PENDING_NOTE ──────────────────────────────────────────────────────────────

describe("runWatchdog — PENDING_NOTE", () => {
  it("fires when pendingNoteCount > 0", () => {
    const snap = makeSnap({ pendingNoteCount: 3 });
    const result = runWatchdog(snap, cfg);
    if (!result.wake) throw new Error("expected wake");
    expect(result.reason).toBe("PENDING_NOTE");
    expect(result.context).toContain("3");
  });

  it("does not fire when pendingNoteCount is 0", () => {
    const snap = makeSnap({ pendingNoteCount: 0 });
    expect(runWatchdog(snap, cfg).wake).toBe(false);
  });
});

// ── CRON_DUE ──────────────────────────────────────────────────────────────────

describe("runWatchdog — CRON_DUE", () => {
  it("fires when dueCronExpressions is non-empty", () => {
    const snap = makeSnap({ dueCronExpressions: ["0 9 * * *"] });
    const result = runWatchdog(snap, cfg);
    if (!result.wake) throw new Error("expected wake");
    expect(result.reason).toBe("CRON_DUE");
    expect(result.context).toContain("0 9 * * *");
  });
});

// ── EXTERNAL_WORLD_DELTA ──────────────────────────────────────────────────────

describe("runWatchdog — EXTERNAL_WORLD_DELTA", () => {
  it("fires when externalWorldEvents is non-empty", () => {
    const snap = makeSnap({ externalWorldEvents: ["calendar:invite:evt-123"] });
    const result = runWatchdog(snap, cfg);
    if (!result.wake) throw new Error("expected wake");
    expect(result.reason).toBe("EXTERNAL_WORLD_DELTA");
    expect(result.context).toContain("calendar:invite:evt-123");
  });

  it("reports count and sample event in context", () => {
    const snap = makeSnap({
      externalWorldEvents: ["email:new:001", "email:new:002", "email:new:003"],
    });
    const result = runWatchdog(snap, cfg);
    if (!result.wake) throw new Error("expected wake");
    expect(result.context).toContain("3");
    expect(result.context).toContain("email:new:001");
  });
});

// ── SILENCE_THRESHOLD ─────────────────────────────────────────────────────────

describe("runWatchdog — SILENCE_THRESHOLD", () => {
  it("fires when silence duration exceeds effectiveSilenceThresholdMs", () => {
    const threshold = 1_800_000; // 30 min
    const snap = makeSnap({
      lastUserInteractionAt: NOW - threshold - 1,
      effectiveSilenceThresholdMs: threshold,
    });
    const result = runWatchdog(snap, cfg);
    if (!result.wake) throw new Error("expected wake");
    expect(result.reason).toBe("SILENCE_THRESHOLD");
  });

  it("does not fire when silence is exactly at threshold (< required)", () => {
    const threshold = 1_800_000;
    const snap = makeSnap({
      lastUserInteractionAt: NOW - threshold,
      effectiveSilenceThresholdMs: threshold,
    });
    expect(runWatchdog(snap, cfg).wake).toBe(false);
  });

  it("expands nextSilenceThresholdMs by 50%", () => {
    const threshold = 1_800_000;
    const snap = makeSnap({
      lastUserInteractionAt: NOW - threshold - 1,
      effectiveSilenceThresholdMs: threshold,
    });
    const result = runWatchdog(snap, cfg);
    if (!result.wake) throw new Error("expected wake");
    expect(result.nextSilenceThresholdMs).toBe(Math.round(threshold * 1.5));
  });

  it("caps nextSilenceThresholdMs at maxSilenceThresholdMs", () => {
    const max = cfg.maxSilenceThresholdMs;
    // threshold already near the cap
    const threshold = Math.round(max / 1.4);
    const snap = makeSnap({
      lastUserInteractionAt: NOW - threshold - 1,
      effectiveSilenceThresholdMs: threshold,
    });
    const result = runWatchdog(snap, cfg);
    if (!result.wake) throw new Error("expected wake");
    expect(result.nextSilenceThresholdMs).toBe(max);
  });

  it("does not fire for brand-new agent (lastUserInteractionAt undefined)", () => {
    const snap = makeSnap({ lastUserInteractionAt: undefined });
    expect(runWatchdog(snap, cfg).wake).toBe(false);
  });
});

// ── Priority order ────────────────────────────────────────────────────────────

describe("runWatchdog — priority order", () => {
  it("TRIGGER_FIRED takes priority over SILENCE_THRESHOLD", () => {
    const threshold = 1_800_000;
    const snap = makeSnap({
      firedTriggerIds: ["t1"],
      lastUserInteractionAt: NOW - threshold - 1,
      effectiveSilenceThresholdMs: threshold,
    });
    const result = runWatchdog(snap, cfg);
    if (!result.wake) throw new Error("expected wake");
    expect(result.reason).toBe("TRIGGER_FIRED");
  });

  it("PENDING_NOTE takes priority over CRON_DUE", () => {
    const snap = makeSnap({
      pendingNoteCount: 1,
      dueCronExpressions: ["0 9 * * *"],
    });
    const result = runWatchdog(snap, cfg);
    if (!result.wake) throw new Error("expected wake");
    expect(result.reason).toBe("PENDING_NOTE");
  });

  it("CRON_DUE takes priority over EXTERNAL_WORLD_DELTA", () => {
    const snap = makeSnap({
      dueCronExpressions: ["0 9 * * *"],
      externalWorldEvents: ["calendar:invite:abc"],
    });
    const result = runWatchdog(snap, cfg);
    if (!result.wake) throw new Error("expected wake");
    expect(result.reason).toBe("CRON_DUE");
  });

  it("EXTERNAL_WORLD_DELTA takes priority over SILENCE_THRESHOLD", () => {
    const threshold = 1_800_000;
    const snap = makeSnap({
      externalWorldEvents: ["email:new:001"],
      lastUserInteractionAt: NOW - threshold - 1,
      effectiveSilenceThresholdMs: threshold,
    });
    const result = runWatchdog(snap, cfg);
    if (!result.wake) throw new Error("expected wake");
    expect(result.reason).toBe("EXTERNAL_WORLD_DELTA");
  });
});

// ── Custom config ─────────────────────────────────────────────────────────────

describe("runWatchdog — custom config", () => {
  it("respects a lower maxSilenceThresholdMs", () => {
    const custom: ConsciousnessConfig = {
      ...cfg,
      maxSilenceThresholdMs: 3_600_000, // 1h cap
    };
    const threshold = 2_700_000; // 45 min — 50% expansion = 4.05h > 1h cap
    const snap = makeSnap({
      lastUserInteractionAt: NOW - threshold - 1,
      effectiveSilenceThresholdMs: threshold,
    });
    const result = runWatchdog(snap, custom);
    if (!result.wake) throw new Error("expected wake");
    expect(result.nextSilenceThresholdMs).toBe(3_600_000);
  });
});
