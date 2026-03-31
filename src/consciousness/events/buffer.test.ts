import { describe, expect, it } from "vitest";
import {
  addEvent,
  BUFFER_DEFAULTS,
  buildEventPromptLines,
  drainByIds,
  listBySurface,
  makeEventBuffer,
  type BufferedEvent,
  type EventBuffer,
} from "./buffer.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const T = 1_700_000_000_000; // fixed base timestamp

function ownerEvent(id: string, receivedAt = T, summary = `summary-${id}`): BufferedEvent {
  return { id, surface: "owner_active_channel", source: `ch:${id}`, summary, receivedAt };
}

function thirdEvent(id: string, receivedAt = T, summary = `summary-${id}`): BufferedEvent {
  return { id, surface: "third_party_contact", source: `contact:${id}`, summary, receivedAt };
}

// ── makeEventBuffer ───────────────────────────────────────────────────────────

describe("makeEventBuffer", () => {
  it("creates an empty buffer with default capacity", () => {
    const buf = makeEventBuffer();
    expect(buf.events).toHaveLength(0);
    expect(buf.capacityPerSurface).toBe(BUFFER_DEFAULTS.capacityPerSurface);
  });

  it("respects explicit capacityPerSurface", () => {
    const buf = makeEventBuffer(10);
    expect(buf.capacityPerSurface).toBe(10);
  });
});

// ── addEvent — basic ──────────────────────────────────────────────────────────

describe("addEvent — basic", () => {
  it("adds a single owner event", () => {
    const buf = addEvent(makeEventBuffer(), ownerEvent("e1"));
    expect(buf.events).toHaveLength(1);
    expect(buf.events[0]!.id).toBe("e1");
    expect(buf.events[0]!.surface).toBe("owner_active_channel");
  });

  it("adds a single third-party event", () => {
    const buf = addEvent(makeEventBuffer(), thirdEvent("t1"));
    expect(buf.events).toHaveLength(1);
    expect(buf.events[0]!.surface).toBe("third_party_contact");
  });

  it("does not mutate the input buffer", () => {
    const original = makeEventBuffer();
    addEvent(original, ownerEvent("e1"));
    expect(original.events).toHaveLength(0);
  });

  it("returns newest-first ordering after two adds", () => {
    const buf0 = makeEventBuffer();
    const buf1 = addEvent(buf0, ownerEvent("old", T));
    const buf2 = addEvent(buf1, ownerEvent("new", T + 1));
    expect(buf2.events[0]!.id).toBe("new");
    expect(buf2.events[1]!.id).toBe("old");
  });
});

// ── addEvent — deduplication ──────────────────────────────────────────────────

describe("addEvent — deduplication", () => {
  it("ignores duplicate (surface, id) — same event re-pushed", () => {
    const buf1 = addEvent(makeEventBuffer(), ownerEvent("e1"));
    const buf2 = addEvent(buf1, ownerEvent("e1")); // duplicate
    expect(buf2.events).toHaveLength(1);
  });

  it("accepts same id on different surfaces (not a duplicate)", () => {
    const buf1 = addEvent(makeEventBuffer(), ownerEvent("id-42"));
    const buf2 = addEvent(buf1, thirdEvent("id-42")); // same id, different surface
    expect(buf2.events).toHaveLength(2);
  });

  it("dedup is idempotent — pushing same event 3 times gives 1 event", () => {
    let buf = makeEventBuffer();
    for (let i = 0; i < 3; i++) buf = addEvent(buf, ownerEvent("e"));
    expect(buf.events).toHaveLength(1);
  });
});

// ── addEvent — bounded eviction ───────────────────────────────────────────────

