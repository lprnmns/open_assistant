import { describe, expect, it, vi } from "vitest";
import { createNoteIngestionPipeline, DefaultNoteIngestionPipeline } from "./ingestion.js";
import type { Cortex, Embedder, Hippocampus, NoteIngestionInput, MemoryNote } from "./types.js";

// ── mock factories ────────────────────────────────────────────────────────────

const DUMMY_VECTOR = [1, 0, 0, 0] as const;

function makeDeps(overrides: {
  cortexStage?: () => void;
  embedResult?: readonly number[] | Error;
  hippoIngest?: () => Promise<void>;
  log?: (msg: string) => void;
} = {}) {
  const callOrder: string[] = [];

  const cortex: Cortex = {
    stage: vi.fn(() => {
      if (overrides.cortexStage) overrides.cortexStage();
      callOrder.push("cortex.stage");
    }),
    recent: vi.fn().mockReturnValue([]),
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
    ingest: vi.fn(async () => {
      callOrder.push("hippocampus.ingest");
      if (overrides.hippoIngest) return overrides.hippoIngest();
    }),
    recall: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const logs: string[] = [];
  const log = overrides.log ?? ((m: string) => logs.push(m));

  return { cortex, embedder, hippocampus, log, logs, callOrder };
}

function input(overrides: Partial<NoteIngestionInput> = {}): NoteIngestionInput {
  return {
    content: overrides.content ?? "test note",
    sessionKey: overrides.sessionKey ?? "session-1",
    type: overrides.type,
  };
}

// ── factory ───────────────────────────────────────────────────────────────────

describe("createNoteIngestionPipeline", () => {
  it("returns a DefaultNoteIngestionPipeline", () => {
    const { cortex, embedder, hippocampus, log } = makeDeps();
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    expect(p).toBeInstanceOf(DefaultNoteIngestionPipeline);
  });
});

// ── happy path ────────────────────────────────────────────────────────────────

describe("DefaultNoteIngestionPipeline — happy path", () => {
  it("calls all three steps on success", async () => {
    const { cortex, embedder, hippocampus, log, callOrder } = makeDeps();
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await p.ingest(input());
    expect(cortex.stage).toHaveBeenCalledTimes(1);
    expect(embedder.embed).toHaveBeenCalledTimes(1);
    expect(hippocampus.ingest).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["cortex.stage", "embedder.embed", "hippocampus.ingest"]);
  });

  it("Cortex.stage is called BEFORE Embedder.embed (step order enforced)", async () => {
    const { cortex, embedder, hippocampus, log, callOrder } = makeDeps();
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await p.ingest(input());
    expect(callOrder.indexOf("cortex.stage")).toBeLessThan(callOrder.indexOf("embedder.embed"));
  });

  it("Embedder.embed is called BEFORE Hippocampus.ingest", async () => {
    const { cortex, embedder, hippocampus, log, callOrder } = makeDeps();
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await p.ingest(input());
    expect(callOrder.indexOf("embedder.embed")).toBeLessThan(
      callOrder.indexOf("hippocampus.ingest"),
    );
  });

  it("passes note content to Embedder.embed", async () => {
    const { cortex, embedder, hippocampus, log } = makeDeps();
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await p.ingest(input({ content: "specific content" }));
    expect(embedder.embed).toHaveBeenCalledWith("specific content");
  });

  it("passes the embedding vector to Hippocampus.ingest", async () => {
    const vec = [0.1, 0.2, 0.3];
    const { cortex, embedder, hippocampus, log } = makeDeps({ embedResult: vec });
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await p.ingest(input());
    expect(hippocampus.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ content: "test note" }),
      vec,
    );
  });

  it("note staged in Cortex has correct sessionKey and defaults to episodic type", async () => {
    const { cortex, embedder, hippocampus, log } = makeDeps();
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await p.ingest(input({ sessionKey: "sess-42" }));
    const stagedNote = (cortex.stage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as MemoryNote;
    expect(stagedNote.sessionKey).toBe("sess-42");
    expect(stagedNote.type).toBe("episodic");
  });

  it("note type is preserved when explicitly provided", async () => {
    const { cortex, embedder, hippocampus, log } = makeDeps();
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await p.ingest(input({ type: "semantic" }));
    const stagedNote = (cortex.stage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as MemoryNote;
    expect(stagedNote.type).toBe("semantic");
  });

  it("each ingest call produces a distinct note id", async () => {
    const { cortex, embedder, hippocampus, log } = makeDeps();
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await p.ingest(input({ content: "first" }));
    await p.ingest(input({ content: "second" }));
    const calls = (cortex.stage as ReturnType<typeof vi.fn>).mock.calls;
    const id1 = (calls[0]![0] as MemoryNote).id;
    const id2 = (calls[1]![0] as MemoryNote).id;
    expect(id1).not.toBe(id2);
  });

  it("ingest returns undefined (Promise<void>)", async () => {
    const { cortex, embedder, hippocampus, log } = makeDeps();
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await expect(p.ingest(input())).resolves.toBeUndefined();
  });
});

