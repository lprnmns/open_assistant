import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { logCall, queryRange, queryToday } from "./cost-store.js";
import type { CostEntry } from "./cost-store.js";

// node:sqlite is only available in Node 22+; skip all tests on older runtimes.
const nodeMajor = parseInt(process.versions.node.split(".")[0]!, 10);
const hasSqlite = nodeMajor >= 22;
const maybeDescribe = hasSqlite ? describe : describe.skip;

// ── helpers ────────────────────────────────────────────────────────────────────

function tmpDb(): string {
  return path.join(os.tmpdir(), `cost-test-${crypto.randomBytes(6).toString("hex")}.db`);
}

function makeEntry(overrides: Partial<CostEntry> = {}): CostEntry {
  return {
    ts: Date.now(),
    source: "chat",
    model: "claude-sonnet",
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    costUsd: 0.005,
    ...overrides,
  };
}

let dbPath: string;

beforeEach(() => {
  dbPath = tmpDb();
});

afterEach(() => {
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

// ── logCall ────────────────────────────────────────────────────────────────────

maybeDescribe("logCall", () => {
  it("creates the database file on first write", () => {
    expect(fs.existsSync(dbPath)).toBe(false);
    logCall(dbPath, makeEntry());
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("persists all fields correctly", () => {
    const entry = makeEntry({
      ts: 1_700_000_000_000,
      source: "consciousness",
      model: "claude-haiku",
      promptTokens: 200,
      completionTokens: 75,
      totalTokens: 275,
      costUsd: 0.001,
    });
    logCall(dbPath, entry);

    const result = queryRange(dbPath, entry.ts - 1, entry.ts + 1);
    expect(result.consciousness.calls).toBe(1);
    expect(result.consciousness.totalTokens).toBe(275);
    expect(result.consciousness.costUsd).toBeCloseTo(0.001);
  });

  it("accumulates multiple calls", () => {
    logCall(dbPath, makeEntry({ source: "chat", totalTokens: 100, costUsd: 0.01 }));
    logCall(dbPath, makeEntry({ source: "chat", totalTokens: 200, costUsd: 0.02 }));

    const result = queryRange(dbPath, 0, Date.now() + 1);
    expect(result.chat.calls).toBe(2);
    expect(result.chat.totalTokens).toBe(300);
    expect(result.chat.costUsd).toBeCloseTo(0.03);
  });
});

// ── queryRange ────────────────────────────────────────────────────────────────

maybeDescribe("queryRange", () => {
  it("returns zero summaries when db does not exist", () => {
    const result = queryRange("/nonexistent/path/costs.db", 0, Date.now());
    for (const s of ["chat", "consciousness", "extraction", "sleep"] as const) {
      expect(result[s].calls).toBe(0);
      expect(result[s].totalTokens).toBe(0);
      expect(result[s].costUsd).toBe(0);
    }
  });

  it("filters records outside the time range", () => {
    const base = 1_700_000_000_000;
    logCall(dbPath, makeEntry({ ts: base, source: "chat" }));
    logCall(dbPath, makeEntry({ ts: base + 10_000, source: "chat" }));

    // Only the first record falls in [base, base+5000)
    const result = queryRange(dbPath, base, base + 5_000);
    expect(result.chat.calls).toBe(1);
  });

  it("returns zeroes for sources not present in range", () => {
    logCall(dbPath, makeEntry({ source: "chat" }));

    const result = queryRange(dbPath, 0, Date.now() + 1);
    expect(result.consciousness.calls).toBe(0);
    expect(result.extraction.calls).toBe(0);
    expect(result.sleep.calls).toBe(0);
  });

  it("aggregates all four sources independently", () => {
    logCall(dbPath, makeEntry({ source: "chat",          totalTokens: 100, costUsd: 0.01 }));
    logCall(dbPath, makeEntry({ source: "consciousness", totalTokens: 50,  costUsd: 0.002 }));
    logCall(dbPath, makeEntry({ source: "extraction",    totalTokens: 30,  costUsd: 0.001 }));
    logCall(dbPath, makeEntry({ source: "sleep",         totalTokens: 20,  costUsd: 0.0005 }));

    const result = queryRange(dbPath, 0, Date.now() + 1);
    expect(result.chat.calls).toBe(1);
    expect(result.consciousness.calls).toBe(1);
    expect(result.extraction.calls).toBe(1);
    expect(result.sleep.calls).toBe(1);
  });
});

// ── queryToday ────────────────────────────────────────────────────────────────

maybeDescribe("queryToday", () => {
  it("includes a record written now", () => {
    logCall(dbPath, makeEntry({ source: "sleep", costUsd: 0.003 }));
    const result = queryToday(dbPath);
    expect(result.sleep.calls).toBe(1);
    expect(result.sleep.costUsd).toBeCloseTo(0.003);
  });

  it("excludes a record written before today midnight UTC", () => {
    // yesterday = 25h ago
    const yesterday = Date.now() - 25 * 60 * 60 * 1000;
    logCall(dbPath, makeEntry({ ts: yesterday, source: "chat" }));
    const result = queryToday(dbPath);
    expect(result.chat.calls).toBe(0);
  });
});