describe("addEvent — bounded eviction per surface", () => {
  it("evicts oldest owner event when owner surface at capacity", () => {
    let buf = makeEventBuffer(3);
    buf = addEvent(buf, ownerEvent("old1", T + 0));
    buf = addEvent(buf, ownerEvent("old2", T + 1));
    buf = addEvent(buf, ownerEvent("old3", T + 2));
    // At capacity (3). Add a 4th → oldest (old1) evicted.
    buf = addEvent(buf, ownerEvent("new4", T + 3));
    const ownerIds = buf.events
      .filter((e) => e.surface === "owner_active_channel")
      .map((e) => e.id);
    expect(ownerIds).toContain("new4");
    expect(ownerIds).not.toContain("old1");
    expect(ownerIds).toHaveLength(3);
  });

  it("evicts oldest third-party event when third-party surface at capacity", () => {
    let buf = makeEventBuffer(2);
    buf = addEvent(buf, thirdEvent("t1", T + 0));
    buf = addEvent(buf, thirdEvent("t2", T + 1));
    buf = addEvent(buf, thirdEvent("t3", T + 2)); // t1 evicted
    const thirdIds = buf.events
      .filter((e) => e.surface === "third_party_contact")
      .map((e) => e.id);
    expect(thirdIds).not.toContain("t1");
    expect(thirdIds).toContain("t2");
    expect(thirdIds).toContain("t3");
  });

  it("owner surface capacity is independent: third-party flood does not evict owner events", () => {
    let buf = makeEventBuffer(3);
    // Fill owner surface to capacity
    buf = addEvent(buf, ownerEvent("o1", T));
    buf = addEvent(buf, ownerEvent("o2", T + 1));
    buf = addEvent(buf, ownerEvent("o3", T + 2));
    // Flood with third-party events (more than capacity)
    for (let i = 0; i < 10; i++) {
      buf = addEvent(buf, thirdEvent(`t${i}`, T + 10 + i));
    }
    // Owner events must all survive
    const ownerIds = buf.events
      .filter((e) => e.surface === "owner_active_channel")
      .map((e) => e.id);
    expect(ownerIds).toEqual(expect.arrayContaining(["o1", "o2", "o3"]));
    expect(ownerIds).toHaveLength(3);
  });

  it("third-party surface capacity is independent: owner flood does not evict third-party events", () => {
    let buf = makeEventBuffer(3);
    buf = addEvent(buf, thirdEvent("t1", T));
    buf = addEvent(buf, thirdEvent("t2", T + 1));
    buf = addEvent(buf, thirdEvent("t3", T + 2));
    for (let i = 0; i < 10; i++) {
      buf = addEvent(buf, ownerEvent(`o${i}`, T + 10 + i));
    }
    const thirdIds = buf.events
      .filter((e) => e.surface === "third_party_contact")
      .map((e) => e.id);
    expect(thirdIds).toEqual(expect.arrayContaining(["t1", "t2", "t3"]));
    expect(thirdIds).toHaveLength(3);
  });

  it("after eviction, total events never exceeds 2 × capacityPerSurface", () => {
    let buf = makeEventBuffer(5);
    for (let i = 0; i < 20; i++) {
      buf = addEvent(buf, ownerEvent(`o${i}`, T + i));
      buf = addEvent(buf, thirdEvent(`t${i}`, T + i));
    }
    expect(buf.events.length).toBeLessThanOrEqual(5 * 2);
  });
});

// ── addEvent — ordering invariant ─────────────────────────────────────────────

describe("addEvent — global newest-first ordering", () => {
  it("events from both surfaces are interleaved newest-first by receivedAt", () => {
    let buf = makeEventBuffer();
    buf = addEvent(buf, ownerEvent("o1", T + 0));
    buf = addEvent(buf, thirdEvent("t1", T + 2));
    buf = addEvent(buf, ownerEvent("o2", T + 4));
    buf = addEvent(buf, thirdEvent("t2", T + 1));

    // Expected order: o2(T+4), t1(T+2), t2(T+1), o1(T+0)
    expect(buf.events.map((e) => e.id)).toEqual(["o2", "t1", "t2", "o1"]);
  });
});

// ── listBySurface ─────────────────────────────────────────────────────────────

