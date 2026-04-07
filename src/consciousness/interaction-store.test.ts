/**
 * src/consciousness/interaction-store.test.ts
 *
 * Tests for FileInteractionStore:
 *   - loadSync returns null on missing/corrupt file
 *   - save + close flushes state to the injected writer
 *   - debounce collapses rapid saves into one write
 *   - close flushes pending state synchronously
 *   - closed store ignores further save() calls
 *   - atomic write path via real fs (tempdir)
 *   - seedInteractionTracker + setInteractionStore integration
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileInteractionStore, type PersistedInteractionState } from "./interaction-store.js";
import {
  _resetInteractionTrackerForTest,
  getActiveDeliveryTarget,
  getActiveChannelId,
  getActiveChannelType,
  getLastUserInteractionAt,
  recordUserInteraction,
  seedInteractionTracker,
  setInteractionStore,
} from "./interaction-tracker.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeStore(
  opts: {
    writes?: Array<{ path: string; data: string }>;
    readReturn?: string | null;
    debounceMs?: number;
  } = {},
): FileInteractionStore {
  const writes = opts.writes ?? [];
  return new FileInteractionStore({
    filePath: "/fake/state.json",
    debounceMs: opts.debounceMs ?? 0, // instant flush in tests
    _writeForTest: (p, d) => writes.push({ path: p, data: d }),
    _readForTest:
      opts.readReturn !== undefined
        ? () => {
            if (opts.readReturn === null) throw new Error("file not found");
            return opts.readReturn!;
          }
        : undefined,
  });
}

// ── FileInteractionStore unit tests ───────────────────────────────────────────

describe("FileInteractionStore", () => {
  it("loadSync returns null when file does not exist", () => {
    const store = makeStore({ readReturn: null });
    expect(store.loadSync()).toBeNull();
  });

  it("loadSync returns null for invalid JSON", () => {
    const store = makeStore({ readReturn: "not json {{" });
    expect(store.loadSync()).toBeNull();
  });

  it("loadSync returns null for non-object JSON", () => {
    const store = makeStore({ readReturn: '"a string"' });
    expect(store.loadSync()).toBeNull();
  });

  it("loadSync returns null for JSON array", () => {
    const store = makeStore({ readReturn: "[]" });
    expect(store.loadSync()).toBeNull();
  });

  it("loadSync parses valid state", () => {
    const queuedAt = Date.now() - 1_000;
    const state: PersistedInteractionState = {
      lastUserInteractionAt: 1_700_000_000_000,
      activeChannelId: "telegram:123",
      activeChannelType: "telegram",
      pendingProactiveDeliveries: [
        {
          id: "queued-1",
          target: { kind: "node", id: "android-node-1" },
          content: "Ping me later",
          queuedAt,
        },
      ],
    };
    const store = makeStore({ readReturn: JSON.stringify(state) });
    expect(store.loadSync()).toEqual({
      ...state,
      activeDeliveryTarget: {
        kind: "channel",
        id: "telegram:123",
        channelType: "telegram",
      },
      pendingProactiveDeliveries: [
        {
          id: "queued-1",
          target: {
            kind: "node",
            id: "android-node-1",
            nodeId: undefined,
            label: undefined,
          },
          content: "Ping me later",
          queuedAt,
        },
      ],
    });
  });

  it("save + close flushes state via writer", async () => {
    const writes: Array<{ path: string; data: string }> = [];
    const store = makeStore({ writes });
    store.save({ lastUserInteractionAt: 42, activeChannelId: "slack:C1" });
    await store.close();
    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!.data) as PersistedInteractionState;
    expect(parsed.lastUserInteractionAt).toBe(42);
    expect(parsed.activeChannelId).toBe("slack:C1");
    expect(parsed.activeDeliveryTarget).toEqual({
      kind: "channel",
      id: "slack:C1",
    });
  });

  it("partial saves shallow-merge: earlier fields not in a later partial are preserved", async () => {
    const queuedAt = Date.now() - 1_000;
    const writes: Array<{ path: string; data: string }> = [];
    const store = makeStore({ writes });
    // First save: WS-1.2/1.3 fields
    store.save({
      effectiveSilenceThresholdMs: 259_200_000,
      lastProactiveSentAt: 1_700_000_000_000,
      pendingProactiveDeliveries: [
        {
          id: "queued-1",
          target: { kind: "node", id: "android-node-1" },
          content: "Queued proactive",
          queuedAt,
        },
      ],
    });
    // Second save: WS-1.1 tracker fields (only 3 fields — must not wipe the first two)
    store.save({
      lastUserInteractionAt: 1_700_001_000_000,
      activeChannelId: "telegram:42",
      activeChannelType: "telegram",
    });
    await store.close();
    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!.data) as PersistedInteractionState;
    // All five fields must survive
    expect(parsed.effectiveSilenceThresholdMs).toBe(259_200_000);
    expect(parsed.lastProactiveSentAt).toBe(1_700_000_000_000);
    expect(parsed.pendingProactiveDeliveries).toEqual([
      {
        id: "queued-1",
        target: {
          kind: "node",
          id: "android-node-1",
          nodeId: undefined,
          label: undefined,
        },
        content: "Queued proactive",
        queuedAt,
      },
    ]);
    expect(parsed.lastUserInteractionAt).toBe(1_700_001_000_000);
    expect(parsed.activeChannelId).toBe("telegram:42");
    expect(parsed.activeChannelType).toBe("telegram");
    expect(parsed.activeDeliveryTarget).toEqual({
      kind: "channel",
      id: "telegram:42",
      channelType: "telegram",
    });
  });

  it("later partial overwrites only the fields it supplies", async () => {
    const writes: Array<{ path: string; data: string }> = [];
    const store = makeStore({ writes });
    store.save({ activeChannelId: "slack:C1", effectiveSilenceThresholdMs: 1_000 });
    store.save({ activeChannelId: "telegram:99" }); // update only channelId
    await store.close();
    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!.data) as PersistedInteractionState;
    expect(parsed.activeChannelId).toBe("telegram:99");
    // effectiveSilenceThresholdMs must still be present
    expect(parsed.effectiveSilenceThresholdMs).toBe(1_000);
    expect(parsed.activeDeliveryTarget).toEqual({
      kind: "channel",
      id: "telegram:99",
    });
  });

  it("debounce collapses rapid saves: only last state is written", async () => {
    const writes: Array<{ path: string; data: string }> = [];
    // debounceMs=0 means the timer fires on next tick — multiple saves before
    // that point should still collapse.
    const store = new FileInteractionStore({
      filePath: "/fake/state.json",
      debounceMs: 50,
      _writeForTest: (p, d) => writes.push({ path: p, data: d }),
    });
    store.save({ activeChannelId: "first" });
    store.save({ activeChannelId: "second" });
    store.save({ activeChannelId: "third" });
    await store.close(); // close flushes immediately
    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!.data) as PersistedInteractionState;
    expect(parsed.activeChannelId).toBe("third");
    expect(parsed.activeDeliveryTarget).toEqual({
      kind: "channel",
      id: "third",
    });
  });

  it("close is idempotent — second call does nothing", async () => {
    const writes: Array<{ path: string; data: string }> = [];
    const store = makeStore({ writes });
    store.save({ activeChannelId: "x" });
    await store.close();
    await store.close(); // second close should not write again
    expect(writes).toHaveLength(1);
  });

  it("save after close is ignored", async () => {
    const writes: Array<{ path: string; data: string }> = [];
    const store = makeStore({ writes });
    await store.close();
    store.save({ activeChannelId: "after-close" });
    // Flush any microtask queue
    await Promise.resolve();
    expect(writes).toHaveLength(0);
  });

  it("close with no pending state does not write", async () => {
    const writes: Array<{ path: string; data: string }> = [];
    const store = makeStore({ writes });
    await store.close();
    expect(writes).toHaveLength(0);
  });
});

// ── Atomic write with real fs ─────────────────────────────────────────────────

describe("FileInteractionStore real fs (atomic write)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-store-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes file atomically and can be read back via loadSync", async () => {
    const filePath = path.join(tmpDir, "sub", "state.json");
    const store = new FileInteractionStore({ filePath, debounceMs: 0 });
    const state: PersistedInteractionState = {
      lastUserInteractionAt: 9_999,
      activeChannelId: "telegram:456",
      activeChannelType: "telegram",
    };
    store.save(state);
    await store.close();

    // File must exist, .tmp must not
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(filePath + ".tmp")).toBe(false);

    // A fresh store instance can read it back
    const reader = new FileInteractionStore({ filePath, debounceMs: 0 });
    expect(reader.loadSync()).toEqual({
      ...state,
      activeDeliveryTarget: {
        kind: "channel",
        id: "telegram:456",
        channelType: "telegram",
      },
    });
  });

  it("leaves no .tmp file on disk when write succeeds", async () => {
    const filePath = path.join(tmpDir, "state.json");
    const store = new FileInteractionStore({ filePath, debounceMs: 0 });
    store.save({ lastUserInteractionAt: 1 });
    await store.close();
    expect(fs.existsSync(filePath + ".tmp")).toBe(false);
  });
});

// ── Tracker integration ───────────────────────────────────────────────────────

describe("seedInteractionTracker + setInteractionStore integration", () => {
  afterEach(() => {
    _resetInteractionTrackerForTest();
  });

  it("seedInteractionTracker populates in-memory state", () => {
    seedInteractionTracker({
      lastUserInteractionAt: 1_234_567,
      activeChannelId: "telegram:99",
      activeChannelType: "telegram",
    });
    expect(getLastUserInteractionAt()).toBe(1_234_567);
    expect(getActiveDeliveryTarget()).toEqual({
      kind: "channel",
      id: "telegram:99",
      channelType: "telegram",
    });
    expect(getActiveChannelId()).toBe("telegram:99");
    expect(getActiveChannelType()).toBe("telegram");
  });

  it("seedInteractionTracker ignores undefined fields (does not overwrite existing state)", () => {
    // Pre-populate
    seedInteractionTracker({ lastUserInteractionAt: 1_000 });
    // Partial seed — only activeChannelId present
    seedInteractionTracker({ activeChannelId: "slack:C2" });
    expect(getLastUserInteractionAt()).toBe(1_000);
    expect(getActiveDeliveryTarget()).toEqual({
      kind: "channel",
      id: "slack:C2",
      channelType: undefined,
    });
    expect(getActiveChannelId()).toBe("slack:C2");
  });

  it("recordUserInteraction calls store.save with current state", async () => {
    const writes: Array<{ path: string; data: string }> = [];
    const store = makeStore({ writes });
    setInteractionStore(store);

    recordUserInteraction("telegram:77", "telegram");
    await store.close();

    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!.data) as PersistedInteractionState;
    expect(parsed.activeDeliveryTarget).toEqual({
      kind: "channel",
      id: "telegram:77",
      channelType: "telegram",
    });
    expect(parsed.activeChannelId).toBe("telegram:77");
    expect(parsed.activeChannelType).toBe("telegram");
    expect(typeof parsed.lastUserInteractionAt).toBe("number");
  });

  it("recordUserInteraction preserves WS-1.2/1.3 fields already in the store", async () => {
    // Simulate WS-1.2/WS-1.3 writing their fields first
    const writes: Array<{ path: string; data: string }> = [];
    const store = makeStore({ writes });
    setInteractionStore(store);

    // WS-1.2 writes silence threshold; WS-1.3 writes last proactive send time
    store.save({ effectiveSilenceThresholdMs: 259_200_000 });
    store.save({ lastProactiveSentAt: 1_700_000_000_000 });

    // WS-1.1 tracker then updates interaction fields on inbound message
    recordUserInteraction("telegram:77", "telegram");

    await store.close();

    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!.data) as PersistedInteractionState;

    // Tracker fields written by recordUserInteraction
    expect(parsed.activeChannelId).toBe("telegram:77");
    expect(parsed.activeChannelType).toBe("telegram");
    expect(parsed.activeDeliveryTarget).toEqual({
      kind: "channel",
      id: "telegram:77",
      channelType: "telegram",
    });
    expect(typeof parsed.lastUserInteractionAt).toBe("number");

    // WS-1.2/1.3 fields must NOT have been wiped
    expect(parsed.effectiveSilenceThresholdMs).toBe(259_200_000);
    expect(parsed.lastProactiveSentAt).toBe(1_700_000_000_000);
  });

  it("restart boundary: loadSync() hydrates mergedState so WS-1.2/1.3 fields survive first partial save", async () => {
    // ── Simulate first process: WS-1.2/1.3 write their fields, then shutdown ──
    const diskStorage: { data: string } = { data: "" };
    const storeA = new FileInteractionStore({
      filePath: "/fake/state.json",
      debounceMs: 0,
      _writeForTest: (_, d) => { diskStorage.data = d; },
    });
    storeA.save({ effectiveSilenceThresholdMs: 259_200_000 });
    storeA.save({ lastProactiveSentAt: 1_700_000_000_000 });
    await storeA.close();
    expect(diskStorage.data).not.toBe(""); // something was written

    // ── Simulate second process: boot reads disk, then inbound message arrives ──
    const writes: Array<string> = [];
    const storeB = new FileInteractionStore({
      filePath: "/fake/state.json",
      debounceMs: 0,
      _writeForTest: (_, d) => writes.push(d),
      _readForTest: () => diskStorage.data,
    });

    // Boot-lifecycle: load from disk + seed tracker
    const loaded = storeB.loadSync();
    expect(loaded).not.toBeNull();
    setInteractionStore(storeB);
    if (loaded) seedInteractionTracker(loaded);

    // First inbound message — recordUserInteraction writes only 3 tracker fields
    recordUserInteraction("telegram:77", "telegram");
    await storeB.close();

    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!) as PersistedInteractionState;

    // Tracker fields
    expect(parsed.activeChannelId).toBe("telegram:77");
    expect(parsed.activeChannelType).toBe("telegram");
    expect(parsed.activeDeliveryTarget).toEqual({
      kind: "channel",
      id: "telegram:77",
      channelType: "telegram",
    });
    expect(typeof parsed.lastUserInteractionAt).toBe("number");

    // WS-1.2/1.3 fields from first process must NOT have been wiped
    expect(parsed.effectiveSilenceThresholdMs).toBe(259_200_000);
    expect(parsed.lastProactiveSentAt).toBe(1_700_000_000_000);
  });

  it("after stop (setInteractionStore(null)), recordUserInteraction does not persist", () => {
    const writes: Array<{ path: string; data: string }> = [];
    const store = makeStore({ writes });
    setInteractionStore(store);
    setInteractionStore(null); // simulate stop()
    recordUserInteraction("telegram:77", "telegram");
    expect(writes).toHaveLength(0);
  });
});
