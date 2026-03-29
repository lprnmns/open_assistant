import { describe, expect, it } from "vitest";
import { createCortex, DEFAULT_CORTEX_CAPACITY, InMemoryCortex } from "./cortex.js";
import { makeMemoryNote } from "./types.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function note(content: string, createdAt = Date.now()): ReturnType<typeof makeMemoryNote> {
  return makeMemoryNote({ content, sessionKey: "test", createdAt });
}

// ── constructor ───────────────────────────────────────────────────────────────

describe("InMemoryCortex — constructor", () => {
  it("accepts a positive integer capacity", () => {
    expect(() => new InMemoryCortex(1)).not.toThrow();
    expect(() => new InMemoryCortex(100)).not.toThrow();
  });

  it("throws RangeError for capacity < 1", () => {
    expect(() => new InMemoryCortex(0)).toThrow(RangeError);
    expect(() => new InMemoryCortex(-1)).toThrow(RangeError);
  });

  it("throws RangeError for non-integer capacity", () => {
    expect(() => new InMemoryCortex(1.5)).toThrow(RangeError);
  });

  it("starts empty — recent() returns []", () => {
    const c = new InMemoryCortex(10);
    expect(c.recent(10)).toEqual([]);
  });

  it("DEFAULT_CORTEX_CAPACITY is a positive integer", () => {
    expect(Number.isInteger(DEFAULT_CORTEX_CAPACITY)).toBe(true);
    expect(DEFAULT_CORTEX_CAPACITY).toBeGreaterThan(0);
  });
});

// ── stage — O(1) write ────────────────────────────────────────────────────────

describe("InMemoryCortex — stage", () => {
  it("a single staged note is retrievable", () => {
    const c = new InMemoryCortex(4);
    const n = note("first");
    c.stage(n);
    expect(c.recent(1)).toEqual([n]);
  });

  it("stage increments size up to capacity", () => {
    const c = new InMemoryCortex(3);
    c.stage(note("a"));
    expect(c.recent(10).length).toBe(1);
    c.stage(note("b"));
    expect(c.recent(10).length).toBe(2);
    c.stage(note("c"));
    expect(c.recent(10).length).toBe(3);
  });

  it("size does not exceed capacity after overflow", () => {
    const c = new InMemoryCortex(3);
    for (let i = 0; i < 10; i++) c.stage(note(`item-${i}`));
    // recent(large) still returns at most capacity items
    expect(c.recent(100).length).toBe(3);
  });

  it("oldest note is evicted when capacity is exceeded", () => {
    const c = new InMemoryCortex(3);
    const oldest = note("oldest");
    c.stage(oldest);
    c.stage(note("middle"));
    c.stage(note("newest"));
    // buffer full — stage one more
    c.stage(note("evicts-oldest"));
    const all = c.recent(10);
    expect(all.map((n) => n.content)).not.toContain("oldest");
  });

  it("exactly the last capacity notes are retained after overflow", () => {
    const cap = 4;
    const c = new InMemoryCortex(cap);
    const contents = ["a", "b", "c", "d", "e", "f"]; // 6 > cap
    for (const s of contents) c.stage(note(s));
    const retained = c.recent(100).map((n) => n.content);
    // Should be the last 4, newest-first
    expect(retained).toEqual(["f", "e", "d", "c"]);
  });
});

// ── recent — newest-first ordering ───────────────────────────────────────────

describe("InMemoryCortex — recent ordering", () => {
  it("returns notes newest-first (last staged = index 0)", () => {
    const c = new InMemoryCortex(5);
    c.stage(note("first"));
    c.stage(note("second"));
    c.stage(note("third"));
    const r = c.recent(3);
    expect(r[0].content).toBe("third");
    expect(r[1].content).toBe("second");
    expect(r[2].content).toBe("first");
  });

  it("recent(n) where n < size returns only the n newest", () => {
    const c = new InMemoryCortex(5);
    c.stage(note("a"));
    c.stage(note("b"));
    c.stage(note("c"));
    const r = c.recent(2);
    expect(r.length).toBe(2);
    expect(r[0].content).toBe("c");
    expect(r[1].content).toBe("b");
  });

  it("recent(n) where n > size returns all (no padding)", () => {
    const c = new InMemoryCortex(10);
    c.stage(note("only"));
    expect(c.recent(99).length).toBe(1);
  });

  it("recent(0) returns empty array", () => {
    const c = new InMemoryCortex(5);
    c.stage(note("x"));
    expect(c.recent(0)).toEqual([]);
  });

  it("recent on empty cortex returns empty array for any n", () => {
    const c = new InMemoryCortex(5);
    expect(c.recent(3)).toEqual([]);
    expect(c.recent(0)).toEqual([]);
  });
});

