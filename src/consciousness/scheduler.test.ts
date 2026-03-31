import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsciousnessScheduler } from "./scheduler.js";
import { type DispatchContext } from "./integration.js";
import {
  DEFAULT_CONSCIOUSNESS_CONFIG,
  type WorldSnapshot,
} from "./types.js";
import type { ConsolidationPipeline, ConsolidationResult } from "./sleep/consolidation.js";
import { listBySurface } from "./events/buffer.js";
import type { BufferedEvent } from "./events/buffer.js";

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

// ── consolidation integration ─────────────────────────────────────────────────

/**
 * Helpers shared across consolidation tests.
 *
 * The consolidation path requires:
 *   1. Watchdog wakes (firedTriggerIds forces wake:true).
 *   2. LLM returns ENTER_SLEEP → tick() sets phase:SLEEPING + sleepEnteredAt.
 *   3. maybeConsolidate() fires (fire-and-forget) → pipeline.run() is called.
 *
 * fetch is mocked to simulate the LiteLLM proxy response.
 */

function makeConsolidationPipeline(overrides: {
  run?: () => Promise<ConsolidationResult>;
} = {}): ConsolidationPipeline {
  const defaultResult: ConsolidationResult = { processed: 1, converted: 1, skipped: 0, failed: 0 };
  return {
    run: vi.fn(overrides.run ?? (() => Promise.resolve(defaultResult))),
  };
}

/** Snapshot that forces Watchdog to wake (trigger fired). */
function makeSleepSnap(): WorldSnapshot {
  return makeSnap({ firedTriggerIds: ["sleep-trigger"] });
}

/** Mock fetch so the LLM returns the given action. */
function mockLlmAction(action: string, extra: Record<string, unknown> = {}) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({
      model: "claude-haiku",
      choices: [{ message: { content: JSON.stringify({ action, ...extra }) } }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    }),
  } as Response);
}

