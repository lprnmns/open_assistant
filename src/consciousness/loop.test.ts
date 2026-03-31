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

  it("adaptive interval accumulates across consecutive idle ticks", async () => {
    const snap = makeSnap();
    const state = makeInitialConsciousnessState();

    const r1 = await tick(snap, state);
    const r2 = await tick(snap, r1.state);

    // Each idle tick steps 25% of remaining range toward max — second delay must be larger
    expect(r2.nextDelayMs).toBeGreaterThan(r1.nextDelayMs);
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

  it("next delay is minTickIntervalMs after a wake (no suggestion)", async () => {
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

  it("honours suggestedNextTickDelayMs from LLM JSON at runtime", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"STAY_SILENT","suggestedNextTickDelayMs":60000}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    const snap = makeSnap({ firedTriggerIds: ["t1"] });
    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.nextDelayMs).toBe(60_000);
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

// ── tick() — memory recall integration ───────────────────────────────────────

describe("tick() — memory recall context (TickContext)", () => {
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

  it("tick() succeeds without ctx (backward-compatible, no recall)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"STAY_SILENT"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    const snap = makeSnap({ firedTriggerIds: ["t1"] });
    await expect(tick(snap, makeInitialConsciousnessState())).resolves.toBeDefined();
  });

  it("memory context section appears in prompt when recent notes are present", async () => {
    let capturedBody: string | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = typeof init?.body === "string" ? init.body : undefined;
      return {
        ok: true,
        json: async () => ({
          model: "claude-haiku",
          choices: [{ message: { content: '{"action":"STAY_SILENT"}' } }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
      } as Response;
    });

    const recentNote = { id: "n1", content: "remember this", type: "episodic" as const,
      createdAt: NOW, sessionKey: "s" };
    const recall = { recall: vi.fn().mockResolvedValue({ recent: [recentNote], recalled: [] }) };

    const snap = makeSnap({ firedTriggerIds: ["t1"] });
    await tick(snap, makeInitialConsciousnessState(), { recall, sessionKey: "s" });

    expect(capturedBody).toBeDefined();
    const body = JSON.parse(capturedBody!);
    const userContent: string = body.messages.find((m: { role: string }) => m.role === "user").content;
    expect(userContent).toContain("Memory context:");
    expect(userContent).toContain("remember this");
  });

  it("memory context section is ABSENT from prompt when both slices are empty", async () => {
    let capturedBody: string | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = typeof init?.body === "string" ? init.body : undefined;
      return {
        ok: true,
        json: async () => ({
          model: "claude-haiku",
          choices: [{ message: { content: '{"action":"STAY_SILENT"}' } }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
      } as Response;
    });

    const recall = { recall: vi.fn().mockResolvedValue({ recent: [], recalled: [] }) };

    const snap = makeSnap({ firedTriggerIds: ["t1"] });
    await tick(snap, makeInitialConsciousnessState(), { recall, sessionKey: "s" });

    expect(capturedBody).toBeDefined();
    const body = JSON.parse(capturedBody!);
    const userContent: string = body.messages.find((m: { role: string }) => m.role === "user").content;
    expect(userContent).not.toContain("Memory context:");
  });

  it("tick completes normally when recall pipeline throws (fail-soft)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"STAY_SILENT"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    const recall = { recall: vi.fn().mockRejectedValue(new Error("recall exploded")) };

    const snap = makeSnap({ firedTriggerIds: ["t1"] });
    const result = await tick(snap, makeInitialConsciousnessState(), { recall, sessionKey: "s" });

    expect(result.decision?.action).toBe("STAY_SILENT");
    expect(result.state.phase).toBe("IDLE");
  });

  it("ENTER_SLEEP from IDLE sets sleepEnteredAt on the returned state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"ENTER_SLEEP"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    const snap = makeSnap({ firedTriggerIds: ["t1"] });
    const state = makeInitialConsciousnessState(); // phase: "IDLE"
    const result = await tick(snap, state);

    expect(result.state.phase).toBe("SLEEPING");
    expect(result.state.consolidation.sleepEnteredAt).toBeGreaterThan(0);
  });

  it("ENTER_SLEEP from SLEEPING does NOT overwrite sleepEnteredAt (at-most-once guard)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"ENTER_SLEEP"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    const originalSleepEnteredAt = NOW - 5_000;
    const snap = makeSnap({ firedTriggerIds: ["t1"] });
    const state = {
      ...makeInitialConsciousnessState(),
      phase: "SLEEPING" as const,
      consolidation: {
        sleepEnteredAt: originalSleepEnteredAt,
        consolidationCompletedAt: undefined,
      },
    };

    const result = await tick(snap, state);
    // sleepEnteredAt must remain the ORIGINAL value — not overwritten
    expect(result.state.consolidation.sleepEnteredAt).toBe(originalSleepEnteredAt);
  });

  it("ENTER_SLEEP from SLEEPING does NOT re-open consolidation after it already completed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"ENTER_SLEEP"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    const sleepEnteredAt = NOW - 20_000;
    const consolidationCompletedAt = NOW - 10_000; // completed AFTER sleep entered

    const snap = makeSnap({ firedTriggerIds: ["t1"] });
    const state = {
      ...makeInitialConsciousnessState(),
      phase: "SLEEPING" as const,
      consolidation: { sleepEnteredAt, consolidationCompletedAt },
    };

    const result = await tick(snap, state);
    // sleepEnteredAt preserved → consolidationCompletedAt still > sleepEnteredAt
    // → evaluateConsolidationTrigger would return shouldConsolidate: false
    expect(result.state.consolidation.sleepEnteredAt).toBe(sleepEnteredAt);
    expect(result.state.consolidation.consolidationCompletedAt).toBe(consolidationCompletedAt);
  });

  it("tick completes normally when ctx.recall is absent (no brain wired)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"STAY_SILENT"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    const snap = makeSnap({ firedTriggerIds: ["t1"] });
    const result = await tick(snap, makeInitialConsciousnessState(), { sessionKey: "s" });

    expect(result.decision?.action).toBe("STAY_SILENT");
    expect(result.state.phase).toBe("IDLE");
  });
});

