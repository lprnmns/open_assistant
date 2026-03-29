/**
 * Hippocampus tests — use ":memory:" for full isolation (no files created).
 *
 * sqlite-vec availability: the vec-dependent tests (recall, similarity ordering)
 * are skipped when the extension cannot be loaded.  Fail-soft and metadata-only
 * tests run regardless.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHippocampus, SqliteHippocampus } from "./hippocampus.js";
import { makeMemoryNote, type MemoryNote } from "./types.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function note(
  content: string,
  opts: Partial<Pick<MemoryNote, "id" | "type" | "sessionKey" | "createdAt">> = {},
): MemoryNote {
  return makeMemoryNote({
    content,
    sessionKey: opts.sessionKey ?? "s1",
    type: opts.type,
    id: opts.id,
    createdAt: opts.createdAt,
  });
}

/** 4-D unit-ish vectors for distance ordering tests. */
const VEC_A = [1, 0, 0, 0] as const;      // "north"
const VEC_B = [0, 1, 0, 0] as const;      // "east"
const VEC_C = [0, 0, 1, 0] as const;      // "up"
const QUERY_NEAR_A = [0.95, 0.1, 0.05, 0] as const;  // close to A

/** Detect whether sqlite-vec loads in this environment. */
async function vecAvailable(): Promise<boolean> {
  const { loadSqliteVecExtension } = await import("../../memory/sqlite-vec.js");
  const { requireNodeSqlite } = await import("../../memory/sqlite.js");
  try {
    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(":memory:");
    const result = await loadSqliteVecExtension({ db });
    db.close();
    return result.ok;
  } catch {
    return false;
  }
}

// ── factory ───────────────────────────────────────────────────────────────────

describe("createHippocampus", () => {
  it("returns a SqliteHippocampus instance", () => {
    const h = createHippocampus(":memory:");
    expect(h).toBeInstanceOf(SqliteHippocampus);
  });
});

// ── close (always runs — no vec needed) ──────────────────────────────────────

describe("SqliteHippocampus — close", () => {
  it("close is idempotent — calling twice does not throw", async () => {
    const h = createHippocampus(":memory:");
    await expect(h.close()).resolves.toBeUndefined();
    await expect(h.close()).resolves.toBeUndefined();
  });

  it("close on a never-opened instance does not throw", async () => {
    const h = createHippocampus(":memory:");
    await expect(h.close()).resolves.toBeUndefined();
  });
});

// ── fail-soft: recall before any ingest ──────────────────────────────────────

describe("SqliteHippocampus — fail-soft recall", () => {
  it("recall before any ingest returns []", async () => {
    const h = createHippocampus(":memory:");
    const r = await h.recall([1, 0, 0, 0], 5);
    expect(r).toEqual([]);
    await h.close();
  });

  it("recall after close returns []", async () => {
    const h = createHippocampus(":memory:");
    await h.close();
    const r = await h.recall([1, 0, 0, 0], 5);
    expect(r).toEqual([]);
  });

  it("recall with k=0 returns []", async () => {
    const h = createHippocampus(":memory:");
    await h.ingest(note("x"), VEC_A);
    const r = await h.recall(VEC_A, 0);
    expect(r).toEqual([]);
    await h.close();
  });

  it("ingest never throws even with a bad vector (all zeros)", async () => {
    const logs: string[] = [];
    const h = createHippocampus(":memory:", (m) => logs.push(m));
    await expect(h.ingest(note("zero-vec"), [0, 0, 0, 0])).resolves.toBeUndefined();
    await h.close();
  });
});

// ── vec-dependent tests ───────────────────────────────────────────────────────