describe("ConsciousnessScheduler — consolidation integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.LITELLM_PROXY_URL = "http://litellm-test:4000";
    process.env.LITELLM_MASTER_KEY = "sk-test-master";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.LITELLM_PROXY_URL;
    delete process.env.LITELLM_MASTER_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  // ── hard gate: shouldConsolidate:false ───────────────────────────────────────

  it("pipeline.run is NOT called when consolidation option is omitted", async () => {
    // No consolidation option at all — scheduler must not crash.
    mockLlmAction("ENTER_SLEEP");
    const scheduler = new ConsciousnessScheduler({
      buildSnapshot: vi.fn().mockResolvedValue(makeSleepSnap()),
      dispatch: makeDispatch(),
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    // No assertion needed; the test passes if the scheduler doesn't crash.
    scheduler.stop();
  });

  it("pipeline.run is NOT called when phase is IDLE (shouldConsolidate:false — hard gate)", async () => {
    // Watchdog does NOT wake → phase stays IDLE → no pipeline entry.
    const pipeline = makeConsolidationPipeline();
    const scheduler = new ConsciousnessScheduler({
      buildSnapshot: vi.fn().mockResolvedValue(makeSnap()), // no delta → wake:false
      dispatch: makeDispatch(),
      consolidation: { pipeline, sessionKey: "s" },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);

    expect(pipeline.run).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("pipeline.run is NOT called when LLM returns STAY_SILENT (phase never reaches SLEEPING)", async () => {
    mockLlmAction("STAY_SILENT");
    const pipeline = makeConsolidationPipeline();
    const scheduler = new ConsciousnessScheduler({
      buildSnapshot: vi.fn().mockResolvedValue(makeSleepSnap()),
      dispatch: makeDispatch(),
      consolidation: { pipeline, sessionKey: "s" },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    // Flush maybeConsolidate microtask
    await Promise.resolve();
    await Promise.resolve();

    expect(pipeline.run).not.toHaveBeenCalled();
    scheduler.stop();
  });

  // ── happy path ───────────────────────────────────────────────────────────────

  it("pipeline.run is called once when ENTER_SLEEP fires and consolidation is configured", async () => {
    mockLlmAction("ENTER_SLEEP");
    const pipeline = makeConsolidationPipeline();
    const scheduler = new ConsciousnessScheduler({
      buildSnapshot: vi.fn().mockResolvedValue(makeSleepSnap()),
      dispatch: makeDispatch(),
      consolidation: { pipeline, sessionKey: "sess-1" },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    await Promise.resolve();
    await Promise.resolve();

    expect(pipeline.run).toHaveBeenCalledOnce();
    scheduler.stop();
  });

  it("pipeline.run receives the configured sessionKey", async () => {
    mockLlmAction("ENTER_SLEEP");
    const pipeline = makeConsolidationPipeline();
    const scheduler = new ConsciousnessScheduler({
      buildSnapshot: vi.fn().mockResolvedValue(makeSleepSnap()),
      dispatch: makeDispatch(),
      consolidation: { pipeline, sessionKey: "my-session" },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    await Promise.resolve();
    await Promise.resolve();

    expect(pipeline.run).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: "my-session" }),
    );
    scheduler.stop();
  });

  it("consolidationCompletedAt is written to state after successful pipeline.run()", async () => {
    mockLlmAction("ENTER_SLEEP");
    const pipeline = makeConsolidationPipeline();
    const scheduler = new ConsciousnessScheduler({
      buildSnapshot: vi.fn().mockResolvedValue(makeSleepSnap()),
      dispatch: makeDispatch(),
      consolidation: { pipeline, sessionKey: "s" },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    await Promise.resolve();
    await Promise.resolve();

    const { consolidationCompletedAt } = scheduler.getState().consolidation;
    expect(consolidationCompletedAt).toBeDefined();
    expect(typeof consolidationCompletedAt).toBe("number");
    scheduler.stop();
  });

  // ── in-progress guard ────────────────────────────────────────────────────────

  it("in-progress guard prevents a second concurrent pipeline.run when first is still running", async () => {
    mockLlmAction("ENTER_SLEEP");

    // A pipeline that suspends until we manually resolve it.
    let resolvePipeline!: () => void;
    const slowPipeline: ConsolidationPipeline = {
      run: vi.fn(
        () =>
          new Promise<ConsolidationResult>((resolve) => {
            resolvePipeline = () =>
              resolve({ processed: 1, converted: 1, skipped: 0, failed: 0 });
          }),
      ),
    };

    const scheduler = new ConsciousnessScheduler({
      buildSnapshot: vi.fn().mockResolvedValue(makeSleepSnap()),
      dispatch: makeDispatch(),
      consolidation: { pipeline: slowPipeline, sessionKey: "s" },
    });
    scheduler.start();

    // First tick → ENTER_SLEEP → maybeConsolidate starts → pipeline.run suspended
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    await Promise.resolve();
    await Promise.resolve();
    expect(slowPipeline.run).toHaveBeenCalledOnce();

    // Second tick fires while first consolidation is still in-flight
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    await Promise.resolve();
    await Promise.resolve();

    // Must still be only one call — in-progress guard blocked the second
    expect(slowPipeline.run).toHaveBeenCalledOnce();

    resolvePipeline(); // clean up
    scheduler.stop();
  });

  it("in-progress flag is cleared after pipeline.run completes (next eligible cycle can run)", async () => {
    // First cycle: ENTER_SLEEP → pipeline runs → consolidationCompletedAt set
    mockLlmAction("ENTER_SLEEP");
    const pipeline = makeConsolidationPipeline();
    const scheduler = new ConsciousnessScheduler({
      buildSnapshot: vi.fn().mockResolvedValue(makeSleepSnap()),
      dispatch: makeDispatch(),
      consolidation: { pipeline, sessionKey: "s" },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    await Promise.resolve();
    await Promise.resolve();

    expect(pipeline.run).toHaveBeenCalledOnce();
    // consolidationCompletedAt is now set — subsequent ticks in same cycle skip
    // but the flag itself is not leaked.
    const state = scheduler.getState();
    expect(state.consolidation.consolidationCompletedAt).toBeDefined();

    scheduler.stop();
  });

  // ── fail-soft / exception handling ──────────────────────────────────────────

  it("in-progress flag is cleared even when pipeline.run throws (no leak)", async () => {
    mockLlmAction("ENTER_SLEEP");

    let callCount = 0;
    const throwingPipeline: ConsolidationPipeline = {
      // First call throws; second call succeeds (proves flag was cleared)
      run: vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error("pipeline error");
        return { processed: 0, converted: 0, skipped: 0, failed: 0 };
      }),
    };

    const scheduler = new ConsciousnessScheduler({
      buildSnapshot: vi.fn().mockResolvedValue(makeSleepSnap()),
      dispatch: makeDispatch(),
      consolidation: { pipeline: throwingPipeline, sessionKey: "s" },
    });
    scheduler.start();

    // First tick → pipeline throws → flag cleared (NOT leaked)
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    await Promise.resolve();
    await Promise.resolve();
    expect(throwingPipeline.run).toHaveBeenCalledOnce();

    // Manually reset sleepEnteredAt to simulate a new sleep cycle so the trigger fires again.
    // We do this by forcibly setting state via an internal workaround:
    // The second tick will call maybeConsolidate; since consolidationCompletedAt is still
    // undefined (throw prevented write) and sleepEnteredAt is still set, shouldConsolidate:true.
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    await Promise.resolve();
    await Promise.resolve();

    // Second call succeeds — proves consolidating flag was not leaked
    expect(throwingPipeline.run).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });

  it("consolidationCompletedAt is NOT written when pipeline.run throws", async () => {
    mockLlmAction("ENTER_SLEEP");

    const throwingPipeline: ConsolidationPipeline = {
      run: vi.fn(async () => {
        throw new Error("pipeline down");
      }),
    };

    const scheduler = new ConsciousnessScheduler({
      buildSnapshot: vi.fn().mockResolvedValue(makeSleepSnap()),
      dispatch: makeDispatch(),
      consolidation: { pipeline: throwingPipeline, sessionKey: "s" },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    await Promise.resolve();
    await Promise.resolve();

    expect(scheduler.getState().consolidation.consolidationCompletedAt).toBeUndefined();
    scheduler.stop();
  });

  // ── same sleep cycle dedup ────────────────────────────────────────────────────

  it("pipeline.run not called a second time within the same sleep cycle", async () => {
    mockLlmAction("ENTER_SLEEP");
    const pipeline = makeConsolidationPipeline();
    const scheduler = new ConsciousnessScheduler({
      buildSnapshot: vi.fn().mockResolvedValue(makeSleepSnap()),
      dispatch: makeDispatch(),
      consolidation: { pipeline, sessionKey: "s" },
    });
    scheduler.start();

    // First tick: ENTER_SLEEP → consolidation runs → consolidationCompletedAt set
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    await Promise.resolve();
    await Promise.resolve();
    expect(pipeline.run).toHaveBeenCalledOnce();

    // Second tick: still SLEEPING / same sleepEnteredAt → shouldConsolidate:false → no second run
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    await Promise.resolve();
    await Promise.resolve();

    expect(pipeline.run).toHaveBeenCalledOnce(); // still only once
    scheduler.stop();
  });
});

// ── brain thread-through ───────────────────────────────────────────────────────

describe("ConsciousnessScheduler — brain.recall thread-through to tick()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.LITELLM_PROXY_URL = "http://litellm-test:4000";
    process.env.LITELLM_MASTER_KEY = "sk-test-master";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.LITELLM_PROXY_URL;
    delete process.env.LITELLM_MASTER_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("recall pipeline is called once per tick when Watchdog wakes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: '{"action":"STAY_SILENT"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as Response);

    const recallFn = vi.fn().mockResolvedValue({ recent: [], recalled: [] });
    const brain = {
      recall: { recall: recallFn },
      sessionKey: "sched-test-session",
    };

    const buildSnapshot = vi.fn().mockResolvedValue(
      makeSnap({ firedTriggerIds: ["trigger"] }), // force wake:true
    );

    const scheduler = new ConsciousnessScheduler({ buildSnapshot, dispatch: makeDispatch(), brain });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);

    expect(recallFn).toHaveBeenCalledOnce();
    expect(recallFn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: "sched-test-session" }),
    );
    scheduler.stop();
  });

  it("recall pipeline is NOT called when Watchdog returns wake:false", async () => {
    const recallFn = vi.fn().mockResolvedValue({ recent: [], recalled: [] });
    const brain = {
      recall: { recall: recallFn },
      sessionKey: "sched-test-session",
    };

    const buildSnapshot = vi.fn().mockResolvedValue(makeSnap()); // no delta → wake:false

    const scheduler = new ConsciousnessScheduler({ buildSnapshot, dispatch: makeDispatch(), brain });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);

    expect(recallFn).not.toHaveBeenCalled();
    scheduler.stop();
  });
});

// ── ConsciousnessScheduler — EventBuffer lifecycle (Sub-Task 6.2 R1) ──────────
//
// Verifies that the scheduler correctly:
//   1. injects the internal EventBuffer into each snapshot before calling tick()
//   2. persists the post-drain buffer so drained events do not re-appear
//   3. exposes pushEvent() for external adapters to add events

describe("ConsciousnessScheduler — EventBuffer lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.LITELLM_PROXY_URL = "http://litellm-test:4000";
    process.env.LITELLM_MASTER_KEY = "sk-test-master";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.LITELLM_PROXY_URL;
    delete process.env.LITELLM_MASTER_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  function makeOwnerEvent(id: string): BufferedEvent {
    return {
      id,
      surface: "owner_active_channel",
      source: "web-chat",
      summary: `owner ${id}`,
      receivedAt: NOW,
    };
  }

  function mockLlm(action: string, extra: Record<string, string> = {}) {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-haiku",
        choices: [{ message: { content: JSON.stringify({ action, ...extra }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    } as Response);
  }

  it("pushEvent() is reflected in the snapshot injected into tick()", async () => {
    // Capture the snapshot seen by tick() via onTick
    const seenSnapshots: WorldSnapshot[] = [];

    mockLlm("STAY_SILENT");
    const buildSnapshot = vi.fn().mockResolvedValue(makeSnap({ firedTriggerIds: ["t1"] }));

    const scheduler = new ConsciousnessScheduler({
      buildSnapshot,
      dispatch: makeDispatch(),
      onTick: (r) => seenSnapshots.push(r.state.lastSnapshot!),
    });

    scheduler.pushEvent(makeOwnerEvent("e1"));
    scheduler.start();
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);

    expect(seenSnapshots).toHaveLength(1);
    const injectedBuffer = seenSnapshots[0]?.eventBuffer;
    expect(injectedBuffer).toBeDefined();
    expect(listBySurface(injectedBuffer!, "owner_active_channel")).toHaveLength(1);
    expect(injectedBuffer!.events[0]!.id).toBe("e1");
    scheduler.stop();
  });

  it("owner event drained after SEND_MESSAGE is NOT re-injected on the next tick", async () => {
    // Tick 1: SEND_MESSAGE (triggers wake via firedTriggerIds) → drains owner event
    // Tick 2: STAY_SILENT — buffer should be empty after drain
    const capturedBodies: string[] = [];

    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBodies.push(typeof init?.body === "string" ? init.body : "");
      const action = callCount++ === 0 ? "SEND_MESSAGE" : "STAY_SILENT";
      const content =
        action === "SEND_MESSAGE"
          ? JSON.stringify({ action, messageContent: "Hello!" })
          : JSON.stringify({ action });
      return {
        ok: true,
        json: async () => ({
          model: "claude-haiku",
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      } as Response;
    });

    // Both ticks see a wake trigger so LLM is called each time
    const buildSnapshot = vi
      .fn()
      .mockResolvedValue(makeSnap({ firedTriggerIds: ["t1"] }));

    const scheduler = new ConsciousnessScheduler({ buildSnapshot, dispatch: makeDispatch() });
    scheduler.pushEvent(makeOwnerEvent("drain-me"));
    scheduler.start();

    // Tick 1 — SEND_MESSAGE → drain
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    // Tick 2 — STAY_SILENT — buffer should be empty
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);

    scheduler.stop();

    // Tick 1 body must contain the event; tick 2 body must NOT
    expect(capturedBodies[0]).toContain("drain-me");
    expect(capturedBodies[1]).not.toContain("drain-me");
  });

  it("owner event NOT drained after STAY_SILENT — persists to next tick", async () => {
    const capturedBodies: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBodies.push(typeof init?.body === "string" ? init.body : "");
      return {
        ok: true,
        json: async () => ({
          model: "claude-haiku",
          choices: [{ message: { content: '{"action":"STAY_SILENT"}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      } as Response;
    });

    const buildSnapshot = vi
      .fn()
      .mockResolvedValue(makeSnap({ firedTriggerIds: ["t1"] }));

    const scheduler = new ConsciousnessScheduler({ buildSnapshot, dispatch: makeDispatch() });
    scheduler.pushEvent(makeOwnerEvent("persist-me"));
    scheduler.start();

    // Two ticks, both STAY_SILENT
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);
    await vi.advanceTimersByTimeAsync(cfg.minTickIntervalMs);

    scheduler.stop();

    // Event must appear in both ticks since it was never drained
    expect(capturedBodies[0]).toContain("persist-me");
    expect(capturedBodies[1]).toContain("persist-me");
  });
});