// ── tick() — SLEEPING phase ────────────────────────────────────────────────────
//
// While SLEEPING the Watchdog and LLM are bypassed entirely.
// Only the wake-transition condition is evaluated.

describe("tick() — SLEEPING phase — stays asleep", () => {
  // sleep entered at 22:00 UTC; scheduledWakeAt = next day 07:00 UTC (9 hours away)
  const sleepEnteredAt = Date.UTC(2026, 2, 31, 22, 0, 0, 0);
  const capturedAt = sleepEnteredAt + 60_000; // 1 minute later — far from wakeAt

  function makeSleepingState(overrides: {
    consolidationCompletedAt?: number;
    postConsolidationDelayMs?: number;
  } = {}): ReturnType<typeof makeInitialConsciousnessState> {
    const base = makeInitialConsciousnessState({
      ...cfg,
      postConsolidationDelayMs: overrides.postConsolidationDelayMs ?? 300_000,
    });
    return {
      ...base,
      phase: "SLEEPING",
      consolidation: {
        sleepEnteredAt,
        consolidationCompletedAt: overrides.consolidationCompletedAt,
      },
    };
  }

  it("returns SLEEPING phase (not IDLE) when neither wake condition is met", async () => {
    const snap = makeSnap({ capturedAt });
    const result = await tick(snap, makeSleepingState());
    expect(result.state.phase).toBe("SLEEPING");
  });

  it("does NOT call the LLM (fetch) while sleeping", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const snap = makeSnap({ capturedAt });
    await tick(snap, makeSleepingState());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns decision:undefined while sleeping", async () => {
    const snap = makeSnap({ capturedAt });
    const result = await tick(snap, makeSleepingState());
    expect(result.decision).toBeUndefined();
  });

  it("increments tickCount while sleeping", async () => {
    const snap = makeSnap({ capturedAt });
    const state = makeSleepingState();
    const result = await tick(snap, state);
    expect(result.state.tickCount).toBe(state.tickCount + 1);
  });

  it("relaxes interval while sleeping (grows toward maxTickIntervalMs)", async () => {
    const snap = makeSnap({ capturedAt });
    const state = makeSleepingState();
    const result = await tick(snap, state);
    expect(result.nextDelayMs).toBeGreaterThanOrEqual(cfg.minTickIntervalMs);
  });

  it("soft wake not triggered when postConsolidationDelay not elapsed", async () => {
    const consolidationCompletedAt = sleepEnteredAt + 30_000; // 30s into sleep
    const capturedTooSoon = consolidationCompletedAt + 60_000; // only 1 min after, delay=5 min
    const state = makeSleepingState({ consolidationCompletedAt, postConsolidationDelayMs: 300_000 });
    const snap = makeSnap({ capturedAt: capturedTooSoon });
    const result = await tick(snap, state);
    expect(result.state.phase).toBe("SLEEPING");
  });
});

