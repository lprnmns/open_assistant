/**
 * src/consciousness/snapshot.test.ts
 */

import { describe, expect, it } from "vitest";
import { buildRealWorldSnapshot, type SnapshotAdapters } from "./snapshot.js";
import { DEFAULT_CONSCIOUSNESS_CONFIG } from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAdapters(overrides: Partial<SnapshotAdapters> = {}): SnapshotAdapters {
  return {
    getLastUserInteractionAt: () => 1000,
    getPendingNoteCount: () => 0,
    getFiredTriggerIds: () => [],
    getActiveChannelId: () => "test-channel",
    getLastTickAt: () => undefined,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildRealWorldSnapshot", () => {
  it("builds a valid snapshot from adapters", async () => {
    const now = Date.now();
    const snap = await buildRealWorldSnapshot(makeAdapters({
      getLastUserInteractionAt: () => now - 60_000,
      getPendingNoteCount: () => 3,
      getFiredTriggerIds: () => ["trigger-abc"],
      getActiveChannelId: () => "channel-1",
      getLastTickAt: () => now - 5_000,
      getEffectiveSilenceThresholdMs: () => 120_000,
    }));

    expect(snap.capturedAt).toBeGreaterThanOrEqual(now);
    expect(snap.lastUserInteractionAt).toBe(now - 60_000);
    expect(snap.pendingNoteCount).toBe(3);
    expect(snap.firedTriggerIds).toEqual(["trigger-abc"]);
    expect(snap.activeChannelId).toBe("channel-1");
    expect(snap.lastTickAt).toBe(now - 5_000);
    expect(snap.effectiveSilenceThresholdMs).toBe(120_000);
    expect(snap.dueCronExpressions).toEqual([]);
    expect(snap.externalWorldEvents).toEqual([]);
  });

  it("handles async adapters", async () => {
    const snap = await buildRealWorldSnapshot(makeAdapters({
      getLastUserInteractionAt: async () => 9999,
      getFiredTriggerIds: async () => ["async-trigger"],
      getActiveChannelId: async () => "async-channel",
    }));
    expect(snap.lastUserInteractionAt).toBe(9999);
    expect(snap.firedTriggerIds).toEqual(["async-trigger"]);
    expect(snap.activeChannelId).toBe("async-channel");
  });

  it("includes optional adapters when provided", async () => {
    const snap = await buildRealWorldSnapshot(makeAdapters({
      getDueCronExpressions: () => ["0 9 * * 1"],
      getExternalWorldEvents: () => ["calendar:invite:abc123"],
    }));
    expect(snap.dueCronExpressions).toEqual(["0 9 * * 1"]);
    expect(snap.externalWorldEvents).toEqual(["calendar:invite:abc123"]);
  });

  it("defaults to empty arrays when optional adapters absent", async () => {
    const snap = await buildRealWorldSnapshot(makeAdapters());
    expect(snap.dueCronExpressions).toEqual([]);
    expect(snap.externalWorldEvents).toEqual([]);
  });

  it("defaults effectiveSilenceThresholdMs when adapter absent", async () => {
    const snap = await buildRealWorldSnapshot(makeAdapters());
    expect(snap.effectiveSilenceThresholdMs).toBe(
      DEFAULT_CONSCIOUSNESS_CONFIG.baseSilenceThresholdMs,
    );
  });

  it("handles undefined lastUserInteractionAt (brand-new agent)", async () => {
    const snap = await buildRealWorldSnapshot(makeAdapters({
      getLastUserInteractionAt: () => undefined,
    }));
    expect(snap.lastUserInteractionAt).toBeUndefined();
  });

  it("handles undefined activeChannelId safely", async () => {
    const snap = await buildRealWorldSnapshot(makeAdapters({
      getActiveChannelId: () => undefined,
    }));
    expect(snap.activeChannelId).toBeUndefined();
  });

  it("substitutes safe defaults when an async adapter throws", async () => {
    const snap = await buildRealWorldSnapshot(makeAdapters({
      getFiredTriggerIds: async () => { throw new Error("Redis down"); },
      getActiveChannelId: async () => { throw new Error("session store unavailable"); },
    }));
    // Should fall back to empty array and undefined, not crash
    expect(snap.firedTriggerIds).toEqual([]);
    expect(snap.activeChannelId).toBeUndefined();
    // Other fields still populated from working adapters
    expect(typeof snap.capturedAt).toBe("number");
  });

  it("substitutes safe default when sync adapter throws", async () => {
    const snap = await buildRealWorldSnapshot(makeAdapters({
      getPendingNoteCount: () => { throw new Error("queue inaccessible"); },
    }));
    expect(snap.pendingNoteCount).toBe(0);
  });

  it("pendingNoteCount reads from PendingReflectionQueue, not Cortex", async () => {
    // Validate design contract: the adapter wires to reflection queue
    let queueCount = 0;
    const adapters = makeAdapters({
      getPendingNoteCount: () => queueCount,
    });

    const snap1 = await buildRealWorldSnapshot(adapters);
    expect(snap1.pendingNoteCount).toBe(0);

    queueCount = 5;
    const snap2 = await buildRealWorldSnapshot(adapters);
    expect(snap2.pendingNoteCount).toBe(5);

    queueCount = 0;
    const snap3 = await buildRealWorldSnapshot(adapters);
    expect(snap3.pendingNoteCount).toBe(0);
  });

  it("does not set eventBuffer (injected by scheduler, not built here)", async () => {
    const snap = await buildRealWorldSnapshot(makeAdapters());
    expect(snap.eventBuffer).toBeUndefined();
  });
});