// ── circular wrap-around ──────────────────────────────────────────────────────

describe("InMemoryCortex — circular buffer wrap-around", () => {
  it("recent is correct after head wraps past the end of the buffer", () => {
    const c = new InMemoryCortex(3); // capacity = 3
    // Fill: [a, b, c]  head=0 (wrapped back)
    c.stage(note("a"));
    c.stage(note("b"));
    c.stage(note("c"));
    // Overflow: [d, b, c]  head=1, d evicts a
    c.stage(note("d"));
    const r = c.recent(3);
    expect(r.map((n) => n.content)).toEqual(["d", "c", "b"]);
  });

  it("multiple wrap-around cycles produce correct newest-first order", () => {
    const c = new InMemoryCortex(3);
    // Stage 7 items — wraps twice
    const items = ["p", "q", "r", "s", "t", "u", "v"];
    for (const s of items) c.stage(note(s));
    // Last 3 should be v, u, t
    expect(c.recent(3).map((n) => n.content)).toEqual(["v", "u", "t"]);
  });

  it("capacity=1 always returns only the most recent note", () => {
    const c = new InMemoryCortex(1);
    c.stage(note("first"));
    c.stage(note("second"));
    c.stage(note("third"));
    const r = c.recent(10);
    expect(r.length).toBe(1);
    expect(r[0].content).toBe("third");
  });
});

// ── clear ─────────────────────────────────────────────────────────────────────

describe("InMemoryCortex — clear", () => {
  it("clear empties a populated buffer", () => {
    const c = new InMemoryCortex(5);
    c.stage(note("x"));
    c.stage(note("y"));
    c.clear();
    expect(c.recent(10)).toEqual([]);
  });

  it("stage after clear works correctly", () => {
    const c = new InMemoryCortex(3);
    c.stage(note("before-clear"));
    c.clear();
    c.stage(note("after-clear"));
    const r = c.recent(10);
    expect(r.length).toBe(1);
    expect(r[0].content).toBe("after-clear");
  });

  it("clear on empty buffer is a no-op (no throw)", () => {
    const c = new InMemoryCortex(5);
    expect(() => c.clear()).not.toThrow();
    expect(c.recent(5)).toEqual([]);
  });

  it("clear resets stage/recent to initial state — full capacity reusable", () => {
    const c = new InMemoryCortex(2);
    c.stage(note("a"));
    c.stage(note("b")); // full
    c.clear();
    c.stage(note("c"));
    c.stage(note("d")); // full again
    expect(c.recent(2).map((n) => n.content)).toEqual(["d", "c"]);
  });
});

// ── zero I/O / embedding independence ────────────────────────────────────────

describe("InMemoryCortex — embedding independence", () => {
  it("staged MemoryNote has no vector field (embedding is an impl concern)", () => {
    const c = new InMemoryCortex(5);
    const n = note("pure RAM note");
    c.stage(n);
    const r = c.recent(1)[0]!;
    expect("vector" in r).toBe(false);
  });

  it("stage and recent accept any valid MemoryNote regardless of type", () => {
    const c = new InMemoryCortex(4);
    const ep = makeMemoryNote({ content: "event", sessionKey: "s", type: "episodic" });
    const sem = makeMemoryNote({ content: "fact", sessionKey: "s", type: "semantic" });
    c.stage(ep);
    c.stage(sem);
    const r = c.recent(2);
    expect(r[0].type).toBe("semantic");
    expect(r[1].type).toBe("episodic");
  });
});

// ── createCortex factory ──────────────────────────────────────────────────────

describe("createCortex", () => {
  it("returns an InMemoryCortex instance", () => {
    expect(createCortex()).toBeInstanceOf(InMemoryCortex);
  });

  it("uses DEFAULT_CORTEX_CAPACITY when no argument is provided", () => {
    const c = createCortex();
    // Stage exactly DEFAULT_CORTEX_CAPACITY + 1 items and confirm only capacity are kept
    for (let i = 0; i <= DEFAULT_CORTEX_CAPACITY; i++) c.stage(note(`item-${i}`));
    expect(c.recent(DEFAULT_CORTEX_CAPACITY + 1).length).toBe(DEFAULT_CORTEX_CAPACITY);
  });

  it("accepts a custom capacity", () => {
    const c = createCortex(7);
    for (let i = 0; i < 10; i++) c.stage(note(`n${i}`));
    expect(c.recent(100).length).toBe(7);
  });
});