describe("listBySurface", () => {
  it("returns only events for the requested surface", () => {
    let buf = makeEventBuffer();
    buf = addEvent(buf, ownerEvent("o1"));
    buf = addEvent(buf, thirdEvent("t1"));
    buf = addEvent(buf, ownerEvent("o2"));

    const owner = listBySurface(buf, "owner_active_channel");
    expect(owner.every((e) => e.surface === "owner_active_channel")).toBe(true);
    expect(owner).toHaveLength(2);
  });

  it("returns [] for a surface with no events", () => {
    const buf = addEvent(makeEventBuffer(), ownerEvent("o1"));
    expect(listBySurface(buf, "third_party_contact")).toHaveLength(0);
  });

  it("respects the limit parameter", () => {
    let buf = makeEventBuffer();
    for (let i = 0; i < 5; i++) buf = addEvent(buf, ownerEvent(`o${i}`, T + i));
    expect(listBySurface(buf, "owner_active_channel", 3)).toHaveLength(3);
  });

  it("without limit returns all events for the surface", () => {
    let buf = makeEventBuffer();
    for (let i = 0; i < 5; i++) buf = addEvent(buf, thirdEvent(`t${i}`, T + i));
    expect(listBySurface(buf, "third_party_contact")).toHaveLength(5);
  });

  it("preserves newest-first ordering within surface", () => {
    let buf = makeEventBuffer();
    buf = addEvent(buf, ownerEvent("o-old", T));
    buf = addEvent(buf, ownerEvent("o-new", T + 100));
    const result = listBySurface(buf, "owner_active_channel");
    expect(result[0]!.id).toBe("o-new");
    expect(result[1]!.id).toBe("o-old");
  });
});

// ── drainByIds ────────────────────────────────────────────────────────────────

describe("drainByIds", () => {
  function makeFilledBuffer(): EventBuffer {
    let buf = makeEventBuffer();
    buf = addEvent(buf, ownerEvent("o1"));
    buf = addEvent(buf, ownerEvent("o2"));
    buf = addEvent(buf, thirdEvent("t1"));
    buf = addEvent(buf, thirdEvent("t2"));
    return buf;
  }

  it("removes the specified (surface, id) pairs", () => {
    const buf = drainByIds(makeFilledBuffer(), [
      { surface: "owner_active_channel", id: "o1" },
      { surface: "third_party_contact", id: "t2" },
    ]);
    const ids = buf.events.map((e) => e.id);
    expect(ids).not.toContain("o1");
    expect(ids).not.toContain("t2");
    expect(ids).toContain("o2");
    expect(ids).toContain("t1");
  });

  it("is a no-op for ids not in the buffer", () => {
    const buf = makeFilledBuffer();
    const drained = drainByIds(buf, [{ surface: "owner_active_channel", id: "nonexistent" }]);
    expect(drained.events).toHaveLength(buf.events.length);
  });

  it("is idempotent — draining the same ids twice leaves same result", () => {
    const buf = makeFilledBuffer();
    const drain1 = drainByIds(buf, [{ surface: "owner_active_channel", id: "o1" }]);
    const drain2 = drainByIds(drain1, [{ surface: "owner_active_channel", id: "o1" }]);
    expect(drain2.events.map((e) => e.id)).toEqual(drain1.events.map((e) => e.id));
  });

  it("empty ids array → buffer unchanged", () => {
    const buf = makeFilledBuffer();
    expect(drainByIds(buf, []).events).toHaveLength(buf.events.length);
  });

  it("does not confuse same id across surfaces (surface is part of the key)", () => {
    let buf = makeEventBuffer();
    buf = addEvent(buf, ownerEvent("shared-id"));
    buf = addEvent(buf, thirdEvent("shared-id"));
    // Drain only the owner surface entry
    const drained = drainByIds(buf, [{ surface: "owner_active_channel", id: "shared-id" }]);
    expect(drained.events).toHaveLength(1);
    expect(drained.events[0]!.surface).toBe("third_party_contact");
  });

  it("does not mutate the input buffer", () => {
    const buf = makeFilledBuffer();
    drainByIds(buf, [{ surface: "owner_active_channel", id: "o1" }]);
    expect(buf.events).toHaveLength(4);
  });
});

// ── buildEventPromptLines ─────────────────────────────────────────────────────

describe("buildEventPromptLines — empty buffer", () => {
  it("returns empty string for an empty buffer", () => {
    expect(buildEventPromptLines(makeEventBuffer())).toBe("");
  });

  it("returns empty string when no events match either surface", () => {
    // Technically impossible with a valid buffer, but guard it anyway
    const emptyBuf: EventBuffer = { events: [], capacityPerSurface: 10 };
    expect(buildEventPromptLines(emptyBuf)).toBe("");
  });
});

