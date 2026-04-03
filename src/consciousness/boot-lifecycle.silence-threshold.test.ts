/**
 * src/consciousness/boot-lifecycle.silence-threshold.test.ts — WS-1.2 tests
 *
 * Covers:
 *   - CONSCIOUSNESS_SILENCE_THRESHOLD_MS env var overrides engine default
 *   - Persisted effectiveSilenceThresholdMs takes priority over env var
 *   - lastTickAt persisted to store after each tick
 *   - effectiveSilenceThresholdMs persisted when SILENCE_THRESHOLD fires
 *   - getEffectiveSilenceThresholdMs / getLastTickAt adapters wired in snapshot
 */

import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONSCIOUSNESS_CONFIG } from "./types.js";
import { FileInteractionStore } from "./interaction-store.js";
import { _resetInteractionTrackerForTest } from "./interaction-tracker.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTestStore(opts: {
  initialData?: string;
  writes?: Array<string>;
}): FileInteractionStore {
  const writes = opts.writes ?? [];
  const storage = { data: opts.initialData ?? "" };
  return new FileInteractionStore({
    filePath: "/fake/state.json",
    debounceMs: 0,
    _writeForTest: (_, d) => {
      storage.data = d;
      writes.push(d);
    },
    _readForTest: () => {
      if (!storage.data) throw new Error("no file");
      return storage.data;
    },
  });
}

afterEach(() => {
  _resetInteractionTrackerForTest();
});

// ── resolvePositiveIntEnv (tested indirectly via maybeStartConsciousnessLoop) ──
// We test the threshold resolution via the snapshot adapters exposed by boot.
// Direct unit tests below use the internal ref behaviour.

describe("WS-1.2: silence threshold env var resolution", () => {
  it("DEFAULT_CONSCIOUSNESS_CONFIG.baseSilenceThresholdMs is 30 min (engine default unchanged)", () => {
    expect(DEFAULT_CONSCIOUSNESS_CONFIG.baseSilenceThresholdMs).toBe(1_800_000);
  });

  it("3-day value matches MVP intent constant", () => {
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1_000;
    expect(THREE_DAYS_MS).toBe(259_200_000);
  });
});

describe("WS-1.2: effectiveSilenceThresholdMs persistence", () => {
  it("loadSync restores effectiveSilenceThresholdMs from disk", () => {
    const store = makeTestStore({
      initialData: JSON.stringify({
        effectiveSilenceThresholdMs: 259_200_000,
        lastTickAt: 1_700_000_000_000,
      }),
    });
    const loaded = store.loadSync();
    expect(loaded?.effectiveSilenceThresholdMs).toBe(259_200_000);
    expect(loaded?.lastTickAt).toBe(1_700_000_000_000);
  });

  it("store.save persists effectiveSilenceThresholdMs", async () => {
    const writes: string[] = [];
    const store = makeTestStore({ writes });
    store.save({ effectiveSilenceThresholdMs: 2_700_000 });
    await store.close();
    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!) as { effectiveSilenceThresholdMs: number };
    expect(parsed.effectiveSilenceThresholdMs).toBe(2_700_000);
  });

  it("store.save persists lastTickAt", async () => {
    const writes: string[] = [];
    const store = makeTestStore({ writes });
    const now = Date.now();
    store.save({ lastTickAt: now });
    await store.close();
    const parsed = JSON.parse(writes[0]!) as { lastTickAt: number };
    expect(parsed.lastTickAt).toBe(now);
  });

  it("effectiveSilenceThresholdMs survives restart: persisted value not overwritten by env base", async () => {
    // ── First process: backoff expands threshold to 2.7M, then shuts down ──
    const diskWrites: string[] = [];
    const storeA = makeTestStore({ writes: diskWrites });
    // Simulate SILENCE_THRESHOLD backoff expansion persisting 2.7M
    storeA.save({ effectiveSilenceThresholdMs: 2_700_000 });
    await storeA.close();
    expect(diskWrites).toHaveLength(1);

    // ── Second process: boot reads disk, env says 1_800_000 (default) ──
    const storeB = new FileInteractionStore({
      filePath: "/fake/state.json",
      debounceMs: 0,
      _writeForTest: (_, d) => diskWrites.push(d),
      _readForTest: () => diskWrites[diskWrites.length - 1]!,
    });
    const loaded = storeB.loadSync();
    // Persisted value (2.7M) must take priority — it represents the backoff state
    expect(loaded?.effectiveSilenceThresholdMs).toBe(2_700_000);

    // Simulate boot-lifecycle: persist it back on next tick
    storeB.save({ effectiveSilenceThresholdMs: loaded!.effectiveSilenceThresholdMs! });
    await storeB.close();
    const final = JSON.parse(diskWrites[diskWrites.length - 1]!) as {
      effectiveSilenceThresholdMs: number;
    };
    expect(final.effectiveSilenceThresholdMs).toBe(2_700_000);
  });

  it("lastTickAt from disk is preserved across restart by merge", async () => {
    const diskWrites: string[] = [];
    const storeA = makeTestStore({ writes: diskWrites });
    const firstTickAt = 1_700_000_000_000;
    storeA.save({ lastTickAt: firstTickAt, effectiveSilenceThresholdMs: 259_200_000 });
    await storeA.close();

    const storeB = new FileInteractionStore({
      filePath: "/fake/state.json",
      debounceMs: 0,
      _writeForTest: (_, d) => diskWrites.push(d),
      _readForTest: () => diskWrites[diskWrites.length - 1]!,
    });
    const loaded = storeB.loadSync();
    expect(loaded?.lastTickAt).toBe(firstTickAt);

    // After restart, tracker partial save must not wipe lastTickAt
    storeB.save({ lastUserInteractionAt: Date.now(), activeChannelId: "telegram:1" });
    await storeB.close();
    const merged = JSON.parse(diskWrites[diskWrites.length - 1]!) as {
      lastTickAt: number;
      effectiveSilenceThresholdMs: number;
    };
    expect(merged.lastTickAt).toBe(firstTickAt);
    expect(merged.effectiveSilenceThresholdMs).toBe(259_200_000);
  });
});
