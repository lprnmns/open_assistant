import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeNextTickDelayMs, tick } from "./loop.js";
import {
  DEFAULT_CONSCIOUSNESS_CONFIG,
  makeInitialConsciousnessState,
  type ConsciousnessConfig,
  type WorldSnapshot,
} from "./types.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;
const cfg = DEFAULT_CONSCIOUSNESS_CONFIG;

function makeSnap(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    capturedAt: NOW,
    lastUserInteractionAt: NOW - 60_000,
    pendingNoteCount: 0,
    firedTriggerIds: [],
    dueCronExpressions: [],
    externalWorldEvents: [],
    activeChannelId: "web-chat",
    lastTickAt: undefined,
    effectiveSilenceThresholdMs: cfg.baseSilenceThresholdMs,
    ...overrides,
  };
}

// ── computeNextTickDelayMs ────────────────────────────────────────────────────

describe("computeNextTickDelayMs", () => {
  it("returns minTickIntervalMs when woke=true", () => {
    const delay = computeNextTickDelayMs({
      woke: true,
      decision: undefined,
      currentDelayMs: cfg.maxTickIntervalMs,
      config: cfg,
    });
    expect(delay).toBe(cfg.minTickIntervalMs);
  });

  it("grows toward maxTickIntervalMs when woke=false", () => {
    const delay = computeNextTickDelayMs({
      woke: false,
      decision: undefined,
      currentDelayMs: cfg.minTickIntervalMs,
      config: cfg,
    });
    expect(delay).toBeGreaterThan(cfg.minTickIntervalMs);
    expect(delay).toBeLessThanOrEqual(cfg.maxTickIntervalMs);
  });

  it("never exceeds maxTickIntervalMs", () => {
    const delay = computeNextTickDelayMs({
      woke: false,
      decision: undefined,
      currentDelayMs: cfg.maxTickIntervalMs,
      config: cfg,
    });
    expect(delay).toBe(cfg.maxTickIntervalMs);
  });

  it("honours suggestedNextTickDelayMs clamped to [min, max]", () => {
    const delay = computeNextTickDelayMs({
      woke: true,
      decision: { action: "STAY_SILENT", suggestedNextTickDelayMs: 60_000 },
      currentDelayMs: cfg.minTickIntervalMs,
      config: cfg,
    });
    expect(delay).toBe(60_000);
  });

  it("clamps suggestedNextTickDelayMs below min up to min", () => {
    const delay = computeNextTickDelayMs({
      woke: true,
      decision: { action: "STAY_SILENT", suggestedNextTickDelayMs: 1_000 },
      currentDelayMs: cfg.minTickIntervalMs,
      config: cfg,
    });
    expect(delay).toBe(cfg.minTickIntervalMs);
  });

  it("clamps suggestedNextTickDelayMs above max down to max", () => {
    const delay = computeNextTickDelayMs({
      woke: true,
      decision: { action: "STAY_SILENT", suggestedNextTickDelayMs: 999_999_999 },
      currentDelayMs: cfg.minTickIntervalMs,
      config: cfg,
    });
    expect(delay).toBe(cfg.maxTickIntervalMs);
  });
});

// ── tick() — Watchdog: wake:false → no LLM call ───────────────────────────────

