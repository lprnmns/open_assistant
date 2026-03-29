import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsciousnessScheduler } from "./scheduler.js";
import { type DispatchContext } from "./integration.js";
import {
  DEFAULT_CONSCIOUSNESS_CONFIG,
  type WorldSnapshot,
} from "./types.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;
const cfg = DEFAULT_CONSCIOUSNESS_CONFIG;

function makeSnap(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    capturedAt: NOW,
    lastUserInteractionAt: NOW - 60_000, // recent — Watchdog will NOT wake
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

function makeDispatch(overrides: Partial<DispatchContext> = {}): DispatchContext {
  return {
    sendToChannel: vi.fn().mockResolvedValue(undefined),
    appendNote: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── lifecycle ─────────────────────────────────────────────────────────────────

describe("ConsciousnessScheduler — lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not call buildSnapshot before start()", async () => {
    const buildSnapshot = vi.fn().mockResolvedValue(makeSnap());
    new ConsciousnessScheduler({ buildSnapshot, dispatch: makeDispatch() });

    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs * 10);

    expect(buildSnapshot).not.toHaveBeenCalled();
  });

  it("calls buildSnapshot after minTickIntervalMs once start() is called", async () => {
    const buildSnapshot = vi.fn().mockResolvedValue(makeSnap());
    const scheduler = new ConsciousnessScheduler({ buildSnapshot, dispatch: makeDispatch() });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);

    expect(buildSnapshot).toHaveBeenCalledOnce();
    scheduler.stop();
  });

  it("start() is idempotent — second call does not schedule a duplicate tick", async () => {
    const buildSnapshot = vi.fn().mockResolvedValue(makeSnap());
    const scheduler = new ConsciousnessScheduler({ buildSnapshot, dispatch: makeDispatch() });

    scheduler.start();
    scheduler.start(); // second call should be no-op
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);

    expect(buildSnapshot).toHaveBeenCalledOnce();
    scheduler.stop();
  });

  it("stop() before first tick fires prevents buildSnapshot from being called", async () => {
    const buildSnapshot = vi.fn().mockResolvedValue(makeSnap());
    const scheduler = new ConsciousnessScheduler({ buildSnapshot, dispatch: makeDispatch() });

    scheduler.start();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);

    expect(buildSnapshot).not.toHaveBeenCalled();
  });

  it("reschedules after each tick — buildSnapshot called at least twice across two intervals", async () => {
    const buildSnapshot = vi.fn().mockResolvedValue(makeSnap());
    const scheduler = new ConsciousnessScheduler({ buildSnapshot, dispatch: makeDispatch() });

    scheduler.start();
    // First tick fires
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    expect(buildSnapshot).toHaveBeenCalledOnce();

    // Advance enough for at least one more adaptive tick to fire
    await vi.advanceTimersByTimeAsync(cfg.maxTickIntervalMs);
    expect(buildSnapshot.mock.calls.length).toBeGreaterThanOrEqual(2);

    scheduler.stop();
  });

  it("stop() between ticks prevents the second tick from firing", async () => {
    const buildSnapshot = vi.fn().mockResolvedValue(makeSnap());
    const scheduler = new ConsciousnessScheduler({ buildSnapshot, dispatch: makeDispatch() });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    expect(buildSnapshot).toHaveBeenCalledOnce();

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(cfg.maxTickIntervalMs);

    // Still only one call
    expect(buildSnapshot).toHaveBeenCalledOnce();
  });
});

// ── pause / resume ────────────────────────────────────────────────────────────

