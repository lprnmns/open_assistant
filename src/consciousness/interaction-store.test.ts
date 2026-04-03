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
    const state: PersistedInteractionState = {
      lastUserInteractionAt: 1_700_000_000_000,
      activeChannelId: "telegram:123",
      activeChannelType: "telegram",
    };
    const store = makeStore({ readReturn: JSON.stringify(state) });
    expect(store.loadSync()).toEqual(state);
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
    expect(reader.loadSync()).toEqual(state);
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
    expect(getActiveChannelId()).toBe("telegram:99");
    expect(getActiveChannelType()).toBe("telegram");
  });

  it("seedInteractionTracker ignores undefined fields (does not overwrite existing state)", () => {
    // Pre-populate
    seedInteractionTracker({ lastUserInteractionAt: 1_000 });
    // Partial seed — only activeChannelId present
    seedInteractionTracker({ activeChannelId: "slack:C2" });
    expect(getLastUserInteractionAt()).toBe(1_000);
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
    expect(parsed.activeChannelId).toBe("telegram:77");
    expect(parsed.activeChannelType).toBe("telegram");
    expect(typeof parsed.lastUserInteractionAt).toBe("number");
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