// ── Embedder failure ──────────────────────────────────────────────────────────

describe("DefaultNoteIngestionPipeline — Embedder failure", () => {
  it("does NOT throw when Embedder.embed rejects", async () => {
    const { cortex, embedder, hippocampus, log } = makeDeps({
      embedResult: new Error("embedding API down"),
    });
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await expect(p.ingest(input())).resolves.toBeUndefined();
  });

  it("Cortex.stage IS called even when Embedder fails", async () => {
    const { cortex, embedder, hippocampus, log } = makeDeps({
      embedResult: new Error("embed fail"),
    });
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await p.ingest(input());
    expect(cortex.stage).toHaveBeenCalledTimes(1);
  });

  it("Hippocampus.ingest is NOT called when Embedder fails (no vector to store)", async () => {
    const { cortex, embedder, hippocampus, log } = makeDeps({
      embedResult: new Error("embed fail"),
    });
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await p.ingest(input());
    expect(hippocampus.ingest).not.toHaveBeenCalled();
  });

  it("Embedder failure is logged", async () => {
    const { cortex, embedder, hippocampus, logs } = makeDeps({
      embedResult: new Error("embed fail"),
    });
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log: (m) => logs.push(m) });
    await p.ingest(input());
    expect(logs.some((m) => m.includes("embed"))).toBe(true);
  });

  it("step order is still cortex-before-embed even when embed fails", async () => {
    const { cortex, embedder, hippocampus, log, callOrder } = makeDeps({
      embedResult: new Error("fail"),
    });
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await p.ingest(input());
    expect(callOrder[0]).toBe("cortex.stage");
    expect(callOrder[1]).toBe("embedder.embed");
  });
});

// ── Hippocampus failure ───────────────────────────────────────────────────────

describe("DefaultNoteIngestionPipeline — Hippocampus failure", () => {
  it("does NOT throw when Hippocampus.ingest rejects", async () => {
    const { cortex, embedder, hippocampus, log } = makeDeps({
      hippoIngest: async () => { throw new Error("sqlite error"); },
    });
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await expect(p.ingest(input())).resolves.toBeUndefined();
  });

  it("Cortex.stage IS called even when Hippocampus fails", async () => {
    const { cortex, embedder, hippocampus, log } = makeDeps({
      hippoIngest: async () => { throw new Error("sqlite error"); },
    });
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await p.ingest(input());
    expect(cortex.stage).toHaveBeenCalledTimes(1);
  });

  it("Hippocampus failure is logged", async () => {
    const logs: string[] = [];
    const { cortex, embedder, hippocampus } = makeDeps({
      hippoIngest: async () => { throw new Error("sqlite error"); },
    });
    const p = createNoteIngestionPipeline({
      cortex, embedder, hippocampus,
      log: (m) => logs.push(m),
    });
    await p.ingest(input());
    expect(logs.some((m) => m.includes("Hippocampus"))).toBe(true);
  });
});

// ── Cortex.stage failure ──────────────────────────────────────────────────────

describe("DefaultNoteIngestionPipeline — Cortex.stage failure", () => {
  it("does NOT throw when Cortex.stage throws", async () => {
    const { cortex, embedder, hippocampus, log } = makeDeps({
      cortexStage: () => { throw new Error("RAM corruption"); },
    });
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await expect(p.ingest(input())).resolves.toBeUndefined();
  });

  it("Embedder and Hippocampus are still called when Cortex.stage throws", async () => {
    const { cortex, embedder, hippocampus, log } = makeDeps({
      cortexStage: () => { throw new Error("RAM corruption"); },
    });
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await p.ingest(input());
    expect(embedder.embed).toHaveBeenCalledTimes(1);
    expect(hippocampus.ingest).toHaveBeenCalledTimes(1);
  });

  it("Cortex.stage failure is logged", async () => {
    const logs: string[] = [];
    const { cortex, embedder, hippocampus } = makeDeps({
      cortexStage: () => { throw new Error("RAM corruption"); },
    });
    const p = createNoteIngestionPipeline({
      cortex, embedder, hippocampus,
      log: (m) => logs.push(m),
    });
    await p.ingest(input());
    expect(logs.some((m) => m.includes("Cortex"))).toBe(true);
  });
});

// ── all-fail scenario ─────────────────────────────────────────────────────────

describe("DefaultNoteIngestionPipeline — all three fail simultaneously", () => {
  it("never throws even when all three steps fail", async () => {
    const { cortex, embedder, hippocampus, log } = makeDeps({
      cortexStage: () => { throw new Error("cortex fail"); },
      embedResult: new Error("embed fail"),
      hippoIngest: async () => { throw new Error("hippo fail"); },
    });
    const p = createNoteIngestionPipeline({ cortex, embedder, hippocampus, log });
    await expect(p.ingest(input())).resolves.toBeUndefined();
  });
});
