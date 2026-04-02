import { describe, expect, it, vi } from "vitest";
import { createMemoryRecallPipeline, DefaultMemoryRecallPipeline } from "./recall.js";
import type { Cortex, Embedder, Hippocampus, MemoryNote } from "./types.js";
import { RECALL_DEFAULTS, makeMemoryNote } from "./types.js";
import { resolveTemporalRange } from "./temporal-resolver.js";

// ── mock factories ────────────────────────────────────────────────────────────

const DUMMY_VECTOR = [1, 0, 0] as const;

function makeNote(content: string, id?: string): MemoryNote {
  return makeMemoryNote({ content, sessionKey: "s", id });
}

function makeDeps(overrides: {
  recentNotes?: MemoryNote[];
  embedResult?: readonly number[] | Error;
  recallResult?: MemoryNote[] | Error;
} = {}) {
  const callOrder: string[] = [];

  const cortex: Cortex = {
    stage: vi.fn(),
    recent: vi.fn(() => {
      callOrder.push("cortex.recent");
      return overrides.recentNotes ?? [];
    }),
    clear: vi.fn(),
  };

  const embedder: Embedder = {
    embed: vi.fn(async () => {
      callOrder.push("embedder.embed");
      const r = overrides.embedResult ?? DUMMY_VECTOR;
      if (r instanceof Error) throw r;
      return r;
    }),
  };

  const hippocampus: Hippocampus = {
    ingest: vi.fn().mockResolvedValue(undefined),
    recall: vi.fn(async () => {
      callOrder.push("hippocampus.recall");
      const r = overrides.recallResult ?? [];
      if (r instanceof Error) throw r;
      return r;
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return { cortex, embedder, hippocampus, callOrder };
}

// ── factory ───────────────────────────────────────────────────────────────────

describe("createMemoryRecallPipeline", () => {
  it("returns a DefaultMemoryRecallPipeline", () => {
    const { cortex, embedder, hippocampus } = makeDeps();
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    expect(p).toBeInstanceOf(DefaultMemoryRecallPipeline);
  });
});

// ── happy path ────────────────────────────────────────────────────────────────

describe("DefaultMemoryRecallPipeline — happy path", () => {
  it("calls cortex.recent before embedder.embed before hippocampus.recall", async () => {
    const { cortex, embedder, hippocampus, callOrder } = makeDeps();
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    await p.recall({ text: "query" });
    expect(callOrder).toEqual(["cortex.recent", "embedder.embed", "hippocampus.recall"]);
  });

  it("returns MemoryRecallResult with recent and recalled slices", async () => {
    const notes = [makeNote("a"), makeNote("b")];
    const recalled = [makeNote("c")];
    const { cortex, embedder, hippocampus } = makeDeps({ recentNotes: notes, recallResult: recalled });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    const result = await p.recall({ text: "query" });
    expect(result.recent).toEqual(notes);
    expect(result.recalled).toEqual(recalled);
  });

  it("applies RECALL_DEFAULTS.recentN when recentN is omitted", async () => {
    const { cortex, embedder, hippocampus } = makeDeps();
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    await p.recall({ text: "q" });
    expect(cortex.recent).toHaveBeenCalledWith(RECALL_DEFAULTS.recentN, undefined);
  });

  it("applies RECALL_DEFAULTS.k when k is omitted", async () => {
    const { cortex, embedder, hippocampus } = makeDeps();
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    await p.recall({ text: "q" });
    const [, kArg] = (hippocampus.recall as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(kArg).toBe(RECALL_DEFAULTS.k);
  });

  it("honours explicit recentN override", async () => {
    const { cortex, embedder, hippocampus } = makeDeps();
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    await p.recall({ text: "q", recentN: 10 });
    expect(cortex.recent).toHaveBeenCalledWith(10, undefined);
  });

  it("honours explicit k override", async () => {
    const { cortex, embedder, hippocampus } = makeDeps();
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    await p.recall({ text: "q", k: 20 });
    const [, kArg] = (hippocampus.recall as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(kArg).toBe(20);
  });

  it("passes the embedded query vector to hippocampus.recall", async () => {
    const vec = [0.1, 0.2, 0.3];
    const { cortex, embedder, hippocampus } = makeDeps({ embedResult: vec });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    await p.recall({ text: "q" });
    const [vecArg] = (hippocampus.recall as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(vecArg).toEqual(vec);
  });

  it("passes query.text to embedder.embed", async () => {
    const { cortex, embedder, hippocampus } = makeDeps();
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    await p.recall({ text: "specific query text" });
    expect(embedder.embed).toHaveBeenCalledWith("specific query text");
  });

  it("passes sessionKey filter when sessionKey is provided", async () => {
    const { cortex, embedder, hippocampus } = makeDeps();
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    await p.recall({ text: "q", sessionKey: "sess-1" });
    expect(hippocampus.recall).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      { sessionKey: "sess-1", startTime: undefined, endTime: undefined },
    );
  });

  it("passes an unfiltered object when sessionKey is omitted", async () => {
    const { cortex, embedder, hippocampus } = makeDeps();
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    await p.recall({ text: "q" });
    expect(hippocampus.recall).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      { sessionKey: undefined, startTime: undefined, endTime: undefined },
    );
  });

  it("passes explicit temporalRange to cortex and hippocampus", async () => {
    const { cortex, embedder, hippocampus } = makeDeps();
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    const temporalRange = {
      start: Date.UTC(2026, 2, 10, 0, 0, 0, 0),
      end: Date.UTC(2026, 2, 11, 0, 0, 0, 0),
      confidence: "exact" as const,
      rawExpression: "last Tuesday",
    };

    await p.recall({ text: "podcast", temporalRange, sessionKey: "sess-1" });

    expect(cortex.recent).toHaveBeenCalledWith(RECALL_DEFAULTS.recentN, {
      startTime: temporalRange.start,
      endTime: temporalRange.end,
    });
    expect(hippocampus.recall).toHaveBeenCalledWith(expect.anything(), expect.any(Number), {
      sessionKey: "sess-1",
      startTime: temporalRange.start,
      endTime: temporalRange.end,
    });
  });

  it("derives temporalRange from query text when not explicitly provided", async () => {
    const { cortex, embedder, hippocampus } = makeDeps();
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 19, 12, 0, 0, 0)));
    try {
      const temporalRange = resolveTemporalRange("what did we decide last Tuesday?");

      expect(temporalRange).not.toBeNull();
      await p.recall({
        text: "what did we decide last Tuesday?",
      });

      expect(cortex.recent).toHaveBeenCalledWith(RECALL_DEFAULTS.recentN, {
        startTime: temporalRange!.start,
        endTime: temporalRange!.end,
      });
      expect(hippocampus.recall).toHaveBeenCalledWith(expect.anything(), expect.any(Number), {
        sessionKey: undefined,
        startTime: temporalRange!.start,
        endTime: temporalRange!.end,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("recall() resolves (returns Promise<MemoryRecallResult>)", async () => {
    const { cortex, embedder, hippocampus } = makeDeps();
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    await expect(p.recall({ text: "q" })).resolves.toBeDefined();
  });

  it("returns a warning when a resolved temporal filter yields no notes", async () => {
    const { cortex, embedder, hippocampus } = makeDeps({
      recentNotes: [],
      recallResult: [],
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    const result = await p.recall({ text: "last Tuesday" });
    expect(result.recent).toEqual([]);
    expect(result.recalled).toEqual([]);
    expect(result.warning).toBe("No notes found in that time range.");
  });

  it("does not emit a temporal warning when the resolver returns null", async () => {
    const recalled = [makeNote("semantic hit")];
    const { cortex, embedder, hippocampus } = makeDeps({
      recentNotes: [],
      recallResult: recalled,
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    const result = await p.recall({ text: "tell me something useful" });
    expect(result.recalled).toEqual(recalled);
    expect(result.warning).toBeUndefined();
  });

  it("does not emit a temporal warning when embedder fails before vector search", async () => {
    const { cortex, embedder, hippocampus } = makeDeps({
      recentNotes: [],
      embedResult: new Error("embed fail"),
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    const result = await p.recall({ text: "last Tuesday" });
    expect(result.recalled).toEqual([]);
    expect(result.warning).toBeUndefined();
  });
});

// ── deduplication ─────────────────────────────────────────────────────────────

describe("DefaultMemoryRecallPipeline — deduplication", () => {
  it("removes notes from recalled that already appear in recent (by id)", async () => {
    const shared = makeNote("shared content", "shared-id");
    const uniqueRecalled = makeNote("unique recalled", "unique-id");
    const { cortex, embedder, hippocampus } = makeDeps({
      recentNotes: [shared],
      recallResult: [shared, uniqueRecalled],
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    const result = await p.recall({ text: "q" });
    expect(result.recalled.map((n) => n.id)).not.toContain("shared-id");
    expect(result.recalled.map((n) => n.id)).toContain("unique-id");
  });

  it("recalled is [] when all recalled notes are already in recent", async () => {
    const n = makeNote("same note", "dup-id");
    const { cortex, embedder, hippocampus } = makeDeps({
      recentNotes: [n],
      recallResult: [n],
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    const result = await p.recall({ text: "q" });
    expect(result.recalled).toEqual([]);
  });

  it("recalled retains all notes when none overlap with recent", async () => {
    const r1 = makeNote("recalled 1", "r1");
    const r2 = makeNote("recalled 2", "r2");
    const recent = makeNote("recent only", "re1");
    const { cortex, embedder, hippocampus } = makeDeps({
      recentNotes: [recent],
      recallResult: [r1, r2],
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    const result = await p.recall({ text: "q" });
    expect(result.recalled.length).toBe(2);
  });

  it("when recent is empty, recalled is returned as-is (no dedup needed)", async () => {
    const notes = [makeNote("a"), makeNote("b")];
    const { cortex, embedder, hippocampus } = makeDeps({
      recentNotes: [],
      recallResult: notes,
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    const result = await p.recall({ text: "q" });
    expect(result.recalled).toEqual(notes);
  });
});

// ── Embedder failure ──────────────────────────────────────────────────────────

describe("DefaultMemoryRecallPipeline — Embedder failure", () => {
  it("does NOT throw when Embedder.embed rejects", async () => {
    const { cortex, embedder, hippocampus } = makeDeps({
      embedResult: new Error("embed API down"),
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    await expect(p.recall({ text: "q" })).resolves.toBeDefined();
  });

  it("recent slice is intact when Embedder fails", async () => {
    const notes = [makeNote("stays")];
    const { cortex, embedder, hippocampus } = makeDeps({
      recentNotes: notes,
      embedResult: new Error("embed fail"),
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    const result = await p.recall({ text: "q" });
    expect(result.recent).toEqual(notes);
  });

  it("recalled is [] when Embedder fails", async () => {
    const { cortex, embedder, hippocampus } = makeDeps({
      embedResult: new Error("embed fail"),
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    const result = await p.recall({ text: "q" });
    expect(result.recalled).toEqual([]);
  });

  it("Hippocampus.recall is NOT called when Embedder fails", async () => {
    const { cortex, embedder, hippocampus } = makeDeps({
      embedResult: new Error("embed fail"),
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    await p.recall({ text: "q" });
    expect(hippocampus.recall).not.toHaveBeenCalled();
  });

  it("step order is cortex-before-embed even when embed fails", async () => {
    const { cortex, embedder, hippocampus, callOrder } = makeDeps({
      embedResult: new Error("fail"),
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    await p.recall({ text: "q" });
    expect(callOrder[0]).toBe("cortex.recent");
    expect(callOrder[1]).toBe("embedder.embed");
  });
});

// ── Hippocampus failure ───────────────────────────────────────────────────────

describe("DefaultMemoryRecallPipeline — Hippocampus failure", () => {
  it("does NOT throw when Hippocampus.recall rejects", async () => {
    const { cortex, embedder, hippocampus } = makeDeps({
      recallResult: new Error("sqlite error"),
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    await expect(p.recall({ text: "q" })).resolves.toBeDefined();
  });

  it("recent slice is intact when Hippocampus fails", async () => {
    const notes = [makeNote("recent note")];
    const { cortex, embedder, hippocampus } = makeDeps({
      recentNotes: notes,
      recallResult: new Error("sqlite error"),
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    const result = await p.recall({ text: "q" });
    expect(result.recent).toEqual(notes);
  });

  it("recalled is [] when Hippocampus fails", async () => {
    const { cortex, embedder, hippocampus } = makeDeps({
      recallResult: new Error("sqlite error"),
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    const result = await p.recall({ text: "q" });
    expect(result.recalled).toEqual([]);
  });

  it("full step order preserved even when Hippocampus fails", async () => {
    const { cortex, embedder, hippocampus, callOrder } = makeDeps({
      recallResult: new Error("fail"),
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    await p.recall({ text: "q" });
    expect(callOrder).toEqual(["cortex.recent", "embedder.embed", "hippocampus.recall"]);
  });
});

// ── both fail ─────────────────────────────────────────────────────────────────

describe("DefaultMemoryRecallPipeline — Embedder + Hippocampus both fail", () => {
  it("never throws; recent intact, recalled empty", async () => {
    const notes = [makeNote("recent")];
    const { cortex, embedder, hippocampus } = makeDeps({
      recentNotes: notes,
      embedResult: new Error("embed fail"),
      recallResult: new Error("hippo fail"),
    });
    const p = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
    const result = await p.recall({ text: "q" });
    expect(result.recent).toEqual(notes);
    expect(result.recalled).toEqual([]);
  });
});