describe("buildEventPromptLines — owner events", () => {
  it("includes 'Owner channel' section when owner events exist", () => {
    let buf = makeEventBuffer();
    buf = addEvent(buf, ownerEvent("o1", T, "Hello from owner"));
    const lines = buildEventPromptLines(buf);
    expect(lines).toContain("Owner channel");
    expect(lines).toContain("Hello from owner");
  });

  it("does not include third-party section when only owner events exist", () => {
    let buf = makeEventBuffer();
    buf = addEvent(buf, ownerEvent("o1"));
    const lines = buildEventPromptLines(buf);
    expect(lines).not.toContain("Third-party");
  });
});

describe("buildEventPromptLines — third-party events (DPE label)", () => {
  it("includes DPE read-only label for third-party section", () => {
    let buf = makeEventBuffer();
    buf = addEvent(buf, thirdEvent("t1", T, "Hi from contact"));
    const lines = buildEventPromptLines(buf);
    expect(lines).toContain("read-only");
    expect(lines).toContain("owner approval");
  });

  it("includes third-party event summary", () => {
    let buf = makeEventBuffer();
    buf = addEvent(buf, thirdEvent("t1", T, "Call me back"));
    const lines = buildEventPromptLines(buf);
    expect(lines).toContain("Call me back");
  });

  it("does not include owner section when only third-party events exist", () => {
    let buf = makeEventBuffer();
    buf = addEvent(buf, thirdEvent("t1"));
    const lines = buildEventPromptLines(buf);
    expect(lines).not.toContain("Owner channel");
  });
});

describe("buildEventPromptLines — both surfaces", () => {
  it("includes both sections when both surfaces have events", () => {
    let buf = makeEventBuffer();
    buf = addEvent(buf, ownerEvent("o1"));
    buf = addEvent(buf, thirdEvent("t1"));
    const lines = buildEventPromptLines(buf);
    expect(lines).toContain("Owner channel");
    expect(lines).toContain("Third-party");
  });
});

describe("buildEventPromptLines — truncation", () => {
  it("truncates event summary to maxCharsPerEvent", () => {
    const longSummary = "x".repeat(300);
    let buf = makeEventBuffer();
    buf = addEvent(buf, ownerEvent("o1", T, longSummary));
    const lines = buildEventPromptLines(buf, { maxCharsPerEvent: 50 });
    // Each line with the event must not contain the full 300-char string
    const eventLine = lines.split("\n").find((l) => l.includes("ch:o1"))!;
    expect(eventLine.length).toBeLessThan(300);
    expect(eventLine).toContain("…");
  });

  it("does not truncate summaries within the limit", () => {
    const short = "short summary";
    let buf = makeEventBuffer();
    buf = addEvent(buf, ownerEvent("o1", T, short));
    const lines = buildEventPromptLines(buf, { maxCharsPerEvent: 200 });
    expect(lines).toContain(short);
    expect(lines).not.toContain("…");
  });
});

describe("buildEventPromptLines — maxPerSurface limit", () => {
  it("limits events per surface to maxPerSurface", () => {
    let buf = makeEventBuffer();
    for (let i = 0; i < 10; i++) buf = addEvent(buf, ownerEvent(`o${i}`, T + i));
    const lines = buildEventPromptLines(buf, { maxPerSurface: 3 });
    // Count owner event lines (indented with 4 spaces and contain "ch:o")
    const eventLines = lines.split("\n").filter((l) => l.includes("ch:o"));
    expect(eventLines).toHaveLength(3);
  });

  it("shows newest N events (not oldest N) when limited", () => {
    let buf = makeEventBuffer();
    for (let i = 0; i < 5; i++) buf = addEvent(buf, ownerEvent(`o${i}`, T + i));
    // o4 is newest
    const lines = buildEventPromptLines(buf, { maxPerSurface: 2 });
    expect(lines).toContain("ch:o4");
    expect(lines).toContain("ch:o3");
    expect(lines).not.toContain("ch:o0");
  });
});