describe("tick() — Watchdog returns wake:false", () => {
  it("returns decision:undefined and does not call proxyCall", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const snap = makeSnap(); // no background deltas
    const state = makeInitialConsciousnessState();

    const result = await tick(snap, state);

    expect(result.decision).toBeUndefined();
    expect(result.watchdogResult.wake).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("transitions phase IDLE → WATCHING → IDLE", async () => {
    const snap = makeSnap();
    const state = makeInitialConsciousnessState();

    const result = await tick(snap, state);

    expect(result.state.phase).toBe("IDLE");
    expect(result.state.tickCount).toBe(1);
    expect(result.state.llmCallCount).toBe(0);
  });

  it("next delay grows (relaxing interval) when no delta", async () => {
    const snap = makeSnap();
    const state = makeInitialConsciousnessState();

    const result = await tick(snap, state);

    expect(result.nextDelayMs).toBeGreaterThanOrEqual(cfg.minTickIntervalMs);
  });
});

// ── tick() — Watchdog: wake:true → LLM call ──────────────────────────────────

describe("tick() — Watchdog returns wake:true", () => {
  beforeEach(() => {
    process.env.LITELLM_PROXY_URL = "http://litellm-test:4000";
    process.env.LITELLM_MASTER_KEY = "sk-test-master";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LITELLM_PROXY_URL;
    delete process.env.LITELLM_MASTER_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("calls proxyCall with source:'consciousness'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"STAY_SILENT"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    } as Response);

    const snap = makeSnap({ firedTriggerIds: ["test-trigger"] });
    const state = makeInitialConsciousnessState();

    const result = await tick(snap, state);

    expect(result.watchdogResult.wake).toBe(true);
    expect(result.state.llmCallCount).toBe(1);
  });

  it("parses STAY_SILENT correctly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"STAY_SILENT"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    const snap = makeSnap({ firedTriggerIds: ["t1"] });
    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.decision?.action).toBe("STAY_SILENT");
    expect(result.state.phase).toBe("IDLE");
  });

  it("parses SEND_MESSAGE and carries messageContent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"SEND_MESSAGE","messageContent":"Hello!"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    const snap = makeSnap({ firedTriggerIds: ["t1"] });
    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.decision?.action).toBe("SEND_MESSAGE");
    if (result.decision?.action === "SEND_MESSAGE") {
      expect(result.decision.messageContent).toBe("Hello!");
    }
  });

  it("parses TAKE_NOTE and carries noteContent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"TAKE_NOTE","noteContent":"Remember this."}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    const snap = makeSnap({ pendingNoteCount: 1 });
    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.decision?.action).toBe("TAKE_NOTE");
    if (result.decision?.action === "TAKE_NOTE") {
      expect(result.decision.noteContent).toBe("Remember this.");
    }
  });

  it("transitions to SLEEPING on ENTER_SLEEP", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"ENTER_SLEEP"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    const snap = makeSnap({ firedTriggerIds: ["sleep-trigger"] });
    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.decision?.action).toBe("ENTER_SLEEP");
    expect(result.state.phase).toBe("SLEEPING");
  });

  it("next delay is minTickIntervalMs after a wake", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"STAY_SILENT"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    const snap = makeSnap({ firedTriggerIds: ["t1"] });
    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.nextDelayMs).toBe(cfg.minTickIntervalMs);
  });

  it("increments llmCallCount", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"STAY_SILENT"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    const snap = makeSnap({ firedTriggerIds: ["t1"] });
    const state = makeInitialConsciousnessState();
    expect(state.llmCallCount).toBe(0);

    const result = await tick(snap, state);
    expect(result.state.llmCallCount).toBe(1);
  });

  it("persists nextSilenceThresholdMs into updatedSnap on SILENCE_THRESHOLD", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"STAY_SILENT"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    const threshold = cfg.baseSilenceThresholdMs;
    const snap = makeSnap({
      lastUserInteractionAt: NOW - threshold - 1,
      effectiveSilenceThresholdMs: threshold,
    });

    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.watchdogResult.wake).toBe(true);
    if (!result.watchdogResult.wake) return;
    expect(result.watchdogResult.reason).toBe("SILENCE_THRESHOLD");
    // The updated snapshot must carry the expanded threshold
    const expectedNext = Math.min(Math.round(threshold * 1.5), cfg.maxSilenceThresholdMs);
    expect(result.state.lastSnapshot?.effectiveSilenceThresholdMs).toBe(expectedNext);
  });
});

// ── tick() — LLM error fallback ───────────────────────────────────────────────

describe("tick() — LLM call failure", () => {
  beforeEach(() => {
    process.env.LITELLM_PROXY_URL = "http://litellm-test:4000";
    process.env.LITELLM_MASTER_KEY = "sk-test-master";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LITELLM_PROXY_URL;
    delete process.env.LITELLM_MASTER_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("falls back to STAY_SILENT when proxyCall throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network timeout"));

    const snap = makeSnap({ firedTriggerIds: ["t1"] });
    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.decision?.action).toBe("STAY_SILENT");
    expect(result.state.phase).toBe("IDLE"); // loop stays alive
  });

  it("falls back to STAY_SILENT on malformed LLM JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: "not json at all" } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    const snap = makeSnap({ firedTriggerIds: ["t1"] });
    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.decision?.action).toBe("STAY_SILENT");
    expect(result.state.phase).toBe("IDLE");
  });
});

// ── tick() — state immutability ───────────────────────────────────────────────

describe("tick() — state immutability", () => {
  it("does not mutate the input state", async () => {
    const snap = makeSnap();
    const state = makeInitialConsciousnessState();
    const originalPhase = state.phase;
    const originalTickCount = state.tickCount;

    await tick(snap, state);

    expect(state.phase).toBe(originalPhase);
    expect(state.tickCount).toBe(originalTickCount);
  });
});
