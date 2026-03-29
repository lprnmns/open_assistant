import { describe, expect, it } from "vitest";
import {
  isEpisodic,
  isSemantic,
  makeMemoryNote,
  NOTE_TYPES,
  RECALL_DEFAULTS,
  type MemoryNote,
  type MemoryRecallResult,
  type NoteType,
} from "./types.js";

// ── NOTE_TYPES tuple ──────────────────────────────────────────────────────────

describe("NOTE_TYPES", () => {
  it("contains exactly episodic and semantic", () => {
    expect(NOTE_TYPES).toEqual(["episodic", "semantic"]);
  });

  it("is readonly (frozen array-like — no push method that mutates)", () => {
    // TypeScript enforces readonly; at runtime it's a plain array.
    // We verify the values haven't been modified.
    expect(NOTE_TYPES.length).toBe(2);
  });

  it("covers every NoteType value — exhaustiveness probe", () => {
    // If NoteType gains a new member, this object literal will cause a
    // compile error (missing key) before the test even runs.
    const _: Record<NoteType, true> = {
      episodic: true,
      semantic: true,
    };
    // Runtime: every NOTE_TYPES entry must appear in the record
    for (const t of NOTE_TYPES) {
      expect(_[t]).toBe(true);
    }
  });
});

// ── RECALL_DEFAULTS ───────────────────────────────────────────────────────────

describe("RECALL_DEFAULTS", () => {
  it("k defaults to 5", () => {
    expect(RECALL_DEFAULTS.k).toBe(5);
  });

  it("recentN defaults to 3", () => {
    expect(RECALL_DEFAULTS.recentN).toBe(3);
  });

  it("k > recentN (Hippocampus slice is wider than Cortex slice)", () => {
    // Invariant: the durable store contributes more context than the RAM buffer.
    expect(RECALL_DEFAULTS.k).toBeGreaterThan(RECALL_DEFAULTS.recentN);
  });
});

// ── makeMemoryNote ────────────────────────────────────────────────────────────

describe("makeMemoryNote", () => {
  it("assigns a non-empty id when none is provided", () => {
    const note = makeMemoryNote({ content: "hello", sessionKey: "s1" });
    expect(typeof note.id).toBe("string");
    expect(note.id.length).toBeGreaterThan(0);
  });

  it("uses the provided id override", () => {
    const note = makeMemoryNote({ content: "hello", sessionKey: "s1", id: "fixed-id" });
    expect(note.id).toBe("fixed-id");
  });

  it("defaults type to 'episodic' when type is omitted", () => {
    const note = makeMemoryNote({ content: "event", sessionKey: "s1" });
    expect(note.type).toBe("episodic");
  });

  it("uses the provided type", () => {
    const note = makeMemoryNote({ content: "fact", sessionKey: "s1", type: "semantic" });
    expect(note.type).toBe("semantic");
  });

  it("uses the provided createdAt override", () => {
    const ts = 1_700_000_000_000;
    const note = makeMemoryNote({ content: "x", sessionKey: "s1", createdAt: ts });
    expect(note.createdAt).toBe(ts);
  });

  it("assigns a createdAt close to Date.now() when not provided", () => {
    const before = Date.now();
    const note = makeMemoryNote({ content: "x", sessionKey: "s1" });
    const after = Date.now();
    expect(note.createdAt).toBeGreaterThanOrEqual(before);
    expect(note.createdAt).toBeLessThanOrEqual(after);
  });

  it("stores content and sessionKey verbatim", () => {
    const note = makeMemoryNote({ content: "remember this", sessionKey: "session-abc" });
    expect(note.content).toBe("remember this");
    expect(note.sessionKey).toBe("session-abc");
  });

  it("two calls with no id override produce different ids", () => {
    const a = makeMemoryNote({ content: "a", sessionKey: "s" });
    const b = makeMemoryNote({ content: "b", sessionKey: "s" });
    expect(a.id).not.toBe(b.id);
  });
});

// ── isEpisodic / isSemantic ───────────────────────────────────────────────────

describe("isEpisodic", () => {
  it("returns true for an episodic note", () => {
    const note = makeMemoryNote({ content: "event", sessionKey: "s", type: "episodic" });
    expect(isEpisodic(note)).toBe(true);
  });

  it("returns false for a semantic note", () => {
    const note = makeMemoryNote({ content: "fact", sessionKey: "s", type: "semantic" });
    expect(isEpisodic(note)).toBe(false);
  });
});

describe("isSemantic", () => {
  it("returns true for a semantic note", () => {
    const note = makeMemoryNote({ content: "fact", sessionKey: "s", type: "semantic" });
    expect(isSemantic(note)).toBe(true);
  });

  it("returns false for an episodic note", () => {
    const note = makeMemoryNote({ content: "event", sessionKey: "s", type: "episodic" });
    expect(isSemantic(note)).toBe(false);
  });

  it("isEpisodic and isSemantic are mutually exclusive for all NoteTypes", () => {
    for (const type of NOTE_TYPES) {
      const note = makeMemoryNote({ content: "x", sessionKey: "s", type });
      expect(isEpisodic(note) !== isSemantic(note)).toBe(true);
    }
  });
});

// ── MemoryRecallResult shape ──────────────────────────────────────────────────

describe("MemoryRecallResult shape", () => {
  it("accepts a well-formed result object", () => {
    const note = makeMemoryNote({ content: "x", sessionKey: "s", id: "id-1", createdAt: 1 });
    const result: MemoryRecallResult = {
      recent: [note],
      recalled: [],
    };
    expect(result.recent).toHaveLength(1);
    expect(result.recalled).toHaveLength(0);
  });

  it("recent and recalled can both be empty", () => {
    const result: MemoryRecallResult = { recent: [], recalled: [] };
    expect(result.recent).toHaveLength(0);
    expect(result.recalled).toHaveLength(0);
  });

  it("deduplication invariant: a note id in recent should not appear in recalled", () => {
    // This test documents the contract; pipelines must enforce it.
    const shared = makeMemoryNote({ content: "shared", sessionKey: "s", id: "shared-id" });
    const unique = makeMemoryNote({ content: "unique", sessionKey: "s", id: "unique-id" });
    const result: MemoryRecallResult = {
      recent: [shared],
      recalled: [unique], // shared is NOT in recalled — pipeline deduped it
    };
    const recentIds = new Set(result.recent.map((n) => n.id));
    for (const n of result.recalled) {
      expect(recentIds.has(n.id)).toBe(false);
    }
  });
});
