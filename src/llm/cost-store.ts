/**
 * src/llm/cost-store.ts — BYOK LLM call cost persistence
 *
 * Appends a row per LLM call to a local SQLite database keyed by source
 * (chat / consciousness / extraction / sleep).  The existing
 * src/agents/usage.ts normalisation surface is intentionally untouched;
 * this module sits alongside it.
 *
 * Database location (default): <stateDir>/llm-costs.db
 *
 * Schema (v1):
 *   llm_calls (
 *     id               INTEGER PRIMARY KEY AUTOINCREMENT,
 *     ts               INTEGER NOT NULL,   -- unix epoch ms
 *     source           TEXT    NOT NULL,   -- LlmSource
 *     model            TEXT    NOT NULL,   -- model alias sent to LiteLLM
 *     prompt_tokens    INTEGER NOT NULL DEFAULT 0,
 *     completion_tokens INTEGER NOT NULL DEFAULT 0,
 *     total_tokens     INTEGER NOT NULL DEFAULT 0,
 *     cost_usd         REAL    NOT NULL DEFAULT 0
 *   )
 */

import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { requireNodeSqlite } from "../memory/sqlite.js";
import type { LlmSource } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CostEntry = {
  /** Unix epoch milliseconds. */
  ts: number;
  source: LlmSource;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** USD cost, or 0 when pricing is unavailable. */
  costUsd: number;
};

export type SourceCostSummary = {
  calls: number;
  totalTokens: number;
  costUsd: number;
};

export type CostBySource = Record<LlmSource, SourceCostSummary>;

const SOURCES: LlmSource[] = ["chat", "consciousness", "extraction", "sleep"];

// ── DB helpers ────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS llm_calls (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                INTEGER NOT NULL,
  source            TEXT    NOT NULL,
  model             TEXT    NOT NULL,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  cost_usd          REAL    NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_ts ON llm_calls (ts);
CREATE INDEX IF NOT EXISTS idx_llm_calls_source ON llm_calls (source);
`;

function openDb(dbPath: string): DatabaseSync {
  const { DatabaseSync } = requireNodeSqlite();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  // Apply schema (idempotent)
  db.exec(SCHEMA_SQL);
  return db;
}

// ── Write API ─────────────────────────────────────────────────────────────────

/**
 * Append a single LLM call record to the cost store.
 * Creates the database and table if they don't exist.
 */
export function logCall(dbPath: string, entry: CostEntry): void {
  const db = openDb(dbPath);
  const stmt = db.prepare(
    `INSERT INTO llm_calls
       (ts, source, model, prompt_tokens, completion_tokens, total_tokens, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(
    entry.ts,
    entry.source,
    entry.model,
    entry.promptTokens,
    entry.completionTokens,
    entry.totalTokens,
    entry.costUsd,
  );
  db.close();
}

// ── Read API ──────────────────────────────────────────────────────────────────

function zeroCostBySource(): CostBySource {
  return Object.fromEntries(
    SOURCES.map((s) => [s, { calls: 0, totalTokens: 0, costUsd: 0 }]),
  ) as CostBySource;
}

type AggRow = {
  source: string;
  calls: number;
  total_tokens: number;
  cost_usd: number;
};

function isAggRow(v: unknown): v is AggRow {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r["source"] === "string" &&
    typeof r["calls"] === "number" &&
    typeof r["total_tokens"] === "number" &&
    typeof r["cost_usd"] === "number"
  );
}

function rowsToCostBySource(rows: unknown[]): CostBySource {
  const result = zeroCostBySource();
  for (const row of rows) {
    if (!isAggRow(row)) continue;
    const source = row.source as LlmSource;
    if (!SOURCES.includes(source)) continue;
    result[source].calls += row.calls;
    result[source].totalTokens += row.total_tokens;
    result[source].costUsd += row.cost_usd;
  }
  return result;
}

/**
 * Aggregate cost records for [fromMs, toMs) by source.
 * Returns zeroed summary for sources with no records.
 */
export function queryRange(dbPath: string, fromMs: number, toMs: number): CostBySource {
  if (!fs.existsSync(dbPath)) {
    return zeroCostBySource();
  }
  const db = openDb(dbPath);
  const rows = db
    .prepare(
      `SELECT source,
              COUNT(*)           AS calls,
              SUM(total_tokens)  AS total_tokens,
              SUM(cost_usd)      AS cost_usd
       FROM llm_calls
       WHERE ts >= ? AND ts < ?
       GROUP BY source`,
    )
    .all(fromMs, toMs);
  db.close();
  return rowsToCostBySource(rows);
}

/**
 * Aggregate cost records for today (midnight UTC → now) by source.
 */
export function queryToday(dbPath: string): CostBySource {
  const now = Date.now();
  const midnightUtc = new Date();
  midnightUtc.setUTCHours(0, 0, 0, 0);
  return queryRange(dbPath, midnightUtc.getTime(), now + 1);
}