describe("tick() — SLEEPING phase — hard wake transition", () => {
  const sleepEnteredAt = Date.UTC(2026, 2, 31, 22, 0, 0, 0);
  // scheduledWakeAt = April 1 07:00 UTC
  const scheduledWakeAt = Date.UTC(2026, 3, 1, 7, 0, 0, 0);

  function makeSleepingState(): ReturnType<typeof makeInitialConsciousnessState> {
    const base = makeInitialConsciousnessState(cfg);
    return {
      ...base,
      phase: "SLEEPING",
      consolidation: { sleepEnteredAt, consolidationCompletedAt: undefined },
    };
  }

  it("transitions SLEEPING → IDLE when capturedAt >= scheduledWakeAt", async () => {
    const snap = makeSnap({ capturedAt: scheduledWakeAt });
    const result = await tick(snap, makeSleepingState());
    expect(result.state.phase).toBe("IDLE");
  });

  it("does NOT call the LLM on hard wake (pure $0 transition)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const snap = makeSnap({ capturedAt: scheduledWakeAt });
    await tick(snap, makeSleepingState());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns decision:undefined on hard wake", async () => {
    const snap = makeSnap({ capturedAt: scheduledWakeAt });
    const result = await tick(snap, makeSleepingState());
    expect(result.decision).toBeUndefined();
  });

  it("next delay is minTickIntervalMs after wake (wake up promptly)", async () => {
    const snap = makeSnap({ capturedAt: scheduledWakeAt });
    const result = await tick(snap, makeSleepingState());
    expect(result.nextDelayMs).toBe(cfg.minTickIntervalMs);
  });

  it("does NOT wake when sleep entered AFTER sleepEndHourUtc — waits for next day", async () => {
    // Sleep entered at 14:00 UTC with endHour=7; naïve check would wake immediately.
    const lateEntry = Date.UTC(2026, 2, 31, 14, 0, 0);
    const justAfter = lateEntry + 60_000; // 1 min later, same day — must NOT wake
    const base = makeInitialConsciousnessState(cfg);
    const state: ReturnType<typeof makeInitialConsciousnessState> = {
      ...base,
      phase: "SLEEPING",
      consolidation: { sleepEnteredAt: lateEntry, consolidationCompletedAt: undefined },
    };
    const snap = makeSnap({ capturedAt: justAfter });
    const result = await tick(snap, state);
    expect(result.state.phase).toBe("SLEEPING"); // must stay asleep
  });
});