describe("ConsciousnessScheduler — pause / resume", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("pause() prevents pending tick from firing", async () => {
    const buildSnapshot = vi.fn().mockResolvedValue(makeSnap());
    const scheduler = new ConsciousnessScheduler({ buildSnapshot, dispatch: makeDispatch() });

    scheduler.start();
    scheduler.pause();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);

    expect(buildSnapshot).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("resume() re-schedules a tick after minTickIntervalMs", async () => {
    const buildSnapshot = vi.fn().mockResolvedValue(makeSnap());
    const scheduler = new ConsciousnessScheduler({ buildSnapshot, dispatch: makeDispatch() });

    scheduler.start();
    scheduler.pause();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs); // tick was cancelled

    scheduler.resume();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs); // new tick fires

    expect(buildSnapshot).toHaveBeenCalledOnce();
    scheduler.stop();
  });

  it("in-flight tick does not reschedule when pause() arrived during execution", async () => {
    // Use a deferred promise so we can pause() while the tick is suspended at buildSnapshot
    let resolveSnapshot!: (v: WorldSnapshot) => void;
    const inflightPromise = new Promise<WorldSnapshot>((resolve) => {
      resolveSnapshot = resolve;
    });
    const buildSnapshot = vi
      .fn()
      .mockReturnValueOnce(inflightPromise) // first call: suspended
      .mockResolvedValue(makeSnap());       // subsequent calls: instant

    const scheduler = new ConsciousnessScheduler({ buildSnapshot, dispatch: makeDispatch() });
    scheduler.start();

    // Fire the timer synchronously — runTick() starts but suspends at await buildSnapshot()
    vi.advanceTimersByTime(cfg.minTickIntervalMs);

    // While tick is in-flight, pause the scheduler
    scheduler.pause();

    // Now let buildSnapshot resolve — runTick() continues to completion
    resolveSnapshot(makeSnap());
    await Promise.resolve(); // flush buildSnapshot microtask
    await Promise.resolve(); // flush tick() microtask
    await Promise.resolve(); // flush dispatchDecision / scheduleNext microtask

    // scheduleNext() should have seen phase=PAUSED and NOT scheduled another tick
    await vi.advanceTimersByTimeAsync(cfg.maxTickIntervalMs);
    expect(buildSnapshot).toHaveBeenCalledOnce();

    scheduler.stop();
  });

  it("resume() is a no-op when scheduler is already running (not paused)", async () => {
    const buildSnapshot = vi.fn().mockResolvedValue(makeSnap());
    const scheduler = new ConsciousnessScheduler({ buildSnapshot, dispatch: makeDispatch() });

    scheduler.start();
    // Calling resume() on an IDLE (not PAUSED) scheduler must not create a duplicate timer
    scheduler.resume();

    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);

    // Exactly one tick, not two from a duplicate timer
    expect(buildSnapshot).toHaveBeenCalledOnce();
    scheduler.stop();
  });
});

// ── resilience ────────────────────────────────────────────────────────────────

describe("ConsciousnessScheduler — resilience", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("buildSnapshot failure → loop stays alive and reschedules", async () => {
    const buildSnapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error("redis unavailable"))
      .mockResolvedValue(makeSnap());

    const ticks: number[] = [];
    const scheduler = new ConsciousnessScheduler({
      buildSnapshot,
      dispatch: makeDispatch(),
      onTick: () => ticks.push(Date.now()),
    });

    scheduler.start();

    // First interval: buildSnapshot throws, no onTick called
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    expect(ticks).toHaveLength(0);

    // Second interval: buildSnapshot succeeds, onTick fires
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    expect(ticks).toHaveLength(1);

    scheduler.stop();
  });

  it("dispatch error does not stop the loop", async () => {
    const buildSnapshot = vi.fn().mockResolvedValue(
      makeSnap({ firedTriggerIds: ["t1"] }), // wake:true → LLM called → decision dispatched
    );

    // Mock fetch so LLM returns SEND_MESSAGE
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"SEND_MESSAGE","messageContent":"Hi"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    process.env.LITELLM_PROXY_URL = "http://litellm-test:4000";
    process.env.LITELLM_MASTER_KEY = "sk-test-master";

    const dispatch = makeDispatch({
      sendToChannel: vi.fn().mockRejectedValue(new Error("channel down")),
    });

    const ticks: number[] = [];
    const scheduler = new ConsciousnessScheduler({
      buildSnapshot,
      dispatch,
      onTick: () => ticks.push(1),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);

    // Tick completed (despite dispatch error) and rescheduled
    expect(ticks).toHaveLength(1);

    scheduler.stop();
    delete process.env.LITELLM_PROXY_URL;
    delete process.env.LITELLM_MASTER_KEY;
  });
});

// ── dispatch gate ─────────────────────────────────────────────────────────────

describe("ConsciousnessScheduler — dispatch gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does NOT call dispatch when Watchdog returns wake:false (decision is undefined)", async () => {
    const dispatch = makeDispatch();
    const buildSnapshot = vi.fn().mockResolvedValue(makeSnap()); // no delta → wake:false

    const scheduler = new ConsciousnessScheduler({ buildSnapshot, dispatch });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);

    expect(dispatch.sendToChannel).not.toHaveBeenCalled();
    expect(dispatch.appendNote).not.toHaveBeenCalled();

    scheduler.stop();
  });
});