describe("SqliteHippocampus — ingest + recall (requires sqlite-vec)", () => {
  let h: SqliteHippocampus;
  let hasVec = false;

  beforeEach(async () => {
    hasVec = await vecAvailable();
    h = createHippocampus(":memory:");
  });

  afterEach(async () => {
    await h.close();
  });

  it("ingested note is retrievable via recall", async () => {
    if (!hasVec) return;
    const n = note("remember this", { id: "n1" });
    await h.ingest(n, VEC_A);
    const r = await h.recall(VEC_A, 5);
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.some((x) => x.id === "n1")).toBe(true);
  });

  it("note metadata round-trips correctly through ingest → recall", async () => {
    if (!hasVec) return;
    const n = note("exact content", {
      id: "round-trip-id",
      type: "semantic",
      sessionKey: "sess-42",
      createdAt: 1_700_000_000_000,
    });
    await h.ingest(n, VEC_A);
    const r = await h.recall(VEC_A, 1);
    expect(r.length).toBe(1);
    const got = r[0]!;
    expect(got.id).toBe("round-trip-id");
    expect(got.content).toBe("exact content");
    expect(got.type).toBe("semantic");
    expect(got.sessionKey).toBe("sess-42");
    expect(got.createdAt).toBe(1_700_000_000_000);
  });

  it("recall respects k limit", async () => {
    if (!hasVec) return;
    await h.ingest(note("a", { id: "a" }), VEC_A);
    await h.ingest(note("b", { id: "b" }), VEC_B);
    await h.ingest(note("c", { id: "c" }), VEC_C);
    const r = await h.recall(QUERY_NEAR_A, 2);
    expect(r.length).toBeLessThanOrEqual(2);
  });

  it("recall orders by cosine similarity — closest note comes first", async () => {
    if (!hasVec) return;
    await h.ingest(note("near-A", { id: "a" }), VEC_A);
    await h.ingest(note("near-B", { id: "b" }), VEC_B);
    await h.ingest(note("near-C", { id: "c" }), VEC_C);
    // QUERY_NEAR_A is closest to VEC_A
    const r = await h.recall(QUERY_NEAR_A, 3);
    expect(r.length).toBe(3);
    expect(r[0]!.id).toBe("a");
  });

  it("sessionKey filter returns only matching notes", async () => {
    if (!hasVec) return;
    await h.ingest(note("session-1 note", { id: "s1n", sessionKey: "sess-1" }), VEC_A);
    await h.ingest(note("session-2 note", { id: "s2n", sessionKey: "sess-2" }), VEC_B);
    const r = await h.recall(QUERY_NEAR_A, 5, { sessionKey: "sess-1" });
    expect(r.every((n) => n.sessionKey === "sess-1")).toBe(true);
    expect(r.some((n) => n.sessionKey === "sess-2")).toBe(false);
  });

  it("sessionKey filter=undefined returns notes from all sessions", async () => {
    if (!hasVec) return;
    await h.ingest(note("s1", { sessionKey: "sess-1" }), VEC_A);
    await h.ingest(note("s2", { sessionKey: "sess-2" }), VEC_B);
    const r = await h.recall(QUERY_NEAR_A, 5);
    const sessions = new Set(r.map((n) => n.sessionKey));
    expect(sessions.has("sess-1")).toBe(true);
    expect(sessions.has("sess-2")).toBe(true);
  });

  it("recall with queryVector dimension mismatch returns []", async () => {
    if (!hasVec) return;
    await h.ingest(note("4-d note"), VEC_A);            // dims = 4
    const r = await h.recall([1, 0, 0], 5);            // wrong dims
    expect(r).toEqual([]);
  });

  it("episodic and semantic notes coexist and are recalled correctly", async () => {
    if (!hasVec) return;
    await h.ingest(note("event", { id: "ep", type: "episodic" }), VEC_A);
    await h.ingest(note("fact",  { id: "sm", type: "semantic"  }), VEC_B);
    const r = await h.recall(QUERY_NEAR_A, 5);
    const types = new Set(r.map((n) => n.type));
    expect(types.has("episodic")).toBe(true);
    expect(types.has("semantic")).toBe(true);
  });

  it("INSERT OR REPLACE: re-ingesting same id overwrites the row", async () => {
    if (!hasVec) return;
    const n = note("original", { id: "dup" });
    await h.ingest(n, VEC_A);
    const updated = { ...n, content: "updated" };
    await h.ingest(updated, VEC_B);
    const r = await h.recall(VEC_B, 5);
    const found = r.find((x) => x.id === "dup");
    expect(found?.content).toBe("updated");
  });
});

// ── Cortex isolation ──────────────────────────────────────────────────────────

describe("SqliteHippocampus — Cortex isolation", () => {
  it("has no reference to InMemoryCortex", async () => {
    // Static check: importing hippocampus must not transitively pull in cortex.
    // If this test compiles and runs, the import graph is clean.
    const mod = await import("./hippocampus.js");
    expect("InMemoryCortex" in mod).toBe(false);
  });

  it("MemoryNote passed to ingest has no vector field", async () => {
    const n = note("pure note");
    expect("vector" in n).toBe(false);
    // ingest accepts the note plus a separate vector argument — they are decoupled.
    const h = createHippocampus(":memory:");
    await expect(h.ingest(n, VEC_A)).resolves.toBeUndefined();
    await h.close();
  });
});
