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
    getActiveChannelType: () => "telegram",
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
      getActiveChannelType: () => "slack",
      getLastTickAt: () => now - 5_000,
      getEffectiveSilenceThresholdMs: () => 120_000,
    }));

    expect(snap.capturedAt).toBeGreaterThanOrEqual(now);
    expect(snap.lastUserInteractionAt).toBe(now - 60_000);
    expect(snap.pendingNoteCount).toBe(3);
    expect(snap.firedTriggerIds).toEqual(["trigger-abc"]);
    expect(snap.activeChannelId).toBe("channel-1");
    expect(snap.activeChannelType).toBe("slack");
    expect(snap.activeDeliveryTarget).toEqual({
      kind: "channel",
      id: "channel-1",
      channelType: "slack",
    });
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
      getActiveChannelType: async () => "telegram",
    }));
    expect(snap.lastUserInteractionAt).toBe(9999);
    expect(snap.firedTriggerIds).toEqual(["async-trigger"]);
    expect(snap.activeChannelId).toBe("async-channel");
    expect(snap.activeChannelType).toBe("telegram");
    expect(snap.activeDeliveryTarget).toEqual({
      kind: "channel",
      id: "async-channel",
      channelType: "telegram",
    });
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
      getActiveChannelType: () => undefined,
    }));
    expect(snap.activeChannelId).toBeUndefined();
    expect(snap.activeChannelType).toBeUndefined();
    expect(snap.activeDeliveryTarget).toBeUndefined();
  });

  it("substitutes safe defaults when an async adapter throws", async () => {
    const snap = await buildRealWorldSnapshot(makeAdapters({
      getFiredTriggerIds: async () => { throw new Error("Redis down"); },
      getActiveChannelId: async () => { throw new Error("session store unavailable"); },
      getActiveChannelType: async () => {
        throw new Error("channel type unavailable");
      },
    }));
    // Should fall back to empty array and undefined, not crash
    expect(snap.firedTriggerIds).toEqual([]);
    expect(snap.activeChannelId).toBeUndefined();
    expect(snap.activeChannelType).toBeUndefined();
    expect(snap.activeDeliveryTarget).toBeUndefined();
    // Other fields still populated from working adapters
    expect(typeof snap.capturedAt).toBe("number");
  });

  it("prefers an explicit delivery target adapter when provided", async () => {
    const snap = await buildRealWorldSnapshot(makeAdapters({
      getActiveDeliveryTarget: () => ({
        kind: "node",
        id: "android-node-1",
        nodeId: "android-node-1",
      }),
      getActiveChannelId: () => "legacy-channel",
      getActiveChannelType: () => "telegram",
    }));

    expect(snap.activeDeliveryTarget).toEqual({
      kind: "node",
      id: "android-node-1",
      nodeId: "android-node-1",
    });
    expect(snap.activeChannelId).toBe("android-node-1");
    expect(snap.activeChannelType).toBeUndefined();
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