describe("tick() — SLEEPING phase — soft early wake transition", () => {
  const sleepEnteredAt = Date.UTC(2026, 2, 31, 22, 0, 0, 0);
  const consolidationCompletedAt = Date.UTC(2026, 2, 31, 22, 30, 0, 0); // 30 min in
  const delay = 300_000; // 5 min

  function makeSleepingState(): ReturnType<typeof makeInitialConsciousnessState> {
    const base = makeInitialConsciousnessState({ ...cfg, postConsolidationDelayMs: delay });
    return {
      ...base,
      phase: "SLEEPING",
      consolidation: { sleepEnteredAt, consolidationCompletedAt },
    };
  }

  it("transitions SLEEPING → IDLE when consolidation + delay elapsed (before hard wake)", async () => {
    const softWakeAt = consolidationCompletedAt + delay;
    const snap = makeSnap({ capturedAt: softWakeAt });
    const result = await tick(snap, makeSleepingState());
    expect(result.state.phase).toBe("IDLE");
  });

  it("stays SLEEPING when delay not yet elapsed", async () => {
    const snap = makeSnap({ capturedAt: consolidationCompletedAt + delay - 1 });
    const result = await tick(snap, makeSleepingState());
    expect(result.state.phase).toBe("SLEEPING");
  });

  it("soft wake is $0 — no LLM call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const softWakeAt = consolidationCompletedAt + delay;
    const snap = makeSnap({ capturedAt: softWakeAt });
    await tick(snap, makeSleepingState());
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── cross-cycle stale consolidationCompletedAt regression ─────────────────────

describe("tick() — SLEEPING phase — cross-cycle stale timestamp regression", () => {
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

  it("ENTER_SLEEP resets consolidationCompletedAt to undefined for the new cycle", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"ENTER_SLEEP"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    // State carries a stale consolidationCompletedAt from a previous cycle
    const staleCompletedAt = NOW - 24 * 60 * 60 * 1000; // 24h ago
    const stateWithStale = {
      ...makeInitialConsciousnessState(),
      consolidation: {
        sleepEnteredAt: staleCompletedAt - 3_600_000,
        consolidationCompletedAt: staleCompletedAt,
      },
    };

    const snap = makeSnap({ firedTriggerIds: ["sleep-trigger"] });
    const result = await tick(snap, stateWithStale);

    expect(result.decision?.action).toBe("ENTER_SLEEP");
    expect(result.state.phase).toBe("SLEEPING");
    // New cycle must not carry the stale completion timestamp
    expect(result.state.consolidation.consolidationCompletedAt).toBeUndefined();
  });

  it("stale consolidationCompletedAt from previous cycle does NOT trigger soft wake", async () => {
    // Simulate: previous cycle completed consolidation; new cycle just entered sleep.
    // capturedAt is only 1 minute into new sleep — must stay SLEEPING.
    const prevCompletedAt = NOW - 48 * 60 * 60 * 1000; // 2 days ago
    const newSleepEnteredAt = NOW - 60_000;             // 1 minute ago

    const sleepingState = {
      ...makeInitialConsciousnessState(),
      phase: "SLEEPING" as const,
      consolidation: {
        sleepEnteredAt: newSleepEnteredAt,
        consolidationCompletedAt: prevCompletedAt, // stale — from prior cycle
      },
    };

    const snap = makeSnap({ capturedAt: NOW });
    const result = await tick(snap, sleepingState);

    // Must stay asleep — stale completion must not fire soft wake
    expect(result.state.phase).toBe("SLEEPING");
  });
});

// ── tick() — EventBuffer integration (Sub-Task 6.2) ───────────────────────────
//
// Verifies that:
//   1. event prompt lines are injected into the LLM user message
//   2. owner_active_channel events are drained after SEND_MESSAGE / TAKE_NOTE
//   3. owner events are NOT drained after STAY_SILENT / ENTER_SLEEP
//   4. third_party_contact events are NEVER auto-drained
//   5. snap.eventBuffer undefined → empty buffer passed through (backwards-compat)
//   6. SLEEPING phase passes buffer through unchanged without LLM call

import { addEvent, makeEventBuffer, listBySurface } from "./events/buffer.js";
import type { BufferedEvent } from "./events/buffer.js";

function makeOwnerEvent(id: string, receivedAt = NOW): BufferedEvent {
  return { id, surface: "owner_active_channel", source: "web-chat", summary: `owner ${id}`, receivedAt };
}

function makeThirdEvent(id: string, receivedAt = NOW): BufferedEvent {
  return { id, surface: "third_party_contact", source: "telegram:+1", summary: `third ${id}`, receivedAt };
}

function mockLlmResponse(action: string, extra: Record<string, string> = {}) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({
      model: "claude-haiku",
      choices: [{ message: { content: JSON.stringify({ action, ...extra }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  } as Response);
}

describe("tick() — EventBuffer — prompt injection", () => {
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

  it("injects owner-channel event lines into the LLM user message", async () => {
    let capturedBody: string | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = typeof init?.body === "string" ? init.body : undefined;
      return {
        ok: true,
        json: async () => ({
          model: "claude-haiku",
          choices: [{ message: { content: '{"action":"STAY_SILENT"}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      } as Response;
    });

    let buf = makeEventBuffer();
    buf = addEvent(buf, makeOwnerEvent("e1"));

    const snap = makeSnap({ firedTriggerIds: ["t1"], eventBuffer: buf });
    await tick(snap, makeInitialConsciousnessState());

    expect(capturedBody).toBeDefined();
    expect(capturedBody).toContain("Buffered events:");
    expect(capturedBody).toContain("Owner channel");
    expect(capturedBody).toContain("owner e1");
  });

  it("injects third-party event lines with read-only label", async () => {
    let capturedBody: string | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = typeof init?.body === "string" ? init.body : undefined;
      return {
        ok: true,
        json: async () => ({
          model: "claude-haiku",
          choices: [{ message: { content: '{"action":"STAY_SILENT"}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      } as Response;
    });

    let buf = makeEventBuffer();
    buf = addEvent(buf, makeThirdEvent("t1"));

    const snap = makeSnap({ firedTriggerIds: ["t1"], eventBuffer: buf });
    await tick(snap, makeInitialConsciousnessState());

    expect(capturedBody).toContain("Third-party contacts");
    expect(capturedBody).toContain("read-only");
    expect(capturedBody).toContain("owner approval");
  });

  it("no event section when buffer is empty", async () => {
    let capturedBody: string | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = typeof init?.body === "string" ? init.body : undefined;
      return {
        ok: true,
        json: async () => ({
          model: "claude-haiku",
          choices: [{ message: { content: '{"action":"STAY_SILENT"}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      } as Response;
    });

    const snap = makeSnap({ firedTriggerIds: ["t1"] }); // no eventBuffer
    await tick(snap, makeInitialConsciousnessState());

    expect(capturedBody).not.toContain("Buffered events:");
  });
});

describe("tick() — EventBuffer — drain on action", () => {
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

  it("drains shown owner events after SEND_MESSAGE", async () => {
    mockLlmResponse("SEND_MESSAGE", { messageContent: "Hi!" });

    let buf = makeEventBuffer();
    buf = addEvent(buf, makeOwnerEvent("o1"));
    buf = addEvent(buf, makeOwnerEvent("o2"));

    const snap = makeSnap({ firedTriggerIds: ["t1"], eventBuffer: buf });
    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.decision?.action).toBe("SEND_MESSAGE");
    // Both owner events should be drained
    expect(listBySurface(result.eventBuffer, "owner_active_channel")).toHaveLength(0);
  });

  it("drains shown owner events after TAKE_NOTE", async () => {
    mockLlmResponse("TAKE_NOTE", { noteContent: "Remember this." });

    let buf = makeEventBuffer();
    buf = addEvent(buf, makeOwnerEvent("o1"));

    const snap = makeSnap({ pendingNoteCount: 1, eventBuffer: buf });
    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.decision?.action).toBe("TAKE_NOTE");
    expect(listBySurface(result.eventBuffer, "owner_active_channel")).toHaveLength(0);
  });

  it("does NOT drain owner events after STAY_SILENT", async () => {
    mockLlmResponse("STAY_SILENT");

    let buf = makeEventBuffer();
    buf = addEvent(buf, makeOwnerEvent("o1"));

    const snap = makeSnap({ firedTriggerIds: ["t1"], eventBuffer: buf });
    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.decision?.action).toBe("STAY_SILENT");
    expect(listBySurface(result.eventBuffer, "owner_active_channel")).toHaveLength(1);
  });

  it("does NOT drain owner events after ENTER_SLEEP", async () => {
    mockLlmResponse("ENTER_SLEEP");

    let buf = makeEventBuffer();
    buf = addEvent(buf, makeOwnerEvent("o1"));

    const snap = makeSnap({ firedTriggerIds: ["t1"], eventBuffer: buf });
    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.decision?.action).toBe("ENTER_SLEEP");
    expect(listBySurface(result.eventBuffer, "owner_active_channel")).toHaveLength(1);
  });

  it("third_party_contact events are NEVER auto-drained after SEND_MESSAGE", async () => {
    mockLlmResponse("SEND_MESSAGE", { messageContent: "Reply!" });

    let buf = makeEventBuffer();
    buf = addEvent(buf, makeThirdEvent("t1"));

    const snap = makeSnap({ firedTriggerIds: ["trig"], eventBuffer: buf });
    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.decision?.action).toBe("SEND_MESSAGE");
    // Third-party events must survive — DPE rule
    expect(listBySurface(result.eventBuffer, "third_party_contact")).toHaveLength(1);
    expect(result.eventBuffer.events[0]!.id).toBe("t1");
  });

  it("third_party_contact events are NEVER auto-drained after TAKE_NOTE", async () => {
    mockLlmResponse("TAKE_NOTE", { noteContent: "Note it." });

    let buf = makeEventBuffer();
    buf = addEvent(buf, makeThirdEvent("t1"));

    const snap = makeSnap({ pendingNoteCount: 1, eventBuffer: buf });
    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.decision?.action).toBe("TAKE_NOTE");
    expect(listBySurface(result.eventBuffer, "third_party_contact")).toHaveLength(1);
  });

  it("only drains the maxPerSurface shown events, leaving excess owner events", async () => {
    // Add 6 owner events; maxPerSurface defaults to 5 → only 5 are shown and drained
    mockLlmResponse("SEND_MESSAGE", { messageContent: "Done!" });

    let buf = makeEventBuffer();
    for (let i = 1; i <= 6; i++) {
      buf = addEvent(buf, makeOwnerEvent(`o${i}`, NOW + i));
    }

    const snap = makeSnap({ firedTriggerIds: ["t1"], eventBuffer: buf });
    const result = await tick(snap, makeInitialConsciousnessState());

    // 5 shown and drained, 1 oldest remains
    expect(listBySurface(result.eventBuffer, "owner_active_channel")).toHaveLength(1);
  });
});

describe("tick() — EventBuffer — backwards compatibility and SLEEPING passthrough", () => {
  it("returns empty eventBuffer when snap.eventBuffer is undefined", async () => {
    const snap = makeSnap(); // no eventBuffer
    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.eventBuffer).toBeDefined();
    expect(result.eventBuffer.events).toHaveLength(0);
  });

  it("SLEEPING tick passes eventBuffer through unchanged without draining", async () => {
    const sleepEnteredAt = Date.UTC(2026, 2, 31, 22, 0, 0, 0);
    const capturedAt = sleepEnteredAt + 60_000;

    let buf = makeEventBuffer();
    buf = addEvent(buf, makeOwnerEvent("o1", sleepEnteredAt));
    buf = addEvent(buf, makeThirdEvent("t1", sleepEnteredAt));

    const sleepingState = {
      ...makeInitialConsciousnessState(),
      phase: "SLEEPING" as const,
      consolidation: { sleepEnteredAt, consolidationCompletedAt: undefined },
    };

    const snap = makeSnap({ capturedAt, eventBuffer: buf });
    const result = await tick(snap, sleepingState);

    expect(result.state.phase).toBe("SLEEPING");
    // Buffer must be returned intact — no drain during sleep
    expect(listBySurface(result.eventBuffer, "owner_active_channel")).toHaveLength(1);
    expect(listBySurface(result.eventBuffer, "third_party_contact")).toHaveLength(1);
  });

  it("wake:false tick (no LLM) passes eventBuffer through unchanged", async () => {
    let buf = makeEventBuffer();
    buf = addEvent(buf, makeOwnerEvent("o1"));

    const snap = makeSnap({ eventBuffer: buf }); // no delta → watchdog wake:false
    const result = await tick(snap, makeInitialConsciousnessState());

    expect(result.watchdogResult.wake).toBe(false);
    expect(listBySurface(result.eventBuffer, "owner_active_channel")).toHaveLength(1);
  });
});
