import { describe, expect, it, vi } from "vitest";
import {
  buildSemanticContent,
  CONSOLIDATION_DEFAULTS,
  createConsolidationPipeline,
  DefaultConsolidationPipeline,
  parseSourceId,
} from "./consolidation.js";
import type { Embedder, Hippocampus, MemoryNote, NoteType } from "../brain/types.js";
import { makeMemoryNote } from "../brain/types.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const DUMMY_VECTOR = [1, 0, 0] as const;

function episodic(content: string, id?: string): MemoryNote {
  return makeMemoryNote({ content, sessionKey: "sess", type: "episodic", id });
}

function semantic(sourceId: string, facts = "a fact", id?: string): MemoryNote {
  return makeMemoryNote({
    content: buildSemanticContent(sourceId, facts),
    sessionKey: "sess",
    type: "semantic",
    id,
  });
}

function makeDeps(overrides: {
  episodicNotes?: MemoryNote[];
  existingSemanticNotes?: MemoryNote[];
  extractResult?: string | Error;
  embedResult?: readonly number[] | Error;
  ingestError?: Error;
  listError?: Error;
} = {}) {
  const hippocampus: Hippocampus = {
    ingest: vi.fn(async () => {
      if (overrides.ingestError) throw overrides.ingestError;
    }),
    recall: vi.fn().mockResolvedValue([]),
    listByType: vi.fn(async (type: NoteType) => {
      if (overrides.listError) throw overrides.listError;
      if (type === "episodic") return overrides.episodicNotes ?? [];
      if (type === "semantic") return overrides.existingSemanticNotes ?? [];
      return [];
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const embedder: Embedder = {
    embed: vi.fn(async () => {
      if (overrides.embedResult instanceof Error) throw overrides.embedResult;
      return overrides.embedResult ?? DUMMY_VECTOR;
    }),
  };

  const logs: string[] = [];
  const extractFacts = vi.fn(async () => {
    if (overrides.extractResult instanceof Error) throw overrides.extractResult;
    return overrides.extractResult ?? "extracted semantic fact";
  });

  return { hippocampus, embedder, extractFacts, logs };
}

// ── source-marker helpers ─────────────────────────────────────────────────────

describe("buildSemanticContent / parseSourceId", () => {
  it("buildSemanticContent produces [source:<id>] on first line", () => {
    const c = buildSemanticContent("abc-123", "some facts");
    expect(c.startsWith("[source:abc-123]")).toBe(true);
  });

  it("parseSourceId extracts the source ID", () => {
    const c = buildSemanticContent("abc-123", "some facts");
    expect(parseSourceId(c)).toBe("abc-123");
  });

  it("parseSourceId returns undefined for content without marker", () => {
    expect(parseSourceId("just regular content")).toBeUndefined();
    expect(parseSourceId("")).toBeUndefined();
  });

  it("extracted facts appear after the first line", () => {
    const facts = "line one\nline two";
    const c = buildSemanticContent("id-1", facts);
    const afterMarker = c.slice(c.indexOf("\n") + 1);
    expect(afterMarker).toBe(facts.trim());
  });

  it("parseSourceId returns undefined for malformed marker (no closing bracket)", () => {
    expect(parseSourceId("[source:abc")).toBeUndefined();
  });
});

// ── factory ───────────────────────────────────────────────────────────────────

describe("createConsolidationPipeline", () => {
  it("returns a DefaultConsolidationPipeline", () => {
    const { hippocampus, embedder, extractFacts } = makeDeps();
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    expect(p).toBeInstanceOf(DefaultConsolidationPipeline);
  });
});

// ── happy path ────────────────────────────────────────────────────────────────

describe("DefaultConsolidationPipeline — happy path", () => {
  it("converts episodic notes to semantic notes", async () => {
    const notes = [episodic("event A", "id-a"), episodic("event B", "id-b")];
    const { hippocampus, embedder, extractFacts } = makeDeps({ episodicNotes: notes });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    const result = await p.run({ sessionKey: "sess" });
    expect(result.converted).toBe(2);
    expect(result.processed).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("calls extractFacts once per unconsolidated note", async () => {
    const notes = [episodic("e1"), episodic("e2"), episodic("e3")];
    const { hippocampus, embedder, extractFacts } = makeDeps({ episodicNotes: notes });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    await p.run({ sessionKey: "sess" });
    expect(extractFacts).toHaveBeenCalledTimes(3);
  });

  it("writes semantic note with source marker to hippocampus.ingest", async () => {
    const ep = episodic("user prefers brevity", "ep-id-1");
    const { hippocampus, embedder, extractFacts } = makeDeps({ episodicNotes: [ep] });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    await p.run({ sessionKey: "sess" });

    const call = (hippocampus.ingest as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const writtenNote = call[0] as MemoryNote;
    expect(writtenNote.type).toBe("semantic");
    expect(parseSourceId(writtenNote.content)).toBe("ep-id-1");
  });

  it("semantic note sessionKey matches input sessionKey", async () => {
    const { hippocampus, embedder, extractFacts } = makeDeps({
      episodicNotes: [episodic("e")],
    });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    await p.run({ sessionKey: "my-session" });
    const call = (hippocampus.ingest as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((call[0] as MemoryNote).sessionKey).toBe("my-session");
  });

  it("run() returns Promise<ConsolidationResult> (never undefined)", async () => {
    const { hippocampus, embedder, extractFacts } = makeDeps();
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    await expect(p.run({ sessionKey: "s" })).resolves.toBeDefined();
  });

  it("no episodic notes → all counts are 0", async () => {
    const { hippocampus, embedder, extractFacts } = makeDeps({ episodicNotes: [] });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    const result = await p.run({ sessionKey: "s" });
    expect(result).toEqual({ processed: 0, converted: 0, skipped: 0, failed: 0 });
  });

  it("passes sessionKey to hippocampus.listByType for both episodic and semantic queries", async () => {
    const { hippocampus, embedder, extractFacts } = makeDeps();
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    await p.run({ sessionKey: "key-99" });
    const calls = (hippocampus.listByType as ReturnType<typeof vi.fn>).mock.calls;
    for (const call of calls) {
      expect(call[1]).toMatchObject({ sessionKey: "key-99" });
    }
  });

  it("applies CONSOLIDATION_DEFAULTS.batchSize when batchSize is omitted", async () => {
    const { hippocampus, embedder, extractFacts } = makeDeps();
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    await p.run({ sessionKey: "s" });
    const episodicCall = (hippocampus.listByType as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "episodic",
    );
    expect(episodicCall![1]).toMatchObject({ limit: CONSOLIDATION_DEFAULTS.batchSize });
  });

  it("honours explicit batchSize override", async () => {
    const { hippocampus, embedder, extractFacts } = makeDeps();
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    await p.run({ sessionKey: "s", batchSize: 5 });
    const episodicCall = (hippocampus.listByType as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "episodic",
    );
    expect(episodicCall![1]).toMatchObject({ limit: 5 });
  });

  it("episodic source note is never passed to hippocampus.ingest (append-only)", async () => {
    const ep = episodic("source event", "ep-src");
    const { hippocampus, embedder, extractFacts } = makeDeps({ episodicNotes: [ep] });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    await p.run({ sessionKey: "sess" });
    const ingestCalls = (hippocampus.ingest as ReturnType<typeof vi.fn>).mock.calls;
    for (const call of ingestCalls) {
      expect((call[0] as MemoryNote).id).not.toBe("ep-src");
    }
  });
});

// ── idempotency ───────────────────────────────────────────────────────────────

describe("DefaultConsolidationPipeline — idempotency", () => {
  it("skips episodic notes that already have a semantic note", async () => {
    const ep = episodic("old event", "ep-1");
    const existing = semantic("ep-1", "already extracted");
    const { hippocampus, embedder, extractFacts } = makeDeps({
      episodicNotes: [ep],
      existingSemanticNotes: [existing],
    });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    const result = await p.run({ sessionKey: "sess" });
    expect(result.skipped).toBe(1);
    expect(result.converted).toBe(0);
    expect(extractFacts).not.toHaveBeenCalled();
  });

  it("extracts only unconsolidated notes when mixed", async () => {
    const ep1 = episodic("event 1", "ep-1");
    const ep2 = episodic("event 2", "ep-2");
    const existing = semantic("ep-1");
    const { hippocampus, embedder, extractFacts } = makeDeps({
      episodicNotes: [ep1, ep2],
      existingSemanticNotes: [existing],
    });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    const result = await p.run({ sessionKey: "sess" });
    expect(result.skipped).toBe(1);
    expect(result.converted).toBe(1);
    expect(extractFacts).toHaveBeenCalledTimes(1);
    expect(extractFacts).toHaveBeenCalledWith(ep2.content);
  });

  it("idempotency holds across re-runs (second run skips all)", async () => {
    const ep = episodic("event", "ep-1");
    const existing = semantic("ep-1");
    const { hippocampus, embedder, extractFacts } = makeDeps({
      episodicNotes: [ep],
      existingSemanticNotes: [existing],
    });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    const r1 = await p.run({ sessionKey: "sess" });
    const r2 = await p.run({ sessionKey: "sess" });
    expect(r1.converted).toBe(0);
    expect(r2.converted).toBe(0);
    expect(extractFacts).not.toHaveBeenCalled();
  });

  it("LLM not called when all notes already consolidated", async () => {
    const notes = [episodic("e1", "ep-1"), episodic("e2", "ep-2")];
    const existing = [semantic("ep-1"), semantic("ep-2")];
    const { hippocampus, embedder, extractFacts } = makeDeps({
      episodicNotes: notes,
      existingSemanticNotes: existing,
    });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    await p.run({ sessionKey: "sess" });
    expect(extractFacts).not.toHaveBeenCalled();
  });
});

// ── fail-soft ─────────────────────────────────────────────────────────────────

describe("DefaultConsolidationPipeline — fail-soft", () => {
  it("does NOT throw when extractFacts rejects", async () => {
    const { hippocampus, embedder, extractFacts } = makeDeps({
      episodicNotes: [episodic("e")],
      extractResult: new Error("LLM down"),
    });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    await expect(p.run({ sessionKey: "s" })).resolves.toBeDefined();
  });

  it("increments failed when extractFacts rejects", async () => {
    const { hippocampus, embedder, extractFacts } = makeDeps({
      episodicNotes: [episodic("e1"), episodic("e2")],
      extractResult: new Error("LLM down"),
    });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    const result = await p.run({ sessionKey: "s" });
    expect(result.failed).toBe(2);
    expect(result.converted).toBe(0);
  });

  it("continues processing remaining notes after individual failure", async () => {
    // First call throws, second succeeds
    let callCount = 0;
    const extractFacts = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error("first note fails");
      return "fact from second note";
    });
    const { hippocampus, embedder } = makeDeps({
      episodicNotes: [episodic("e1"), episodic("e2")],
    });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    const result = await p.run({ sessionKey: "s" });
    expect(result.failed).toBe(1);
    expect(result.converted).toBe(1);
  });

  it("does NOT throw when embedder.embed rejects", async () => {
    const { hippocampus, embedder, extractFacts } = makeDeps({
      episodicNotes: [episodic("e")],
      embedResult: new Error("embed fail"),
    });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    await expect(p.run({ sessionKey: "s" })).resolves.toBeDefined();
  });

  it("increments failed when embedder.embed rejects", async () => {
    const { hippocampus, embedder, extractFacts } = makeDeps({
      episodicNotes: [episodic("e")],
      embedResult: new Error("embed fail"),
    });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    const result = await p.run({ sessionKey: "s" });
    expect(result.failed).toBe(1);
  });

  it("does NOT throw when hippocampus.ingest rejects", async () => {
    const { hippocampus, embedder, extractFacts } = makeDeps({
      episodicNotes: [episodic("e")],
      ingestError: new Error("sqlite error"),
    });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    await expect(p.run({ sessionKey: "s" })).resolves.toBeDefined();
  });

  it("does NOT throw when listByType throws (outer guard)", async () => {
    const { hippocampus, embedder, extractFacts } = makeDeps({
      listError: new Error("db corrupted"),
    });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    await expect(p.run({ sessionKey: "s" })).resolves.toBeDefined();
  });

  it("empty string returned from extractFacts → note not written, not counted as failed", async () => {
    const { hippocampus, embedder } = makeDeps({ episodicNotes: [episodic("trivial")] });
    const extractFacts = vi.fn(async () => "   "); // whitespace only
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    const result = await p.run({ sessionKey: "s" });
    expect(result.converted).toBe(0);
    expect(result.failed).toBe(0);
    expect(hippocampus.ingest).not.toHaveBeenCalled();
  });
});

// ── LLM cost attribution ──────────────────────────────────────────────────────

describe("DefaultConsolidationPipeline — LLM cost attribution", () => {
  it("extractFacts is NEVER called during construction", () => {
    const extractFacts = vi.fn();
    createConsolidationPipeline({
      hippocampus: makeDeps().hippocampus,
      embedder: makeDeps().embedder,
      extractFacts,
    });
    expect(extractFacts).not.toHaveBeenCalled();
  });

  it("extractFacts called exactly N times for N unconsolidated episodic notes", async () => {
    const notes = [episodic("a"), episodic("b"), episodic("c")];
    const { hippocampus, embedder, extractFacts } = makeDeps({ episodicNotes: notes });
    const p = createConsolidationPipeline({ hippocampus, embedder, extractFacts });
    await p.run({ sessionKey: "s" });
    expect(extractFacts).toHaveBeenCalledTimes(3);
  });
});
